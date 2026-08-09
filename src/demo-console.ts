import { findScholarships, type Category } from "./opportunities/find.js";
import { checkEligibility, buildWhyFit, whyFitSentence, type StudentProfile } from "./eligibility/engine.js";
import type { Opportunity } from "./types.js";

const DLINE = "=".repeat(50);

function fmtWorkMode(m: string): string {
    switch (m) {
        case "remote": return "Remote";
        case "hybrid": return "Hybrid";
        case "on_site": return "On site";
        default: return "Not specified";
    }
}

function resolveWorkMode(opp: Opportunity): string {
    if (opp.work_mode && opp.work_mode !== "unknown") return fmtWorkMode(opp.work_mode);
    return "Not specified";
}

function fmtStatus(s: string): string {
    switch (s) {
        case "eligible": return "ELIGIBLE";
        case "likely_eligible": return "LIKELY ELIGIBLE";
        case "missing_info": return "MORE INFORMATION NEEDED";
        case "not_eligible": return "NOT ELIGIBLE";
        default: return s.toUpperCase();
    }
}

function safeLocation(opp: Opportunity): string | null {
    if (!opp.location) return null;
    const loc = opp.location.trim();
    if (!loc || /not specified/i.test(loc)) return null;

    const fromDirectory =
        opp.source_type === "specialized_directory" ||
        opp.source_type === "aggregator" ||
        opp.source_type === "job_board";

    if (fromDirectory) {
        if (/virtual|remote|online|nationwide/i.test(loc)) return loc;
        const orgTokens = (opp.organization ?? "")
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length > 3);
        const locLower = loc.toLowerCase();
        const related = orgTokens.some((t) => locLower.includes(t));
        if (!related) return null; // likely leaked from another entry on the list page
    }
    return loc;
}

function summaryLine(opp: Opportunity): string {
    const parts: string[] = [];
    const wm = resolveWorkMode(opp);
    if (wm !== "Not specified") parts.push(wm);
    const loc = safeLocation(opp);
    if (loc && !/virtual|remote/i.test(loc) && wm !== "Remote") parts.push(loc);
    if (opp.award_amount) parts.push(opp.award_amount);
    return parts.join(" · ");
}

export function formatOpportunity(
    opp: Opportunity,
    status: string,
    reasons: string[],
    score: number,
    student: StudentProfile
): string {
    const out: string[] = [];
    const title = opp.organization ? `${opp.title} @ ${opp.organization}` : opp.title;
    out.push(title);

    const summary = summaryLine(opp);
    if (summary) out.push(summary);
    out.push("");

    if (opp.description) {
        out.push(opp.description.slice(0, 240).trim());
        out.push("");
    }

    out.push(`ELIGIBILITY: ${fmtStatus(status)}`);
    out.push(`MATCH SCORE: ${score}`);
    out.push("");

    out.push("Why it fits you:");
    out.push("  " + whyFitSentence(opp, student));
    out.push("");

    out.push("Eligibility checks:");
    const isNot = status === "not_eligible";
    reasons.forEach((r) => {
        const caution = isNot || /double-check|make sure|could not be confirmed|specific gender|eligibility group/i.test(r);
        out.push(`  ${caution ? "!" : "✓"} ${r}`);
    });
    out.push("");

    if (opp.deadline) out.push(`Deadline: ${opp.deadline}`);
    const loc = safeLocation(opp);
    out.push(`Location: ${loc ?? "Not specified"}`);
    out.push("");

    out.push(`Source: ${opp.official_url ?? opp.discovered_from_url}`);
    out.push(`Source type: ${opp.source_type}  |  Confidence: ${opp.source_confidence}`);

    return out.join("\n");
}

async function runQuery(label: string, category: Category, student: StudentProfile & { interests?: string[] }) {
    console.log(DLINE);
    console.log("OPPORTUNITY FINDER");
    console.log(DLINE);
    console.log(`Query: ${label}`);
    console.log(`Student: grade ${student.grade}, ${student.state}, age ${student.age}, interests: ${student.interests?.join(", ")}`);
    console.log("");

    const results = await findScholarships(student, undefined, category);

    if (results.length === 0) {
        console.log("(no matches — warm the cache first)\n");
        return;
    }

    results.forEach((r, i) => {
        console.log(DLINE);
        console.log(`RESULT #${i + 1}`);
        console.log(DLINE);
        console.log(formatOpportunity(r.opportunity, r.eligibility_status, r.eligibility_reasons, r.match_score, student));
        console.log("");
    });
}

function demoResidencyRule() {
    console.log(DLINE);
    console.log("RESIDENCY RULE DEMONSTRATION");
    console.log("Remote does NOT bypass an explicit residency requirement.");
    console.log(DLINE);

    const remoteNCOnly: Opportunity = {
        title: "Remote Tech Internship (NC residents only)",
        organization: "Example Program",
        category: "internship",
        official_url: null,
        discovered_from_url: "https://example.com",
        source_type: "official",
        source_confidence: "high",
        description: "A fully remote internship, open only to North Carolina residents.",
        deadline: "2026-12-01",
        location: "Remote",
        work_mode: "remote",
        remote: true,
        eligible_states: ["NC"],
        minimum_age: null,
        maximum_age: null,
        eligible_grades: [],
        minimum_gpa: null,
        citizenship_requirement: null,
        demographic_restrictions: [],
        award_amount: "Paid",
        application_effort: null,
        requirements: [],
    };

    const caStudent: StudentProfile = { grade: 12, age: 17, state: "CA", gpa: 3.8, interests: ["computer science"] };
    const ncStudent: StudentProfile = { grade: 12, age: 17, state: "NC", gpa: 3.8, interests: ["computer science"] };

    for (const [who, student] of [["California student", caStudent], ["North Carolina student", ncStudent]] as const) {
        const e = checkEligibility(remoteNCOnly, student);
        console.log("");
        console.log("Work mode: Remote  |  Residency requirement: North Carolina");
        console.log(`Student state: ${student.state} (${who})`);
        console.log(`Result: ${fmtStatus(e.status)}`);
        e.reasons.forEach((r) => console.log(`  ${e.status === "not_eligible" ? "✗" : "✓"} ${r}`));
    }
    console.log("");
}

async function main() {
    const student: StudentProfile & { interests?: string[] } = {
        grade: 12, age: 17, state: "NC", gpa: 3.8, interests: ["computer science"],
    };
    await runQuery("software engineering internships", "internship", student);
    demoResidencyRule();
}

main().catch((err) => console.error("Demo failed:", err));