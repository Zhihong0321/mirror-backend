# Cutover: point the workers at company-diver

The workers (Windows Gmap worker, Windows fetch worker, Mac mini) keep their
code. Only two settings change: the lab address and the key. Nothing in
automation-tools is edited; the old lab keeps running until you turn the old
workers off in the last section.

Placeholders: `<NEW_LAB_URL>` is the company-diver service URL (no trailing
slash). `<LAB_TOKEN>` is the new service's `LAB_TOKEN` variable.

The workers no longer have a built-in lab address. A worker with no `LAB_URL`
refuses to start (it never falls back to the old lab).

## The key changes with the lab

`GMAP_WORKER_KEY` is an HMAC of the lab's `LAB_TOKEN`, so the old key does not
work on the new lab. Make the new one on any machine with node:

```bash
node -e "console.log(require('crypto').createHmac('sha256','<LAB_TOKEN>').update('gmap-local-worker-v1').digest('hex'))"
```

Call the output `<WORKER_KEY>`. The Mac mini and the Windows fetch worker can
use `LAB_TOKEN` directly instead; the Windows Gmap worker needs `<WORKER_KEY>`.

## 1. Windows PC (this PC, pc-desktop-camhl16)

Back up first, so rollback is one copy.

### Gmap worker (`GmapWorker`, reads Maps list pages)

Easiest: open `<NEW_LAB_URL>/workers` and download the Gmap worker package (it
needs `LAB_TOKEN`; the zip has the right `LAB_URL` and key inside). Then:

```powershell
# stop the running worker (the script runs under powershell)
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'GmapWorker.*worker\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# old settings, kept for rollback
Copy-Item "<old GmapWorker folder>\worker.env" "<old GmapWorker folder>\worker.env.old"
```

Or edit the existing `worker.env` in the GmapWorker folder in place:

```
LAB_URL=<NEW_LAB_URL>
GMAP_WORKER_KEY=<WORKER_KEY>
```

Start it again with `Start Gmap Worker.cmd` (or `Enable autostart.cmd` if it
was on). `%LOCALAPPDATA%\GmapWorker\worker.log` must show it checking in to the
new URL; a `refused this worker's key` line means the key is wrong.

### Fetch worker (native Crawl4AI, `~\.local-fetch-worker`)

```powershell
$f = "$env:USERPROFILE\.local-fetch-worker\worker.env"
Copy-Item $f "$f.old"
(Get-Content $f) `
  -replace '^LAB_URL=.*', 'LAB_URL=<NEW_LAB_URL>' `
  -replace '^(GMAP_WORKER_KEY|LAB_TOKEN)=.*', 'GMAP_WORKER_KEY=<WORKER_KEY>' |
  Set-Content $f -Encoding ascii
# restart: stop the supervisor and its children, then start it again
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'local-fetch-worker|crawl4ai_server\.py|start-windows\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# from the new checkout:
powershell -ExecutionPolicy Bypass -File G:\company-diver\agy-lab\local-fetch-worker\start-windows.ps1
```

(The memory notes say it was started through WMI so it outlives the terminal:
`Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell -ExecutionPolicy Bypass -File G:\company-diver\agy-lab\local-fetch-worker\start-windows.ps1'}`.)
`~\.local-fetch-worker\worker.log` should show `hub <NEW_LAB_URL>`.

### Step 2 worker (`agy-lab/step2-worker`)

Leave it on the old lab. Step 2 (list-step2) is a lead-pipeline loop, and the
fork has it switched off, so a worker pointed at the new lab would find no jobs.

## 2. Mac mini

I cannot reach it. Run these on the mini, in Terminal, as the user the worker
runs as. Check which launchd jobs exist first: `launchctl list | grep eternalgy`.

```bash
# a. Get the fork next to the old checkout (the old one stays for rollback)
cd ~ && git clone https://github.com/Zhihong0321/mirror-backend.git company-diver
cd ~/company-diver/agy-lab && npm install --omit=dev
cd ~/company-diver/worker && ls   # macmini.mjs, gmap.mjs, fb.mjs, x.mjs, ads.mjs, db.mjs

# b. Settings. Back up, then point at the new lab. LAB_URL is now required.
cp ~/.gmap-worker.env ~/.gmap-worker.env.old
umask 077
sed -i '' '/^LAB_URL=/d;/^LAB_TOKEN=/d' ~/.gmap-worker.env
printf 'LAB_URL=<NEW_LAB_URL>\nLAB_TOKEN=<LAB_TOKEN>\n' >> ~/.gmap-worker.env
chmod 600 ~/.gmap-worker.env

# c. Foreground test FIRST. Ctrl-C after the log shows it claiming from <NEW_LAB_URL>.
cd ~/company-diver/worker && node macmini.mjs
```

The plists in `worker/` hard-code the checkout path (`__HOME__/automation-tools`, `__HOME__` is filled in by the sed below). Point
them at the new checkout, then reload:

```bash
cd ~/company-diver/worker
for p in com.eternalgy.gmapworker com.eternalgy.gmapworker.fb com.eternalgy.gmapworker.x com.eternalgy.gmapworker.ads; do
  [ -f ~/Library/LaunchAgents/$p.plist ] || continue
  launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/$p.plist 2>/dev/null
  sed "s#__HOME__#$HOME#g;s#automation-tools#company-diver#g" $p.plist > ~/Library/LaunchAgents/$p.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$p.plist
  launchctl kickstart -k gui/$(id -u)/$p
done
# daemon variant (only if you installed it):
#   sudo launchctl bootout system /Library/LaunchDaemons/com.eternalgy.gmapworker.daemon.plist
#   sed "s#__HOME__#$HOME#g;s#automation-tools#company-diver#g" com.eternalgy.gmapworker.daemon.plist | sudo tee /Library/LaunchDaemons/com.eternalgy.gmapworker.daemon.plist >/dev/null
#   sudo launchctl bootstrap system /Library/LaunchDaemons/com.eternalgy.gmapworker.daemon.plist
tail -f ~/Library/Logs/gmap-worker*.log     # must say "-> <NEW_LAB_URL>"
```

The ~/.step2-worker/worker.env job (`com.eternalgy.step2worker`) stays on the
old lab, for the same reason as on the PC.

## 3. Verify, then turn the old ones off

Verify on the new lab (`Authorization: Bearer <LAB_TOKEN>`):

```bash
curl -s <NEW_LAB_URL>/api/jobs -H "authorization: Bearer <LAB_TOKEN>"   # each worker listed with a recent check-in
```

Queue one ping or one company dive and see it complete on the new lab. After
that the **old** lab has no Maps/fetch workers left: a worker holds one lab at a
time, so switching a worker already turned it off for the old lab.

Turn the old things off only after the new lab has run a real job:
1. In automation-tools do nothing to the code. Stop the old Railway service
   (ee-auto) from the Railway dashboard when you are ready; do not delete it.
2. Mac mini: `launchctl bootout` the jobs still pointing at `~/automation-tools`
   (the `step2worker` one stays only while the old lab runs) and archive
   `~/automation-tools` when you no longer need it.
3. Delete `*.old` settings files only when you are sure there is no rollback.

Rollback: copy each `*.old` back over `worker.env` / `~/.gmap-worker.env`,
restart the worker.

## What changed in the worker code

- `worker/macmini.mjs`, `worker/replay-scan.mjs`,
  `agy-lab/local-fetch-worker/worker.ts`: removed the built-in
  `https://ee-auto.up.railway.app` default. `LAB_URL` is required and a missing
  one is reported and stops the worker (same style as a missing token).
- READMEs/comments: example URLs are now `<NEW_LAB_URL>`.
- Unchanged: `agy-lab/local-worker/worker.ps1` and `step2-worker/worker.ts`
  already read `LAB_URL` from `worker.env`; `start-windows.ps1` reads
  `worker.env`; the plists have no lab URL or token.
