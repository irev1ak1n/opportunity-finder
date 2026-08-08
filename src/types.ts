export interface Opportunity {
    title: string;
    organization: string;
    category: string;                    // "scholarship" | "internship" | "volunteering" | "program" | "competition"
    official_url: string | null;
    discovered_from_url: string;         // where was found (Tavily)
    source_type: "official" | "trusted_directory" | "specialized_directory" | "aggregator" | "job_board" | "unknown";
    source_confidence: "high" | "medium" | "low";
    description: string | null;
    deadline: string | null;             // ISO "YYYY-MM-DD" or null
    location: string | null;             // where the opportunity physically happens (NOT residency)
    work_mode: "remote" | "hybrid" | "on_site" | "unknown";
    remote: boolean;                     // legacy, kept for backward compatibility
    eligible_states: string[];           // RESIDENCY restriction (who may apply); [] = no limits
    minimum_age: number | null;
    maximum_age: number | null;
    eligible_grades: number[];           // [] = no limits
    minimum_gpa: number | null;
    citizenship_requirement: string | null;
    demographic_restrictions: string[];
    award_amount: string | null;
    application_effort: string | null;
    requirements: string[];
}