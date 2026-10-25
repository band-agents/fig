import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { registerChannels, type ChannelDef } from '../channels';

// One database for the whole process. Local development runs an embedded Postgres (PGlite) under
// .data/; production sets DATABASE_URL and gets real Postgres. Same schema, same migrations.

type DB = ReturnType<typeof drizzlePglite<typeof schema>>;

const g = globalThis as unknown as { __relayDb?: Promise<DB> };

async function open(): Promise<DB> {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    const db = drizzlePg(pool, { schema });
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder });
    return db as unknown as DB;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  // RELAY_PGLITE_DIR points a second copy (a staging server on another port) at its own database
  const dir = process.env.RELAY_PGLITE_DIR || path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  await migrate(db, { migrationsFolder });
  return db;
}

/** Storefronts added from the console join the shipped list as soon as the database is open. */
async function withStorefronts(db: DB): Promise<DB> {
  const rows = await db.select({ config: schema.channels.config }).from(schema.channels).where(eq(schema.channels.custom, true));
  registerChannels(rows.map((r) => r.config).filter((c): c is ChannelDef => Boolean(c)));
  return db;
}

export function getDb(): Promise<DB> {
  g.__relayDb ??= open().then(withStorefronts).catch((e) => {
    g.__relayDb = undefined;
    throw e;
  });
  return g.__relayDb;
}

export { schema };
