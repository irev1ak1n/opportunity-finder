import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { registerTools } from "./tools.js";
import { findScholarships, type Category } from "./opportunities/find.js";
import { buildWhyFit } from "./eligibility/engine.js";

const userIdStore = new AsyncLocalStorage<string>();

function getUserId(): string {
    const id = userIdStore.getStore();
    return id ?? "anonymous";
}

const app = express();
app.use(express.json());

// the landing page (Vercel) calls this backend (Railway) from a different origin.
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
    }
    next();
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "opportunity-finder" });
});

// Public demo endpoint for the landing page "Quick Live Preview".
// Reuses the exact same search, eligibility and ranking pipeline as Poke
app.post("/api/demo-search", async (req, res) => {
    try {
        const { state, grade, interest, category } = req.body ?? {};

        const profile = {
            grade: Number(grade) || 12,
            age: 17,
            state: (state as string) || "NC",
            gpa: 3.8,
            interests: interest ? [String(interest)] : [],
        };

        const valid: Category[] = ["scholarship", "internship", "volunteering", "program", "competition"];
        const cat: Category = valid.includes(category) ? category : "internship";

        const results = await findScholarships(profile, undefined, cat);

        const out = results.slice(0, 3).map((r) => ({
            title: r.opportunity.title,
            organization: r.opportunity.organization,
            eligibility: r.eligibility_status,
            score: r.match_score,
            whyFit: buildWhyFit(r.opportunity, profile),
            workMode: r.opportunity.work_mode,
            location: r.opportunity.location,
            deadline: r.opportunity.deadline,
            awardAmount: r.opportunity.award_amount,
            source: r.opportunity.official_url ?? r.opportunity.discovered_from_url,
            sourceType: r.opportunity.source_type,
        }));

        res.json({ ok: true, category: cat, results: out });
    } catch (err) {
        res.json({ ok: false, error: (err as Error).message, results: [] });
    }
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