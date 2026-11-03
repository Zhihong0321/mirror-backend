# Research tracker

A local page that tracks 125 research runs (25 countries × 5 industries), two passes each.
An outside AI tool (an IDE or a CLI) fetches the brief, does the research, and submits its JSON answer.
The server checks every answer and stores only the valid ones.

Local only: it listens on `127.0.0.1`, shares no code or data with the hub, and needs no deploy.

## Start

From `agy-lab/`:

```bash
node research-tracker/server.mjs
```

Open http://127.0.0.1:4777 (set `TRACKER_PORT` to use another port).

## Pass 1 and pass 2

- **Pass 1:** the brief for the pair, with the country and industry filled in.
- **Pass 2:** the same brief plus the accepted pass 1 answer. It is locked until pass 1 is accepted.

## How an outside tool gets its brief

```bash
curl -s http://127.0.0.1:4777/api/pairs/MY-accounting-firm/brief/1
```

Use `/brief/2` for pass 2. The pair id is the two-letter country code in capitals, then the industry in lowercase with dashes, for example `SG-web-design-company`.
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
- `409`: pass 2 was sent before pass 1 was accepted.

## What the server checks

- `test_firms`: at least 3 names.
- `prompts`: 1 to 12, each with a unique `rank` from 1 to 12.
- `category`, `problem_type`, `source.access`, `used_in` and `confidence` take only the values in
  [schema.json](schema.json).
- `source.url` is a real http or https address.
- `question` is at least 15 characters. `why_it_matters`, `how_to_query`, `found_when`, `not_found_when`,
  `couldnt_check_when` and `source.name` / `source.language` are filled in.
- `tested`: at least one entry with `firm`, `date` (YYYY-MM-DD) and `result`.

It does not check that a URL is live or that a result is true. Those checks come from the review step.

## Files

| File | What it is |
|---|---|
| `pairs.json` | the 125 pairs |
| `brief.md` | the brief, with `{{COUNTRY}}` and `{{INDUSTRY}}` placeholders |
| `schema.json` | the allowed values for the answer |
| `server.mjs` | the server: storage, validation, the brief for each pass |
| `index.html` | the monitor page |
| `data/` | accepted answers (`<pair>/round1.json`, `round2.json`) and `log.jsonl` (every accept and reject). Created at runtime |
