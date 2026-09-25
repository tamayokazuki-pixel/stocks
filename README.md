# Northstar

A responsive stock-market workspace for exploring equities and **paper trading**. It includes account creation and sign-in, streamed quotes, charts, watchlists, a portfolio, market/limit orders, order history, and a separate administrator console. The interface takes inspiration from common broker-platform patterns (including FOREX.com's demo accounts and charting tools), but is an original implementation and is not affiliated with FOREX.com.

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

Without a data-provider key, the app runs a **clearly labeled simulated market feed**. Quotes update every seven seconds and are pushed to browsers via Server-Sent Events; simulated charts are labeled **Illustrative demo chart**. This keeps the entire practice workflow usable with no credentials.

To use indicative provider quotes, set `FINNHUB_API_KEY` in `.env`. The server fetches listed symbols from Finnhub approximately every 30 seconds and pushes updates to connected clients. It also attempts to load Finnhub historical candles for chart ranges; where candles are unavailable, charts fall back to clearly labeled illustrative data. Failed or unavailable symbol quotes fall back to individually labeled simulation, and the interface shows **Mixed prices** if both sources are present. Provider quotes may be delayed, subject to your plan and market hours. A session-open indicator uses US regular trading hours but does not account for exchange holidays.

**This is market-data integration, not broker execution.** Paper orders can be placed outside regular exchange hours and fill against the latest displayed indicative/simulated quote. Do not use this implementation for real-money trading or price-sensitive decisions.

## What works

| Area | Features |
| --- | --- |
| Markets | Browse/search/filter/sort stocks and ETFs; live-updating price panels; selectable 1D/1W/1M/3M/1Y charts; market pulse. |
| Accounts | Register, sign in, sign out, or enter the development demo; private portfolio and watchlist. New accounts receive $100,000 in **virtual** buying power. |
| Trading | Buy/sell whole shares with market orders; place limit orders; reserve buying power/shares while pending; automatically fill crossed limits on price ticks; review and cancel orders. |
| Portfolio | Current equity, cash, holdings, allocation, daily movement, and unrealized position returns. |
| Admin | Role-protected asset listing/visibility/featured controls and demo reference prices; suspend/reactivate traders; adjust virtual cash; publish/hide announcements; pause/resume all paper trading; audit log. |
| Safety | Password hashes (bcrypt), random server-stored hashed session tokens, HttpOnly/SameSite cookies, request-verification header for mutations, login rate limiting, server-side validation and authorization, and transactional order/account updates. |

Cash is stored as integer cents and positions as whole shares. Pending buy orders reserve `quantity × limit price`; pending sell orders reserve shares. Hiding an asset cancels its pending orders. Pausing trading stops new orders and pending-order matching until resumed. This is a single-process SQLite application intended as a functional prototype, not a distributed trading engine.

## Production build

```bash
npm run build
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-unique-password-at-least-12-characters' NODE_ENV=production npm start
```

The production server defaults to port **3000** (`PORT` overrides it). Place it behind HTTPS and use a persistent filesystem for `DATABASE_PATH`. Production sets the session cookie's `Secure` flag. Set **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first startup to provision an admin account. A configured admin is created only when the email is not already registered. `DEMO_MODE=true` can explicitly enable the shared demo in production, but **do not do this for a public deployment**.

For a real production service, replace the prototype's shared/local SQLite setup with appropriate infrastructure; add email verification/password recovery, account protection, monitoring, backups, licensed data feeds, a broker/clearing integration, and legal/compliance checks before any real trades or deposits.

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
- `server/market.js` — quote adapters, simulated fallback, SSE updates, and historical chart data.
- `server/orders.js` — buying-power reservations, order filling, positions, and portfolio math.
- `server/auth.js` — HttpOnly cookie sessions and role checks.
- `server/api.test.js` — end-to-end API integration coverage against an isolated database.
