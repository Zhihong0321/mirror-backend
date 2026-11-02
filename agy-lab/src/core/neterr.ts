// Node's fetch() throws TypeError("fetch failed") for every network failure and keeps the real reason
// (ENOTFOUND, ETIMEDOUT, ECONNRESET, UND_ERR_CONNECT_TIMEOUT, a TLS error...) in `.cause`. A message built
// from `.message` alone says "fetch failed" and nothing else, which cannot tell a DNS failure from a blocked
// site from a refused connection. Every provider error that comes from a failed fetch goes through here.

/** The message of a failed fetch with its cause appended: "fetch failed (UND_ERR_CONNECT_TIMEOUT)". */
export function netError(cause: unknown): string {
  const err = cause as { message?: string; cause?: { code?: string; message?: string } } | null;
  const message = err?.message ?? String(cause);
  const why = err?.cause?.code ?? err?.cause?.message;
  return why && !message.includes(why) ? `${message} (${why})` : message;
}
