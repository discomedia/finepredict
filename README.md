# FinePredict

FinePredict explains, archives, and compares the settlement terms behind prediction-market contracts. The initial release supports Polymarket and Kalshi URLs.

It deliberately does not create a pseudo-precise risk score. Reports show specific findings and place the original contract wording directly beside each conclusion.

## Product surface

- One- or two-market reports from public Polymarket and Kalshi URLs
- Debounced cross-venue search that pairs equivalent events, outcomes, thresholds, and deadlines
- Plain-English settlement summaries with verbatim supporting quotes
- 18 deterministic wording and consistency checks
- Optional structured explanations through `@discomedia/utils` and `gpt-5.6-luna`
- Cross-market deadline, trigger, source, revision, postponement, and fallback comparison
- Immutable, timestamped Neon snapshots with SHA-256 hashes and visual line diffs
- Platform-end countdowns and direct resolution-source reachability checks
- Permanent public report URLs and a recent-report index
- Passwordless managed Neon Auth accounts delivered through Disco Mail
- Paid watchlists with hourly rule, source, lifecycle, and dispute monitoring
- Free developer API keys with account-wide limits and an optional metered upgrade
- Reviewed historical dispute cases and related-wording matches
- Embeddable report mode and a Manifest V3 market-page extension
- Report-specific canonical, social, and structured metadata at the edge
- Administrator-only model selection through the system settings page
- Public JSON endpoints for other analytics and arbitrage tools
- Public, fee-aware Polymarket/Kalshi arbitrage dashboard with recurring deterministic discovery

## Architecture

```text
apps/web        React + Vite client, deployed on Netlify
apps/api        Express API, Drizzle persistence, market adapters, deployed on Railway
apps/extension  Manifest V3 content script for supported market pages
packages/shared Zod schemas and types shared by both apps
Neon            Postgres product data and managed authentication
Disco Mail      Magic-link and watchlist-alert email delivery
Stripe          Watchlist subscriptions and metered developer API billing
Polygon RPC     Optional Polymarket on-chain dispute evidence
Oddpool         Full-text Polymarket and Kalshi market discovery
```

Cross-venue discovery starts with [Oddpool event search](https://docs.oddpool.com/search/search-events), pairs semantically compatible event groups, and expands the strongest candidates through [Oddpool event markets](https://docs.oddpool.com/search/event-markets). FinePredict then aligns individual outcomes using direction, numeric thresholds, and dates; volume and liquidity only break ties between otherwise credible matches. It enriches Kalshi candidates through one public [Kalshi Get Markets API](https://docs.kalshi.com/api-reference/market/get-markets) batch request. Contract extraction uses the documented public [Polymarket Gamma API](https://docs.polymarket.com/market-data/fetching-markets) and [Kalshi Get Market API](https://docs.kalshi.com/api-reference/market/get-market). Trading credentials are not required for read-only discovery or extraction.

The `/arbitrage` page is a separate deterministic scanner. It downloads the
public Polymarket and Kalshi catalogs hourly, normalizes titles, outcomes,
thresholds, and deadlines, and evaluates only high-confidence candidate pairs.
It refreshes the strongest 24 persisted pairs every five minutes. Executable
order-book asks, venue fees, gross edge, net edge, depth, and projected profit
are stored in Postgres and streamed to the page. The scanner does not use an
LLM, place trades, or treat a merely correlated market as risk-free arbitrage.

## Local development

Use Node 22 or newer and pnpm 10.34.4.

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts the API on `http://localhost:3001`, starts the web app on `http://localhost:5173`, and opens the browser through Vite.

FinePredict uses one root `.env` locally. Copy `.env.example`; do not create
package-level env files.

### Environment variables

| Variable                      | Purpose                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | Pooled Neon Postgres connection string. Without it, public reports use non-persistent memory storage and account/product routes are unavailable. |
| `OPENAI_API_KEY`              | Enables LLM explanations. Deterministic analysis still works without it.                                                                         |
| `ODDPOOL_API_KEY`             | Server-only credential for homepage Polymarket and Kalshi full-text search.                                                                      |
| `FINEPREDICT_MODEL`           | Server default model; defaults to `gpt-5.6-luna`.                                                                                                |
| `ADMIN_API_KEY`               | Emergency server-side key accepted through `x-admin-api-key` for settings and dispute administration.                                            |
| `ADMIN_EMAILS`                | Comma-separated email addresses treated as administrators after Neon Auth verifies their identity.                                               |
| `PORT`                        | API listen port; defaults to `3001` locally and is injected by Railway.                                                                          |
| `APP_URL`                     | Public web origin used for Stripe Checkout and portal redirects.                                                                                 |
| `WEB_ORIGIN`                  | Comma-separated browser origins allowed by the FinePredict API CORS policy.                                                                      |
| `API_URL`                     | Public API origin advertised by OpenAPI, for example `https://<api>.up.railway.app`.                                                             |
| `NEON_AUTH_BASE_URL`          | Branch-specific managed Neon Auth URL used by the API for JWT verification and webhook signing keys.                                             |
| `DISCO_MAIL_API_KEY`          | Server-side Disco Mail key used for magic links and monitor alert email.                                                                         |
| `DISCO_MAIL_FROM_EMAIL`       | Disco Mail sender on the verified `fp.discomedia.co` domain.                                                                                     |
| `STRIPE_API_KEY`              | Server-side Stripe API key shared by both billing products.                                                                                      |
| `STRIPE_WATCHLIST_PRICE_ID`   | Recurring flat-price subscription for watchlist access.                                                                                          |
| `STRIPE_API_PRICE_ID`         | Separate recurring metered price for developer API access.                                                                                       |
| `STRIPE_WEBHOOK_SECRET`       | Signing secret for `POST /api/billing/webhook`.                                                                                                  |
| `STRIPE_API_METER_EVENT_NAME` | Exact event name of the Stripe Billing Meter attached to the API price.                                                                          |
| `API_KEY_HASH_SECRET`         | HMAC secret for developer API keys; must be at least 32 characters.                                                                              |
| `DEVELOPER_API_DAILY_LIMIT`   | Paid per-key daily request limit; defaults to `1000`. Free accounts receive 1 request per UTC minute and 10 per UTC day across all keys.         |
| `MONITOR_DRY_RUN`             | Defaults to `true`; suppresses email and Stripe meter writes while retaining internal monitor records.                                           |
| `POLYGON_RPC_URL`             | Optional Polygon mainnet JSON-RPC endpoint for Polymarket UMA dispute evidence.                                                                  |
| `VITE_API_BASE_URL`           | API origin compiled into the browser client.                                                                                                     |
| `VITE_NEON_AUTH_URL`          | Branch-specific managed Neon Auth URL compiled into the browser client.                                                                          |
| `FINEPREDICT_API_BASE_URL`    | API origin read by the Netlify report-metadata Edge Function.                                                                                    |
| `ARBITRAGE_SERVICE_ENABLED`   | Enables the recurring scanner when Postgres is configured; defaults to `true`.                                                                   |

The remaining `ARBITRAGE_*` variables in `.env.example` set the hourly discovery
cadence, five-minute bounded refresh, candidate caps, similarity threshold, and
minimum post-fee edge. Defaults are deliberately strict and network-bounded.

Generate the developer API secret locally:

```bash
openssl rand -hex 32 # API_KEY_HASH_SECRET
```

Account API access is intentionally unavailable when `NEON_AUTH_BASE_URL` or
`DATABASE_URL` is absent; public analysis and report routes continue to work.
The browser additionally requires `VITE_NEON_AUTH_URL`. Configure Neon Auth's
signed `send.magic_link` webhook and Disco Mail together because passwordless
sign-in requires email delivery. Billing remains unavailable without its Stripe credentials, and
the public product continues without paid entitlements. The developer bearer
API returns an explicit configuration error when `API_KEY_HASH_SECRET` is absent
or shorter than 32 characters.

### Provider resources

Create two distinct recurring Stripe prices: a flat watchlist subscription and
a metered developer API subscription. Attach the API price to a Stripe Billing
Meter whose event name exactly matches `STRIPE_API_METER_EVENT_NAME`; FinePredict
sends `stripe_customer_id` and `value` in each meter event. Register
`https://<api>.up.railway.app/api/billing/webhook` for
`customer.subscription.created`, `customer.subscription.updated`, and
`customer.subscription.deleted`, then store its signing secret in
`STRIPE_WEBHOOK_SECRET`.

Stripe CLI commands use test mode unless `--live` is passed. The test and live
catalogs use US$12/month for watchlists and US$0.01 per API unit, summed by the
`finepredict_api_usage` meter. Store price IDs matching the mode of
`STRIPE_API_KEY`; the API key, prices, meter, and webhook signing secret must all
belong to the same Stripe mode.

The Disco Mail key must have access to `fp.discomedia.co`; FinePredict defaults
to `FinePredict <hello@fp.discomedia.co>`. A Polygon mainnet RPC provider is
optional: it reads UMA dispute and resolution transactions for Polymarket
contracts. Omitting `POLYGON_RPC_URL` skips only that on-chain evidence and does
not disable normal market, source, lifecycle, or alert monitoring.

## Validation

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

The database-backed integration suite always uses the root `DATABASE_URL`. It
applies pending migrations, creates uniquely identified temporary product and
monitoring rows, verifies arbitrage catalog write suppression, and removes those
rows before closing its database connections.
The command fails instead of silently skipping when `DATABASE_URL` is absent.

To verify upstream APIs and the OpenAI path with real credentials, run the API and submit a current market URL:

```bash
pnpm dev:api
curl -X POST http://localhost:3001/api/reports \
  -H 'content-type: application/json' \
  --data '{"urls":["https://polymarket.com/event/<slug>"]}'
```

To verify Oddpool discovery through the local API without exposing its key:

```bash
curl 'http://localhost:3001/api/markets/search?platform=polymarket&query=bitcoin'
curl 'http://localhost:3001/api/markets/search?platform=kalshi&query=bitcoin'
curl 'http://localhost:3001/api/markets/search-pairs?query=bitcoin'
```

The homepage uses the paired endpoint. It pairs event groups before comparing
their child markets, rejects incompatible dates and meanings, and aligns exact
directions and numeric thresholds. A query may intentionally return no pairs
when the venues do not offer a credible equivalent. Kalshi's public batch
endpoint supplies the specific outcome label shown as each result title.

## API

All report reads are public in the MVP.

| Method | Path                           | Purpose                                                      |
| ------ | ------------------------------ | ------------------------------------------------------------ |
| `GET`  | `/api/health/live`             | Database-free Railway liveness check                         |
| `GET`  | `/api/meta`                    | Supported platforms and deterministic-check count            |
| `GET`  | `/api/markets/search`          | Search one venue with `platform` and `query`                 |
| `GET`  | `/api/markets/search-pairs`    | Find aligned Polymarket and Kalshi equivalents by `query`    |
| `GET`  | `/api/arbitrage/opportunities` | List current post-fee cross-venue opportunities              |
| `GET`  | `/api/arbitrage/summary`       | Return catalog and opportunity counts                        |
| `GET`  | `/api/arbitrage/status`        | Return discovery, refresh, request, and write metrics        |
| `GET`  | `/api/arbitrage/stream`        | Stream invalidations for live dashboard updates              |
| `POST` | `/api/reports`                 | Create a report from `{ "urls": ["..."] }`                   |
| `GET`  | `/api/reports`                 | List recent public reports                                   |
| `GET`  | `/api/reports/:slug`           | Fetch a permanent report                                     |
| `GET`  | `/api/settings`                | Read the active model and allowed choices                    |
| `PUT`  | `/api/settings`                | Update the model; requires an admin session or emergency key |

Account, watchlist, billing, dispute, and developer routes are documented by
the generated OpenAPI document at `GET /api/openapi.json`. Developer clients use
`Authorization: Bearer <fp_live_...>` under `/api/v1`; watchlist and account
routes use a short-lived managed Neon Auth bearer token. Developer API keys and
account JWTs are separate credentials even though both use the standard
`Authorization` header.

## Database changes

Edit `apps/api/src/database/schema.ts`, then generate and apply a checked-in migration:

```bash
pnpm db:generate
git diff -- apps/api/drizzle
pnpm db:migrate
```

Neon owns its tables in the managed `neon_auth` schema. FinePredict migrations
reference `neon_auth.user(id)` with UUID foreign keys but must never create,
alter, or drop the managed table. The checked-in migrations include product
subscriptions, watchlists, immutable observations/snapshots, alerts, dispute
history, API keys, account-wide free minute windows, daily usage, and Stripe
webhook idempotency. The arbitrage tables retain normalized public venue
catalogs, executable opportunities, scan metrics, and service runs. Unchanged
catalog rows are hash-compared and are not rewritten. Apply migrations to the
intended database after enabling Neon Auth and before enabling billing or
monitoring.

## Monitoring

Build and run one bounded monitor pass from the root:

```bash
pnpm --filter @finepredict/shared build
pnpm --filter @finepredict/api build
MONITOR_DRY_RUN=true pnpm --filter @finepredict/api monitor
```

For a source TypeScript run during development:

```bash
MONITOR_DRY_RUN=true pnpm --filter @finepredict/api monitor:dev
```

Dry run is the safe default. It still writes monitor-run records, market
observations, changed snapshots, and deduplicated alert records to the configured
database, but it does not send Disco Mail email or Stripe meter events. Set
`MONITOR_DRY_RUN=false` only after Disco Mail, Stripe, and production entitlements
have been verified. The process takes a Postgres advisory lock, retries each
market once, closes its database clients, and exits.

## Deployment

- Railway reads `railway.json`, builds the shared package and API, and probes `/api/health/live` without touching Neon.
- A separate Railway cron service reads `railway.monitor.json`, runs the bounded monitor, and has no public domain or health check. Its checked-in schedule is `7 * * * *` (minute 7 of every hour, UTC).
- Netlify reads `netlify.toml`, builds the shared package and Vite client, and serves `apps/web/dist` with SPA redirects.
- Both services are connected to the public `discomedia/finepredict` GitHub repository and deploy from pushes to the default branch.

Set production variables through the platform CLIs rather than committing `.env`:

```bash
railway variable set DATABASE_URL=... OPENAI_API_KEY=... ODDPOOL_API_KEY=... ADMIN_API_KEY=... \
  ADMIN_EMAILS=admin@example.com \
  FINEPREDICT_MODEL=gpt-5.6-luna APP_URL=https://<site>.netlify.app \
  WEB_ORIGIN=https://<site>.netlify.app API_URL=https://<api>.up.railway.app \
  NEON_AUTH_BASE_URL=https://<branch>.neonauth.<region>.aws.neon.tech/<database>/auth \
  DISCO_MAIL_API_KEY=... \
  DISCO_MAIL_FROM_EMAIL='FinePredict <hello@fp.discomedia.co>' STRIPE_API_KEY=... \
  STRIPE_WATCHLIST_PRICE_ID=price_... STRIPE_API_PRICE_ID=price_... \
  STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_API_METER_EVENT_NAME=... \
  API_KEY_HASH_SECRET=... DEVELOPER_API_DAILY_LIMIT=1000 \
  MONITOR_DRY_RUN=true POLYGON_RPC_URL=...

netlify env:set VITE_API_BASE_URL https://<api>.up.railway.app
netlify env:set VITE_NEON_AUTH_URL https://<branch>.neonauth.<region>.aws.neon.tech/<database>/auth
netlify env:set FINEPREDICT_API_BASE_URL https://<api>.up.railway.app
```

Enable Neon Auth Magic Link for the production branch, disable unused password
and OAuth providers, and trust the Netlify origin. After the new API deployment
is healthy, enable the custom Neon Auth webhook at
`https://<api>.up.railway.app/api/auth/neon-webhook` for only
`send.magic_link`. Enabling it earlier causes Neon Auth to skip its built-in
email and route delivery to an endpoint that may not exist yet.

Create the monitor as a second service connected to the same repository and
branch. Set its Railway config-file path to `/railway.monitor.json`, share the
same `DATABASE_URL` and relevant provider variables, and do not assign a domain.
Deploy the API and its migrations first. Keep `MONITOR_DRY_RUN=true` for the
first scheduled runs, inspect the monitor logs and stored observations, then
change it to `false` only when external delivery is approved. Railway evaluates
the schedule in UTC and skips an overlapping run if the previous process has not
exited.

See [Distribution surfaces](docs/distribution.md) for the browser extension,
report iframe snippet, resize-message contract, and crawler metadata behavior.

## Analysis guarantees

- Deterministic checks run before the LLM.
- A model explanation is accepted only when its supporting quote is an exact substring of the archived title or rules.
- Failed or disabled LLM calls fall back to deterministic summaries and findings.
- “Equivalent” requires every extracted comparison dimension to match; the report lists each mismatch explicitly.
- Platform end timestamps are labeled as such and are not silently presented as the legal settlement deadline.
