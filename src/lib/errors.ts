export class RelayError extends Error {
  constructor(
    public code: 'forbidden' | 'not_found' | 'invalid' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (m = "Your access doesn't cover this.") => new RelayError('forbidden', m);
export const invalid = (m: string) => new RelayError('invalid', m);
export const notFound = (m = 'Not found.') => new RelayError('not_found', m);

/** A RelayError as an HTTP status and a body the portal and the apps can both read. */
export function httpError(e: unknown): { status: number; body: { error: string; message: string } } {
  const STATUS = { forbidden: 403, not_found: 404, invalid: 400, conflict: 409 } as const;
  if (e instanceof RelayError) return { status: STATUS[e.code], body: { error: e.code, message: e.message } };
  // Anything else is ours, not theirs: say so without handing back a stack trace.
  return { status: 500, body: { error: 'server_error', message: 'Something went wrong on our side.' } };
}
