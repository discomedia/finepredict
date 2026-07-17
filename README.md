# FinePredict

FinePredict explains, archives, and compares the settlement terms behind prediction-market contracts. The initial release supports Polymarket and Kalshi URLs.

It deliberately does not create a pseudo-precise risk score. Reports show specific findings and place the original contract wording directly beside each conclusion.

## Product surface

- One- or two-market reports from public Polymarket and Kalshi URLs
- Plain-English settlement summaries with verbatim supporting quotes
- 18 deterministic wording and consistency checks
- Optional structured explanations through `@discomedia/utils` and `gpt-5.6-luna`
- Cross-market deadline, trigger, source, revision, postponement, and fallback comparison
- Immutable, timestamped Neon snapshots with SHA-256 hashes and visual line diffs
- Platform-end countdowns and direct resolution-source reachability checks
- Permanent public report URLs and a recent-report index
- Administrator-only model selection through the system settings page
- Public JSON endpoints for other analytics and arbitrage tools

## Architecture

```text
apps/web        React + Vite client, deployed on Netlify
apps/api        Express API, Drizzle persistence, market adapters, deployed on Railway
packages/shared Zod schemas and types shared by both apps
Neon            Postgres reports, snapshots, and system settings
```

Market discovery uses the documented public [Polymarket Gamma API](https://docs.polymarket.com/market-data/fetching-markets) and [Kalshi Get Market API](https://docs.kalshi.com/api-reference/market/get-market). Trading credentials are not required for read-only contract extraction.

## Local development

Use Node 22 or newer and pnpm 10.34.4.

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts the API on `http://localhost:3001`, starts the web app on `http://localhost:5173`, and opens the browser through Vite.

FinePredict uses one root `.env` locally. Copy `.env.example` and provide:

- `DATABASE_URL`: pooled Neon Postgres connection string
- `OPENAI_API_KEY`: enables LLM explanations; deterministic analysis still works without it
- `ADMIN_API_KEY`: required in the `x-admin-api-key` header for settings changes
- `FINEPREDICT_MODEL`: defaults to `gpt-5.6-luna`
- `WEB_ORIGIN`: comma-separated browser origins allowed by the API
- `VITE_API_BASE_URL`: browser-visible API origin

## Validation

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

To verify upstream APIs and the OpenAI path with real credentials, run the API and submit a current market URL:

```bash
pnpm dev:api
curl -X POST http://localhost:3001/api/reports \
  -H 'content-type: application/json' \
  --data '{"urls":["https://polymarket.com/event/<slug>"]}'
```

## API

All report reads are public in the MVP.

| Method | Path                 | Purpose                                           |
| ------ | -------------------- | ------------------------------------------------- |
| `GET`  | `/api/health/live`   | Database-free Railway liveness check              |
| `GET`  | `/api/meta`          | Supported platforms and deterministic-check count |
| `POST` | `/api/reports`       | Create a report from `{ "urls": ["..."] }`        |
| `GET`  | `/api/reports`       | List recent public reports                        |
| `GET`  | `/api/reports/:slug` | Fetch a permanent report                          |
| `GET`  | `/api/settings`      | Read the active model and allowed choices         |
| `PUT`  | `/api/settings`      | Update the model; requires `x-admin-api-key`      |

## Database changes

Edit `apps/api/src/database/schema.ts`, then generate and apply a checked-in migration:

```bash
pnpm db:generate
pnpm db:migrate
```

## Deployment

- Railway reads `railway.json`, builds the shared package and API, and probes `/api/health/live` without touching Neon.
- Netlify reads `netlify.toml`, builds the shared package and Vite client, and serves `apps/web/dist` with SPA redirects.
- Both services are connected to the public `discomedia/finepredict` GitHub repository and deploy from pushes to the default branch.

Set production variables through the platform CLIs rather than committing `.env`:

```bash
railway variable set DATABASE_URL=... OPENAI_API_KEY=... ADMIN_API_KEY=... \
  FINEPREDICT_MODEL=gpt-5.6-luna WEB_ORIGIN=https://<site>.netlify.app

netlify env:set VITE_API_BASE_URL https://<api>.up.railway.app
```

## Analysis guarantees

- Deterministic checks run before the LLM.
- A model explanation is accepted only when its supporting quote is an exact substring of the archived title or rules.
- Failed or disabled LLM calls fall back to deterministic summaries and findings.
- “Equivalent” requires every extracted comparison dimension to match; the report lists each mismatch explicitly.
- Platform end timestamps are labeled as such and are not silently presented as the legal settlement deadline.
