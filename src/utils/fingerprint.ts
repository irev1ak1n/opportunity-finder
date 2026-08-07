export function makeFingerprint(title: string, organization: string): string {
    const norm = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ") // removing punctuation
            .replace(/\b(scholarship|program|fund|award|foundation|the)\b/g, "") //stop words
            .replace(/\s+/g, " ")
            .trim();

    const t = norm(title);
    const o = norm(organization);
    return `${t}|${o}`.replace(/^\||\|$/g, "");
}