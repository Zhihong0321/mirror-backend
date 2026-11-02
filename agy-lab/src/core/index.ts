// The app's one door to outside APIs. Every call to an LLM, a search API or a
// paid data API goes through a module of this folder, and every file outside
// it imports this index and nothing else of core/. core/README.md has the
// rules; core-door.test.ts fails the build when a file goes around them.
//
//   llm        every LLM call: the deepseek lanes on /workers, MiniMax last (llm.chat, llm.ask, llm.agent)
//   pi         MiniMax through the Pi agent SDK; called by llm, its config read by others
//   tavily     Tavily search and map over the key pool (gemini_contact_key); page reads go to pagefetch.ts
//   exa        Exa search and contents over the key pool and the US proxy
//   brave      Brave Search over the /workers Brave keys
//   maps       scraper.tech Google Maps tools
//   pagespeed  Google PageSpeed Insights
//   parallel   Parallel's FindAll entity search (person research)
//   smartlead  Smartlead, the cold-email platform (campaigns, leads, replies)
//   search     web search for pipelines: Tavily and Exa, keys and provider fallback inside
//   secrets    the keys of the one-key providers above (MiniMax, Maps, Parallel,
//              Smartlead, PageSpeed), kept in the hub database
//
// Each call takes an optional `log` (an ApiCall[]) and pushes one record per
// request: when, what for, lane or key pool, model, tokens or credits, time,
// ok or failed, and its USD cost.
export * as llm from './llm.ts';
export * as pi from './pi.ts';
export * as tavily from './tavily.ts';
export * as exa from './exa.ts';
export * as brave from './brave.ts';
export * as maps from './maps.ts';
export * as pagespeed from './pagespeed.ts';
export * as parallel from './parallel.ts';
export * as smartlead from './smartlead.ts';
export * as secrets from './secrets.ts';
export * as search from './search.ts';
export { startCall, type ApiCall, type ApiName } from '../cost.ts';
