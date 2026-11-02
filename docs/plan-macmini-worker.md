# gmap-recon online — the Mac mini worker

## The problem this solves

Google Maps is the input to everything downstream, and it cannot be scraped from here.
Google does not block a datacenter IP — it **degrades** it. The same search that returns
~100 businesses from a residential line returns ~60 from a rented one, with no error, no
captcha and no empty feed. A scan run inside this container produces a dataset that is
thin and looks complete, and afterwards a town that was throttled is indistinguishable
from a town with few businesses.

A 24/7 Mac mini at home has a residential IP and is always awake. So the scan runs there
and the lab keeps everything else.

## Direction, and why it is inverted

The mini is behind home NAT with no public address. This service can never open a
connection to it. So the mini opens the connection: it long-polls `GET /api/jobs/next`
and the lab answers the moment a job exists.

That single decision removes the whole category of work everyone reaches for first — no
Cloudflare tunnel, no port forwarding, no dynamic DNS, no Tailscale, nothing on the home
router that has to keep working at 2am.

```
you ──POST /api/jobs {type:'ping'}──> [lab, Railway]
                                          │  in-memory queue
[Mac mini] ──GET /api/jobs/next (long-poll 25s)──┘
           ──POST /api/jobs/:id/result {hostname, publicIp}──>
you ──GET /api/jobs/:id──> {"ok":true,"hostname":"macmini","publicIp":"<home IP>"}
```

## Phase 1 — prove the transport. DONE

Built, and deliberately nothing more:

- `agy-lab/src/jobs.ts` — the broker. In-memory, leased, `POST /api/jobs`,
  `GET /api/jobs/next`, `POST /api/jobs/:id/result`, `GET /api/jobs[/:id]`.
- `worker/macmini.mjs` — the loop. One handler: `ping`.
- `worker/README.md` + the launchd plist — how it stays up.

**The job type is `ping` and the field that matters is `publicIp`.** When a ping
round-trips carrying the home address, four things are proven at once: the lab queued it,
the mini received it, the mini answered, and the mini's egress is residential. That is
the entire premise, tested end to end, before a line of Maps code is written.

Verified locally before deploy (broker + worker against a loopback server): create →
claim → result, immediate hand-off to an already-waiting worker (603 ms), unknown job type
reported as a failure rather than left to time out, and an expired lease returning the job
to `pending`.

### What is deliberately missing

- **Persistence.** Jobs live in a Map and die with the process; a redeploy takes ~6
  minutes and drops what is in flight. Adding a database before the transport is proven is
  how a one-day step becomes a week. The upgrade sits behind the same four functions.
- **Fan-out.** One worker. `WORKER_TYPES` exists so a second one can be added without the
  two stealing each other's work, and nothing else assumes a fleet.
- **Auth beyond `LAB_TOKEN`.** The worker holds the same bearer everything else does.

## Phase 2 — the scan

Add one entry to the `handlers` map in `worker/macmini.mjs`:

```
gmap.scan  {keyword, place}  ->  {businesses: [...], found, capped, blocked}
```

The handler body already exists and is probe-tuned — `searchPlace()` from gmap-recon's
`gmaprecon.ts`, with `browser.ts` and `leads.ts` alongside it. It comes over as-is;
patchright runs on macOS unchanged.

Nothing in Phase 1 changes to make this work. That is what Phase 1 bought.

Two things to carry over with it rather than rediscover:

- **Yield is a health signal, not ground truth.** The scanner already treats a search
  that returns far fewer results than its predecessor as a sign the profile is being
  throttled. Keep that; it is the only way a soft block is visible at all.
- **An empty feed is never recorded as `found: 0`.** During a soft block it is
  indistinguishable from a town with no matches.

## Phase 3 — the research chain

> **Not how it turned out.** The `chatgpt` and `meta` steps below no longer exist:
> Meta AI was retired (region-blocked from Railway), and the ChatGPT browser engine
> was removed on 2026-10-26 after Cloudflare started refusing it from the Railway
> IP. There is no browser lane in the container any more. The research rounds run
> on Pi (MiniMax) in the hub, and the Facebook round is the `fb.*` crawler on the
> mini. Kept as the original plan.

Per company, all of it through the gateway this service already exposes, so the mini needs
no logins of its own:

1. `agy` — first research pass.
2. `chatgpt` — enrich against agy's brief: its unknowns, news, and its risk list.
3. `meta` — restricted to the Meta network. Enforced by dropping any claim whose source
   host is not `facebook.com` / `instagram.com` / `threads.net`, because meta.ai will
   otherwise answer from general knowledge and it will read the same.
4. `agy` — rewrite all three into one report, losing nothing. Checked mechanically
   afterwards: every fact line and source URL from steps 1-3 must appear in the final
   report, and whatever does not is appended verbatim rather than quietly dropped.

ChatGPT and Meta share one browser lane in this container at 2s spacing, so this runs one
company at a time — roughly 13-18 minutes each. That number decides how the queue is
paced, and it is why the research chain is a Phase of its own rather than something
bolted onto the scan.
