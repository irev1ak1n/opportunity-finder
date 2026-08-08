import { tavilySearch } from "../search/tavily.js";
import { extractOpportunities } from "../ai/extract.js";
import { checkEligibility, isExpired, type StudentProfile, type EligibilityStatus } from "../eligibility/engine.js";
import { makeFingerprint } from "../utils/fingerprint.js";
import { preferredDomains, sourceRankBonus } from "../utils/source.js";
import { supabase } from "../db.js";
import type { Opportunity } from "../types.js";

export type Category = "scholarship" | "internship" | "volunteering" | "program" | "competition";

export interface RankedOpportunity {
    opportunity: Opportunity;
    fingerprint: string;
    opportunity_id?: string;
    eligibility_status: EligibilityStatus;
    eligibility_reasons: string[];
    match_score: number;
}

function buildQueries(
    profile: StudentProfile & { interests?: string[]; city?: string | null },
    category: Category
): string[] {
    const year = new Date().getFullYear();
    const state = profile.state ?? "";
    const city = profile.city ?? "";
    const interest = profile.interests?.[0] ?? "";
    const gradeWord = profile.grade === 12 ? "high school seniors" : "high school students";

    let base: string[];
    if (category === "internship") {
        base = [
            `${interest} internships for ${gradeWord} ${city} ${state} ${year}`,
            `summer internships ${gradeWord} ${state} ${year}`,
            `${interest} internships teens high school ${year}`,
        ];
    } else if (category === "volunteering") {
        base = [
            `teen volunteer opportunities ${city} ${state} ${year}`,
            `${interest} volunteer opportunities high school students ${state}`,
            `community service opportunities ${gradeWord} ${state}`,
        ];
    } else if (category === "program") {
        base = [
            `${interest} summer programs for ${gradeWord} ${state} ${year}`,
            `${interest} programs high school students ${year}`,
            `pre-college programs ${gradeWord} ${year}`,
        ];
    } else if (category === "competition") {
        base = [
            `${interest} competitions for high school students ${year}`,
            `${interest} contests ${gradeWord} ${year}`,
            `national competitions high school students ${year}`,
        ];
    } else {
        // scholarship (default)
        base = [
            `${interest} scholarships for ${gradeWord} ${state} ${year}`,
            `scholarships ${gradeWord} ${state} ${year}`,
            `${interest} scholarships ${state} high school ${year}`,
        ];
    }

    // targeted site: searches against a few preferred discovery domains
    // (adds discovery breadth; does NOT restrict — broad queries above still run)
    const domains = preferredDomains(category).slice(0, 3);
    const targeted = domains.map((d) => {
        const q = interest ? `${interest} ${category === "scholarship" ? "scholarships" : category}` : category;
        return `site:${d} ${q} high school ${year}`;
    });

    return [...base, ...targeted]
        .map((q) => q.replace(/\s+/g, " ").trim())
        .filter((q) => q.length > 10);
}

function buildBroaderQueries(
    profile: StudentProfile & { interests?: string[] },
    category: Category
): string[] {
    const year = new Date().getFullYear();
    const interest = profile.interests?.[0] ?? "STEM";

    if (category === "internship") {
        return [
            `high school internships ${year}`,
            `${interest} internships students ${year}`,
            `summer programs internships teens ${year}`,
        ];
    }
    if (category === "volunteering") {
        return [
            `high school volunteer opportunities ${year}`,
            `teen community service ${year}`,
            `${interest} volunteering students ${year}`,
        ];
    }
    if (category === "program") {
        return [
            `high school summer programs ${year}`,
            `${interest} pre-college programs ${year}`,
            `enrichment programs high school students ${year}`,
        ];
    }
    if (category === "competition") {
        return [
            `high school competitions ${year}`,
            `${interest} contests students ${year}`,
            `academic competitions high school ${year}`,
        ];
    }

    return [
        `high school scholarships ${year}`,
        `${interest} scholarships high school students ${year}`,
        `merit scholarships high school seniors ${year}`,
    ];
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

    // source quality bonus (official > trusted > specialized > aggregator > job_board > unknown)
    score += sourceRankBonus(opp.source_type);

    if (opp.deadline) score += 5;

    return score;
}

export async function findScholarships(
    profile: StudentProfile & { interests?: string[]; city?: string | null },
    userId?: string,
    category: Category = "scholarship"
): Promise<RankedOpportunity[]> {
    const TARGET = 5;
    const WEB_BUDGET_MS = 12000;
    const seenFingerprints = await getSeenFingerprints(userId);

    const cached = await searchCache(profile, seenFingerprints, category);

    let pool = new Map<string, RankedOpportunity>();
    for (const r of cached) pool.set(r.fingerprint, r);

    if (pool.size < TARGET) {
        const webPromise = runSearchPass(buildQueries(profile, category), profile, seenFingerprints, category);
        const timeout = new Promise<RankedOpportunity[]>((resolve) =>
            setTimeout(() => resolve([]), WEB_BUDGET_MS)
        );
        const fromWeb = await Promise.race([webPromise, timeout]);

        for (const r of fromWeb) {
            if (!pool.has(r.fingerprint)) pool.set(r.fingerprint, r);
        }

        webPromise.then((full) => {
            saveAndRecord(full.slice(0, 10), userId).catch(() => {});
        }).catch(() => {});

        if (pool.size < 3) {
            const broader = await runSearchPass(buildBroaderQueries(profile, category), profile, seenFingerprints, category);
            for (const r of broader) {
                if (!pool.has(r.fingerprint)) pool.set(r.fingerprint, r);
            }
        }
    }

    const ranked = [...pool.values()].sort((a, b) => b.match_score - a.match_score);
    const top = ranked.slice(0, TARGET);

    const withIds = await saveAndRecord(top, userId);
    return withIds;
}

async function runSearchPass(
    queries: string[],
    profile: StudentProfile & { interests?: string[] },
    seenFingerprints: Set<string>,
    category: Category
): Promise<RankedOpportunity[]> {
    const t0 = Date.now();

    const searchResults = (
        await Promise.all(queries.map((q) => tavilySearch(q, 3).catch(() => [])))
    ).flat();
    console.error(`[PERF] tavily: ${Date.now() - t0}ms (${searchResults.length} results)`);

    const urls = [...new Set(searchResults.map((r) => r.url))];
    const freshCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: processed } = await supabase
        .from("opportunities")
        .select("discovered_from_url")
        .in("discovered_from_url", urls)
        .gte("last_checked_at", freshCutoff);

    const processedUrls = new Set((processed ?? []).map((p: any) => p.discovered_from_url));

    const toExtract = searchResults.filter((r) => !processedUrls.has(r.url));
    console.error(`[PERF] skipping ${searchResults.length - toExtract.length} already-processed URLs, extracting ${toExtract.length}`);

    const t1 = Date.now();
    const extracted = (
        await Promise.all(
            toExtract.map((r) => extractOpportunities(r.content, r.url, category).catch(() => []))
        )
    ).flat();
    console.error(`[PERF] extraction: ${Date.now() - t1}ms (${extracted.length} opportunities)`);

    const byFingerprint = new Map<string, RankedOpportunity>();

    for (const opp of extracted) {
        if (isExpired(opp)) continue;
        if (!opp.title) continue;

        const fp = makeFingerprint(opp.title, opp.organization);
        if (!fp) continue;
        if (seenFingerprints.has(fp)) continue;

        const existing = byFingerprint.get(fp);

        const elig = checkEligibility(opp, profile);
        if (elig.status === "not_eligible") continue;

        const score = scoreOpportunity(opp, elig.status, profile);

        // prefer the higher-quality source when the same opportunity is found twice
        if (existing && existing.match_score >= score) continue;

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

async function searchCache(
    profile: StudentProfile & { interests?: string[] },
    seenFingerprints: Set<string>,
    category: Category
): Promise<RankedOpportunity[]> {
    const freshCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("category", category)
        .gte("last_checked_at", freshCutoff)
        .or(`deadline.is.null,deadline.gte.${today}`)
        .limit(100);

    if (error || !data) return [];

    const results: RankedOpportunity[] = [];

    for (const row of data as any[]) {
        const opp: Opportunity = {
            title: row.title,
            organization: row.organization ?? "",
            category: row.category,
            official_url: row.official_url,
            discovered_from_url: row.discovered_from_url ?? "",
            source_type: row.source_type,
            source_confidence: row.source_confidence,
            description: row.description,
            deadline: row.deadline,
            location: row.location,
            remote: row.remote ?? false,
            eligible_states: row.eligible_states ?? [],
            minimum_age: row.minimum_age,
            maximum_age: row.maximum_age,
            eligible_grades: row.eligible_grades ?? [],
            minimum_gpa: row.minimum_gpa,
            citizenship_requirement: row.citizenship_requirement,
            demographic_restrictions: row.demographic_restrictions ?? [],
            award_amount: row.award_amount,
            application_effort: row.application_effort,
            requirements: row.requirements ?? [],
        };

        const fp = row.fingerprint ?? makeFingerprint(opp.title, opp.organization);
        if (!fp || seenFingerprints.has(fp)) continue;

        const elig = checkEligibility(opp, profile);
        if (elig.status === "not_eligible") continue;

        results.push({
            opportunity: opp,
            fingerprint: fp,
            opportunity_id: row.id,
            eligibility_status: elig.status,
            eligibility_reasons: elig.reasons,
            match_score: scoreOpportunity(opp, elig.status, profile),
        });
    }

    return results.sort((a, b) => b.match_score - a.match_score);
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
            demographic_restrictions: o.demographic_restrictions,
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