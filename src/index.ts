import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { registerTools } from "./tools.js";

const userIdStore = new AsyncLocalStorage<string>();

function getUserId(): string {
    const id = userIdStore.getStore();
    return id ?? "anonymous";
}

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "opportunity-finder" });
});

app.post("/mcp", async (req, res) => {
    const pokeUserId =
        (req.header("X-Poke-User-Id") as string | undefined) ?? "anonymous";

    const server = new McpServer({ name: "opportunity-finder", version: "0.1.0" });
    registerTools(server, getUserId);

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });

    res.on("close", () => {
        transport.close();
        server.close();
    });

    await userIdStore.run(pokeUserId, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
    console.error(`Opportunity Finder MCP server (HTTP) on http://localhost:${PORT}/mcp`);
});