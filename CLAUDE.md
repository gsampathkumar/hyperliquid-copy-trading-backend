# Hyperliquid Copy Trading Backend

## Architecture

Two separate processes sharing a single `.env` at the repo root:

- **api/** — NestJS Nx monorepo (HTTP + WebSocket). Port 3003.
- **analytics/** — Standalone Node.js workers (BullMQ + event collector + batch scripts).

Both connect to the same MongoDB (`MONGO_URI`) and Redis (`REDIS_HOST`).

## Path aliases

- API: `@hyperliquid-api/main/*` → `api/libs/main/src/*`
- Analytics: no aliases, uses relative imports

## Key services

- `HyperliquidApiService` (api) — wraps `@nktkas/hyperliquid` SDK (InfoClient, SubscriptionClient)
- `HyperliquidClient` (analytics) — standalone HL API client with built-in rate limiter
- `SessionValidationGuard` — shared session auth with core-exchange-api via Redis
- `RedisService` — ioredis connection with reconnection handling
- `LoggerService` — structured logging with Logtail + SES email alerts
- `TradersService` — trader queries, explore bucketing, positions (live from HL API)

## Collections

- `hl_traders` — trader profiles with computed metrics (prefixed with SHARED_PREFIX)
- `hl_fills` — trader fill history (backfilled + forward-filled)
- `hl_trades` — raw market trades from WebSocket (all assets)
- `hl_assets` — asset metadata, prices, OI (Step 3)
- `hl_funding_history` — hourly funding rate snapshots (Step 3)
- `hl_checkpoints` — resumable bootstrap progress tracking

## Queue names

- `hl-trader-stats` — trader metrics computation
- `hl-asset-stats` — asset price/OI/funding updates
- `hl-trade-execution` — paper copy trade execution

## API endpoints (Step 2)

- `GET /v1/hl/traders` — paginated, sortable by any metric
- `GET /v1/hl/traders/search?q=` — autocomplete by address or name
- `GET /v1/hl/traders/explore?dimension=` — bucketed histogram
- `GET /v1/hl/traders/explore/rows` — paginated rows for explore criteria
- `GET /v1/hl/traders/:address` — trader detail
- `GET /v1/hl/traders/:address/positions?status=` — live positions from HL
- `GET /v1/hl/traders/:address/trades` — trade history from stored fills

## Running

```bash
# API
cd api && npm install --legacy-peer-deps && npm run dev

# Analytics workers
cd analytics && npm install && npm run workers

# Event collector
cd analytics && npm run collector

# Bootstrap traders (one-time)
cd analytics && npm run bootstrap:traders
```

## Conventions

- Collection names are prefixed with `SHARED_PREFIX` env var
- Auth uses shared Redis sessions with `api_session:` key prefix
- Cookie name: `airavat_session` (same as polymarket backend)
- All timestamps in IST for console, UTC for storage
- Analytics uses raw mongodb driver (not Mongoose). API uses Mongoose 5.x.
- Rate limits: 1200 weight/min per IP (REST), 1000 subs per IP (WebSocket)
- Trader fills: backfill up to 10K via REST, forward-fill via WebSocket trades channel
