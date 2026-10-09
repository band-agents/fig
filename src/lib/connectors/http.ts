import 'server-only';

// One fetch with the retries every store API needs: dropped connections, 429s and 5xx come back
// after a pause; anything else is the caller's to read. Never logs headers or bodies.

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly codes: string[] = [],
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const backoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 16_000) + Math.floor(Math.random() * 250);

const TRANSIENT = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);

export function transientError(err: unknown) {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  if (/fetch failed|ECONNRESET|socket hang up/i.test(err.message)) return true;
  const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
  return Boolean(code && TRANSIENT.has(code));
}

const retryAfter = (res: Response) => {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 30_000) : null;
};

export async function fetchRetry(
  url: string,
  init: RequestInit,
  opts: { label: string; tries?: number; timeoutMs?: number },
): Promise<Response> {
  const tries = Math.max(1, opts.tries ?? 5);
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
    } catch (err) {
      if (attempt < tries && transientError(err)) {
        await sleep(backoff(attempt));
        continue;
      }
      const why = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : String(err);
      throw new ConnectorError(`${opts.label} could not be reached: ${why}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(retryAfter(res) ?? backoff(attempt));
      continue;
    }
    return res;
  }
}

/** The start of an error body as plain text, for a message staff can read. */
export async function errorText(res: Response) {
  const text = await res.text().catch(() => '');
  return text
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export const basicAuth = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
