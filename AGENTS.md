# Development Rules

This file contains important guidelines and conventions for this codebase to follow when making changes. Follow all these rules strictly.

## Guidance Maintenance

- Keep this `AGENTS.md` file up to date when repository changes alter how future work should be built, tested, run, deployed, migrated, or validated. Update it whenever we add or remove an external resource or API and show clearly how to use and test it.
- Keep updates tight and operational. Do not add broad preferences unless they are backed by a concrete repo workflow or recurring development mistake.

## Coding Standards

- Write TypeScript
- Check existing type files first. Use current types, or extend or create new ones as needed.
- Always use clearly defined types for a 100% type-safe application (other than errors or catch-alls).
- Follow coding principles: DRY (Don't Repeat Yourself), KISS (Keep It Simple Stupid), YAGNI (You Aren't Gonna Need It), and SOLID principles
- Check how functions/imports are used in other parts of the code for context
- Check type errors and fix them before finishing
- When naming percentage variables and functions, prefer scale 100, and use the naming convention `variableNamePercent100` if they're scale 100 (e.g. 75 = 75%), or `variableNamePercent1` if they're scale 1 (e.g. 0.75 = 75%)
- Name functions, classes, and types clearly, describing their function, e.g. not with generic words like "extended" or "normalized".
- Always use string literals with inline variables: `log(\`The value is ${value}\`)`
- When logging dates, use locale en-US and timezone 'America/New_York' for consistency: `new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })`
- Use one master .env that we use locally and in production.
- Log clearly so errors can be traced, naming service names, functions names, api calls, etc. Use a common "log" function that is imported and shared.
- JSDocs for every function, class, and type. Include a description of the function, its parameters, and its return value. Use the `@param` and `@returns` tags to document parameters and return values.

## Testing

- Always do unit tests and integration tests.
- Unless instructed not to, do tests of API calls using keys to ensure correct function.
- Run your own tests, assess output, then iterate and improve
- Ensure code builds on completion

## Repository workflow

- This repository is a pnpm workspace. Use pnpm 10.34.4 with Node 22 or newer.
- `pnpm dev` starts the Express API on port 3001 and Vite on port 5173, then opens the web app in a browser.
- Keep local configuration in the single root `.env`. API startup and migrations load that file from the workspace root; do not add package-level env files.
- Run `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and `pnpm build` before finishing code changes.
- Database schema changes start in `apps/api/src/database/schema.ts`. Run `pnpm db:generate`, review the SQL under `apps/api/drizzle`, then run `pnpm db:migrate` against the intended Neon database.
- Live market extraction uses public read-only endpoints: Polymarket Gamma `https://gamma-api.polymarket.com` and Kalshi Trade API `https://api.elections.kalshi.com/trade-api/v2`. A current-URL `POST /api/reports` smoke validates both extraction and the configured LLM path.
- All OpenAI text calls must use `disco.llm.call` from `@discomedia/utils`. `gpt-5.6-luna` is the cost-safe default. Keep the admin-selectable allowlist in `packages/shared/src/index.ts` synchronized with server validation and the settings dropdown.
- Deterministic checks must run before the LLM. Never accept or render an LLM conclusion unless its supporting quote is an exact substring of the archived contract text.
- Railway builds the API using `railway.json`. Its `/api/health/live` probe must remain database-free so idle health checks do not wake Neon.
- Netlify builds the web client using `netlify.toml`. Keep the SPA redirect and set `VITE_API_BASE_URL` to the active Railway domain.
- Production variables are configured with the Railway and Netlify CLIs; never commit `.env`. GitHub pushes to the default branch should remain the deployment trigger for both services.
