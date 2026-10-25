# Going live

One small server runs everything: the console, its Postgres, Caddy (HTTPS) and a nightly backup.
A 4 vCPU / 8 GB machine is plenty (Hetzner CX32 or similar, about €8 a month), in the company's name.

## What you need first

| Item | Who | Notes |
|---|---|---|
| A server with Docker | Dan / the company | Ubuntu 24.04, ports 80 and 443 open |
| An address | Dan | e.g. `ops.dh-dco.com`: an **A record** pointing at the server's IP |
| Google sign-in client | Dan (Google Cloud) | see below; optional on day one, password sign-in works without it |
| Store keys | already in the local `.env.local` | Labesny's Shopify app client id + secret; others when they are ready |

## Steps

```bash
# on the server
git clone <the relay repository> relay && cd relay/deploy
cp ../.env.example .env        # then fill in DOMAIN, RELAY_PUBLIC_URL, POSTGRES_PASSWORD and the store keys
docker compose up -d --build   # first build takes a few minutes
docker compose logs -f app     # wait for "Ready"
```

1. Open `https://<DOMAIN>/login`. On an empty database it asks for the **owner account**: create it.
2. **Team & access** → add each teammate by email with their job. They sign in with Google, or by password from an invitation.
3. Read Labesny's catalogue, stock and orders once (read-only towards the store):
   ```bash
   docker compose exec app npm run import:live
   ```
   After that the schedule keeps orders fresh every `RELAY_SYNC_MINUTES` and the AI planner reads the range every `RELAY_PLAN_MINUTES`.
4. Keep `RELAY_WRITE_BACK=false` until each store's write-back has been tried on a test order.

The production database starts empty: no demo orders, no demo stock. Egypt fills in when FIG's store keys are added.

## Google sign-in

1. Google Cloud console → a project for DH & DCO → **APIs & Services → OAuth consent screen**.
   With Google Workspace choose **Internal** (only company accounts, no review). Otherwise **External** and add staff as test users, or publish (needs the domain, a home page and a privacy page).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI: `https://<DOMAIN>/api/auth/google/callback`
3. Put the client id and secret in `deploy/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then `docker compose up -d`.

Only emails that already have an account get in; anyone else is told to ask an admin.

## Backups

- `deploy/backups/relay-YYYY-MM-DD.sql.gz` every night, fourteen days kept. Copy them off the server too (another machine, Drive, or object storage), and turn on the provider's server snapshots.
- Restore: `gunzip -c relay-2026-10-21.sql.gz | docker compose exec -T db psql -U relay relay` (into an empty database).

## Updating

```bash
cd relay && git pull && cd deploy && docker compose up -d --build
```

Migrations run by themselves when the app starts.

## Why not Medusa Cloud

Medusa Cloud hosts Medusa projects (the store backends, and storefronts inside the same monorepo). The console is its own app with its own database and background jobs (store sync, the AI planner, live updates), so it needs its own server. Medusa stays what it is today: a source of orders and returns the console reads.
