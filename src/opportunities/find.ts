import { tavilySearch } from "../search/tavily.js";
import { extractOpportunities } from "../ai/extract.js";
import { checkEligibility, isExpired, type StudentProfile, type EligibilityStatus } from "../eligibility/engine.js";
import { makeFingerprint } from "../utils/fingerprint.js";
import { supabase } from "../db.js";
import type { Opportunity } from "../types.js";

export interface RankedOpportunity {
    opportunity: Opportunity;
    fingerprint: string;
    opportunity_id?: string;
    eligibility_status: EligibilityStatus;
    eligibility_reasons: string[];
    match_score: number;
}

function buildQueries(profile: StudentProfile & { interests?: string[] }): string[] {
    const year = new Date().getFullYear();
    const state = profile.state ?? "";
    const interest = profile.interests?.[0] ?? "";
    const gradeWord = profile.grade === 12 ? "high school seniors" : "high school students";

    return [
        `${interest} scholarships ${gradeWord} ${year}`.trim(),
        `scholarships ${gradeWord} ${state} ${year}`.trim(),
        `${interest} scholarships ${state} high school ${year}`.trim(),
    ].filter((q) => q.length > 10);
}

function scoreOpportunity(
    opp: Opportunity,
    status: EligibilityStatus,
    profile: { interests?: string[] }
): number {
    let score = 0;
    if (status === "eligible") score += 40;
    else if (status === "likely_eligible") score += 25;
    else if (status === "missing_info") score += 10;

    const text = `${opp.title} ${opp.description ?? ""}`.toLowerCase();
    if (profile.interests?.some((i) => text.includes(i.toLowerCase()))) score += 20;

    if (opp.source_confidence === "high") score += 5;
    else if (opp.source_confidence === "medium") score += 3;

    if (opp.deadline) score += 5;

    return score;
}

export async function findScholarships(
    profile: StudentProfile & { interests?: string[] },
    userId?: string
): Promise<RankedOpportunity[]> {
    const seenFingerprints = await getSeenFingerprints(userId);

    let ranked = await runSearchPass(buildQueries(profile), profile, seenFingerprints);

    if (ranked.length < 3) {
        const broaderQueries = buildBroaderQueries(profile);
        const more = await runSearchPass(broaderQueries, profile, seenFingerprints);

        const merged = new Map<string, RankedOpportunity>();
        for (const r of [...ranked, ...more]) merged.set(r.fingerprint, r);
        ranked = [...merged.values()].sort((a, b) => b.match_score - a.match_score);
    }

    const top = ranked.slice(0, 5);
    const withIds = await saveAndRecord(top, userId);
    return withIds;
}

async function runSearchPass(
    queries: string[],
    profile: StudentProfile & { interests?: string[] },
    seenFingerprints: Set<string>
): Promise<RankedOpportunity[]> {
    const searchResults = (
        await Promise.all(queries.map((q) => tavilySearch(q, 3).catch(() => [])))
    ).flat();

    const extracted = (
        await Promise.all(
            searchResults.map((r) => extractOpportunities(r.content, r.url).catch(() => []))
        )
    ).flat();

    const byFingerprint = new Map<string, RankedOpportunity>();

    for (const opp of extracted) {
        if (isExpired(opp)) continue;
        if (!opp.title) continue;

        const fp = makeFingerprint(opp.title, opp.organization);
        if (!fp) continue;
        if (seenFingerprints.has(fp)) continue;
        if (byFingerprint.has(fp)) continue;

        const elig = checkEligibility(opp, profile);
        if (elig.status === "not_eligible") continue;

        const score = scoreOpportunity(opp, elig.status, profile);

        byFingerprint.set(fp, {
            opportunity: opp,
            fingerprint: fp,
            eligibility_status: elig.status,
            eligibility_reasons: elig.reasons,
            match_score: score,
        });
    }

    return [...byFingerprint.values()].sort((a, b) => b.match_score - a.match_score);
}

async function getSeenFingerprints(userId?: string): Promise<Set<string>> {
    if (!userId) return new Set();

    const { data, error } = await supabase
        .from("user_opportunities")
        .select("opportunities(fingerprint)")
        .eq("user_id", userId);

    if (error || !data) return new Set();

    const set = new Set<string>();
    for (const row of data as any[]) {
        const fp = row.opportunities?.fingerprint;
        if (fp) set.add(fp);
    }
    return set;
}

function buildBroaderQueries(
    profile: StudentProfile & { interests?: string[] }
): string[] {
    const year = new Date().getFullYear();
    const interest = profile.interests?.[0] ?? "STEM";
    return [
        `high school scholarships ${year}`,
        `${interest} scholarships high school students ${year}`,
        `merit scholarships high school seniors ${year}`,
    ];
}

async function saveAndRecord(
    ranked: RankedOpportunity[],
    userId?: string
): Promise<RankedOpportunity[]> {
    if (ranked.length === 0) return [];

    const rows = ranked.map((r) => {
        const o = r.opportunity;
        return {
            title: o.title,
            organization: o.organization || null,
            category: o.category,
            official_url: o.official_url,
            discovered_from_url: o.discovered_from_url,
            source_type: o.source_type,
            source_confidence: o.source_confidence,
            description: o.description,
            deadline: o.deadline,
            location: o.location,
            remote: o.remote,
            eligible_states: o.eligible_states,
            minimum_age: o.minimum_age,
            maximum_age: o.maximum_age,
            eligible_grades: o.eligible_grades,
            minimum_gpa: o.minimum_gpa,
            citizenship_requirement: o.citizenship_requirement,
            award_amount: o.award_amount,
            application_effort: o.application_effort,
            requirements: o.requirements,
            fingerprint: r.fingerprint,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    });

    const { data, error } = await supabase
        .from("opportunities")
        .upsert(rows, { onConflict: "fingerprint" })
        .select("id, fingerprint");

    if (error) {
        console.error("Cache save error:", error.message);
        return ranked;
    }

    const idByFp = new Map(data.map((d) => [d.fingerprint, d.id]));
    const withIds = ranked.map((r) => ({
        ...r,
        opportunity_id: idByFp.get(r.fingerprint),
    }));

    if (userId) {
        const historyRows = withIds
            .filter((r) => r.opportunity_id)
            .map((r) => ({
                user_id: userId,
                opportunity_id: r.opportunity_id,
                status: "recommended",
                match_score: r.match_score,
                eligibility_status: r.eligibility_status,
                eligibility_reasons: r.eligibility_reasons,
                why_match: r.eligibility_reasons[0] ?? null,
                recommended_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }));

        const { error: histErr } = await supabase
            .from("user_opportunities")
            .upsert(historyRows, { onConflict: "user_id,opportunity_id", ignoreDuplicates: true });

        if (histErr) console.error("History save error:", histErr.message);
    }

    return withIds;
}