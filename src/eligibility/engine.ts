import type { Opportunity } from "../types.js";

export interface StudentProfile {
    grade?: number | null;
    age?: number | null;
    state?: string | null;
    minimum_gpa?: number | null;
    gpa?: number | null;
    gender?: string | null;
    military_family?: boolean | null;
    interests?: string[];
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

export function isExpired(opp: Opportunity, now = new Date()): boolean {
    if (!opp.deadline) return false;
    const d = new Date(opp.deadline);
    if (isNaN(d.getTime())) return false;
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

    // --- state / residency ---
    // IMPORTANT: eligible_states is a RESIDENCY restriction (who may apply),
    // NOT where the opportunity happens. work_mode does NOT bypass it.
    // Remote only means the student need not travel; residency still applies.
    if (opp.eligible_states.length > 0) {
        if (!student.state) {
            missing = true;
            reasons.push("Residency restriction exists but your state is unknown.");
        } else if (!opp.eligible_states.includes(student.state.toUpperCase())) {
            return {
                status: "not_eligible",
                reasons: [`Open only to residents of ${opp.eligible_states.join("/")}, you are in ${student.state}.`],
            };
        } else {
            reasons.push("Residency requirement met.");
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

    // --- citizenship ---
    if (opp.citizenship_requirement) {
        missing = true;
        reasons.push(`Citizenship requirement (${opp.citizenship_requirement}) could not be confirmed.`);
    }

    // --- demographic restrictions (variant C) ---
    if (opp.demographic_restrictions && opp.demographic_restrictions.length > 0) {
        const restr = opp.demographic_restrictions.map((r) => r.toLowerCase());
        const mentions = (keys: string[]) => restr.some((r) => keys.some((k) => r.includes(k)));
        const label = opp.demographic_restrictions.join(", ");

        const femaleOnly = mentions(["women", "woman", "female", "girls"]);
        const maleOnly = mentions(["men only", "male only", "boys"]);
        const gender = student.gender ? student.gender.toLowerCase() : null;

        if (femaleOnly && gender === "male") {
            return { status: "not_eligible", reasons: ["Limited to women."] };
        }
        if (maleOnly && gender === "female") {
            return { status: "not_eligible", reasons: ["Limited to men."] };
        }
        if ((femaleOnly || maleOnly) && !gender) {
            missing = true;
            reasons.push(`This looks limited to a specific gender (${label}). Make sure it applies to you.`);
        }

        const militaryOnly = mentions(["military", "veteran", "armed forces", "service member"]);
        if (militaryOnly) {
            if (student.military_family === false) {
                return { status: "not_eligible", reasons: ["Limited to military or veteran families."] };
            }
            missing = true;
            reasons.push("For military or veteran families. Double-check you qualify.");
        }

        const identityBased = mentions([
            "ethnicity", "hispanic", "latino", "black", "african american",
            "asian", "native", "indigenous", "first-generation", "first generation",
            "disability", "lgbtq",
        ]);
        if (identityBased) {
            missing = true;
            reasons.push(`Has a specific eligibility group (${label}). Double-check you qualify.`);
        }
    }

    if (missing) {
        return { status: "likely_eligible", reasons };
    }
    if (reasons.length === 0) {
        return { status: "likely_eligible", reasons: ["No hard restrictions found; likely open to you."] };
    }
    return { status: "eligible", reasons };
}

// --- deterministic "why it fits" (facts only, no AI fluff) ---
export function buildWhyFit(opp: Opportunity, student: StudentProfile): string[] {
    const reasons: string[] = [];

    // interest match
    const text = `${opp.title} ${opp.description ?? ""}`.toLowerCase();
    const hitInterest = student.interests?.find((i) => text.includes(i.toLowerCase()));
    if (hitInterest) {
        reasons.push(`Matches your interest in ${hitInterest}.`);
    }

    // grade
    if (student.grade != null && opp.eligible_grades.length > 0 && opp.eligible_grades.includes(student.grade)) {
        reasons.push(`Open to students in grade ${student.grade}.`);
    }

    // age
    if (student.age != null && (opp.minimum_age != null || opp.maximum_age != null)) {
        const okMin = opp.minimum_age == null || student.age >= opp.minimum_age;
        const okMax = opp.maximum_age == null || student.age <= opp.maximum_age;
        if (okMin && okMax) reasons.push("Your age meets the listed requirement.");
    }

    // GPA
    const gpa = student.gpa ?? null;
    if (gpa != null && opp.minimum_gpa != null && gpa >= opp.minimum_gpa) {
        reasons.push("Your GPA meets the listed minimum.");
    }

    // remote
    if (opp.work_mode === "remote") {
        reasons.push("Available remotely.");
    }

    // located in your state (physical location, not residency)
    if (opp.location && student.state && opp.location.toLowerCase().includes(student.state.toLowerCase())) {
        reasons.push("Located in your state.");
    }

    // nationwide (no residency restriction)
    if (opp.eligible_states.length === 0 && reasons.length < 2) {
        reasons.push("Open to students nationwide.");
    }

    return reasons.slice(0, 4);
}