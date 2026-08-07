export interface Opportunity {
    title: string;
    organization: string;
    category: string;                    // as if now always "scholarship"
    official_url: string | null;
    discovered_from_url: string;         // where was found  (Tavily)
    source_type: "official" | "aggregator" | "unknown";
    source_confidence: "high" | "medium" | "low";
    description: string | null;
    deadline: string | null;             // ISO "YYYY-MM-DD" or null
    location: string | null;
    remote: boolean;
    eligible_states: string[];           // [] = no limits
    minimum_age: number | null;
    maximum_age: number | null;
    eligible_grades: number[];           // [] = no limits
    minimum_gpa: number | null;
    citizenship_requirement: string | null;
    award_amount: string | null;
    application_effort: string | null;
    requirements: string[];
}