import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "./db.js";
import { findScholarships, type Category } from "./opportunities/find.js";

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

function matchReason(opp: { title: string; description?: string | null }, interests: string[]): string {
    const text = `${opp.title} ${opp.description ?? ""}`.toLowerCase();
    const hit = interests.find((i) => text.includes(i.toLowerCase()));
    if (hit) return `Matches your interest in ${hit}.`;
    return "Open to your profile.";
}

async function trackingSummary(user_id: string): Promise<{ tracked_count: number; next_deadline: string | null }> {
    const active = ["saved", "planning_to_apply", "in_progress", "applied", "accepted"];
    const { data } = await supabase
        .from("user_opportunities")
        .select("opportunities(deadline)")
        .eq("user_id", user_id)
        .in("status", active);

    const rows = (data ?? []) as any[];
    const deadlines = rows
        .map((r) => r.opportunities?.deadline)
        .filter((d): d is string => !!d)
        .filter((d) => new Date(d) >= new Date())
        .sort();

    return { tracked_count: rows.length, next_deadline: deadlines[0] ?? null };
}

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
            title: "Find Opportunities",
            description:
                "Finds opportunities for the student's profile and returns a ready-to-send message. " +
                "Pass category based on what the student asked for: use \"internship\" if they asked for internships, programs, or work experience; otherwise use \"scholarship\" (the default). " +
                "Send the returned text to the user AS-IS. Do not reformat, summarize, shorten, or remove the eligibility lines.",
            inputSchema: {
                category: z.enum(["scholarship", "internship"]).optional()
                    .describe("What kind of opportunity to find. Default is scholarship."),
            },
        },
        async ({ category }) => {
            const user_id = getUserId();
            const cat: Category = category ?? "scholarship";

            const { data: profile, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("user_id", user_id)
                .maybeSingle();

            if (error) {
                return {
                    content: [{ type: "text", text: `Error: ${error.message}` }],
                    isError: true,
                };
            }
            if (!profile) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No profile found yet. Tell me your grade, location, and interests first.",
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
                user_id,
                cat
            );

            const labelMap: Record<string, string> = {
                eligible: "✓ Eligible",
                likely_eligible: "◐ Likely eligible",
                missing_info: "? Missing info",
                not_eligible: "✗ Not eligible",
            };

            const noun = cat === "internship" ? "internships" : "scholarships";

            const lines: string[] = results.map((r, i) => {
                const o = r.opportunity;
                const label = labelMap[r.eligibility_status] ?? r.eligibility_status;
                const why = r.eligibility_reasons.slice(0, 3).join(" · ");
                const match = matchReason(o, profile.interests ?? []);
                const amount = o.award_amount ? ` — ${o.award_amount}` : "";
                const deadline = o.deadline ? ` (deadline ${o.deadline})` : "";
                const src = o.official_url ?? o.discovered_from_url ?? "";

                return (
                    `${i + 1}. ${o.title}${amount}${deadline}\n` +
                    `   ${label}\n` +
                    `   Why you qualify: ${why}\n` +
                    `   ${match}\n` +
                    `   Source: ${src}`
                );
            });

            const display_text = lines.length
                ? lines.join("\n\n")
                : `No new ${noun} right now — you've already seen the current matches.`;

            return {
                content: [
                    {
                        type: "text",
                        text: display_text,
                    },
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
            const summary = await trackingSummary(user_id);
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, saved: data, tracking: summary }) }] };
        }
    );

    server.registerTool(
        "save_opportunity_by_title",
        {
            title: "Save Opportunity By Title",
            description:
                "Saves an opportunity to the student's list by its title (or part of it). Use when you have the name but not its opportunity_id. " +
                "After saving, show the confirmation AND the tracking summary (how many opportunities are tracked and the nearest deadline) so the student sees their list is growing.",
            inputSchema: {
                title_query: z.string().describe("The opportunity title or part of it, e.g. 'Endeavour' or 'Golden Door'."),
            },
        },
        async ({ title_query }) => {
            const user_id = getUserId();

            const { data: recs } = await supabase
                .from("user_opportunities")
                .select("opportunity_id, opportunities(title)")
                .eq("user_id", user_id)
                .eq("status", "recommended")
                .order("recommended_at", { ascending: false })
                .limit(50);

            if (!recs || recs.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No recent recommendations found. Run a search first." }) }] };
            }

            const q = title_query.toLowerCase();
            const match = (recs as any[]).find((r) => (r.opportunities?.title ?? "").toLowerCase().includes(q));

            if (!match) {
                return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `No recommended opportunity matching "${title_query}".` }) }] };
            }

            const now = new Date().toISOString();
            const { error } = await supabase
                .from("user_opportunities")
                .update({ status: "saved", saved_at: now, updated_at: now })
                .eq("user_id", user_id)
                .eq("opportunity_id", match.opportunity_id);

            if (error) {
                return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }], isError: true };
            }

            const summary = await trackingSummary(user_id);

            return {
                content: [{ type: "text", text: JSON.stringify({ ok: true, saved: match.opportunities?.title, tracking: summary }) }],
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
            const summary = await trackingSummary(user_id);
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, updated: data, tracking: summary }) }] };
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