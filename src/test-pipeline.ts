import { findScholarships } from "./opportunities/find.js";

async function main() {
    const profile = {
        grade: 12,
        age: 17,
        state: "NC",
        gpa: 3.8,
        interests: ["marine biology"],
    };

    console.time("find");
    const results = await findScholarships(profile, "cache_test_user");
    console.timeEnd("find");

    console.log(`\nReturned ${results.length} matches:`);
    for (const r of results) {
        console.log(`[${r.match_score}] ${r.opportunity.title} — ${r.eligibility_status}`);
    }
}

main().catch((err) => console.error("Failed:", err));