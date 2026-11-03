# Research tracker

A local page that tracks 150 research runs, two passes each:

- **125 country × industry pairs** (25 countries × 5 industries), for example `MY-accounting-firm`.
- **25 country layers**, one per country, for example `MY-country-layer`: the checks that apply to any business in
  that country (company register, courts, general directories), whatever its industry.

An outside AI tool (an IDE or a CLI) fetches the brief, does the research, and submits its JSON answer.
The server checks every answer and stores only the valid ones.

Local only: it listens on `127.0.0.1`, shares no code or data with the hub, and needs no deploy.

## Start

Double-click `start-research-tracker.bat` (or the desktop shortcut), or from `agy-lab/`:

```bash
node research-tracker/server.mjs
```

Open http://127.0.0.1:4777 (set `TRACKER_PORT` to use another port).

## Pass 1 and pass 2

- **Pass 1:** the brief for the run, with the country and industry filled in.
- **Pass 2:** the same brief plus the accepted pass 1 answer. It is locked until pass 1 is accepted.

An answer stored under an older brief shows as **outdated**. It stays on disk, but pass 2 stays locked until
pass 1 is submitted again under the current brief.

## How an outside tool gets its brief

```bash
curl -s http://127.0.0.1:4777/api/pairs/MY-accounting-firm/brief/1
```

Use `/brief/2` for pass 2. The id is the two-letter country code in capitals, then the industry in lowercase with
dashes (`SG-web-design-company`), or `-country-layer` for the country layer (`SG-country-layer`).
The full list of ids is at `/api/pairs`.

## How an outside tool submits its answer

1. Save the AI's JSON answer to a file (for example `answer-round1.json`). The file must be one JSON object, with
   nothing around it.
2. Submit it:

```bash
curl -s -X POST http://127.0.0.1:4777/api/pairs/MY-accounting-firm/round/1 \
  -H "content-type: application/json" --data-binary @answer-round1.json
```

For pass 2, use `/round/2` and `answer-round2.json`.

**Answer:**
- `200` with `{"accepted": true}`: stored. The page shows it.
- `422` with `{"accepted": false, "errors": [...]}`: the answer breaks a rule. Nothing is stored. Fix the listed
  errors and submit again.
- `409`: pass 2 was sent before pass 1 was accepted (or pass 1 is outdated).

## What the server checks

- `prompts`: 1 to 12, each with a unique `rank` from 1 to 12.
- `category`, `problem_type`, `source.access`, `query_type`, `used_in` and `confidence` take only the values in
  [schema.json](schema.json).
- `applies_when` and `sub_segment` are filled in (`always` and `all` are allowed).
- `query_type` is `url_template` (the URL needs a `{placeholder}`), `static_list` (a real URL), or `manual`
  (needs a `manual_reason`).
- `source.url` is a real http or https address.
- `question` is at least 15 characters. `why_it_matters`, `how_to_query`, `found_when`, `not_found_when`,
  `couldnt_check_when`, `not_applicable_when` and `source.name` / `source.language` are filled in.
  `possible_match_when` is optional.

It does not check that a URL is live or that a result is true. Those checks come from the review step.

## Files

| File | What it is |
|---|---|
| `pairs.json` | the 150 runs (`kind` is `industry` or `country`) |
| `brief.md` | the brief for an industry pair, with `{{COUNTRY}}` and `{{INDUSTRY}}` placeholders |
| `brief-country.md` | the brief for a country layer, with a `{{COUNTRY}}` placeholder |
| `schema.json` | the allowed values for the answer, and the schema `version` |
| `server.mjs` | the server: storage, validation, the brief for each pass |
| `index.html` | the monitor page |
| `start-research-tracker.bat` | starts the server and opens the page |
| `data/` | accepted answers (`<id>/round1.json`, `round2.json`) and `log.jsonl` (every accept and reject). Created at runtime, not committed |
