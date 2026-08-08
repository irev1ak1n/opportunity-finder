import "dotenv/config";
import OpenAI from "openai";
import type { Opportunity } from "../types.js";
import { classifySource } from "../utils/source.js";

const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY;

if (!FEATHERLESS_API_KEY) {
    throw new Error("Missing FEATHERLESS_API_KEY in environment (.env)");
}

const client = new OpenAI({
    apiKey: FEATHERLESS_API_KEY,
    baseURL: "https://api.featherless.ai/v1",
    timeout: 45000,
    maxRetries: 1,
});

const MODEL = "mistralai/Mistral-Nemo-Instruct-2407";

const WORK_MODE_NOTE = `
- work_mode: one of "remote", "hybrid", "on_site", or "unknown". Normalize from the text:
  remote = remote / virtual / fully remote / work from home / online
  hybrid = hybrid / partially remote / mix of remote and in person
  on_site = on site / onsite / in person / in-person
  If unclear, use "unknown". Do NOT assume on_site just because a city or organization address is listed; many remote opportunities still list a location.
- location: where the opportunity physically happens or the org is based. This is NOT a residency restriction.
- eligible_states: ONLY explicit applicant RESIDENCY restrictions (e.g. "must be a North Carolina resident", "open only to Texas students"). Do NOT fill this just because the opportunity is located in a state. If no residency rule is stated, use [].`;

const SCHOLARSHIP_PROMPT = `You extract structured scholarship data from web page text.
A page may describe MULTIPLE scholarships (e.g. a directory) or just one.
Return ONLY a JSON object with a single key "opportunities" whose value is an array.
No markdown, no backticks, no explanation.

Each array item must match this exact shape:
{
  "title": string,
  "organization": string,
  "official_url": string | null,
  "description": string | null,
  "deadline": string | null,           // ISO "YYYY-MM-DD" if clearly stated, else null
  "location": string | null,
  "work_mode": "remote" | "hybrid" | "on_site" | "unknown",
  "remote": boolean,
  "eligible_states": string[],         // residency restriction only; [] if none
  "minimum_age": number | null,
  "maximum_age": number | null,
  "eligible_grades": number[],
  "minimum_gpa": number | null,
  "citizenship_requirement": string | null,
  "demographic_restrictions": string[],
  "award_amount": string | null,
  "application_effort": string | null,
  "requirements": string[]
}

CRITICAL RULES:
- NEVER invent values. If a field is not clearly stated, use null (or [] for arrays).
- Do not guess GPA, deadline, amount, or age. Unknown = null.
- demographic_restrictions: capture explicit limits (gender, military, ethnicity, disability, first-generation, LGBTQ) ONLY if clearly stated. A program name alone is not a restriction.${WORK_MODE_NOTE}
- Extract up to 6 distinct scholarships max. Skip navigation/ads/unrelated text.
- If the page has no real scholarship, return {"opportunities": []}.
- Output must be valid JSON and nothing else.`;

const INTERNSHIP_PROMPT = `You extract structured internship data from web page text.
A page may describe MULTIPLE internships or just one.
Return ONLY a JSON object with a single key "opportunities" whose value is an array.
No markdown, no backticks, no explanation.

Each array item must match this exact shape:
{
  "title": string,
  "organization": string,
  "official_url": string | null,
  "description": string | null,
  "deadline": string | null,
  "location": string | null,
  "work_mode": "remote" | "hybrid" | "on_site" | "unknown",
  "remote": boolean,
  "eligible_states": string[],         // residency restriction only; [] if none
  "minimum_age": number | null,
  "maximum_age": number | null,
  "eligible_grades": number[],
  "minimum_gpa": number | null,
  "citizenship_requirement": string | null,
  "demographic_restrictions": string[],
  "award_amount": string | null,        // pay/stipend ("paid","unpaid","$15/hr") if stated, else null
  "application_effort": string | null,
  "requirements": string[]
}

CRITICAL RULES:
- NEVER invent values. Unknown = null (or [] for arrays).
- Only extract real internships/programs for students. Skip adult job postings, ads, navigation.
- award_amount: pay/stipend info if stated, else null.
- demographic_restrictions: explicit limits only.${WORK_MODE_NOTE}
- Extract up to 6 distinct internships max.
- If the page has no real internship, return {"opportunities": []}.
- Output must be valid JSON and nothing else.`;

const VOLUNTEERING_PROMPT = `You extract structured volunteer opportunity data from web page text.
A page may describe MULTIPLE volunteer opportunities or just one.
Return ONLY a JSON object with a single key "opportunities" whose value is an array.
No markdown, no backticks, no explanation.

Each array item must match this exact shape:
{
  "title": string,
  "organization": string,
  "official_url": string | null,
  "description": string | null,
  "deadline": string | null,
  "location": string | null,
  "work_mode": "remote" | "hybrid" | "on_site" | "unknown",
  "remote": boolean,
  "eligible_states": string[],
  "minimum_age": number | null,
  "maximum_age": number | null,
  "eligible_grades": number[],
  "minimum_gpa": number | null,
  "citizenship_requirement": string | null,
  "demographic_restrictions": string[],
  "award_amount": string | null,        // usually null; volunteering is unpaid
  "application_effort": string | null,
  "requirements": string[]             // time commitment, materials, etc.
}

CRITICAL RULES:
- NEVER invent values. Unknown = null (or [] for arrays).
- Only extract real volunteer opportunities for students. Skip ads and navigation.
- demographic_restrictions: explicit limits only.${WORK_MODE_NOTE}
- Extract up to 6 max. If none, return {"opportunities": []}.
- Output must be valid JSON and nothing else.`;

const PROGRAM_PROMPT = `You extract structured student program or competition data from web page text.
This includes summer programs, pre-college programs, enrichment programs, contests, and competitions.
A page may describe MULTIPLE of these or just one.
Return ONLY a JSON object with a single key "opportunities" whose value is an array.
No markdown, no backticks, no explanation.

Each array item must match this exact shape:
{
  "title": string,
  "organization": string,
  "official_url": string | null,
  "description": string | null,
  "deadline": string | null,
  "location": string | null,
  "work_mode": "remote" | "hybrid" | "on_site" | "unknown",
  "remote": boolean,
  "eligible_states": string[],
  "minimum_age": number | null,
  "maximum_age": number | null,
  "eligible_grades": number[],
  "minimum_gpa": number | null,
  "citizenship_requirement": string | null,
  "demographic_restrictions": string[],
  "award_amount": string | null,        // cost, stipend, or prize if stated, else null
  "application_effort": string | null,
  "requirements": string[]
}

CRITICAL RULES:
- NEVER invent values. Unknown = null (or [] for arrays).
- Only extract real programs or competitions for students. Skip webinars, ads, and navigation.
- award_amount: cost, stipend, or prize money if stated, else null.
- demographic_restrictions: explicit limits only.${WORK_MODE_NOTE}
- Extract up to 6 max. If none, return {"opportunities": []}.
- Output must be valid JSON and nothing else.`;

interface RawOpportunity {
    title?: string;
    organization?: string;
    official_url?: string | null;
    description?: string | null;
    deadline?: string | null;
    location?: string | null;
    work_mode?: string | null;
    remote?: boolean;
    eligible_states?: string[];
    minimum_age?: number | null;
    maximum_age?: number | null;
    eligible_grades?: number[];
    minimum_gpa?: number | null;
    citizenship_requirement?: string | null;
    demographic_restrictions?: string[];
    award_amount?: string | null;
    application_effort?: string | null;
    requirements?: string[];
}

export type Category = "scholarship" | "internship" | "volunteering" | "program" | "competition";

type WorkMode = "remote" | "hybrid" | "on_site" | "unknown";

function normalizeWorkMode(raw: string | null | undefined, remoteBool: boolean | undefined): WorkMode {
    const s = (raw ?? "").toLowerCase().trim();
    if (["remote", "virtual", "fully remote", "work from home", "online"].some((k) => s.includes(k))) return "remote";
    if (["hybrid", "partially remote", "partly remote"].some((k) => s.includes(k))) return "hybrid";
    if (["on_site", "on site", "onsite", "in person", "in-person"].some((k) => s.includes(k))) return "on_site";
    if (s === "remote" || s === "hybrid" || s === "on_site" || s === "unknown") return s as WorkMode;
    // fall back to legacy boolean only if it clearly says remote
    if (remoteBool === true) return "remote";
    return "unknown";
}

export async function extractOpportunities(
    pageText: string,
    sourceUrl: string,
    category: Category = "scholarship"
): Promise<Opportunity[]> {
    let systemPrompt: string;
    switch (category) {
        case "internship": systemPrompt = INTERNSHIP_PROMPT; break;
        case "volunteering": systemPrompt = VOLUNTEERING_PROMPT; break;
        case "program":
        case "competition": systemPrompt = PROGRAM_PROMPT; break;
        default: systemPrompt = SCHOLARSHIP_PROMPT;
    }

    const userContent = `Source URL: ${sourceUrl}\n\nPage text:\n${pageText.slice(0, 6000)}`;

    const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return [];

    let items: RawOpportunity[] = [];
    try {
        const parsed = JSON.parse(raw) as { opportunities?: RawOpportunity[] };
        items = parsed.opportunities ?? [];
    } catch {
        return [];
    }

    const source = classifySource(sourceUrl);

    return items
        .filter((it) => it.title && it.title.trim().length > 0)
        .map((it): Opportunity => {
            const work_mode = normalizeWorkMode(it.work_mode, it.remote);
            return {
                title: it.title!.trim(),
                organization: (it.organization ?? "").trim(),
                category: category,
                official_url: it.official_url ?? null,
                discovered_from_url: sourceUrl,
                source_type: source.source_type,
                source_confidence: source.source_confidence,
                description: it.description ?? null,
                deadline: it.deadline ?? null,
                location: it.location ?? null,
                work_mode,
                remote: work_mode === "remote" || (it.remote ?? false),
                eligible_states: it.eligible_states ?? [],
                minimum_age: it.minimum_age ?? null,
                maximum_age: it.maximum_age ?? null,
                eligible_grades: it.eligible_grades ?? [],
                minimum_gpa: it.minimum_gpa ?? null,
                citizenship_requirement: it.citizenship_requirement ?? null,
                demographic_restrictions: it.demographic_restrictions ?? [],
                award_amount: it.award_amount ?? null,
                application_effort: it.application_effort ?? null,
                requirements: it.requirements ?? [],
            };
        });
}