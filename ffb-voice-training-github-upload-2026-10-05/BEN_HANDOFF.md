# FFB Voice Role-Play Training App - Ben Handoff

## Purpose

This is the V1 beta of the FFB Voice Role-Play Training app. Employees practice information calls as the sales representative. The AI plays the prospect for full role-plays and can also run focused skill drills from dashboard coaching opportunities.

## Local Run

1. Install/use Node.js.
2. Create `.env` from `.env.example`.
3. Set `OPENAI_API_KEY` on the server only.
4. Run:

```bash
npm start
```

For local testing, the app has been run on:

```bash
PORT=3011 node server.js
```

Open:

```text
http://localhost:3011/
```

## Required Environment Variables

```text
OPENAI_API_KEY=server-side OpenAI API key
PORT=hosting platform port if required
LIVE_MODEL=gpt-live-1
EVALUATOR_MODEL=gpt-5.1
```

Optional:

```text
WEEKLY_PRACTICE_TARGET=10
DAILY_PRACTICE_TARGET=2
```

## Important Security

Do not expose the OpenAI API key in browser code. The key must remain server-side only. The `.env` file is intentionally not included in the deployment zip.

## Key Files

- `server.js` - Node server, OpenAI calls, saving reports/drills, dashboard APIs.
- `public/` - Browser UI.
- `prompts/liveRoleplay.js` - Live prospect and focused skill drill instructions.
- `prompts/evaluator.js` - Evaluation rubric and calibration anchors.
- `config/appConfig.js` - Centers, employees, brand mapping, prospect profiles, curve balls.
- `data/sessions/` - Saved full practice calls and reports.
- `data/skill-practices/` - Saved focused skill drill records.

## Calibration

Evaluator calibration is in `prompts/evaluator.js` and should survive migration as long as the source files are deployed. Current anchors include Lisa 3/10, Julie 9/10, and Lisa Curve Balls Price 8/10.

## Hosting Requirements

The hosted version must support:

- Node server runtime
- HTTPS for microphone access
- Server-side environment variables
- Persistent storage for `data/sessions` and `data/skill-practices`, or a replacement database/storage layer

If the host uses ephemeral filesystem storage, saved reports and dashboard history will disappear unless storage is moved to a persistent volume or database.

## Domain/Subdomain

Use an existing domain/subdomain, for example:

```text
training.example.com
```

Point DNS to the hosting provider following that provider's instructions. No new domain is required.

## Launch Test Checklist

- App loads over HTTPS.
- Chrome microphone permission works.
- Full live role-play starts.
- Transcript captures.
- Evaluation report appears.
- Full practice report saves.
- Dashboard populates.
- Focused skill drill starts from `Practice this skill`.
- Focused skill drill saves separately from full calls.
- `.env` and API key are not present in browser/source bundle.
