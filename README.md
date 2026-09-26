# Opportunity Finder (In Development Process)

Opportunity Finder is a conversational assistant that helps high school students find scholarships, internships, volunteer opportunities, programs, and competitions they actually qualify for.

Instead of only searching for opportunities, it checks requirements against the student's profile, explains why an opportunity is a good match, and helps track opportunities after they are discovered.

## How it works

Opportunity Finder combines live web discovery, structured AI extraction, and deterministic eligibility checking.

The backend is built with TypeScript and Node.js. Supabase stores opportunities and user data, while Tavily helps discover new opportunities from the web. AI extracts useful information from pages, but final eligibility decisions are handled by deterministic code rather than the AI model.

This means the same requirements and student profile should lead to the same eligibility result every time.

The system can also reuse previously processed opportunities, which makes future searches faster while still calculating eligibility separately for each student.

## Tech Stack

**TypeScript**  
**Node.js**  
**Supabase**  
**PostgreSQL**  
**Tavily**  
**Featherless AI**  
**Model Context Protocol**  
**Poke**  
**Railway**

## Project Architecture

Opportunity Finder keeps its core logic inside its own backend rather than depending on the conversational platform.

Poke currently serves as the interface, while eligibility checking, opportunity processing, ranking, and user data are handled by the Opportunity Finder backend.

This separation was intentional. During development, I ran into platform limitations outside my control, which made it even more important for the core system to remain independent.

It also means the same backend can later power a dedicated Opportunity Finder web app, mobile app, or another conversational interface.
