# The home worker

A loop that asks the lab for a job, runs it on this machine, and posts the answer
back. What keeps the work here rather than in the container:

- **Logins that already exist here.** Facebook was signed in by hand in the
  crawler's own ego lite task space, and grok.com in its own — no OAuth-paste
  apparatus, no keyring the container does not have.

**`gmap.scan` has moved to the hub.** Google Maps business lists now come from
scraper.tech, run by the hub's own worker (`scraper-tech-maps`,
[maps-worker.ts](../agy-lab/src/maps-worker.ts)). It found 1,838 businesses in
Taman Daya where this machine found 118. The home IP was the reason scans ran
here: a scan from a datacenter address came back thin. scraper.tech does not have
that problem. The hub no longer gives this machine `gmap.scan`: `RETIRED_TYPES` in
[jobs.ts](../agy-lab/src/jobs.ts) drops it from any worker whose name starts with
`m4-mini`, even if the scan daemon still offers it. The `gmap.scan` row and the
scan daemon below are kept for the record. See
[docs/pipeline.md](../docs/pipeline.md) and
[docs/scraper-tech-maps.md](../docs/scraper-tech-maps.md).

It only ever makes outbound requests. Nothing needs to be opened on the router.

```
GET  /api/jobs/next?worker=<name>&wait=25&types=…   held open ~25s, 204 when idle
POST /api/jobs/heartbeat                            every 30s, only while a job runs
POST /api/jobs/<id>/result                          {ok, result, error}
```

## What it runs

| type | payload | runs |
|---|---|---|
| `ping` | anything, echoed back | the proof job — reports `publicIp` |
| `gmap.scan` | `{keyword, place?, max?, userId?}` | `gmap.mjs`, a Chrome on the home line, 12–60s |
| `fb.company` | `{name, city?, phone?, website?, address?, category?, budget?}` | `fb.mjs` → `fbw`, an ego lite crawl, 16–55s — 16s and no model call when the deterministic scorer settles it |
| `fb.person` | `{person, company, city?}` | that person's profile, if it is publicly linked to the company |
| `fb.discover` | `{name, city?}` | named humans on a company's public surface, 60–120s |
| `fb.probe` | none | whether ego lite still holds a Facebook session — one page load, no model call |

The `ads.company`, `ads.market` and `ads.probe` types run `ads.mjs` (ads-recon,
a deterministic crawl of two public ad libraries) on the `-ads` lane below.

**`chatgpt.*`, `meta.*` and `muse.*` are gone.** On 2026-10-25 Cloudflare started
refusing ChatGPT chats from the Railway IP — `cloudflare_challenge` came back in
place of the answer — and the ChatGPT engine was removed on 2026-10-26, here and
in the hub. `chatgpt.mjs`, `chatgpt-ego.mjs` and the ask LaunchAgent plist are
deleted. Meta AI was retired before that: it was never activated on this machine
(no ego lite profile ever held a `meta.ai` or `facebook.com` cookie, so every
route to it ended at an interactive Facebook login), and the muse 1.2 stand-in
that answered under the `meta.*` names is gone too. `meta-ego.mjs` and its test
are deleted with it. The gateway's model names for those engines now resolve to
Pi in the hub; no model call is queued for this machine any more.

The Facebook work that Meta was originally wanted for is `fb.*` above — a
read-only crawler with an evidence trail, not a model asked what it can see.

A worker advertises the types it was **started** with, so a process older than
the handler it is missing looks, from the cloud, exactly like a machine that is
switched off. Restart a lane after a `git pull` that adds a handler. See
[API.md](../API.md).

## Lanes

`macmini.mjs` runs one claim loop per lane, side by side in one process, each
checking in under its own name — so a lane that dies is visible in `GET /api/jobs`
instead of being covered for by its neighbour still polling.

With `WORKER_TYPES` unset there are four lanes: `<name>` for `ping` and
`gmap.scan`, `<name>-fb` for `fb.*`, `<name>-x` for `x.*` and `<name>-ads` for
`ads.*`. Set, it collapses the process to a single lane taking exactly those
types — which is how this machine actually runs, one process per engine:

| Process | `WORKER_NAME` | `WORKER_TYPES` | Kept alive by |
|---|---|---|---|
| the scan | `$(hostname)` | `ping,gmap.scan` | the LaunchDaemon, at boot |
| the fb lane | `macmini-fb` | `fb.company,fb.person,fb.discover,fb.probe` | the LaunchAgent, at login |
| the x lane | `macmini-x` | `x.subject,x.company,x.probe` | the LaunchAgent, at login |
| the ads lane | `macmini-ads` | `ads.company,ads.market,ads.probe` | the LaunchAgent (`com.eternalgy.gmapworker.ads.plist`), at login |

`agy.*`, `chatgpt.*`, `meta.*` and `muse.*` are dropped from `WORKER_TYPES` even
when an installed plist still names them. A process whose `WORKER_TYPES` names
**only** retired types claims nothing and logs that its LaunchAgent should be
unloaded — rather than falling through to the default lanes and starting a second
`gmap.scan` lane beside the scan daemon on the same home line.

Pinning the daemon matters as much as pinning the other lanes: an unpinned scan
daemon starts all four default lanes, so it would claim `fb.*`, `x.*` and `ads.*`
jobs in the system domain, where ego lite cannot run, and fail them — stealing
them from the agent that could have answered.

The split is by duration and by what the engine needs. Each lane is serial within
itself, and the fb, x and ads lanes each hold their own ego lite task space for
minutes at a time, so none of them should wait behind another.

## Accounts

The wrappers store no password, token or TOTP. Every credential is a login that a
human performed once, in a browser profile on this machine:

- **Facebook** — signed in by hand once, in the `facebook read-only crawler` task
  space inside ego lite. `fb-recon` never types, stores or reads a password; when
  the session lapses the fix is `./fb login` on this machine, which hands you the
  browser to sign in yourself. `fb.probe` is how the cloud finds out.
- **Claude** — `fbw` runs the Claude CLI on an OAuth login in the **login
  keychain**, which is the second reason the fb lane cannot be a daemon.

The ChatGPT accounts this machine used to answer on are no longer used. The
ChatGPT entries in `~/.gmap-worker/spaces.json` and any `CGPT_*` variables in
`~/.gmap-worker.env` do nothing now and can be deleted.

---

## Install on the Mac mini

```bash
# 1. Node 24 (type stripping and process.loadEnvFile are both required)
brew install node
node --version          # must be v24 or newer

# 2. The code
cd ~
git clone https://github.com/Zhihong0321/automation-tools.git
cd automation-tools

# 3. The token, in a file only you can read.
#    It is a root shell on the lab container — never put it in the plist.
printf 'LAB_TOKEN=%s\n' 'PASTE_THE_TOKEN' > ~/.gmap-worker.env
chmod 600 ~/.gmap-worker.env

# 4. Run it in the foreground FIRST. A failure you can see beats one in a log.
node worker/macmini.mjs
```

Expect:

```
[2026-08-20 19:31:02] worker "macmini" -> https://ee-auto.up.railway.app (any type)
```

…and then nothing, which is correct: it is holding a long poll, waiting for work.

## Prove it, from any machine with the token

```bash
LAB=https://ee-auto.up.railway.app
ID=$(curl -s -X POST $LAB/api/jobs -H "authorization: Bearer $LAB_TOKEN" \
     -H 'content-type: application/json' -d '{"type":"ping"}' | jq -r .job.id)
curl -s $LAB/api/jobs/$ID -H "authorization: Bearer $LAB_TOKEN" | jq .job.result
```

```json
{
  "hostname": "macmini",
  "platform": "darwin 24.5.0 arm64",
  "publicIp": "…your home line…",
  "at": "2026-08-20T11:31:44.201Z"
}
```

**`publicIp` is the whole test.** If it is your home address, a Maps scan launched from
here will be served the full result page. If it is a Railway address, the job ran in the
container and nothing has been proven — stop and find out why.

## Keep it running

Use the **daemon**, not the agent. A LaunchAgent starts when a user logs in; a mini
that reboots at 3am and stops at the login window runs no agent, and there is nothing
in the log to say so — the jobs just stay `pending`. A LaunchDaemon starts at boot with
nobody logged in. It still runs as you, not as root, so it can read the chmod-600 token.

```bash
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$(which node)|g" -e "s|__USER__|$(id -un)|g" \
    worker/com.eternalgy.gmapworker.daemon.plist > /tmp/gmapworker.plist
sudo install -o root -g wheel -m 644 /tmp/gmapworker.plist \
    /Library/LaunchDaemons/com.eternalgy.gmapworker.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.eternalgy.gmapworker.plist
tail -f ~/Library/Logs/gmap-worker.log
```

To stop it: `sudo launchctl bootout system/com.eternalgy.gmapworker`. Re-run the four
lines above after a `git pull` that changes the worker, or after any Node change.

`com.eternalgy.gmapworker.plist` (no `.daemon`) is the LaunchAgent version. It is kept
only for a mini that is already set to log in automatically; on anything else it is the
trap described above.

### agy — removed

The agy lane (`agy.ask`, `agy.probe`) is gone: the Google accounts it ran on were
banned. Its replacement, the Pi worker on MiniMax, runs in the hub
(`agy-lab/src/pi.ts`), not on this machine. If `com.eternalgy.gmapworker.agy` is
still loaded here, remove it:

```bash
launchctl bootout gui/$(id -u)/com.eternalgy.gmapworker.agy
rm ~/Library/LaunchAgents/com.eternalgy.gmapworker.agy.plist
```

### The ask lane — removed, unload it once

The ask lane (`macmini-ask`, `chatgpt.ask` and `chatgpt.probe`) is gone with the
ChatGPT engine, and `com.eternalgy.gmapworker.ask.plist` is deleted from the repo.
A copy already installed on the mini keeps starting at login: after a `git pull`
it claims nothing and logs that it should be unloaded, but it still runs. Remove
it by hand, once:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.gmapworker.ask.plist
rm ~/Library/LaunchAgents/com.eternalgy.gmapworker.ask.plist
```

**The fb, x and ads lanes are LaunchAgents and start at login, not at boot.** Pay
for that with automatic login: System Settings → Users & Groups → Automatic login,
set to this account. FileVault has to stay off for it to work at all.

`macmini-ego` has the same gap and no plist at all yet. The same agent shape fits
it — ego lite is a GUI app and cannot run in the system domain either — with
`WORKER_NAME` and `WORKER_TYPES` changed.

### The fb lane — an agent for two reasons

ego lite is a GUI app, and a GUI app cannot run in the system domain. It also
runs the Claude CLI, whose credential is an OAuth login in the login keychain —
which a system-domain process cannot unlock. Either reason alone rules out the
daemon.

```bash
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$(which node)|g" \
    worker/com.eternalgy.gmapworker.fb.plist \
    > ~/Library/LaunchAgents/com.eternalgy.gmapworker.fb.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.gmapworker.fb.plist
tail -f ~/Library/Logs/gmap-worker-fb.log
```

Stop it with `launchctl bootout gui/$(id -u)/com.eternalgy.gmapworker.fb`.

Prove the engine before routing anything to it — `fb.mjs` runs standalone, and a
failure you can see beats one in a log:

```bash
node worker/fb.mjs probe
node worker/fb.mjs company '{"name":"Riomation2u","city":"Johor Bahru","budget":4}'
```

### The x lane — an agent for three reasons

The two above, plus one this lane has alone. grok.com puts an age-confirmation
modal in the way, once per ego lite task space, and x-recon will not click it: an
age attestation is a statement about a person, not a checkbox a job may tick. That
gate is cleared by a human at this machine or not at all, so there is no version of
this lane that runs somewhere nobody is sitting.

It drives a *different* ego lite task space from the fb lane — `grok x-search`
against the crawl space — so the two do not contend for a browser and can be in
flight at once.

```bash
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$(which node)|g" \
    worker/com.eternalgy.gmapworker.x.plist \
    > ~/Library/LaunchAgents/com.eternalgy.gmapworker.x.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.gmapworker.x.plist
tail -f ~/Library/Logs/gmap-worker-x.log
```

Stop it with `launchctl bootout gui/$(id -u)/com.eternalgy.gmapworker.x`.

Prove the engine before routing anything to it. `probe` is the one to read first,
because it distinguishes the two things that look alike from the outside — a lapsed
sign-in (`logged_out`) and a signed-in account behind an unanswered dialog
(`gated`). They need different humans doing different things.

```bash
node worker/x.mjs probe
node worker/x.mjs subject '{"subject":"Grok 5 launch","budget":1}'
```

**Budget buys wall clock here, not money.** One Grok ask is 40–120s and the default
is four per lead, so give jobs a `timeoutMs` of at least `600000` — the handler's
own default — and expect a full ladder to run six minutes.

**Test it with a scrubbed environment, not your shell's.** `fbw` shells out to
`claude`, and an interactive terminal on this machine carries desktop-app
variables that launchd does not — including one that overrides the API base URL.
Run it the way launchd will:

```bash
env -i HOME="$HOME" USER="$USER" PATH="$(dirname $(which node)):$HOME/.local/bin:/usr/bin:/bin" \
    node worker/fb.mjs probe
```

**Check what `$(which node)` actually resolved to.** launchd needs an absolute path, so
that sed bakes one in permanently. If Node came from nvm rather than brew it will be
version-specific — `~/.nvm/versions/node/v24.13.1/bin/node` — and the day that version is
uninstalled or switched away from, the plist points at nothing. It fails at boot, where
nobody is looking. Either install Node with brew so the path is `/opt/homebrew/bin/node`,
or re-run the sed after any Node change.

**Power.** A sleeping mini answers no polls, and the queue will simply say `pending`
forever with no error anywhere. The two settings live in System Settings → Energy, but
set and verify them from the shell — the checkbox labels move between macOS versions and
`pmset` does not:

```bash
sudo pmset -a autorestart 1   # come back by itself after a power cut
sudo pmset -a sleep 0         # never sleep the machine
pmset -g | grep -E 'autorestart|^ sleep'
```

Both must read what you set them to. `displaysleep` does not matter; only the machine
sleeping does.

## The Step 2 Worker — the mini also shares List processing

Separate from the Maps lanes above, the mini runs a second worker that shares
**step 2 of List processing** with the hub and the Windows PC. Step 2 re-reads each
business's website for a contact form, collects emails, checks their MX records,
types the phones and picks a `best_contact_method` — plain web requests and DNS
only, no LLM and nothing paid, so it costs nothing to leave running. It submits
nothing. See `docs/list-step2.md` for what step 2 does and how the leases work.

It is `agy-lab/step2-worker/worker.ts`, the same file the Windows PC runs, run
straight as TypeScript by Node 24. Nothing is built, so it always runs the
checkout's current step-2 code — a `git pull` is the whole upgrade.

```bash
# 1. Deps, once (and after any package change)
cd ~/automation-tools/agy-lab && npm install --omit=dev

# 2. Settings. The mini already holds LAB_TOKEN, which reaches the worker routes,
#    so it uses that rather than the PC's GMAP_WORKER_KEY. chmod 600, never the plist.
mkdir -p ~/.step2-worker && chmod 700 ~/.step2-worker
umask 077; cat > ~/.step2-worker/worker.env <<EOF
LAB_URL=https://ee-auto.up.railway.app
LAB_TOKEN=$(grep -m1 '^LAB_TOKEN=' ~/.gmap-worker.env | cut -d= -f2-)
WORKER_NAME=mac-mini
CONCURRENCY=8
EOF

# 3. Foreground FIRST, the same rule as the Maps worker. Ctrl-C after a batch or two.
cd ~/automation-tools/agy-lab/step2-worker && node worker.ts
```

Keep it running, as a LaunchAgent:

```bash
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$(which node)|g" \
    worker/com.eternalgy.step2worker.plist > ~/Library/LaunchAgents/com.eternalgy.step2worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eternalgy.step2worker.plist
tail -f ~/.step2-worker/worker.log
```

- **Stop it:** `launchctl bootout gui/$(id -u)/com.eternalgy.step2worker`.
- **Start it again:** the `bootstrap` line above.
- **After a Node change,** re-run the `sed` and `bootstrap` lines: the plist holds the
  absolute Node path baked in at install, the same trap as the Maps plists. This one
  was installed against nvm's `v24.13.1`.
- **Logs:** `~/.step2-worker/worker.log` is the worker's own; `launchd.log` beside it
  catches anything it dies before writing.

An agent is right here only because this mini logs in automatically
(`autoLoginUser` is set), so it comes back by itself after a reboot — the warning
under "Keep it running" applies to this job too. If autologin is ever turned off,
this needs the daemon treatment as well.

**Measured on 2026-10-31,** at `CONCURRENCY=8`: 16 leads a batch, 6–12 s a batch
once warm — **357 leads in 4 minutes, 89 a minute**, against the Windows PC's ~50.
The first few batches after a start are about half speed, so read the rate off a
minute of `worker.log`, not off batch one. The hub's `doneBy` counts it as
`mac-mini`; 510 leads in its first five minutes.

## Reading the failure modes

| What you see | What it is |
|---|---|
| `FATAL: 401 — LAB_TOKEN is wrong or was rotated` | the worker exits on purpose. Retrying a bad token forever looks identical to working. |
| `poll failed (…) — retrying in 5s`, doubling to 60s | the lab is down or redeploying. It reconnects by itself; nothing to do. |
| a burst of `poll failed (fetch failed)` right after a reboot | the daemon starts before the network is up. It backs off to 60s and connects when the link comes back — on this mini it took about 4 minutes. Expected, not a fault. |
| a job sits `pending` and the worker log is silent | the mini is asleep, or the process is not running. `sudo launchctl list \| grep gmapworker`. |
| nothing at all in the log after a reboot | the job was installed as an agent, not a daemon, and nobody logged in. |
| a job goes back to `pending` on its own | its lease expired — the worker died mid-job. Three of those and the job fails with a message saying so. |
| the worker stops coming back after a Node upgrade | the plist holds the absolute path baked in at install. Re-run the `sed` line above. |
| `fb.*` fails `logged_out: ego lite is not signed in to Facebook` | the crawl space's Facebook session lapsed. `./fb login` on the mini and sign in by hand; nothing here stores a credential to refresh. |
| `fb.*` fails `busy: another fb-recon run holds the browser lock` | a lead is already running, or a previous one was killed hard and left `fb-recon/worker/runs/.lock` behind. Remove the directory only after checking nothing is running. |
| `fb.*` fails `busy: the crawl space is under a human's control` | somebody clicked in the crawl space's window. The crawler will not fight you for the browser. Re-run when you are done. |
| `fb.*` fails with a 403 mentioning `provider:11111` | `claude` read `~/.claude/settings.json`, which points at a proxy that does not serve `claude-sonnet-5`. `fbw` passes `--setting-sources project,local` to skip that file; a failure here means the flag was lost. |
| every `fb.*` job fails only under launchd, never from your terminal | the desktop app exports variables a launchd job does not — the base-URL override above is the usual one. Reproduce with the `env -i` line in the install section. |
| `quota_reached: Individual quota reached. Resets in …` | The failed job records the quota error. The broker marks that lane `cooldown` in `GET /api/jobs`, stops assigning it jobs, and exposes `cooldownUntil`. The worker sleeps until the reset time, then resumes polling automatically. |
| `WORKER_TYPES names only retired types (…); claiming nothing. Unload this LaunchAgent.` | an old LaunchAgent (usually the ask lane) is still installed. Unload and delete it — see [The ask lane](#the-ask-lane--removed-unload-it-once). |

## Configuration

| Variable | Default | |
|---|---|---|
| `LAB_TOKEN` | — | required; from `~/.gmap-worker.env` or the environment |
| `LAB_URL` | `https://ee-auto.up.railway.app` | |
| `WORKER_NAME` | `os.hostname()` | what `GET /api/jobs` reports |
| `WORKER_TYPES` | empty | comma-separated. Empty gives the four default lanes; set, it pins the process to one lane taking exactly these types. See [Lanes](#lanes) |
| `WORKER_ENV_FILE` | `~/.gmap-worker.env` | |
| `FBW_BIN` | `~/project/gmap-recon/fb-recon/worker/fbw` | the fb-recon worker; it lives in its own repo |
| `FB_BIN` | `~/project/gmap-recon/fb-recon/fb` | the crawler itself, used only by `fb.probe` |
| `FB_TIMEOUT_MS` | 300000 | ceiling for one lead; the payload's `timeoutMs` wins when set |
| `EGO_BROWSER_BIN` | `ego-browser` on `PATH` | the worker prepends `~/.local/bin`, which launchd does not inherit |
| `WORKER_COOLDOWN_MS` | unset | optional pause after each job, per lane |
| `WORKER_RECOVERY_DIR` | `~/.gmap-worker/unsaved-scans` | local recovery copies of report scans; the hub writes to its own database |

### Recovering an unsaved Maps scan

The worker returns scanned businesses to the hub, which saves them through
`DATABASE_URL`. Before reporting a scan, the worker also keeps a copy at
`~/.gmap-worker/unsaved-scans/JOB_ID.json`. If hub persistence fails, the report
stays `partial`, shows the error in Reports, and
offers **Repair save** once the database is working again. This reuses the
captured companies and does not open Google Maps.

If the lab was unable to retain the captured result at all, restore the worker
copy after the database returns:

```sh
node worker/replay-scan.mjs ~/.gmap-worker/unsaved-scans/JOB_ID.json
```

The command uses `LAB_URL` and `LAB_TOKEN`, verifies the company links, and
updates the same public report. It keeps the recovery file for inspection.
