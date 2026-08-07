import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { supabase } from "./db.js";
import { findScholarships } from "./opportunities/find.js";

const server = new McpServer({
    name: "opportunity-finder",
    version: "0.1.0",
});

// --- Returns OK to confirm the Opportunity Finder server is running ---
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

// --- Upsert student profile ---
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

// --- Get student profile ---
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

// --- Find opportunities ---
server.registerTool(
    "find_opportunities",
    {
        title: "Find Scholarships",
        description:
            "Finds scholarships matching a student's profile. Loads the stored profile by user_id, searches the web, checks eligibility, and returns ranked matches. Currently scholarships only.",
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

        const results = await findScholarships({
            grade: profile.grade,
            age: profile.age,
            state: profile.state,
            gpa: profile.preferences?.gpa ?? null,
            interests: profile.interests ?? [],
        });

        const matches = results.map((r) => ({
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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Opportunity Finder MCP server running on stdio ✅");
}

main().catch((err) => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});