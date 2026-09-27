# Northstar

A responsive stock-market workspace for exploring equities and **paper trading**. It includes account creation and sign-in, streamed real-time quotes, charts, watchlists, a portfolio, market/limit orders, order history, and a separate administrator console. The interface takes inspiration from common broker-platform patterns (including FOREX.com's demo accounts and charting tools), but is an original implementation and is not affiliated with FOREX.com.

> **Important:** Northstar does **not** execute real-money trades or connect to a stock exchange. All orders, cash balances, holdings, and fills are simulated. An actual brokerage product would require a licensed broker integration, KYC/AML onboarding, regulatory review, market-data rights, and production-grade operations. Never present paper fills as exchange executions.

## Run locally

Requires **Node.js 22+** (the server uses Node's built-in `node:sqlite` module) and npm.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The Express API and Vite-powered React app share the same origin and port, so authentication cookies, the live price stream, and API calls work without cross-origin configuration. Backend code changes require a server restart; Vite hot-reloads frontend changes.

On first run, a local SQLite database is created at `data/northstar.sqlite`. The `data/` directory is Git-ignored. An example environment file is in `.env.example`; copy it to `.env` to customize settings.

### Explore the demo

- Click **Explore demo account** for a one-click sign-in to a seeded portfolio with virtual holdings and cash.
- The development-only administrator login is **`admin@northstar.demo`** / **`NorthstarAdmin123!`**. Sign in with those credentials, then open **Admin console** in the sidebar.
- These defaults are for local evaluation only. Do not expose a development server as a production service. In production, the demo login is disabled by default and no default admin is created.

## Market prices

Northstar shows **real market data out of the box — no API key required.** On startup the server
selects a provider:

| `MARKET_PROVIDER` | Behaviour |
| --- | --- |
| `auto` (default) | Finnhub when `FINNHUB_API_KEY` is set, otherwise Yahoo Finance. |
| `yahoo` | Keyless real quotes and historical candles from Yahoo Finance's public chart endpoints. Refreshes every 15 seconds. |
| `finnhub` | Requires `FINNHUB_API_KEY`. Refreshes every 30 seconds (free-tier friendly). |
| `demo` | Forces the clearly labeled simulated feed. Useful offline and in tests. |

Quotes are polled server-side and pushed to every connected browser over Server-Sent Events, so all
sessions see the same prices. Charts (1D/1W/1M/3M/1Y) use real historical candles from the same
provider. The header badge reads **Live · <provider>** when real data is flowing.

Real prices may be **delayed** (typically up to ~15 minutes, depending on exchange and provider) and
the keyless Yahoo endpoints are public, unofficial, and carry no SLA or redistribution rights — fine
for a personal or evaluation deployment, not for a commercial product. Review the provider's terms
before public use, and buy a licensed feed for anything serious.

If a symbol or the whole provider is unreachable, that symbol falls back to the **simulated feed**,
labeled per-symbol; the interface shows **Mixed prices** when both are present, and charts that are
not real market data are labeled **Illustrative demo chart**. A session-open indicator uses US
regular trading hours and does not account for exchange holidays.

**This is market-data integration, not broker execution.** Paper orders can be placed outside
regular exchange hours and fill against the latest displayed quote. Do not use this implementation
for real-money trading or price-sensitive decisions.

## What works

| Area | Features |
| --- | --- |
| Markets | Browse/search/filter/sort stocks and ETFs; live-updating price panels; selectable 1D/1W/1M/3M/1Y charts; market pulse. |
| Accounts | Register, sign in, sign out, or enter the development demo; private portfolio and watchlist. New accounts receive $100,000 in **virtual** buying power. |
| Cash | Top up virtual paper-trading cash or withdraw unreserved cash; review a per-account activity history. These are simulated balance adjustments only—no bank, card, or payment processor is connected. Each adjustment is $1–$100,000. |
| Trading | Buy/sell whole shares with market orders; place limit orders; reserve buying power/shares while pending; automatically fill crossed limits on price ticks; review and cancel orders. |
| Portfolio | Current equity, cash, holdings, allocation, daily movement, and unrealized position returns. |
| Admin | Role-protected asset listing/visibility/featured controls and demo reference prices; suspend/reactivate traders; adjust virtual cash; publish/hide announcements; pause/resume all paper trading; audit log. |
| Safety | Password hashes (bcrypt), random server-stored hashed session tokens, HttpOnly/SameSite cookies, request-verification header for mutations, login rate limiting, server-side validation and authorization, and transactional order/account updates. |

Cash is stored as integer cents and positions as whole shares. Cash top-ups and withdrawals are virtual ledger entries; withdrawals cannot consume funds reserved by pending buy orders. Pending buy orders reserve `quantity × limit price`; pending sell orders reserve shares. Hiding an asset cancels its pending orders. Pausing trading stops new orders and pending-order matching until resumed. This is a single-process SQLite application intended as a functional prototype, not a distributed trading engine.

## Production build

```bash
npm run build
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-unique-password-at-least-12-characters' NODE_ENV=production npm start
```

The production server defaults to port **3000** (`PORT` overrides it). Place it behind HTTPS and use a persistent filesystem for `DATABASE_PATH`. Production sets the session cookie's `Secure` flag. Set **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first startup to provision an admin account. A configured admin is created only when the email is not already registered. `DEMO_MODE=true` can explicitly enable the shared demo in production, but **do not do this for a public deployment**.

For a real production service, replace the prototype's shared/local SQLite setup with appropriate infrastructure; add email verification/password recovery, account protection, monitoring, backups, licensed data feeds, a regulated payments and brokerage integration, and legal/compliance checks before any real trades, deposits, or withdrawals. The cash controls in this prototype never move real money.

## Checks

```bash
npm test        # isolated API integration test: auth, orders, reserves, permissions, admin controls
npm run build   # TypeScript validation and production bundle
```

The integration test starts its own production-mode server against a temporary SQLite database, and removes the database afterward.

## Project map

- `src/` — React/TypeScript pages, reusable chart/order components, styles, API client, and session/market state.
- `server/index.js` — same-origin Express API, validation, authorization, and admin endpoints.
- `server/db.js` — SQLite schema, local seed data, settings, and transaction helper.
- `server/market.js` — quote cache, simulated fallback, SSE updates, and historical chart data.
- `server/providers.js` — real market-data adapters (Yahoo Finance, Finnhub) and provider selection.
- `server/orders.js` — buying-power reservations, order filling, positions, and portfolio math.
- `server/auth.js` — HttpOnly cookie sessions and role checks.
- `server/api.test.js` — end-to-end API integration coverage against an isolated database.
- `server/providers.test.js` — market-data adapter parsing, fallback, and selection tests.
