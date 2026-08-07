import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { supabase } from "./db.js";
import { findScholarships } from "./opportunities/find.js";

const server = new McpServer({
    name: "opportunity-finder",
    version: "0.1.0",
});

// --- health_check ---
server.registerTool(
    "health_check",
    {
        title: "Health Check",
        description: "Returns OK to confirm the Opportunity Finder server is running.",
        inputSchema: {},
    },
    async () => {
        return {
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
        };
    }
);

// --- upsert_student_profile ---
server.registerTool(
    "upsert_student_profile",
    {
        title: "Create or Update Student Profile",
        description:
            "Creates or updates a student's profile. Only provided fields are changed. Requires user_id.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
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
        const row = {
            ...args,
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from("profiles")
            .upsert(row, { onConflict: "user_id" })
            .select()
            .single();

        if (error) {
            return {
                content: [
                    { type: "text", text: JSON.stringify({ ok: false, error: error.message }) },
                ],
                isError: true,
            };
        }

        return {
            content: [
                { type: "text", text: JSON.stringify({ ok: true, profile: data }) },
            ],
        };
    }
);

// --- get_student_profile ---
server.registerTool(
    "get_student_profile",
    {
        title: "Get Student Profile",
        description: "Retrieves a student's profile by user_id.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
        },
    },
    async ({ user_id }) => {
        const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("user_id", user_id)
            .maybeSingle();

        if (error) {
            return {
                content: [
                    { type: "text", text: JSON.stringify({ ok: false, error: error.message }) },
                ],
                isError: true,
            };
        }

        if (!data) {
            return {
                content: [
                    { type: "text", text: JSON.stringify({ ok: true, found: false, profile: null }) },
                ],
            };
        }

        return {
            content: [
                { type: "text", text: JSON.stringify({ ok: true, found: true, profile: data }) },
            ],
        };
    }
);

// --- find_opportunities ---
server.registerTool(
    "find_opportunities",
    {
        title: "Find Scholarships",
        description:
            "Finds scholarships matching a student's profile. Loads the stored profile by user_id, searches the web, checks eligibility, and returns ranked matches with an opportunity_id for each (needed to save). Currently scholarships only.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
        },
    },
    async ({ user_id }) => {
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
            opportunity_id: r.opportunity_id, // needed for save_opportunity
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
                {
                    type: "text",
                    text: JSON.stringify({ ok: true, count: matches.length, matches }, null, 2),
                },
            ],
        };
    }
);

// --- save_opportunity ---
server.registerTool(
    "save_opportunity",
    {
        title: "Save Opportunity",
        description:
            "Saves an opportunity to the student's list. Use the opportunity_id from find_opportunities results.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
            opportunity_id: z.string().describe("The opportunity_id returned by find_opportunities."),
        },
    },
    async ({ user_id, opportunity_id }) => {
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from("user_opportunities")
            .upsert(
                {
                    user_id,
                    opportunity_id,
                    status: "saved",
                    saved_at: now,
                    updated_at: now,
                },
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

        return {
            content: [{ type: "text", text: JSON.stringify({ ok: true, saved: data }) }],
        };
    }
);

// --- update_opportunity_status ---
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

server.registerTool(
    "update_opportunity_status",
    {
        title: "Update Opportunity Status",
        description:
            "Updates the status of an opportunity on the student's list (e.g. applied, in_progress, accepted, rejected, not_interested). Use opportunity_id from find_opportunities or my_list.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
            opportunity_id: z.string().describe("The opportunity_id."),
            status: z.enum(VALID_STATUSES).describe("New status."),
        },
    },
    async ({ user_id, opportunity_id, status }) => {
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {
            user_id,
            opportunity_id,
            status,
            updated_at: now,
        };
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

        return {
            content: [{ type: "text", text: JSON.stringify({ ok: true, updated: data }) }],
        };
    }
);

// --- get_my_list ---
const DEFAULT_LIST_STATUSES = [
    "saved",
    "planning_to_apply",
    "in_progress",
    "applied",
    "accepted",
];

server.registerTool(
    "get_my_list",
    {
        title: "Get My List",
        description:
            "Returns the student's saved and active opportunities. By default shows saved/planning/in_progress/applied/accepted. Pass include_all=true to also show recommended/rejected/not_interested.",
        inputSchema: {
            user_id: z.string().describe("Unique identifier for the student."),
            include_all: z.boolean().optional().describe("If true, include recommended/rejected/not_interested too."),
        },
    },
    async ({ user_id, include_all }) => {
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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Opportunity Finder MCP server running on stdio ✅");
}

main().catch((err) => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});