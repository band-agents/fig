@AGENTS.md

# Relay: rules for working here

FIG's order-fulfilment and returns console (Next.js 16 + Drizzle + Postgres/PGlite). README.md has the map.

- **Every order or return change goes through `src/lib/engine.ts`** (`ingestOrder`, `moveOrder`, `moveReturn`,
  `setHold`, `addNote`, `openReturn`). It checks the transition and the actor's access, stamps the SLA clock,
  writes the timeline, runs Autopilot, publishes to the live bus and queues write-back. Never update the
  `orders.stage` column directly.
- Stages, transitions and which area owns each one live in `src/lib/domain/stages.ts`. Add a stage there first,
  then its SLA default, then the tests in `src/lib/domain/__tests__`.
- Access: `can(p, area, level)` from `src/lib/domain/perms.ts`, and every list query goes through
  `scope(p)` (store scope). Customer data and money are masked in the query layer (`order-query.ts`,
  `order-detail.ts`), not in components.
- Money is minor units everywhere; KWD/JOD have 3 decimals (`format.ts`). Cairo time for day keys.
- Store facts only move orders forward (`applyPlatformFacts`). Write-back is off unless `RELAY_WRITE_BACK=true`
  and never runs for `source = 'demo'` orders.
- The local DB (PGlite in `.data/`) belongs to one process: stop `npm run dev` before `npm run seed`, or use
  Rules → Rebuild demo floor while the server runs.
- After a schema change: `npm run db:generate` (drizzle-kit) and commit the migration in `drizzle/`.
- **Live = Google Cloud** (Dan, 1 Nov): https://console.dagher-hinnawi.com on the server in `deploy/README.md`, Postgres in
  Docker. Ship by merging to `master`, then `deploy/update.sh` on the server, with Dan's go (about 15 s down). The PC
  console (PGlite, `.data/swap.ps1`) is retired: never start it again, it would sync and write to the stores twice.
- Before handing over: `npx tsc --noEmit`, `npm run lint` (0 problems), `npm test`, `npm run build`.
- Never read other projects' `.env`/`_secrets` files to wire stores; credentials go in this project's env.
