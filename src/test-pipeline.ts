import { findScholarships } from "./opportunities/find.js";

async function main() {
    const profile = {
        grade: 12, age: 17, state: "NC", gpa: 3.8,
        interests: ["computer science"],
    };

    console.time("internships");
    const results = await findScholarships(profile, "internship_test_user", "internship");
    console.timeEnd("internships");

    console.log(`\nReturned ${results.length} internships:\n`);
    for (const r of results) {
        console.log(`[${r.match_score}] ${r.opportunity.title}`);
        console.log(`   category: ${r.opportunity.category} | pay: ${r.opportunity.award_amount}`);
        console.log(`   ${r.eligibility_status} — ${r.eligibility_reasons[0]}`);
        console.log();
    }
}

main().catch((err) => console.error("Failed:", err));