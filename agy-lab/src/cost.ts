// What one report cost to make: LLM tokens and the search / API calls, priced in
// US dollars. A company-dive, its preview and its deeper dive each give a Usage;
// price() turns it into lines and a total. Prices are the plans we pay for (the
// source sits beside each). A call with no per-call price is counted and named in
// `unpriced`, never guessed. Calls from before tokens were recorded are estimated
// from text length and marked so. Every call is also kept one by one as an
// ApiCall: when it ran, what it was for, what it used and what it cost.
import type { LlmUse } from './companydive.ts';
import type { Meter } from './divedeeper/lib.ts';

const CNY_PER_USD = 7.2;

/** USD per million tokens, input and output alike, by model name. */
const LLM_PER_M: Array<{ model: RegExp; usd: number }> = [
  // Vectide 1B-token pack (VECTIDE_DEEPSEEK_KEY): CNY 100 for 1,000M tokens. Vectide names the model
  // deepseek-v...; Hive's "deepseek-ai/..." has no price on record, so it is listed unpriced, not guessed.
  { model: /^deepseek-v/i, usd: 100 / 1000 / CNY_PER_USD },
];

export const PRICES = {
  /** Tavily pay-as-you-go, per credit. */
  tavilyCredit: 0.008,
  /** Brave Search API, $5 per 1,000 requests. */
  braveCall: 0.005,
  /** One Exa search with highlights, measured 2026-10-24; Exa's own figure wins when it sends one. */
  exaSearch: 0.007,
  /** scraper.tech Maps, Basic plan: $4 for 30,000 requests. */
  mapsCall: 4 / 30_000,
};

/** A rough token count for text whose tokens were not reported. */
const TOKENS_PER_CHAR = 1 / 4;

export type LlmTally = { calls: number; tokensIn: number; tokensOut: number; estimated: boolean };

export type Usage = {
  llm: Record<string, LlmTally>;
  tavilyCalls: number;
  tavilyCredits: number;
  braveCalls: number;
  exaCalls: number;
  /** Exa calls that reported their own price, and what they reported. */
  exaReported: number;
  exaDollars: number;
  mapsCalls: number;
  /** Free calls: PageSpeed, WHOIS, DNS, page fetches. */
  httpCalls: number;
  /** Calls that failed before the service did billable work. */
  failedCalls: number;
};

export type ApiName = 'llm' | 'tavily' | 'brave' | 'exa' | 'maps' | 'web';

/**
 * One request to an outside service, as it happened. A retry is its own call.
 * `usd` is fixed when the call is made; null means the service has no per-call
 * price we know (MiniMax on its token plan).
 */
export type ApiCall = {
  at: string;
  api: ApiName;
  /** The step, label, query or URL the call was for. */
  what: string;
  model?: string;
  /** Which lane or key pool served it: the lane's label on /workers, or MiniMax. */
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Tavily credits. */
  credits?: number;
  results?: number;
  ms: number;
  ok: boolean;
  usd: number | null;
  note?: string;
  /** Set when calls from several deeper-dive lanes are listed together. */
  lane?: string;
};

export type CostLine = { item: string; detail: string; usd: number | null; estimated?: boolean };
export type Cost = { usd: number; estimated: boolean; unpriced: string[]; lines: CostLine[] };

export const emptyUsage = (): Usage => ({ llm: {}, tavilyCalls: 0, tavilyCredits: 0, braveCalls: 0, exaCalls: 0, exaReported: 0, exaDollars: 0, mapsCalls: 0, httpCalls: 0, failedCalls: 0 });

/** What one LLM call cost, or null for a model with no per-token price. */
export function llmUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const perM = llmPrice(model);
  return perM == null ? null : (tokensIn + tokensOut) / 1e6 * perM;
}

/** The list price of one call. A failed call costs nothing unless it reported tokens. */
export function callUsd(c: Pick<ApiCall, 'api' | 'ok' | 'model' | 'tokensIn' | 'tokensOut' | 'credits'>): number | null {
  switch (c.api) {
    case 'llm': return llmUsd(c.model ?? 'unknown', c.tokensIn ?? 0, c.tokensOut ?? 0);
    case 'tavily': return (c.credits ?? 0) * PRICES.tavilyCredit;
    case 'brave': return c.ok ? PRICES.braveCall : 0;
    case 'exa': return c.ok ? PRICES.exaSearch : 0;
    case 'maps': return c.ok ? PRICES.mapsCall : 0;
    case 'web': return 0;
  }
}

/** Start timing a call; `done` returns its record with the time taken and the cost (list price unless `usd` is given). */
export function startCall(api: ApiName, what: string, extra: Partial<ApiCall> = {}): { done: (end: Partial<ApiCall> & { ok: boolean }) => ApiCall } {
  const started = Date.now();
  const at = new Date(started).toISOString();
  return {
    done: (end) => {
      const c: ApiCall = { at, api, what: what.slice(0, 300), ...extra, ...end, ms: Date.now() - started, usd: null };
      c.usd = end.usd !== undefined ? end.usd : callUsd(c);
      return c;
    },
  };
}

/** A per-call log. An LLM call that failed but reported tokens still counts: those tokens were billed. */
export function addCalls(u: Usage, calls: ApiCall[] | null | undefined): Usage {
  for (const c of calls ?? []) {
    const billedLlm = c.api === 'llm' && (c.ok || c.tokensIn || c.tokensOut);
    if (!c.ok && !billedLlm) { u.failedCalls++; continue; }
    if (c.api === 'llm') addLlm(u, c.model || 'unknown', { calls: 1, tokensIn: c.tokensIn ?? 0, tokensOut: c.tokensOut ?? 0, estimated: false });
    else if (c.api === 'tavily') { u.tavilyCalls++; u.tavilyCredits += c.credits ?? 0; }
    else if (c.api === 'brave') u.braveCalls++;
    else if (c.api === 'exa') { u.exaCalls++; u.exaReported++; u.exaDollars += c.usd ?? 0; }
    else if (c.api === 'maps') u.mapsCalls++;
    else u.httpCalls++;
  }
  return u;
}

function addLlm(u: Usage, model: string, t: LlmTally): void {
  const has = u.llm[model] ?? { calls: 0, tokensIn: 0, tokensOut: 0, estimated: false };
  u.llm[model] = { calls: has.calls + t.calls, tokensIn: has.tokensIn + t.tokensIn, tokensOut: has.tokensOut + t.tokensOut, estimated: has.estimated || t.estimated };
}

/** A company-dive's (or its people step's) LLM calls. */
export function addLlmUses(u: Usage, uses: LlmUse[] | null | undefined): Usage {
  for (const c of uses ?? []) {
    const known = c.tokensIn != null || c.tokensOut != null;
    if (c.ok === false && !c.tokensIn && !c.tokensOut) { u.failedCalls++; continue; }
    addLlm(u, c.engine || 'unknown', {
      calls: 1,
      tokensIn: known ? Number(c.tokensIn ?? 0) : Math.round((c.promptChars ?? 0) * TOKENS_PER_CHAR),
      tokensOut: known ? Number(c.tokensOut ?? 0) : Math.round((c.answerChars ?? 0) * TOKENS_PER_CHAR),
      estimated: !known,
    });
  }
  return u;
}

/** One deeper-dive lane's (or the preview's) meter. */
export function addMeter(u: Usage, m: Partial<Meter> | null | undefined): Usage {
  if (!m) return u;
  // Meters since 2026-10-31 keep every call; older ones kept only totals.
  if (m.calls?.length) return addCalls(u, m.calls);
  const llm = m.llm;
  if (llm) {
    const byTokens = llm.byModelTokens ?? {};
    const models = Object.entries(llm.byModel ?? {});
    const calls = models.reduce((n, [, c]) => n + c, 0) || 1;
    for (const [model, n] of models) {
      const t = byTokens[model];
      // Meters from before per-model tokens split the lane's total by calls.
      addLlm(u, model, t
        ? { calls: n, tokensIn: t.in, tokensOut: t.out, estimated: false }
        : { calls: n, tokensIn: Math.round((llm.tokensIn ?? 0) * n / calls), tokensOut: Math.round((llm.tokensOut ?? 0) * n / calls), estimated: models.length > 1 });
    }
  }
  u.exaCalls += m.exa?.calls ?? 0;
  u.exaReported += m.exa?.priced ?? 0;
  u.exaDollars += m.exa?.dollars ?? 0;
  u.braveCalls += m.brave?.calls ?? 0;
  u.mapsCalls += m.maps?.calls ?? 0;
  u.httpCalls += m.http?.calls ?? 0;
  return u;
}

/** A company-dive row: its counters plus the LLM and Exa calls kept in its result. */
export function diveUsage(row: { tavily_calls?: number; tavily_credits?: number; brave_calls?: number; llm?: LlmUse[] | null; people_llm?: LlmUse[] | null; people_exa?: Array<{ dollars?: number; usd?: number; ok?: boolean }> | null }): Usage {
  const u = emptyUsage();
  u.tavilyCalls = Number(row.tavily_calls ?? 0);
  u.tavilyCredits = Number(row.tavily_credits ?? 0);
  u.braveCalls = Number(row.brave_calls ?? 0);
  addLlmUses(u, row.llm);
  addLlmUses(u, row.people_llm);
  for (const e of row.people_exa ?? []) {
    if (e.ok === false) { u.failedCalls++; continue; }
    u.exaCalls++;
    u.exaReported++;
    u.exaDollars += Number(e.usd ?? e.dollars ?? 0);
  }
  return u;
}

type DiveLogs = {
  llm?: LlmUse[] | null;
  tavily?: Array<{ at?: string; path: string; label: string; credits: number; ms: number; ok: boolean; note?: string; usd?: number }> | null;
  brave?: ApiCall[] | null;
  people?: { llm?: LlmUse[] | null; exa?: Array<{ at?: string; query: string; kind: string; results: number; dollars: number; ms?: number; ok: boolean; note?: string; usd?: number }> | null } | null;
};

/**
 * A company-dive's calls one by one, oldest first. Calls logged before
 * 2026-10-31 carry no time and sort first; their cost is worked out from what
 * they recorded, and an LLM call without tokens gets tokens estimated from text.
 */
export function diveCalls(result: DiveLogs | null | undefined): ApiCall[] {
  if (!result) return [];
  const llm = (uses: LlmUse[] | null | undefined): ApiCall[] => (uses ?? []).map((c) => {
    const known = c.tokensIn != null || c.tokensOut != null;
    const tokensIn = known ? Number(c.tokensIn ?? 0) : Math.round(c.promptChars * TOKENS_PER_CHAR);
    const tokensOut = known ? Number(c.tokensOut ?? 0) : Math.round(c.answerChars * TOKENS_PER_CHAR);
    const ok = c.ok !== false;
    const note = c.note ?? (known || !ok ? undefined : 'tokens estimated from text length');
    return { at: c.at ?? '', api: 'llm', what: c.step, model: c.engine, ...(c.provider ? { provider: c.provider } : {}), ...(ok || known ? { tokensIn, tokensOut } : {}), ms: c.ms, ok,
      usd: c.usd !== undefined ? c.usd : ok || known ? llmUsd(c.engine, tokensIn, tokensOut) : 0, ...(note ? { note } : {}) };
  });
  const out: ApiCall[] = [
    ...llm(result.llm),
    ...(result.tavily ?? []).map((c): ApiCall => ({ at: c.at ?? '', api: 'tavily', what: `${c.label} (${c.path})`, credits: c.credits, ms: c.ms, ok: c.ok, usd: c.usd ?? c.credits * PRICES.tavilyCredit, ...(c.note ? { note: c.note } : {}) })),
    ...(result.brave ?? []),
    ...llm(result.people?.llm),
    ...(result.people?.exa ?? []).map((c): ApiCall => ({ at: c.at ?? '', api: 'exa', what: `${c.kind}: ${c.query}`, results: c.results, ms: c.ms ?? 0, ok: c.ok, usd: c.usd ?? (c.ok ? c.dollars : 0), ...(c.note ? { note: c.note } : {}) })),
  ];
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const llmPrice = (model: string): number | null => LLM_PER_M.find((p) => p.model.test(model))?.usd ?? null;
const n = (x: number) => x.toLocaleString('en-US');
const calls = (x: number) => `${n(x)} ${x === 1 ? 'call' : 'calls'}`;
const mTok = (x: number) => x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(x);

export function price(u: Usage): Cost {
  const lines: CostLine[] = [];
  const unpriced: string[] = [];
  for (const [model, t] of Object.entries(u.llm)) {
    const perM = llmPrice(model);
    const detail = `${calls(t.calls)}, ${mTok(t.tokensIn)} in / ${mTok(t.tokensOut)} out tokens`;
    const usd = perM == null ? null : (t.tokensIn + t.tokensOut) / 1e6 * perM;
    if (usd == null) unpriced.push(`${model} (${calls(t.calls)})`);
    lines.push({ item: `LLM ${model}`, detail, usd, ...(t.estimated ? { estimated: true } : {}) });
  }
  if (u.tavilyCalls || u.tavilyCredits) lines.push({ item: 'Tavily', detail: `${calls(u.tavilyCalls)}, ${n(u.tavilyCredits)} credits`, usd: u.tavilyCredits * PRICES.tavilyCredit });
  if (u.braveCalls) lines.push({ item: 'Brave', detail: calls(u.braveCalls), usd: u.braveCalls * PRICES.braveCall });
  if (u.exaCalls) {
    const listed = Math.max(0, u.exaCalls - u.exaReported);
    lines.push({ item: 'Exa', detail: calls(u.exaCalls), usd: u.exaDollars + listed * PRICES.exaSearch });
  }
  if (u.mapsCalls) lines.push({ item: 'Google Maps (scraper.tech)', detail: calls(u.mapsCalls), usd: u.mapsCalls * PRICES.mapsCall });
  if (u.httpCalls) lines.push({ item: 'Other web calls', detail: `${calls(u.httpCalls)}, free`, usd: 0 });
  if (u.failedCalls) lines.push({ item: 'Failed calls', detail: `${calls(u.failedCalls)}, not billed`, usd: 0 });
  return {
    usd: lines.reduce((s, l) => s + (l.usd ?? 0), 0),
    estimated: lines.some((l) => l.estimated),
    unpriced,
    lines,
  };
}
