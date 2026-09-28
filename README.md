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
| Paper cash | Top up virtual paper-trading cash or withdraw unreserved cash; review a per-account activity history. These are simulated balance adjustments only—no bank, card, or payment processor is connected. Each adjustment is $1–$100,000. |
| External transfers (opt-in) | Operator receiving bank/wallet details, manual top-up reports and withdrawal requests, encrypted details, private history, cancellation, and an admin review queue. Records only; no automated payment, custody balance, or link to virtual cash. |
| Trading | Buy/sell whole shares with market orders; place limit orders; reserve buying power/shares while pending; automatically fill crossed limits on price ticks; review and cancel orders. |
| Portfolio | Current equity, cash, holdings, allocation, daily movement, and unrealized position returns. |
| Admin | Role-protected asset listing/visibility/featured controls and demo reference prices; suspend/reactivate traders; adjust virtual cash; publish/hide announcements; pause/resume all paper trading; audit log. |
| Safety | Password hashes (bcrypt), random server-stored hashed session tokens, HttpOnly/SameSite cookies, request-verification header for mutations, login rate limiting, server-side validation and authorization, and transactional order/account updates. |

Cash is stored as integer cents and positions as whole shares. Cash top-ups and withdrawals are virtual ledger entries; withdrawals cannot consume funds reserved by pending buy orders. Pending buy orders reserve `quantity × limit price`; pending sell orders reserve shares. Hiding an asset cancels its pending orders. Pausing trading stops new orders and pending-order matching until resumed. This is a single-process SQLite application intended as a functional prototype, not a distributed trading engine.

## Manual bank and wallet transfers

This optional workflow records **requests for transfers settled outside Northstar**. It is separate
from **Manage your paper funds**, which still adjusts only virtual cash. Submitting, rejecting,
cancelling, or completing an external request **never changes paper buying power or holdings**.
Northstar does not connect to a bank/blockchain, execute payouts, verify receipts, or maintain a
real-money ledger. The $100,000 starter paper balance is **not withdrawable real money**.

### Configure the operator's receiving details

1. Generate a persistent encryption key on the deployment host:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
2. Store it as `TRANSFER_DETAILS_KEY` in your secret manager or Git-ignored `.env`. Set
   `MANUAL_TRANSFERS_ENABLED=true` and restart the server. Startup fails if the enabled feature
   does not have a valid 64-character hexadecimal key. Do not put this key in frontend/Vite
   variables. Back it up separately from the database. **Do not regenerate it on every start**:
   changing or losing it makes stored records unreadable. Automated key rotation is not provided.
3. Sign in as an administrator. Open **Admin console → Bank & wallet → Add bank / wallet**.
   Enter and independently verify an operator-owned destination:
   - **US bank:** account holder, bank name, account number, nine-digit ABA routing number,
     and checking/savings account type. USD only; international banks/IBANs are not supported.
   - **Wallet:** a public EVM address on **Ethereum or Polygon**, for **USDC only**. No seed
     phrase, private key, wallet login, or signature is requested. Address shape checks do not
     verify ownership, checksum, network compatibility, or token support.
4. Receiving methods are visible to authenticated private accounts. To change details, disable
   the old method and add a new one. Existing requests retain an immutable snapshot. No real
   destination is seeded or hard-coded. The shared demo account cannot use this workflow.

Without configuration, the portfolio explains that manual transfers are unavailable; no destination
or payment instructions are invented. Disabling `MANUAL_TRANSFERS_ENABLED` stops access to these
routes without deleting encrypted records.

### User workflow

Open **Portfolio → Bank & wallet transfers**:

- **Submit top-up request:** choose an operator receiving account, verify instructions directly
  with the operator via a trusted channel, and report an externally made transfer with its amount
  and bank reference / transaction hash. A submitted reference is **not proof of receipt**.
- **Request withdrawal:** enter a bank account or public wallet you own and the requested amount.
  The operator must independently verify the actual external balance and eligibility. The app
  neither authorizes nor reserves real funds and does not use the virtual balance.
- Requests start **pending**. Users can view their latest 100 requests and cancel pending request
  records. Cancellation does **not** reverse or refund a transfer. Once an admin claims a request,
  it becomes **processing** and cannot be cancelled by the user.

Each request is $1–$100,000. Wallet requests use nominal **1 USDC = 1 USD**, with at most two decimal
places; this is not an exchange quote or a peg guarantee. There is no token conversion or fee
calculation. Confirm gross/net amounts and bank/network fees outside the app. Withdrawal details
are collected per request, not added to a reusable saved-account directory.

### Administrator workflow

In **Admin console → Bank & wallet**, select a status to view the queue (100 records per page,
with an **Older requests** control). **Claim & review request** atomically assigns the request to
that administrator before any external processing. Only that administrator can finish it; another
admin cannot claim it or record a second completion. Admins cannot review their own requests.

- For deposits, independently confirm actual receipt, identity, reference uniqueness, and ledger
  reconciliation. Merely receiving a reference or transaction hash is insufficient.
- For withdrawals, check identity, destination ownership, **external** balances/reservations and
  previous payouts before using your authorized external settlement process. Never use paper cash.
- **Record externally completed transfer** requires an external settlement reference and explicit
  verification acknowledgement. It only records an attestation; it does not send or credit funds.
- **Reject request** requires a reason visible to the user. Neither rejection nor cancellation
  triggers a refund. Finished requests cannot be reviewed again. A suspended account's request
  cannot be completed. Use **Processing (claimed) → Continue review** to resume an interrupted review.

Claims intentionally have no automatic timeout/reassignment: an expired claim is not evidence that
an external payment did not happen. Recovery from an unavailable reviewer requires an audited
operator procedure and external reconciliation before any database intervention.

### Security and deployment limitations

Bank/wallet snapshots, submitted references, and review notes are encrypted at rest with AES-256-GCM.
Only authenticated owners and administrators can read request details; operator receiving accounts
are readable by authenticated private accounts. Responses are `no-store`; audit logs omit account
numbers, addresses, and references. Request creation has a per-user rate limit, a 20-open-request
cap, and an idempotency key so retries of the same submission do not create duplicate records.
This is **not** global duplicate-payment detection: admins must cross-check external references and
payouts in their settlement ledger. A rejected response permits editing; uncertain network outcomes
can be retried with the original key/payload.

**Do not accept real funds on a demo deployment.** Before real-world use, arrange a regulated
provider/custody and reconciliation process, KYC/AML and legal review, identity and bank/wallet
ownership verification, administrator MFA/step-up authorization and separation of duties,
external balances/reservations, settlement confirmation, refund/dispute handling, monitoring,
backups, privacy/retention policies, and HTTPS. Disable shared demo access and remove default demo
administrators. This feature is a manual request-management prototype, not a production payments
or real-money trading integration.

## Production build

```bash
npm run build
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-unique-password-at-least-12-characters' NODE_ENV=production npm start
```

The production server defaults to port **3000** (`PORT` overrides it). Place it behind HTTPS and use a persistent filesystem for `DATABASE_PATH`. Production sets the session cookie's `Secure` flag. Set **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first startup to provision an admin account. A configured admin is created only when the email is not already registered. `DEMO_MODE=true` can explicitly enable the shared demo in production, but **do not do this for a public deployment**.

For a real production service, replace the prototype's shared/local SQLite setup with appropriate infrastructure; add email verification/password recovery, account protection, monitoring, backups, licensed data feeds, a regulated payments and brokerage integration, and legal/compliance checks before any real trades, deposits, or withdrawals. The cash controls in this prototype never move real money.

## Checks

```bash
npm test        # isolated API + provider tests, including manual transfers and encrypted storage
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

- `server/transfers.js` — opt-in external transfer validation, encrypted storage, receiving methods, request ownership and manual review.
- `server/transfers.test.js` — transfer privacy, encryption, idempotency, state transitions, and paper-balance isolation tests.
- `src/components/{ManualTransfers,AdminTransfers,TransferDetails}.tsx` — portfolio request forms and administrator transfer workspace.
