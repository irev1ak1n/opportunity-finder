import { findScholarships } from "./opportunities/find.js";

async function main() {
    const profile = {
        grade: 12,
        age: 17,
        state: "NC",
        gpa: 3.8,
        interests: ["computer science", "aerospace engineering"],
    };

    console.log("Finding scholarships for profile:", profile, "\n");
    const results = await findScholarships(profile);

    console.log(`\n=== TOP ${results.length} MATCHES ===\n`);
    for (const r of results) {
        console.log(`[${r.match_score}] ${r.opportunity.title}`);
        console.log(`   ${r.eligibility_status} — ${r.eligibility_reasons[0]}`);
        console.log(`   ${r.opportunity.award_amount ?? "?"} | ${r.opportunity.source_type} | deadline: ${r.opportunity.deadline ?? "none"}`);
        console.log();
    }
}

main().catch((err) => console.error("Failed:", err));