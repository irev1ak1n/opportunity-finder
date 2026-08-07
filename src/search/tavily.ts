import "dotenv/config";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

if (!TAVILY_API_KEY) {
    throw new Error("Missing TAVILY_API_KEY in environment (.env)");
}

export interface TavilyResult {
    title: string;
    url: string;
    content: string;
    score: number;
}

export async function tavilySearch(
    query: string,
    maxResults = 5
): Promise<TavilyResult[]> {
    const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: "basic",
            include_raw_content: false,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Tavily error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { results?: TavilyResult[] };
    return data.results ?? [];
}