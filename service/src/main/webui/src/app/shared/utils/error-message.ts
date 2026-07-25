/**
 * A human-readable message from a failed HTTP call: the backend `{message}` body (or plain-string
 * body) when present, else the client-side message, else the fallback.
 */
export function errorMessage(error: unknown, fallback = 'Request failed'): string {
  const httpError = error as { error?: unknown; message?: string } | null;
  const body = httpError?.error;
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return httpError?.message ?? fallback;
}
