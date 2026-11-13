# Task: write a company-lookup handler for one website

We do due diligence on companies from {{COUNTRY}}, using only public information on the web. You are given ONE website
from our research list. Decide whether a script can look a company up on it by name, and if it can, write that script
(a "handler"). Work only inside this folder.

## The website

- Name: {{SOURCE_NAME}}
- Address: {{SOURCE_URL}}
- What the research says it shows: {{WHAT_TO_SEE}}
- Country: {{COUNTRY}} ({{COUNTRY_CODE}})
- Task id: {{TASK_ID}}

Real company names in {{COUNTRY}} are often written in the local language or script. The keyword your handler
receives is one company name as the user typed it (legal form included, for example "ACME TRADING SDN BHD").

## What to deliver, in this folder

1. `w1.handler.mjs`: the handler (only when a script can really do the lookup, tier 1 or 2).
2. `w1.draft.json`: your verdict (always). Shape below.

## The handler contract

```js
export const meta = { task: '{{TASK_ID}}', want: 'w1', tier: 1, method: 'get', pdf: false, input: 'company name',
  fields: ['name', '...'], canary: { found: 'a company that IS listed', not_found: 'a name that is NOT listed' } };

/** Look one company up. Must never throw: every failure is a couldnt_check with a reason. */
export default async function lookup(keyword) {
  return { status: 'found' | 'not_found' | 'couldnt_check', reason: '', records: [ /* one object per match */ ],
           source_url: 'the page or search URL used', excerpt: 'short text from the result' };
}
```

- `found`: the company is on the site; `records` has the matching entries with the useful fields (legal name,
  registration number, status, address, dates, whatever the site shows). Match the company, not just similar words:
  compare normalised names (case, punctuation, legal form) before you call it found.
- `not_found`: the site answered normally and the company is not there (an empty result page, "0 results").
- `couldnt_check`: anything else, with `reason` one of `blocked` (403/429, captcha, login wall, bot check),
  `http_error`, `timeout`, `layout_changed` (the page is not what you expected), `pdf` (see `pdf` below), `other`.
  A site that refuses the search is NEVER `not_found`.
- Only the standard `fetch` and plain JavaScript are available. No imports, no npm packages, no files, no child
  processes. Every `fetch` gets `signal: AbortSignal.timeout(25000)` and a browser-like `user-agent`. The whole call
  must finish in under 60 s.
- `pdf: true` is for a source that is a PDF list: the handler fetches it, checks it really starts with `%PDF-`, and
  returns `couldnt_check` with `reason: 'pdf'` and the PDF address in `source_url`. The hub reads the PDF itself.
- No browser is available to the handler. A site that only works with a rendered, interactive page is tier 3.

## Tiers (your verdict)

- **1**: the lookup is a plain page, a list, a PDF, or a URL you can build from the company name.
- **2**: the lookup needs a search request: a JSON API, a form POST, data embedded in the page, a token you have to
  fetch first.
- **3**: the data is public and a person or a real browser can get it, but a handler cannot (JavaScript-only
  widget, interactive report). Give `browser_steps`: exact steps for a person, specific enough to follow.
- **4**: no handler is possible. `tier4.reason` is `blocked` (login, captcha, fee, bot wall), `no_data` (the site
  does not publish company records), or `down` (the site is gone or unreachable). `tier4.evidence` says exactly what
  you saw (URLs, HTTP codes, page text).

## `w1.draft.json`

```json
{ "tier": 1, "method": "static_list | url_template | get | json_api | form_post | embedded_json | other", "pdf": false,
  "canary": { "found": "...", "not_found": "..." },
  "browser_steps": null, "tier4": null }
```

Tier 3: `browser_steps` is a string, `canary` null. Tier 4: `tier4` is `{ "reason": "...", "evidence": "..." }`.

## How to prove it works (do this before you answer)

- `node _tools/try.mjs w1.handler.mjs "COMPANY NAME"` runs your handler exactly like the worker PC does and prints its
  answer. The harness will run the same command again to check you.
- Find the `found` canary on the site itself: a company that is really listed there, copied as the site writes it.
  Never invent one. The `not_found` canary is an obviously unlisted name in the local language.
- The handler must return `found` with at least one record for the first canary and `not_found` for the second.
- `_example/handler.mjs` and `_example/verdict.json` show a finished tier 2 handler for another country.

## Rules

- Public pages only. Never log in, never solve or bypass a captcha, never pay, never use someone's credentials.
- Never invent data, URLs or canaries. If you cannot prove it, say so: tier 3 or 4 with the evidence is a good answer.
- Do not write outside this folder. No secrets in any file.
- Stop after about 25 tool calls. A clear tier 4 with evidence beats an endless attempt.
