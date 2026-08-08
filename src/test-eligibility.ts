import { checkEligibility, buildWhyFit, type StudentProfile } from "./eligibility/engine.js";
import type { Opportunity } from "./types.js";

// helper to build a full Opportunity with sensible defaults
function opp(partial: Partial<Opportunity>): Opportunity {
    return {
        title: "Test Opportunity",
        organization: "Test Org",
        category: "internship",
        official_url: null,
        discovered_from_url: "https://example.com",
        source_type: "unknown",
        source_confidence: "low",
        description: null,
        deadline: null,
        location: null,
        work_mode: "unknown",
        remote: false,
        eligible_states: [],
        minimum_age: null,
        maximum_age: null,
        eligible_grades: [],
        minimum_gpa: null,
        citizenship_requirement: null,
        demographic_restrictions: [],
        award_amount: null,
        application_effort: null,
        requirements: [],
        ...partial,
    };
}

const student: StudentProfile = {
    grade: 12,
    age: 17,
    state: "CA",
    gpa: 3.8,
    interests: ["computer science"],
};

let passed = 0;
let failed = 0;

function check(name: string, got: string, expected: string) {
    const ok = got === expected;
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) console.log(`      expected "${expected}", got "${got}"`);
}

function checkContains(name: string, arr: string[], needle: string) {
    const ok = arr.some((x) => x.toLowerCase().includes(needle.toLowerCase()));
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) console.log(`      expected a reason containing "${needle}", got ${JSON.stringify(arr)}`);
}

console.log("=== Eligibility: work_mode vs residency ===\n");

// 1. Remote nationwide internship (grade matches) -> eligible
check(
    "1. Remote nationwide internship",
    checkEligibility(opp({ work_mode: "remote", location: "Houston, TX", eligible_states: [], eligible_grades: [11, 12] }), student).status,
    "eligible"
);

// 2. Remote internship restricted to NC residents -> CA student NOT eligible (remote must NOT bypass residency)
check(
    "2. Remote internship, NC residents only",
    checkEligibility(opp({ work_mode: "remote", location: "Remote", eligible_states: ["NC"] }), student).status,
    "not_eligible"
);

// 3. On-site internship in another state, no residency restriction -> eligible (location != residency)
check(
    "3. On-site in TX, no residency rule",
    checkEligibility(opp({ work_mode: "on_site", location: "Redmond, WA", eligible_states: [] }), student).status,
    "likely_eligible"
);

// 4. Hybrid internship, no residency restriction -> eligible
check(
    "4. Hybrid, no residency rule",
    checkEligibility(opp({ work_mode: "hybrid", location: "New York, NY", eligible_states: [] }), student).status,
    "likely_eligible"
);

// 5. Unknown work mode, no restrictions -- > eligible (don't assume anything)
check(
    "5. Unknown work mode, no rules",
    checkEligibility(opp({ work_mode: "unknown", location: "Boston, MA", eligible_states: [] }), student).status,
    "likely_eligible"
);

// 6. Scholarship with explicit CA residency requirement -- > CA student eligible, NC student not
check(
    "6a. Scholarship CA-only, CA student",
    checkEligibility(opp({ category: "scholarship", eligible_states: ["CA"] }), student).status,
    "eligible"
);
check(
    "6b. Scholarship CA-only, NC student",
    checkEligibility(opp({ category: "scholarship", eligible_states: ["CA"] }), { ...student, state: "NC" }).status,
    "not_eligible"
);

console.log("\n=== buildWhyFit ===\n");

// 7. buildWhyFit with grade + interest + remote match
const why7 = buildWhyFit(
    opp({
        title: "Computer Science Remote Internship",
        work_mode: "remote",
        eligible_grades: [11, 12],
    }),
    student
);
checkContains("7a. why-fit mentions interest", why7, "computer science");
checkContains("7b. why-fit mentions grade", why7, "grade 12");
checkContains("7c. why-fit mentions remote", why7, "remotely");

// 8. buildWhyFit with not enough data -> should not fabricate claims (few/no reasons, or only 'nationwide')
const why8 = buildWhyFit(
    opp({ title: "Generic Opportunity", eligible_grades: [], work_mode: "unknown" }),
    { grade: null, age: null, state: null, gpa: null, interests: [] }
);
const noFabrication = why8.every((r) =>
    /nationwide/i.test(r) // the only claim allowed with no profile data
);
if (noFabrication) {
    passed++;
    console.log(`PASS  8. why-fit with no data does not fabricate (${JSON.stringify(why8)})`);
} else {
    failed++;
    console.log(`FAIL  8. why-fit fabricated claims: ${JSON.stringify(why8)}`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);