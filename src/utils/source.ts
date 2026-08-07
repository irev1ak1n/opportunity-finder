const AGGREGATOR_DOMAINS = [
    "scholarships.com",
    "fastweb.com",
    "scholarshipowl.com",
    "niche.com",
    "bold.org",
    "cappex.com",
    "unigo.com",
    "collegeboard.org",
    "petersons.com",
    "scholarships360.org",
];

export type SourceType = "official" | "aggregator" | "unknown";

export function classifySource(url: string): {
    source_type: SourceType;
    source_confidence: "high" | "medium" | "low";
} {
    let host = "";
    try {
        host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return { source_type: "unknown", source_confidence: "low" };
    }

    if (AGGREGATOR_DOMAINS.some((d) => host.endsWith(d))) {
        return { source_type: "aggregator", source_confidence: "medium" };
    }

    // .edu / .gov / .org frequently are official providers/UNIs
    if (host.endsWith(".edu") || host.endsWith(".gov")) {
        return { source_type: "official", source_confidence: "high" };
    }
    if (host.endsWith(".org")) {
        return { source_type: "official", source_confidence: "medium" };
    }

    return { source_type: "unknown", source_confidence: "low" };
}