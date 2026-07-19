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
- `pnpm test:integration` always runs the database-backed product-store suite against the root `DATABASE_URL`; it applies pending migrations, creates uniquely identified temporary rows, and removes those rows afterward. Keep the configured database available and expect this command to exercise it directly.
- Live market extraction uses public read-only endpoints: Polymarket Gamma `https://gamma-api.polymarket.com` and Kalshi Trade API `https://external-api.kalshi.com/trade-api/v2`. A current-URL `POST /api/reports` smoke validates both extraction and the configured LLM path.
- Homepage market search uses Oddpool `GET https://api.oddpool.com/search/markets` with the root `ODDPOOL_API_KEY`. The API searches Polymarket and Kalshi independently, merges 50 relevance-sorted and 50 volume-sorted candidates, spaces all upstream starts by at least 200 ms, retries bounded `429` responses, and caches identical venue/query results for five minutes. FinePredict locally reranks the merged set using complete token coverage, field relevance, logarithmic volume/liquidity, and event diversity. Kalshi results are enriched in one public `GET /trade-api/v2/markets?tickers=...` call so outcome subtitles and current lifecycle state are available. Keep the Oddpool key server-only and verify search with `GET /api/markets/search?platform=polymarket&query=bitcoin` and the equivalent `platform=kalshi` request.
- All OpenAI text calls must use `disco.llm.call` from `@discomedia/utils`. `gpt-5.6-luna` is the cost-safe default. Keep the admin-selectable allowlist in `packages/shared/src/index.ts` synchronized with server validation and the settings dropdown.
- Deterministic checks must run before the LLM. Never accept or render an LLM conclusion unless its supporting quote is an exact substring of the archived contract text.
- Managed Neon Auth account access requires `DATABASE_URL`, `NEON_AUTH_BASE_URL`, and the browser build's matching `VITE_NEON_AUTH_URL`. The API verifies short-lived Neon JWTs against the branch JWKS and loads the authoritative user from `neon_auth.user`. FinePredict product ownership uses UUID foreign keys to that managed table; migrations must never create, alter, or drop the `neon_auth` schema or its tables.
- Neon Auth Magic Link delivery uses the signed `POST /api/auth/neon-webhook` bridge to Disco Mail. Subscribe only `send.magic_link` after that endpoint is deployed, keep unused password/OAuth providers disabled, and trust the Netlify origin. FinePredict uses `disco.mail.send` from `@discomedia/utils` for both magic links and monitor alerts; both require `DISCO_MAIL_API_KEY` and a sender on the verified `fp.discomedia.co` domain.
- `ADMIN_EMAILS` is a comma-separated allowlist applied after Neon Auth verifies the account; a managed user whose `role` is `admin` is also an administrator. Normal settings and dispute administration use an authenticated admin JWT; `ADMIN_API_KEY` is emergency automation only and must not be requested by the browser UI.
- Stripe watchlists and the metered developer API are separate products. Keep `STRIPE_WATCHLIST_PRICE_ID` distinct from `STRIPE_API_PRICE_ID`, verify `/api/billing/webhook` with `STRIPE_WEBHOOK_SECRET`, and match `STRIPE_API_METER_EVENT_NAME` to the configured Stripe Billing Meter.
- Stripe CLI commands default to test mode; pass `--live` deliberately for live resources. The FinePredict test and live catalogs use a US$12 monthly watchlist price and US$0.01-per-unit developer API price attached to the `finepredict_api_usage` sum meter, whose payload keys are `stripe_customer_id` and `value`. `STRIPE_API_KEY`, both price IDs, the meter, and `STRIPE_WEBHOOK_SECRET` must all belong to the same Stripe mode. One Stripe customer may own both product subscriptions; only the Stripe subscription ID is unique.
- Any authenticated account may create developer API keys. Free usage is enforced atomically across all of an account's keys at one request per UTC minute and 10 requests per UTC day. Active developer API subscribers use the paid per-key `DEVELOPER_API_DAILY_LIMIT` and their daily usage is sent to the Stripe meter. API keys are HMAC-hashed with `API_KEY_HASH_SECRET`, which must contain at least 32 characters.
- The monitor uses optional `POLYGON_RPC_URL` access for Polymarket on-chain dispute evidence. Without it, normal market, rules, source, and lifecycle monitoring still runs.
- `MONITOR_DRY_RUN` defaults to `true`. A dry run may persist monitor runs, observations, snapshots, and deduplicated alerts, but it must not send Disco Mail emails or Stripe meter events. Build before running `pnpm --filter @finepredict/api monitor`; use `pnpm --filter @finepredict/api monitor:dev` for a TypeScript local run.
- Railway builds the API using `railway.json`. Its `/api/health/live` probe must remain database-free so idle health checks do not wake Neon.
- Railway's separate monitor service uses `/railway.monitor.json`, runs `pnpm --filter @finepredict/api monitor`, has no public domain or health check, and is scheduled at `7 * * * *` UTC. The process must close every database connection and exit so later cron runs are not skipped.
- Railway injects the production `PORT` (currently 8080). The generated public domain must target that injected port, not the local-development port 3001; verify with `railway domain status` after creating or changing a domain.
- Netlify builds the web client using `netlify.toml`. Keep the SPA redirect and set `VITE_API_BASE_URL` to the active Railway domain.
- Netlify Edge Function `netlify/edge-functions/report-meta.ts` adds report-specific canonical, social, and JSON-LD metadata. Set `FINEPREDICT_API_BASE_URL` with Netlify's Functions scope if the API domain changes; failures must fall through to the unchanged SPA response.
- `apps/extension` builds the Manifest V3 browser extension into `apps/extension/dist`. It only prefills a supported market URL in FinePredict and must never submit an analysis without an explicit user action.
- Embedded reports use `?embed=1` and post `{ type: "finepredict:resize", height }` to the parent window when their document height changes.
- Production variables are configured with the Railway and Netlify CLIs; never commit `.env`. GitHub pushes to the default branch should remain the deployment trigger for both services.
