# agy-lab

Install, authenticate and drive the **Antigravity CLI (`agy`)** inside a Railway
container — and find out whether the login survives a redeploy.

This is a research harness, not a product. It exists to settle one question:
*can agy hold a Google session in a container, or does agy have to stay on a
local PC?* The answer decides whether the gmap-recon pipeline can move to the
cloud or needs a worker at home.

It can: agy holds its login across a redeploy. So the harness grew a
consumer-facing end - a gateway that serves a model to other tools in the OpenAI
chat-completions shape, documented in [../API.md](../API.md). That gateway is now
Pi on MiniMax only: agy's Google accounts were banned and Pi replaced it, and the
ChatGPT and Meta AI browser engines that once sat beside it are removed (see the
end of this page). Everything below is the agy machinery as it was built:
installing agy, driving a login, and finding where the credential lands.

## Railway setup

1. **New service → deploy from this repo.** No Root Directory setting needed —
   the Dockerfile sits at the repo root and copies `agy-lab/` in. Railway's
   builder only looks for a Dockerfile at the root of the build context and falls
   back to language autodetection when it finds none, so a Dockerfile one
   directory down is silently ignored and the deploy fails claiming it cannot
   tell what the app is.
2. **Variables → `LAB_TOKEN`** — 16+ random characters. The service refuses to
   start without it (see *Security* below).
3. **Volume → mount at `/data`.** `HOME=/data`, and agy derives everything from
   `HOME`: the binary at `~/.local/bin/agy`, settings, conversations, and the
   credential store. Without the volume the container works fine and forgets the
   login on every redeploy.

Then open the service URL, paste the token, and work down the buttons.

## The three ways agy can authenticate here

| Route | Interaction | Verdict |
|---|---|---|
| **Gemini API key** | none | Set `GEMINI_API_KEY`, then press *Set provider = gemini* (writes `modelProvider` into `settings.json`). The documented headless/CI path. The env var alone is not enough — the provider switch is what stops agy reaching for a keyring session. |
| **OAuth paste** | once | Press *Log in*. agy prints an authorization URL, you open it, and paste the code back into the terminal box. This is the flow you already use on the PC. |
| **OS keyring** | — | Not available. Containers have no D-Bus session bus, and agy's changelog says it bypasses the keyring when there is none. That fallback is precisely what this harness measures. |

### Why the login needs a terminal

agy's changelog: the authorization code is read *"via the controlling terminal
(/dev/tty on POSIX and CONIN$ on Windows) when stdin is consumed by a piped
prompt"*, and *"truly headless runs fail fast with an actionable message instead
of blocking"*. A normal `spawn` gives it pipes, not a terminal, so the paste step
can never complete.

`src/pty.ts` solves that with `script` from util-linux rather than `node-pty`: it
allocates a pty from a package Debian already ships, with no C++ toolchain in the
image and nothing to rebuild when Node's ABI moves.

The docs also describe two *different* login behaviours — a local run launches a
browser (there is none here), while an SSH run prints a URL to paste a code back
into. Only the second can work in a container, so sessions set `SSH_CONNECTION`,
`SSH_CLIENT` and `SSH_TTY` by default. Whether that is sufficient is one of the
things being tested; pass `fakeSsh: false` to turn it off.

## Where does the credential land?

The open question. agy bypasses the keyring in a container — in favour of *what*,
written *where*, is documented nowhere, and it decides whether a login survives a
redeploy.

The method is deliberately dumb and therefore trustworthy:

1. **Snapshot now** — records every file under `HOME`.
2. **Log in.**
3. **Diff vs pre-login** — whatever appeared is the credential store.
4. **Inspect** it. Redacted by default: the file being hunted is a live token and
   a browser tab is not a vault. `?reveal=1` prints it verbatim.

No guessing at library internals, no reading strings out of a Go binary.

## Outside APIs: `src/core/`

Every LLM, Tavily, Exa, Brave, scraper.tech Maps and Google PageSpeed call goes
through [`src/core/`](src/core/README.md), and nothing else talks to those services.
The LLM router there uses every enabled deepseek lane saved on /workers, several at
once. It rests a lane after a 429 and moves on, and falls back to MiniMax only after
every lane failed. Each request is logged with its lane, tokens and USD.
`src/core/core-door.test.ts` fails the build when a file goes around it.

## API

Everything the page does is a plain HTTP call, so the whole harness can be driven
from a terminal. All `/api/*` routes need `Authorization: Bearer $LAB_TOKEN`.

| | |
|---|---|
| `GET /healthz` | unauthenticated; Railway's healthcheck |
| `GET /api/status` | installed? version? volume mounted? which auth route is configured? |
| `POST /api/install` | runs `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |
| `POST /api/login` | snapshots `HOME`, then starts a pty run that triggers the OAuth flow |
| `POST /api/session` | `{command, fakeSsh, env}` — run anything in a pty |
| `GET /api/session/:id?offset=N` | stream output from a byte offset |
| `POST /api/session/:id/input` | `{text}` — **this is how the OAuth code gets pasted** |
| `POST /api/session/:id/kill` | SIGHUP, then SIGKILL after 3s |
| `POST /api/probe` | one real tool-free model call: is the session actually live? |
| `POST /api/run` | `{prompt, tools, format}` — a real prompt |
| `POST /api/exec` | `{cmd}` — arbitrary shell |
| `POST /api/snapshot` | `{label}` — record the file tree |
| `GET /api/snapshot/diff?from=pre-login` | what changed |
| `GET /api/file?path=&reveal=` | inspect one file |
| `POST /api/settings/provider` | `{provider}` — write `modelProvider` into settings.json |

```bash
LAB=https://your-service.up.railway.app
TOK=your-lab-token
curl -s -H "Authorization: Bearer $TOK" $LAB/api/status
curl -s -X POST -H "Authorization: Bearer $TOK" $LAB/api/install
curl -s -H "Authorization: Bearer $TOK" "$LAB/api/session/s1?offset=0"
```

## Probe states

Four states, not two — lifted from gmap-recon's session-monitor for the same
reason. `ok | broken` collapses *"could not tell"* into *"logged out"*, which
sends a human to re-authenticate for nothing. Here it would also corrupt the
experiment: a container that failed to allocate a pty is not a container that
failed to authenticate, and telling those apart is the entire point.

| | |
|---|---|
| `ready` | proven just now by a real model call |
| `logged_out` | credentials are gone; sign in |
| `not_installed` | no binary; press Install |
| `unknown` | the probe could not tell — read `detail` before acting |

## Security

`/api/exec` is a remote shell, and this container will be holding a live Google
session. The service therefore **refuses to start without a `LAB_TOKEN` of at
least 16 characters**, and there is no dev mode that skips it — an open shell on a
public Railway hostname is a root shell for whoever scans the port first.

`--dangerously-skip-permissions` is opt-in per run, never a default. There is no
narrower per-tool allow flag on the command line, so it is all-or-nothing: full
tool auto-approval with nobody watching. That is a much bigger surface inside a
web-reachable container than it is on a desktop.

## Not built yet

agy's *own* browser tools. agy downloads its own Playwright driver at runtime and
already 404s doing so on a normal desktop. There is no Chrome in the image any
more to point it at.

`agy update` self-modifies the binary. On a volume that works and silently drifts
from what this README claims is installed; pin it once there is anything worth
pinning.

---

# ChatGPT and Meta AI sessions — removed

This service used to hold ChatGPT accounts as persistent Chrome profiles on the
volume (`/data/profiles/<id>`), run headed Chrome under Xvfb with patchright, and
drive the real ChatGPT UI for the gateway. Meta AI sessions used the same
machinery. All of it was removed on 2026-10-26.

Why: on 2026-10-25 Cloudflare started refusing ChatGPT chats from the Railway IP
— `cloudflare_challenge` came back in place of the answer — and there is no
browser fix for an address the site will not serve. Meta AI had already been
retired because Railway's address is region-blocked.

What went with it:

- `src/browser.ts`, `sessions.ts`, `login.ts`, `cgptroutes.ts`, `meta.ts`,
  `totp.ts` and `entrypoint.sh`.
- Every `/api/cgpt/*` route (probe, open, login, OTP, import, export, ask, frame)
  and `/api/net`.
- Chrome, Xvfb, the fonts and the patchright dependency, from the Docker image —
  and with them the ~400MB-per-profile memory budget and the `--no-sandbox`
  trade-off this page used to explain.
- The Egress, ChatGPT sessions, Log in, Import session and Ask through a session
  cards in the hub UI.
- The variables `CGPT_*`, `META_*`, `MAX_OPEN_BROWSERS`, `BROWSER_IDLE_MS` and
  `BROWSER_LEASE_MS`, which no longer do anything.

The gateway's old model names (`chatgpt`, `gpt-*`, `meta`, `llama-*` and the rest)
now resolve to Pi; see [../API.md](../API.md).
