# Deploying Northstar

Northstar runs as a Node.js web server and stores application data in PostgreSQL. The included schema is designed for Supabase; it can also connect to a compatible PostgreSQL database through `DATABASE_URL`.

## Before deploying

1. Create a Supabase project.
2. In **Supabase → SQL Editor**, run the repository's `supabase/schema.sql` once. This creates the tables, indexes, row-level security settings, stock seed data, and default announcement.
3. In **Project Settings → Database → Connection string**, copy a PostgreSQL URI suitable for your hosting provider. Supabase pooler connections are useful when direct networking is unavailable. Keep the URI private.
4. Configure `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` as server-side secrets in your host. Never use these as frontend/Vite variables.
5. Keep `DEMO_MODE=false` for public deployments. The current app uses its own server-side sessions and password hashes, not Supabase Auth. Do not expose service credentials or database credentials in the browser.

On startup, the backend runs the schema SQL idempotently and provisions configured demo/admin accounts. The SQL schema seeds the stock catalog. It does not migrate data from an existing SQLite file; export/import existing users and portfolio data separately before switching a live app.

> The server stores sessions and password hashes in application tables, so treat the database as sensitive. RLS and revoked browser-role grants prevent direct browser access; all app operations should go through the authenticated server API. Keep a backup of the database and all encryption keys used for manual transfers.

Production sets the session cookie's `Secure` flag, so serve the app over HTTPS. The market quote poller and SSE clients are in-process; keep one app instance unless you add shared market-data coordination.

Ready-to-use configs:

| File | Platform |
| --- | --- |
| `render.yaml` | Render Blueprint; add `DATABASE_URL` and admin secrets in the dashboard. |
| `fly.toml` + `Dockerfile` | Fly.io; set secrets with `fly secrets set`. |
| `Dockerfile` | Any Docker host or VPS. |

## Render

1. Push the repository to GitHub.
2. In Render select **New → Blueprint** and choose this repo.
3. Add `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the service's environment settings. The URI comes from the Supabase dashboard. Keep all three server-side secrets.
4. Deploy. The health endpoint is `/api/health`.

No Render disk is needed because the database is in Supabase.

## Fly.io

1. Install `flyctl`, sign in, and change the globally unique `app` name in `fly.toml`.
2. Run `fly launch --no-deploy`.
3. Apply `supabase/schema.sql` in Supabase if you have not done so already.
4. Set secrets:

   ```bash
   fly secrets set DATABASE_URL='your-supabase-postgres-uri' \
     ADMIN_EMAIL='you@example.com' \
     ADMIN_PASSWORD='a-long-unique-password'
   ```

5. Run `fly deploy` and `fly open`.

Keep one machine while market updates are in-process.

## Docker or VPS

```bash
docker build -t northstar .
docker run -d --name northstar -p 3000:3000 \
  -e DATABASE_URL='your-supabase-postgres-uri' \
  -e ADMIN_EMAIL='you@example.com' \
  -e ADMIN_PASSWORD='a-long-unique-password' \
  --restart unless-stopped northstar
```

For production, inject secrets using the host's secret manager rather than storing them in shell history or a checked-in file. Put a TLS reverse proxy (for example, Caddy) in front of the app.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URI from Supabase. Server-side only. |
| `DB_POOL_SIZE` | Optional PostgreSQL pool size; defaults to 10. |
| `PGSSL` | Optional; set to `disable` only for trusted local PostgreSQL. Supabase uses TLS. |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD` | Set both before first startup to provision an administrator. |
| `PORT` | Optional; defaults to 3000 in production and 5173 in development. |
| `MARKET_PROVIDER` | Optional: `auto`, `yahoo`, `finnhub`, or `demo`. |
| `FINNHUB_API_KEY` | Optional Finnhub market-data key. |
| `DEMO_MODE` | Shared demo login; off by default in production. Keep off for public deployments. |
| `SEED_USER_NAME` / `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | Optional one-time private paper-trading account provisioning. |
| `MANUAL_TRANSFERS_ENABLED` + `TRANSFER_DETAILS_KEY` | Optional external transfer request feature; read the README warnings before enabling. |
| `DATABASE_DRIVER=sqlite` | Explicit local-only compatibility mode; do not use in production. Tests use it automatically. |

## After deploying

- Open the site, sign in with the admin credentials, and verify **Admin console** appears.
- Check `GET /api/health` and confirm the server logs show successful startup.
- Back up the Supabase database and retain a protected copy of `TRANSFER_DETAILS_KEY` if manual transfers are enabled.
- Northstar is a paper-trading prototype. It does not execute real trades or move real money.
