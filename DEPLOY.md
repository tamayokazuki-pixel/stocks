# Deploying Northstar

Northstar is a **single Node.js process** that serves both the API (`server/`) and the built
frontend (`dist/`), with all state in **one SQLite file**. That keeps deployment simple, but
it imposes three rules:

1. **Node 22.13+** — the server uses Node's built-in `node:sqlite` module.
2. **Exactly one instance** — SQLite plus the in-process market-price poller mean the app
   cannot be scaled horizontally. Never enable multi-instance or autoscaling.
3. **Persist the database** — the SQLite file (`DATABASE_PATH`, default `./data/northstar.sqlite`)
   must live on a persistent volume. On an ephemeral filesystem every deploy or restart
   wipes all accounts, portfolios, and orders. (Free tiers without disks are fine only for
   throwaway demos.)

Production sets the session cookie's `Secure` flag, so the site **must be served over
HTTPS** — use a platform that terminates TLS for you (Render, Fly, Railway, …) or put a
reverse proxy in front.

Before the *first* start, set **both** `ADMIN_EMAIL` and `ADMIN_PASSWORD` so an
administrator account is provisioned. `DEMO_MODE` is off by default in production — leave
it that way for anything public.

Ready-to-use configs in this repo:

| File | Platform |
| --- | --- |
| `render.yaml` | Render (blueprint with a 1 GB persistent disk) |
| `fly.toml` + `Dockerfile` | Fly.io (machine + volume) |
| `Dockerfile` + `.dockerignore` | Any Docker host, VPS, or Kubernetes |

---

## Option A — Render (easiest)

1. Push this repository to GitHub.
2. On <https://dashboard.render.com> choose **New → Blueprint** and select the repo.
   Render reads `render.yaml`: Node 22, `npm ci && npm run build`, `npm start`, a health
   check on `/api/health`, and a 1 GB persistent disk mounted at `/var/data` (the database
   is pointed there via `DATABASE_PATH`).
3. When prompted, fill in the two secrets: `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Create. The app is live at `https://<service>.onrender.com` within a few minutes.

Notes:

- Persistent disks require a paid plan (Starter is the smallest that works). The **free
  tier has no disk**, so the database resets on every restart.
- To update: push to GitHub — Render rebuilds and redeploys; the disk and database survive.
- No external database add-on is needed; SQLite on the disk is the intended setup.

## Option B — Fly.io

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and run `fly auth signup` (or `fly auth login`).
2. Edit `fly.toml` and set `app` to a globally unique name (e.g. `yourname-northstar`).
3. `fly launch --no-deploy` — it picks up `fly.toml` and the `Dockerfile`; create the
   `northstar_data` volume when asked (1 GB is plenty).
4. `fly secrets set ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-unique-password'`
5. `fly deploy`, then `fly open`.

Notes:

- The volume is mounted at `/app/data`, which is where the server writes by default.
- Stay at one machine (`fly scale count 1`); the app has no multi-node coordination.
- `min_machines_running = 0` lets the app sleep when idle to save money. Set it to `1`
  if you want it always on — the SSE price stream reconnects either way.

## Option C — Any Docker host or VPS

```bash
docker build -t northstar .
docker run -d --name northstar -p 3000:3000 \
  -v northstar-data:/app/data \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='a-long-unique-password' \
  --restart unless-stopped \
  northstar
```

On a VPS with a domain, put [Caddy](https://caddyserver.com/) in front for automatic HTTPS
(plain HTTP will not work because production cookies are `Secure`):

```Caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Without Docker, the equivalent is `npm ci && npm run build`, then
`NODE_ENV=production npm start` with the environment variables below — but you must run it
from the same directory every time so `DATABASE_PATH` stays on persistent storage, and
arrange your own systemd unit + TLS.

---

## Environment variables

| Variable | When | Purpose |
| --- | --- | --- |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD` | Before first start | Provisions the administrator account. Set both or neither. |
| `PORT` | Optional | Defaults to 3000 in production (5173 in dev). Platforms usually inject this. |
| `DATABASE_PATH` | Optional | SQLite file location. Point it at your persistent volume if the default (`./data/northstar.sqlite`) is not persistent. |
| `MARKET_PROVIDER` | Optional | `auto` (default) \| `yahoo` \| `finnhub` \| `demo`. |
| `FINNHUB_API_KEY` | Optional | Preferred real-quote source when set; otherwise keyless Yahoo Finance. |
| `DEMO_MODE` | Optional | Shared demo login. Off by default in production; keep it off for public deployments. |
| `SEED_USER_NAME` / `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | Optional | Pre-provision one private account at first startup. |
| `MANUAL_TRANSFERS_ENABLED` + `TRANSFER_DETAILS_KEY` | Optional | Opt-in manual bank/wallet transfer records — read the README section before enabling. |

Secrets belong in the platform's secret store (Render dashboard, `fly secrets`), never in Git.

## After deploying

- Open the site, sign in with the admin credentials, and check that **Admin console**
  appears in the sidebar.
- **Backups:** everything lives in the single SQLite file on the volume. Use volume
  snapshots (Fly and Render both support them) or stop the app and copy the file. There is
  no other copy.
- **Health check:** `GET /api/health` returns `{"status":"ok"}` — use it for uptime monitors
  or platform health checks.
- Northstar is a **paper-trading prototype**: no real-money trading, deposits, or
  withdrawals. See "Security and deployment limitations" in the README before pointing
  real users at it.
