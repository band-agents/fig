import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { IncomingPhoto } from './domain/photos';

export { readPhotos, MAX_PHOTOS, MAX_PHOTO_BYTES, type IncomingPhoto } from './domain/photos';

/**
 * The photographs that come with a self-service return.
 *
 * A customer has to show us what they are sending back. It settles "too small" from "arrived
 * damaged" before anyone drives out to collect the parcel, and it is the only record of the state
 * the piece was in when it left them.
 *
 * What arrives is checked by domain/photos.ts first; this is only the storing and the reading.
 */

/** Files the photographs against a return that has just been opened. */
export async function savePhotos(returnId: string, photos: IncomingPhoto[]) {
  if (!photos.length) return;
  const db = await getDb();
  await db.insert(schema.returnPhotos).values(photos.map((p) => ({ returnId, ...p })));
}

/** What the desk lists beside a return: ids and sizes, never the bytes. */
export async function photosFor(returnId: string) {
  const db = await getDb();
  return db
    .select({
      id: schema.returnPhotos.id,
      mime: schema.returnPhotos.mime,
      size: schema.returnPhotos.size,
      createdAt: schema.returnPhotos.createdAt,
    })
    .from(schema.returnPhotos)
    .where(eq(schema.returnPhotos.returnId, returnId))
    .orderBy(asc(schema.returnPhotos.createdAt));
}

/** One photograph, with its bytes, for the staff endpoint that serves it. */
export async function photoById(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.returnPhotos).where(eq(schema.returnPhotos.id, id));
  return row ?? null;
}
