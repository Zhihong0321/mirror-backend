// One company deep dive, start to finish:
//
//   1 discover   Brave x8 at once (outside the Tavily budget) + Tavily search T1
//   2 triage     LLM: who the company is, which URLs are really about it, what to read
//   3 read       Tavily map T2 on the official site, LLM picks pages, extract T3 + T4
//   4 analyse    LLM: cited facts, contradictions, gaps, the gap-filling searches
//   5 fill gaps  Tavily search T5..T11
//   6 reflect    LLM: new facts, what is still missing, up to 3 reserve calls
//   7 write      LLM: the dossier, every claim cited to the source list; written after
//                the research is saved, so the preview starts without waiting for it
//
// The people step (companydive-people.ts) runs beside 5 and 6, from the facts of 4.
// Three dives run at once.
//
// A country pack (countries.ts, src/countries/<CC>/pack.json) can only add: country codes,
// Brave queries in step 1, unreadable hosts, and instructions in the prompts. Without one
// the dive is exactly as below.
//
// Tavily never takes more than 15 calls (the Budget refuses the 16th), and one
// is always left unspent. Every URL is read at most once: the ledger knows which
// pages already came back with text.
//
// Tavily goes through the shared key pool in tavily.ts, so dives and contact
// research see the same quota. Every thinking step is the deepseek model contact
// research uses (extract-llm.ts, CONTACT_LLM_*). Brave keys are on /workers (core/brave.ts).
// Dives run in this process, one at a time, and are kept in company_dive.
//
//   GET  /company-dive              the page
//   POST /api/company-dive          {company, country?} -> {id}
//   GET  /api/company-dive          recent dives
//   GET  /api/company-dive/:id      live log, then dossier, facts, sources, Tavily calls
//   GET  /d/:publicId               the public report page (no token: the id is the link)
//   GET  /d/:publicId/data          what that page polls: status, log, dossier, people
//
// After the research, the Exa people step (companydive-people.ts) runs on its own
// unless the request said people: false. The dive stays 'running' at stage
// 'people' until it ends, so one status covers the whole report.
//
// Complete or not published: a search that fails falls back to Exa, and anything that
// still fails after its backups (a search, a page read, an LLM step, the people step,
// the dossier) is a warning. A dive with any warning is 'incomplete', not 'done': its
// result is not saved and it runs again on its own (RETRY_AFTER_MS), up to MAX_TRIES
// times, then it is 'failed'. A dive cut off by a restart is queued again.

export type {
  Source,
  Fact,
  Identity,
  DiveResult,
  Progress,
  TavilyCall,
  LlmUse,
  Warn,
  DiveStats,
  Alongside,
} from './companydive/pipeline.ts';
export {
  MAX_TAVILY_CALLS,
  Budget,
  BudgetSpent,
  budgetedCall,
  ask,
  stripThinking,
  parseJson,
  askJson,
  plainName,
  shortName,
  urlKey,
  hostOf,
  liveDomains,
  Ledger,
  corpus,
  discoveryQueries,
  run,
} from './companydive/pipeline.ts';
export type { DiveRow } from './companydive/store.ts';
export {
  onFinished,
  MAX_TRIES,
  nextTry,
  LANE_HOLD_MS,
  diveRunning,
  setRunningForTests,
  resumeInterrupted,
} from './companydive/runner.ts';
export {
  handle,
  publicView,
  handlePublic,
} from './companydive/http.ts';
