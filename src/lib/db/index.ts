import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

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
  const dir = path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  await migrate(db, { migrationsFolder });
  return db;
}

export function getDb(): Promise<DB> {
  g.__relayDb ??= open().catch((e) => {
    g.__relayDb = undefined;
    throw e;
  });
  return g.__relayDb;
}

export { schema };
