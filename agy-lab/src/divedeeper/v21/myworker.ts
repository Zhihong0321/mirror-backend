import { secret, type MapsRow } from '../lib.ts';

export type WorkerRow = MapsRow & { place_id: string | null };
type Options = { baseUrl?: string; apiKey?: string };
type Answer = { rows: WorkerRow[]; error?: never } | { rows: null; error: string };

/** Each request holds for at most 60 seconds. The service, rather than this client, expires jobs. */
export async function scan(keyword: string, place: string, max: number, opts: Options = {}): Promise<Answer> {
  const base = (opts.baseUrl ?? process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app').replace(/\/+$/, '');
  try {
    const health = await fetch(base + '/health', { signal: AbortSignal.timeout(60_000) });
    if (!health.ok) throw new Error(`myworker health: HTTP ${health.status}`);
    const live = await health.json() as { ok: boolean; workersLive: number | unknown[] };
    if (!(Array.isArray(live.workersLive) ? live.workersLive.length : live.workersLive)) return { rows: null, error: 'no Gmap worker online' };
    if (!live.ok) throw new Error('myworker health failed');
    const key = opts.apiKey ?? secret('GMAP_API_KEY');
    if (!key) throw new Error('GMAP_API_KEY is missing');
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    const request = async (url: string, init: RequestInit = {}) => {
      // The service holds a request up to 60 s; give it room to answer before giving up on this one request.
      const res = await fetch(base + url, { ...init, headers, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`myworker: HTTP ${res.status}`);
      const body = await res.json() as any;
      if (!body.job) throw new Error('myworker returned no job');
      return body.job;
    };
    let job = await request('/api/scan', { method: 'POST', body: JSON.stringify({ keyword, place, max, wait: 60 }) });
    while (job.status === 'pending' || job.status === 'running') {
      if (!job.id) throw new Error('myworker returned no job id');
      job = await request(`/api/scan/${encodeURIComponent(job.id)}?wait=60`);
    }
    if (job.status === 'failed') throw new Error(String(job.error ?? 'Gmap job failed'));
    if (job.status !== 'done') throw new Error(`unexpected Gmap job status: ${job.status}`);
    if (job.result?.stoppedEarly) throw new Error('Google refused the Gmap worker (stoppedEarly)');
    if (!Array.isArray(job.result?.businesses)) throw new Error('no businesses in the answer');
    return { rows: job.result.businesses.map((r: any): WorkerRow => ({
      name: r.name, rating: r.rating ?? null, reviews: r.reviews ?? null, category: r.category ?? null,
      address: r.address ?? null, phone: r.phone ?? null, website: r.website ?? null, mapsUrl: r.mapsUrl ?? null, place_id: r.place_id ?? null,
    })) };
  } catch (err) { return { rows: null, error: err instanceof Error ? err.message : String(err) }; }
}
