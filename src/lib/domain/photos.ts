import { invalid } from '../errors';

/**
 * What counts as a photograph of a returned piece.
 *
 * The portal shrinks each picture in the browser and sends it as a data URL, so by the time it
 * reaches us it should be a few hundred kilobytes of JPEG. This is the gate: everything past it is
 * stored, and a page that accepts whatever a request calls a photograph is a way to fill the
 * database.
 */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Four is plenty to show a garment, and keeps a single return under a couple of megabytes. */
export const MAX_PHOTOS = 4;
/** After the browser has shrunk it. A 1600px JPEG lands near 300 KB; this is room to spare. */
export const MAX_PHOTO_BYTES = 2_000_000;

export type IncomingPhoto = { mime: string; bytes: string; size: number };

/**
 * Reads what the request calls photographs, and refuses anything that is not one.
 *
 * Deliberately strict about shape: the mime comes from the data URL itself rather than from a field
 * beside it, so a caller cannot label a zip as a JPEG.
 */
export function readPhotos(input: unknown, { required }: { required: boolean }): IncomingPhoto[] {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) {
    if (required) throw invalid('Add a photo of what you are returning.');
    return [];
  }
  if (list.length > MAX_PHOTOS) throw invalid(`You can add up to ${MAX_PHOTOS} photos.`);

  return list.map((entry) => {
    const url = typeof entry === 'string' ? entry : (entry as { dataUrl?: unknown })?.dataUrl;
    if (typeof url !== 'string') throw invalid('One of those photos could not be read.');

    const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url.trim());
    if (!match) throw invalid('One of those photos could not be read.');
    const [, mime, b64] = match;
    if (!ALLOWED.has(mime.toLowerCase())) throw invalid('Photos have to be JPEG, PNG or WebP.');

    /* Base64 carries three bytes in every four characters; the padding is what is left over. */
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    const size = Math.floor((b64.length * 3) / 4) - padding;
    if (size <= 0) throw invalid('One of those photos is empty.');
    if (size > MAX_PHOTO_BYTES) throw invalid('That photo is too large. Try again, or take a new one.');

    return { mime: mime.toLowerCase(), bytes: b64, size };
  });
}
