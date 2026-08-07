import type { Opportunity } from "../types.js";

export interface StudentProfile {
    grade?: number | null;
    age?: number | null;
    state?: string | null;
    minimum_gpa?: number | null;
    gpa?: number | null;
}

export type EligibilityStatus =
    | "eligible"
    | "likely_eligible"
    | "missing_info"
    | "not_eligible";

export interface EligibilityResult {
    status: EligibilityStatus;
    reasons: string[];
}

// Is the deasline expired?
export function isExpired(opp: Opportunity, now = new Date()): boolean {
    if (!opp.deadline)
        return false; // no date — not considered expired
    const d = new Date(opp.deadline);
    if (isNaN(d.getTime()))
        return false;
    return d.getTime() < now.getTime();
}

export function checkEligibility(
    opp: Opportunity,
    student: StudentProfile
): EligibilityResult {
    const reasons: string[] = [];
    let missing = false;

    // --- grade ---
    if (opp.eligible_grades.length > 0) {
        if (student.grade == null) {
            missing = true;
            reasons.push("Grade requirement exists but your grade is unknown.");
        } else if (!opp.eligible_grades.includes(student.grade)) {
            return {
                status: "not_eligible",
                reasons: [`Requires grade ${opp.eligible_grades.join("/")}, you are grade ${student.grade}.`],
            };
        } else {
            reasons.push("Grade requirement met.");
        }
    }

    // --- age ---
    if (opp.minimum_age != null || opp.maximum_age != null) {
        if (student.age == null) {
            missing = true;
            reasons.push("Age requirement exists but your age is unknown.");
        } else {
            if (opp.minimum_age != null && student.age < opp.minimum_age) {
                return { status: "not_eligible", reasons: [`Minimum age ${opp.minimum_age}, you are ${student.age}.`] };
            }
            if (opp.maximum_age != null && student.age > opp.maximum_age) {
                return { status: "not_eligible", reasons: [`Maximum age ${opp.maximum_age}, you are ${student.age}.`] };
            }
            reasons.push("Age requirement met.");
        }
    }

    // --- state ---
    if (opp.eligible_states.length > 0) {
        if (!student.state) {
            missing = true;
            reasons.push("State restriction exists but your state is unknown.");
        } else if (!opp.eligible_states.includes(student.state.toUpperCase())) {
            return {
                status: "not_eligible",
                reasons: [`Limited to ${opp.eligible_states.join("/")}, you are in ${student.state}.`],
            };
        } else {
            reasons.push("State requirement met.");
        }
    }

    // --- GPA ---
    const studentGpa = student.gpa ?? student.minimum_gpa ?? null;
    if (opp.minimum_gpa != null) {
        if (studentGpa == null) {
            missing = true;
            reasons.push("GPA requirement exists but your GPA is unknown.");
        } else if (studentGpa < opp.minimum_gpa) {
            return { status: "not_eligible", reasons: [`Minimum GPA ${opp.minimum_gpa}, yours is ${studentGpa}.`] };
        } else {
            reasons.push("GPA requirement met.");
        }
    }

    // --- citizenship: cant test, only mark ---
    if (opp.citizenship_requirement) {
        missing = true;
        reasons.push(`Citizenship requirement (${opp.citizenship_requirement}) could not be confirmed.`);
    }

    if (missing) {
        return { status: "likely_eligible", reasons };
    }
    if (reasons.length === 0) {
        return { status: "likely_eligible", reasons: ["No hard restrictions found; likely open to you."] };
    }
    return { status: "eligible", reasons };
}