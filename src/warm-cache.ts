import { findScholarships, type Category } from "./opportunities/find.js";

const INTERESTS = [
    "computer science",
    "engineering",
    "business",
    "finance",
    "medicine",
    "biology",
    "environmental science",
    "psychology",
    "law",
    "journalism",
    "arts and design",
    "robotics",
];

const STATES = [
    "NC",
    "CA",
    "TX",
    "NY",
    "FL",
    "IL",
    "PA",
    "GA",
    "MA",
    "VA",
    "WA",
    "OH",
];

const CATEGORIES: Category[] = [
    "scholarship",
    "internship",
    "volunteering",
    "program",
    "competition",
];

const BASE = {
    grade: 12,
    age: 17,
    gpa: 3.8,
};

async function warmOne(
    category: Category,
    interest: string,
    state: string
) {
    const profile = {
        ...BASE,
        state,
        interests: [interest],
    };

    const t0 = Date.now();

    try {
        const results = await findScholarships(
            profile,
            undefined,
            category
        );

        console.log(
            `[${category}] ${state} | "${interest}": ` +
            `${results.length} results in ${(
                (Date.now() - t0) /
                1000
            ).toFixed(1)}s`
        );
    } catch (err) {
        console.log(
            `[${category}] ${state} | "${interest}": FAILED — ` +
            `${(err as Error).message}`
        );
    }
}

async function main() {
    console.log("Warming broader Opportunity Finder cache...\n");

    const start = Date.now();
    let count = 0;

    for (const category of CATEGORIES) {
        console.log(`\n=== ${category.toUpperCase()} ===`);

        for (let i = 0; i < INTERESTS.length; i++) {
            const interest = INTERESTS[i];

            // Rotate states instead of searching everything from NC
            const state =
                STATES[(i + CATEGORIES.indexOf(category) * 3) % STATES.length];

            await warmOne(category, interest, state);

            count++;

            await new Promise((resolve) =>
                setTimeout(resolve, 1500)
            );
        }
    }

    console.log(
        `\nDone. ${count} searches in ${(
            (Date.now() - start) /
            60000
        ).toFixed(1)} min.`
    );
}

main().catch((err) =>
    console.error("Warm failed:", err)
);