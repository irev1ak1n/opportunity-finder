import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "./db.js";
import { findScholarships } from "./opportunities/find.js";

type GetUserId = () => string;

const VALID_STATUSES = [
    "recommended",
    "saved",
    "planning_to_apply",
    "in_progress",
    "applied",
    "accepted",
    "rejected",
    "completed",
    "not_interested",
] as const;

const DEFAULT_LIST_STATUSES = [
    "saved",
    "planning_to_apply",
    "in_progress",
    "applied",
    "accepted",
];

export function registerTools(server: McpServer, getUserId: GetUserId) {
    server.registerTool(
        "health_check",
        {
            title: "Health Check",
            description: "Returns OK to confirm the Opportunity Finder server is running.",
            inputSchema: {},
        },
        async () => ({
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: "ok",
                        service: "opportunity-finder",
                        time: new Date().toISOString(),
                    }),
                },
            ],
        })
    );

    server.registerTool(
        "upsert_student_profile",
        {
            title: "Create or Update Student Profile",
            description:
                "Creates or updates the current student's profile. Only provided fields are changed.",
            inputSchema: {
                grade: z.number().int().optional(),
                age: z.number().int().optional(),
                state: z.string().optional(),
                city: z.string().optional(),
                zip: z.string().optional(),
                interests: z.array(z.string()).optional(),
                opportunity_types: z.array(z.string()).optional(),
                preferences: z.record(z.string(), z.any()).optional(),
            },
        },
        async (args) => {
            const user_id = getUserId();
            const row = { user_id, ...args, updated_at: new Date().toISOString() };

            const { data, error } = await supabase
                .from("profiles")
                .upsert(row, { onConflict: "user_id" })
                .select()
                .single();

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, profile: data }) }] };
        }
    );

    server.registerTool(
        "get_student_profile",
        {
            title: "Get Student Profile",
            description: "Retrieves the current student's profile.",
            inputSchema: {},
        },
        async () => {
            const user_id = getUserId();
            const { data, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("user_id", user_id)
                .maybeSingle();

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }
            if (!data) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: true, found: false, profile: null }) }],
                };
            }
            return {
                content: [{ type: "text", text: JSON.stringify({ ok: true, found: true, profile: data }) }],
            };
        }
    );

    server.registerTool(
        "find_opportunities",
        {
            title: "Find Scholarships",
            description:
                "Finds scholarships matching the current student's stored profile. Returns ranked matches, each with an opportunity_id needed to save. Excludes previously seen ones. Currently scholarships only.",
            inputSchema: {},
        },
        async () => {
            const user_id = getUserId();
            const { data: profile, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("user_id", user_id)
                .maybeSingle();

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }
            if (!profile) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                ok: false,
                                error: "No profile found. Ask the student for grade, location, and interests first.",
                            }),
                        },
                    ],
                };
            }

            const results = await findScholarships(
                {
                    grade: profile.grade,
                    age: profile.age,
                    state: profile.state,
                    gpa: profile.preferences?.gpa ?? null,
                    interests: profile.interests ?? [],
                },
                user_id
            );

            const matches = results.map((r) => ({
                opportunity_id: r.opportunity_id,
                title: r.opportunity.title,
                organization: r.opportunity.organization,
                eligibility: r.eligibility_status,
                why: r.eligibility_reasons[0],
                award_amount: r.opportunity.award_amount,
                deadline: r.opportunity.deadline,
                source_type: r.opportunity.source_type,
                source: r.opportunity.discovered_from_url,
                official_url: r.opportunity.official_url,
                match_score: r.match_score,
            }));

            return {
                content: [
                    { type: "text", text: JSON.stringify({ ok: true, count: matches.length, matches }, null, 2) },
                ],
            };
        }
    );

    server.registerTool(
        "save_opportunity",
        {
            title: "Save Opportunity",
            description:
                "Saves an opportunity to the current student's list. Use the opportunity_id from find_opportunities results.",
            inputSchema: {
                opportunity_id: z.string().describe("The opportunity_id returned by find_opportunities."),
            },
        },
        async ({ opportunity_id }) => {
            const user_id = getUserId();
            const now = new Date().toISOString();
            const { data, error } = await supabase
                .from("user_opportunities")
                .upsert(
                    { user_id, opportunity_id, status: "saved", saved_at: now, updated_at: now },
                    { onConflict: "user_id,opportunity_id" }
                )
                .select("opportunity_id, status")
                .single();

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, saved: data }) }] };
        }
    );

    server.registerTool(
        "save_opportunity_by_title",
        {
            title: "Save Opportunity By Title",
            description:
                "Saves an opportunity to the student's list by its title (or part of it). Use this when you have the scholarship name but not its opportunity_id. Matches against the student's recently recommended opportunities.",
            inputSchema: {
                title_query: z.string().describe("The scholarship title or part of it, e.g. 'Endeavour' or 'Golden Door'."),
            },
        },
        async ({ title_query }) => {
            const user_id = getUserId();

            const { data: recs, error: recErr } = await supabase
                .from("user_opportunities")
                .select("opportunity_id, opportunities(title)")
                .eq("user_id", user_id)
                .eq("status", "recommended")
                .order("recommended_at", { ascending: false })
                .limit(50);

            if (recErr || !recs || recs.length === 0) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No recent recommendations found. Run a search first." }) }],
                };
            }

            const q = title_query.toLowerCase();
            const match = (recs as any[]).find((r) =>
                (r.opportunities?.title ?? "").toLowerCase().includes(q)
            );

            if (!match) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: `No recommended scholarship matching "${title_query}".` }) }],
                };
            }

            const now = new Date().toISOString();
            const { error } = await supabase
                .from("user_opportunities")
                .update({ status: "saved", saved_at: now, updated_at: now })
                .eq("user_id", user_id)
                .eq("opportunity_id", match.opportunity_id);

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }

            return {
                content: [{ type: "text", text: JSON.stringify({ ok: true, saved: match.opportunities?.title }) }],
            };
        }
    );

    server.registerTool(
        "update_opportunity_status",
        {
            title: "Update Opportunity Status",
            description:
                "Updates the status of an opportunity on the current student's list (applied, in_progress, accepted, rejected, not_interested, etc). Use opportunity_id from find_opportunities or my_list.",
            inputSchema: {
                opportunity_id: z.string().describe("The opportunity_id."),
                status: z.enum(VALID_STATUSES).describe("New status."),
            },
        },
        async ({ opportunity_id, status }) => {
            const user_id = getUserId();
            const now = new Date().toISOString();
            const patch: Record<string, unknown> = { user_id, opportunity_id, status, updated_at: now };
            if (status === "applied") patch.applied_at = now;
            if (status === "saved") patch.saved_at = now;

            const { data, error } = await supabase
                .from("user_opportunities")
                .upsert(patch, { onConflict: "user_id,opportunity_id" })
                .select("opportunity_id, status")
                .single();

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, updated: data }) }] };
        }
    );

    server.registerTool(
        "get_my_list",
        {
            title: "Get My List",
            description:
                "Returns the current student's saved and active opportunities. By default shows saved/planning/in_progress/applied/accepted. Pass include_all=true to also show recommended/rejected/not_interested.",
            inputSchema: {
                include_all: z.boolean().optional(),
            },
        },
        async ({ include_all }) => {
            const user_id = getUserId();
            let query = supabase
                .from("user_opportunities")
                .select(
                    "status, match_score, applied_at, saved_at, opportunities(title, organization, deadline, award_amount, official_url, discovered_from_url)"
                )
                .eq("user_id", user_id)
                .order("updated_at", { ascending: false });

            if (!include_all) {
                query = query.in("status", DEFAULT_LIST_STATUSES);
            }

            const { data, error } = await query;

            if (error) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
                    isError: true,
                };
            }

            const list = (data ?? []).map((row: any) => ({
                title: row.opportunities?.title,
                organization: row.opportunities?.organization,
                status: row.status,
                deadline: row.opportunities?.deadline,
                award_amount: row.opportunities?.award_amount,
                applied_at: row.applied_at,
                source: row.opportunities?.official_url ?? row.opportunities?.discovered_from_url,
            }));

            return {
                content: [{ type: "text", text: JSON.stringify({ ok: true, count: list.length, list }, null, 2) }],
            };
        }
    );
}