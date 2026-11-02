# Local Fetch Worker — page reads on the Mac mini, not on Tavily's bill

A company dive's largest line was Tavily `/extract`, and what it sold us was a
page fetched, stripped of its chrome and handed back as text. The only part of
that this container cannot do itself is **have an address a website will
serve** — and the mini has had one all along, which is the whole premise of
`docs/plan-macmini-worker.md`. So the read moved here. It costs nothing.

```
hub (Railway)                         Mac mini (this folder)
  companydive T3/T4
    └─ src/pagefetch.ts
         creates job `fetch.pages` ──┐
                                     │  worker.ts holds GET /api/jobs/next open
         jobs.wait(id) ←─────────────┤  reads each URL via Crawl4AI on loopback
         results[].raw_content       └─ POST /api/jobs/:id/result
```

Nothing listens on the mini for the hub's sake. The mini asks, as every worker
here does — no tunnel, no port forwarding, no dynamic DNS, nothing on the home
router that has to keep working at 2am.

## What it is made of

| Piece | What it does |
|---|---|
| `worker.ts` | the bridge: claims `fetch.pages`, reads the URLs, posts them back |
| `check.ts` | reads real pages through the worker's own `readPage`; proves the mini works without touching the hub |
| `com.eternalgy.colima.plist` | keeps the Colima VM up |
| `com.eternalgy.localfetchworker.plist` | keeps the worker up |
| `../src/pagefetch.ts` | the hub side: creates the job and awaits it |

The actual fetching and cleaning is [Crawl4AI](https://github.com/unclecode/crawl4ai)
(Apache-2.0) in one container. This folder is the bridge and deliberately little
else — the extraction is not ours to maintain.

## Why Crawl4AI, and why in a container

Picked over the alternatives on 2026-11-01:

- **Firecrawl** is the bigger project and has the closest API to Tavily's, but
  self-hosting it is six services (api, workers, Playwright, Redis, RabbitMQ,
  Postgres), it is AGPL-3.0, and upstream's own `SELF_HOST.md` calls its compose
  file *"a source-aligned starting point, not a production architecture"* that
  ships unauthenticated. Too much to run on the box that also does the Maps
  scans, fb-recon, x-recon, ads-recon and step 2.
- **Readability + Turndown in Node**, which is what Jina Reader does, would have
  avoided Python entirely and reused `puppeteer-core`. Rejected because it makes
  extraction quality ours to own forever, for one saved container.
- **Crawl4AI** is one `docker run`, publishes a real `linux/arm64` image, and its
  `/md` endpoint is a flat `{url, f}` body — no nested, version-sensitive config
  objects to get wrong on an upgrade.

The vendor comparisons that claim Firecrawl ~95% vs Crawl4AI ~90% (and 88% vs
72% on anti-bot pages) are all measured **from datacenter IPs**. Most of that gap
is the ASN, not the renderer, and the ASN is the one thing this machine fixes.

## `raw`, not `fit`, not `bm25`

`/md` takes `f`: `fit` (its Readability pass), `raw` (the whole DOM), `bm25` and
`llm`. The worker asks for **`raw`**.

`fit` was the first choice and it measured worse than what it replaced. On
2026-11-02, 12 pages dives had read went through both this worker and Tavily
`/extract` (advanced, markdown, exactly what dives bought before):

| | Tavily | `fit` | `raw` |
|---|---|---|---|
| Tavily's words kept (11 pages) | 100% | ~67% (36–94%) | ~99% (98–100%) |
| phones, emails, SSM numbers kept (78 in Tavily's text) | 78 | 33 | 78 |

`fit` cuts footers and side panels as chrome, and that is where a company prints
its registration number, phone and email: Eternalgy's own SSM numbers on its
services pages, all of Samaiden's emails. `raw` is about Tavily's own size per
page, so a dive gets what it got before.

With `raw` and the error fix below, all 12 pages through this worker's
`readPage` on the PC: 99% of Tavily's words (5,023 of 5,063), and every phone,
email and SSM number Tavily's text had (the one regex "miss" was a timestamp in
an image URL). No page came back as an error message.

`bm25` is the obvious choice for "pages about this company" and it is the worst
trap of the three. Measured on three pages on 2026-11-01:

| page | `fit` | `raw` | `bm25` |
|---|---|---|---|
| solarvest.my/about-us | 5,957 | 19,326 | **328** |
| samaiden.com.my | 4,889 | 12,606 | **475** |
| maybank.com/en/about-us | 1,374 | 10,871 | **181** |

It keeps ~3% of the page — and a registration number or a director's name lives
in the part it throws away. It is a snippet generator, not a page reader. Do not
reach for it again without re-measuring.

Crawl4AI also reports a page its parser choked on **as the markdown**, with
`success: true`: `Crawl4AI Error: This page is not fully supported...` (seen on
newpages.com.my, whose HTML carries control characters Crawl4AI's HTML step
refuses). `worker.ts` turns that into a failed page instead of passing the
paragraph on as text. The Windows `crawl4ai_server.py` first retries such a page
with the control characters stripped inside the browser, which read newpages at
24,004 characters against Tavily's 24,585. Switching to the BeautifulSoup parser
does not help (it fails the same way), and feeding the fetched HTML back as
`raw:` garbles it. The Docker image on the mini has no such retry, so there that
page is a failed page rather than a wrong one.

One more wording trap: Crawl4AI answers **"URL blocked (SSRF protection)"** for a
host that simply has no DNS record. Every such answer measured here was a dead
domain, `www.` hosts included and fine. `worker.ts` translates it, so a dive
report says the host does not resolve rather than implying we crawled a router.

## Install

Everything below runs on the mini, as the normal user.

**1. The container runtime.** Colima, not Docker Desktop: it is CLI-only, so it
comes up under `launchd` without a GUI login, and it is free for commercial use.

```bash
brew install colima docker
colima start --network-host-addresses --cpu 2 --memory 4 --disk 20 --vm-type vz
```

`--network-host-addresses` is **not optional**. Without it Colima ignores the
container's `-p 127.0.0.1:...` and forwards the crawler to `0.0.0.0` on this Mac
instead — an open page-fetcher on the home network, on the one IP whose good
standing this entire setup depends on.

**2. The crawler.**

```bash
docker run -d --name crawl4ai --restart unless-stopped -p 127.0.0.1:11235:11235 --shm-size=1g -e CRAWL4AI_API_TOKEN="$(openssl rand -hex 32)" -e CRAWL4AI_NO_CLOUD_NOTICE=1 unclecode/crawl4ai:latest
```

Set `CRAWL4AI_API_TOKEN` yourself and keep it. Left unset, Crawl4AI generates an
ephemeral one that changes on every restart, and the worker's saved token stops
matching. Then check both, every time this is touched:

```bash
lsof -nP -iTCP:11235 -sTCP:LISTEN
```

That must print `127.0.0.1:11235` and nothing else. And the token must be
enforced — this has to answer `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:11235/md -H 'content-type: application/json' -d '{"url":"https://example.com","f":"raw"}'
```

**3. Settings.** `~/.local-fetch-worker/worker.env`, `chmod 600` — never in the
plist, which is world-readable:

```
LAB_URL=https://ee-auto.up.railway.app
LAB_TOKEN=…                            # or GMAP_WORKER_KEY once fetch.pages is in its scope
CRAWL4AI_URL=http://127.0.0.1:11235
CRAWL4AI_TOKEN=…                       # the one from step 2
WORKER_NAME=mini-fetch                 # optional
LANES=2                                # optional: dives served at once
PAGE_CONCURRENCY=4                     # optional: pages read at once within one job
```

**4. Prove it reads pages** before the hub depends on it:

```bash
node agy-lab/local-fetch-worker/check.ts
```

**5. Keep both up.** Both are LaunchAgents, not LaunchDaemons, which is only
safe because this mini auto-logs in (`autoLoginUser` is set) — as every other
worker here already relies on. An agent does not start until that login happens,
and Colima is per-user, so it cannot become a root daemon. If auto-login is ever
turned off, these two stop coming back after a reboot and the hub reports page
reads as unavailable until someone logs in.

```bash
sed -e "s|__HOME__|$HOME|g" local-fetch-worker/com.eternalgy.colima.plist > ~/Library/LaunchAgents/com.eternalgy.colima.plist
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$(which node)|g" local-fetch-worker/com.eternalgy.localfetchworker.plist > ~/Library/LaunchAgents/com.eternalgy.localfetchworker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.colima.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.localfetchworker.plist
tail -f ~/.local-fetch-worker/worker.log
```

Stop either with `launchctl bootout gui/$(id -u)/com.eternalgy.localfetchworker`.
Re-run the `sed` and `bootstrap` lines after a `git pull` that changes the
worker, or after any Node upgrade — `which node` is an nvm path and moves.

## On a Windows PC

A Windows PC runs the same `worker.ts`, against **Crawl4AI as a Python package**
rather than the Docker image: no Docker Desktop, no WSL VM, which a PC already
running the Gmap and step-2 workers has no RAM for. `crawl4ai_server.py` serves
the image's `/md` and `/health` on `127.0.0.1`, built the way the image builds
them (`fit` = `PruningContentFilterLXML`, `raw` = the DOM, LXML scraping), so
the bridge cannot tell the two apart. It refuses a host that resolves to a
private or loopback address with the image's own wording.

The PC holds `GMAP_WORKER_KEY`, never `LAB_TOKEN`: the worker key's scope
(`JOB_TYPES` in `../src/gmap-worker.ts`) includes `fetch.pages`.

Everything goes in `%USERPROFILE%\.local-fetch-worker`, **not under AppData**:
the Claude desktop app's shell sees a private copy of AppData, so a Chromium
installed from there is not where a worker started at sign-in looks.

```powershell
$d = "$env:USERPROFILE\.local-fetch-worker"
py -3.12 -m venv "$d\venv"
& "$d\venv\Scripts\python.exe" -m pip install crawl4ai
$env:PLAYWRIGHT_BROWSERS_PATH = "$d\ms-playwright"
& "$d\venv\Scripts\python.exe" -m playwright install chromium
```

`worker.env` there: `LAB_URL`, `GMAP_WORKER_KEY` (from the Gmap worker's own
`worker.env`), `CRAWL4AI_URL=http://127.0.0.1:11235`, `CRAWL4AI_TOKEN` (any
random 64 hex), `WORKER_NAME`, and `LANES=1`, `PAGE_CONCURRENCY=3` on a PC with
little free RAM. Then prove pages are read, and start it:

```powershell
node agy-lab\local-fetch-worker\check.ts
powershell -NoProfile -ExecutionPolicy Bypass -File agy-lab\local-fetch-worker\start-windows.ps1 -Autostart on
```

`start-windows.ps1` keeps both processes up and restarts either one that stops.
Without `-Autostart` it runs in the foreground. Measured on pc-desktop-camhl16
(i5-13500H) on 2026-11-01: solarvest.my 7,808 characters, samaiden.com.my 4,921,
maybank about-us 2,511; about 1.4 GB on disk with Chromium; 1–3 s a page once
the browser is warm, 12 s for the first.

## When the mini is off

The hub does **not** fall back to Tavily. That was chosen deliberately: a dive
that quietly bought its pages again would hide a mini that has been down for a
week behind a bill that looks normal.

Instead, with no `fetch.pages` worker checked in within 90s, `pagefetch.read`
fails with code `not_installed`, the dive's T3/T4 steps report that the pages
could not be read, and the dive carries on from its search snippets. Thinner,
and visibly thinner.

The worker also **stops claiming while Crawl4AI is not answering**, which is the
same mechanism rather than a separate one: a lane that kept checking in while it
could read nothing would leave the hub believing reads were available and fail
every dive instead of degrading it.

## Costs, measured on this mini (M4, 16 GB)

| | |
|---|---|
| Image | 2.9 GB |
| Colima VM | 2 CPU, 4 GiB, 20 GiB disk |
| Container idle | ~440 MB |
| A page | 0.3–6 s, typically 1–2 s |
| A page, in Tavily credits | 0 |

## Known follow-up

`budgetedCall` still counts a page read against the dive's 15-call **Tavily**
budget, as it did when Tavily served it. Now that reads are free and local that
cap buys nothing but a shorter dive, and freeing it would let a dive read more
pages and spend its Tavily calls on search. Left alone here on purpose: it
changes dive economics, which is a separate decision from changing the provider.
