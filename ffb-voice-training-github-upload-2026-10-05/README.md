# FFB Voice Role-Play Training MVP

Focused first MVP for live spoken sales role-play practice.

## Setup

1. Copy `.env.example` to `.env`.
2. Add `OPENAI_API_KEY`.
3. Start the app:

```bash
node server.js
```

The app runs at `http://localhost:3000` by default.

## Editable Files

- `config/appConfig.js`: centers, brand facts, prospect profiles, and objection options.
- `prompts/liveRoleplay.js`: GPT-Live prospect behavior.
- `prompts/evaluator.js`: evaluator rubric and calibrated benchmark fixtures.

Completed role-plays are saved as JSON in `data/sessions/`.
