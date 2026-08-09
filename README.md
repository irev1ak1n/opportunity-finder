# Opportunity Finder

Opportunity Finder is a conversational assistant that helps high school students find scholarships, internships, volunteer opportunities, programs, and competitions they actually qualify for.

Instead of only searching for opportunities, it checks requirements against the student's profile, explains why an opportunity is a good match, and helps track opportunities after they are discovered.

## Important Poke Note

Opportunity Finder is currently connected to Poke through a custom MCP integration.

Normally, I would share the project through a Poke Recipe, which would make the setup easier for a new user. However, Poke is currently returning a **500 server error** when I try to submit the Recipe, which prevents me from using the normal Recipe sharing flow.

I reported the issue directly to the Poke team. They were able to reproduce the bug, identify the issue, and told me that a fix is being worked on.

Because this issue is on the Poke side, I currently cannot provide the simpler Recipe link. The MCP integration itself works normally, so Opportunity Finder can still be tested using the integration link below.

## Try Opportunity Finder

### 1. Open the integration link

[Connect Opportunity Finder to Poke](https://poke.com/integrations/new?name=Opportunity%20Finder&url=https%3A%2F%2Fopportunity-finder-production.up.railway.app%2Fmcp)

You may need to sign in or create a Poke account first.

### 2. Create the integration

The page should automatically fill in:

**Name:** Opportunity Finder

**Server URL:**

`https://opportunity-finder-production.up.railway.app/mcp`

No API key is required.

Click **Create Integration**.

### 3. Close the Integrations window

After the integration is created, close the Integrations window and return to the main Poke screen.

### 4. Click Message

Click **Message** and start talking to Poke.

You can try something like:

> I'm a high school senior in North Carolina interested in computer science. Find me internships I qualify for.

or:

> Find me scholarships for high school seniors interested in engineering.

Opportunity Finder will search for relevant opportunities and use its backend to evaluate how well each opportunity matches the student's profile.

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
