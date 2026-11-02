# Starts this PC's company-diver workers at sign-in (idempotent; safe to run twice).
# Windows PowerShell 5.1, ASCII only.
$ErrorActionPreference = 'Continue'
$Here = $PSScriptRoot
$old = 'E:\000\automation-tools\agy-lab\local-fetch-worker\start-windows.ps1'

# 1. Crawl4AI on 127.0.0.1:11235 (both fetch pollers share it). The old checkout's
#    supervisor is what starts it, together with the old lab's poller.
$up = $false
try { $up = (Invoke-WebRequest 'http://127.0.0.1:11235/health' -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { }
if (-not $up -and (Test-Path $old)) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$old
  Start-Sleep -Seconds 40
}

# 2. fetch poller for the new hub
$pollerRunning = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('G:\company-diver\agy-lab\local-fetch-worker\worker.ts') }
if (-not $pollerRunning) {
  $env:LOCAL_FETCH_WORKER_ENV = Join-Path $Here '.fetch-worker.env'
  Start-Process node -WindowStyle Hidden -ArgumentList ('"' + (Join-Path $Here 'agy-lab\local-fetch-worker\worker.ts') + '"') `
    -RedirectStandardOutput (Join-Path $Here 'fetch-diver.log') -RedirectStandardError (Join-Path $Here 'fetch-diver.err')
}

# 3. Gmap worker for the new hub (its own lock stops a second copy)
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Here 'agy-lab\local-worker\worker.ps1')
