import 'server-only';
import { after } from 'next/server';

/**
 * Work a request starts and does not wait for (the changes sent to Shopify, a courier booking): on a
 * serverless host (Vercel) the function can stop as soon as the answer is sent, so it is handed to
 * `after()`, which keeps it running to the end. Outside a request (a script, the scheduler) `after`
 * is not available and the work simply runs on its own.
 */
export function keepAlive(work: Promise<unknown>) {
  try {
    after(() => work.then(() => undefined, () => undefined));
  } catch {
    // not inside a request: nothing to keep alive
  }
}
