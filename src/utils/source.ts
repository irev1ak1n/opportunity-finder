export const GENERAL_DISCOVERY_DOMAINS = [
    "highschoolopportunity.org",
    "atlasofopportunity.org",
    "extracurricularhub.com",
    "standoutsearch.com",
];

export const SCHOLARSHIP_DISCOVERY_DOMAINS = [
    "bigfuture.collegeboard.org",
    "careeronestop.org",
    "scholarships.com",
    "scholarshipowl.com",
    "fastweb.com",
    "scholarships360.org",
    "niche.com",
    "appily.com",
    "goingmerry.com",
    "bold.org",
    "unigo.com",
    "petersons.com",
    "cfnc.org",
    "finaid.org",
    "sallie.com",
];

export const INTERNSHIP_DISCOVERY_DOMAINS = [
    "usajobs.gov",
    "joinhandshake.com",
    "wayup.com",
    "internships.com",
    "indeed.com",
    "linkedin.com",
    "ziprecruiter.com",
    "standoutsearch.com",
];

export const VOLUNTEER_DISCOVERY_DOMAINS = [
    "idealist.org",
    "volunteermatch.org",
    "sharecharlotte.org",
    "pointsoflight.org",
    "engage.pointsoflight.org",
    "goldenvolunteer.com",
    "justserve.org",
    "americorps.gov",
];

export const PROGRAM_DISCOVERY_DOMAINS = [
    "highschoolopportunity.org",
    "atlasofopportunity.org",
    "extracurricularhub.com",
    "standoutsearch.com",
];

export const COMPETITION_DISCOVERY_DOMAINS = [
    "highschoolopportunity.org",
    "atlasofopportunity.org",
    "extracurricularhub.com",
    "devpost.com",
];

// Directories we trust more than generic aggregators
const TRUSTED_DIRECTORIES = [
    "careeronestop.org",
    "bigfuture.collegeboard.org",
    "idealist.org",
    "volunteermatch.org",
    "americorps.gov",
    "usajobs.gov",
    "joinhandshake.com",
];

// Specialized, curated directories for high-school opportunities
const SPECIALIZED_DIRECTORIES = [
    "highschoolopportunity.org",
    "atlasofopportunity.org",
    "extracurricularhub.com",
    "standoutsearch.com",
    "devpost.com",
];

// Generic scholarship aggregators.
const AGGREGATOR_DOMAINS = [
    "scholarships.com",
    "fastweb.com",
    "scholarshipowl.com",
    "niche.com",
    "bold.org",
    "cappex.com",
    "unigo.com",
    "petersons.com",
    "scholarships360.org",
    "appily.com",
    "goingmerry.com",
    "finaid.org",
    "sallie.com",
];

// Job boards (fine for internships, but generic)
const JOB_BOARDS = [
    "indeed.com",
    "linkedin.com",
    "ziprecruiter.com",
    "wayup.com",
    "internships.com",
];

export type SourceType =
    | "official"
    | "trusted_directory"
    | "specialized_directory"
    | "aggregator"
    | "job_board"
    | "unknown";

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

    const endsWithAny = (list: string[]) => list.some((d) => host === d || host.endsWith("." + d) || host.endsWith(d));

    // trusted / specialized directories first (before generic .org/.gov catch-all)
    if (endsWithAny(TRUSTED_DIRECTORIES)) {
        return { source_type: "trusted_directory", source_confidence: "high" };
    }
    if (endsWithAny(SPECIALIZED_DIRECTORIES)) {
        return { source_type: "specialized_directory", source_confidence: "medium" };
    }
    if (endsWithAny(AGGREGATOR_DOMAINS)) {
        return { source_type: "aggregator", source_confidence: "medium" };
    }
    if (endsWithAny(JOB_BOARDS)) {
        return { source_type: "job_board", source_confidence: "medium" };
    }

    // official providers: .gov / .edu are strong, .org medium
    if (host.endsWith(".gov")) {
        return { source_type: "official", source_confidence: "high" };
    }
    if (host.endsWith(".edu")) {
        return { source_type: "official", source_confidence: "high" };
    }
    if (host.endsWith(".org")) {
        return { source_type: "official", source_confidence: "medium" };
    }

    return { source_type: "unknown", source_confidence: "low" };
}

// Ranking bonus by source quality (higher = better)
export function sourceRankBonus(type: SourceType): number {
    switch (type) {
        case "official": return 15;
        case "trusted_directory": return 10;
        case "specialized_directory": return 8;
        case "aggregator": return 4;
        case "job_board": return 3;
        case "unknown": return 0;
    }
}

// Preferred discovery domains for a given category (for targeted site: searches)
export function preferredDomains(category: string): string[] {
    switch (category) {
        case "internship": return [...INTERNSHIP_DISCOVERY_DOMAINS, ...GENERAL_DISCOVERY_DOMAINS];
        case "volunteering": return [...VOLUNTEER_DISCOVERY_DOMAINS, ...GENERAL_DISCOVERY_DOMAINS];
        case "program": return PROGRAM_DISCOVERY_DOMAINS;
        case "competition": return COMPETITION_DISCOVERY_DOMAINS;
        case "scholarship":
        default: return [...SCHOLARSHIP_DISCOVERY_DOMAINS, ...GENERAL_DISCOVERY_DOMAINS];
    }
}