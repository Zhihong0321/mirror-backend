// A streamed answer that stops arriving. On 2026-11-02 a thehive.ai lane stopped
// sending mid-answer and kept the socket open (TCP keep-alive still answered), so
// res.text() waited for ever and dive-deeper run #11 hung in G-grounded. A total
// timeout would cut off a model that is still thinking; an idle timeout does not,
// because a thinking model keeps streaming reasoning deltas.

/** No byte for this long, headers included, and the request is given up. */
export const IDLE_MS = 120_000;

export type IdleGuard = { signal: AbortSignal; touch: () => void; done: () => void; readonly idled: boolean };

/** An abort signal that fires when touch() has not been called for `idleMs`. */
export function idleGuard(idleMs = IDLE_MS): IdleGuard {
  const ctl = new AbortController();
  let idled = false;
  const fire = () => { idled = true; ctl.abort(Object.assign(new Error(`nothing arrived for ${Math.round(idleMs / 1000)}s`), { name: 'IdleTimeout' })); };
  let timer = setTimeout(fire, idleMs);
  return {
    signal: ctl.signal,
    touch: () => { if (idled) return; clearTimeout(timer); timer = setTimeout(fire, idleMs); },
    done: () => clearTimeout(timer),
    get idled() { return idled; },
  };
}

/**
 * The whole body as text, touching the guard on every chunk that counts as progress (any chunk,
 * unless `progress` says otherwise); stops when the guard fires.
 */
export async function readText(res: Response, guard: IdleGuard, progress: (chunk: string) => boolean = () => true): Promise<string> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return await res.text();
  const reader = body.getReader();
  // Cancelling ends a pending read() even when the fetch itself ignored the signal.
  const stop = () => { void reader.cancel(guard.signal.reason).catch(() => {}); };
  guard.signal.addEventListener('abort', stop, { once: true });
  const decoder = new TextDecoder();
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (progress(text)) guard.touch();
      out += text;
    }
  } finally {
    guard.signal.removeEventListener('abort', stop);
  }
  if (guard.idled) throw guard.signal.reason;
  return out + decoder.decode();
}
