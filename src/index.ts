import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Opportunity Finder MCP server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});