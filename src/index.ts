import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { supabase } from "./db.js";

const server = new McpServer({
    name: "opportunity-finder",
    version: "0.1.0",
});

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

// --- Creates new profile or updates current one ---
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

// --- Gets student profile ---
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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Opportunity Finder MCP server running on stdio ✅");
}

main().catch((err) => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});