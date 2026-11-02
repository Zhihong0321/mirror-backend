# One-shot setup of a fresh Windows PC as a hub worker: the Gmap scan worker and
# the Crawl4AI page-fetch worker. On the new PC: `git pull`, then from the repo root
#
#   .\setup-worker.cmd
#
# It asks for the hub URL and the worker key. Or give them up front:
#
#   .\setup-worker.cmd https://<hub> <GMAP_WORKER_KEY>
#
# The key is the hub's HMAC key, not LAB_TOKEN (docs/CUTOVER.md says how to make it);
# this PC never needs LAB_TOKEN. Both workers use the same key. Optional switches go
# after them: -WorkerName pc-office-2, -SkipGmap, -SkipFetch, -NoAutostart.
#
# What it does, in order (safe to run again; existing settings are backed up to .old):
#   1. checks Node 24+ and Python 3.12, installing them with winget if missing
#   2. Gmap worker: builds <GmapDir> the way GmapWorker.zip is laid out, writes worker.env
#   3. Crawl4AI: venv + crawl4ai + Chromium in %USERPROFILE%\.local-fetch-worker, writes worker.env
#   4. starts the Crawl4AI supervisor, waits for /health, runs check.ts (reads real pages)
#   5. turns autostart on for both (starts at Windows sign-in) and starts the Gmap worker
#
# Windows PowerShell 5.1, ASCII only.
param(
  [Parameter(Position = 0)][string]$LabUrl = '',
  [Parameter(Position = 1)][string]$WorkerKey = '',
  [string]$WorkerName = ('pc-' + ($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '-')),
  [string]$GmapDir = 'C:\GmapWorker',
  [int]$Lanes = 1,
  [int]$PageConcurrency = 3,
  [switch]$SkipGmap,
  [switch]$SkipFetch,
  [switch]$NoAutostart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Here = $PSScriptRoot
$LocalWorker = Join-Path (Split-Path $Here -Parent) 'local-worker'
$Data = Join-Path $env:USERPROFILE '.local-fetch-worker'
function Say([string]$m) { Write-Host ('[setup] ' + $m) }
function Fail([string]$m) { Write-Host ('[setup] STOP: ' + $m) -ForegroundColor Red; exit 1 }

# Windows line endings and a BOM: 5.1 reads a BOM-less script as ANSI. Same as the hub's zip.
function Write-ForWindows([string]$Path, [string]$Text, [bool]$Bom) {
  $crlf = $Text -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($Path, $crlf, (New-Object Text.UTF8Encoding($Bom)))
}
function Backup([string]$Path) { if (Test-Path $Path) { Copy-Item $Path ($Path + '.old') -Force } }
function Read-EnvFile([string]$File) {
  $out = @{}
  if (-not (Test-Path $File)) { return $out }
  foreach ($line in Get-Content $File) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $out[$Matches[1]] = $Matches[2] }
  }
  return $out
}

# Asked for only when not given on the command line. Neither is committed: the repo is public.
if (-not $LabUrl) { $LabUrl = Read-Host 'Hub URL (the company-diver service address)' }
if (-not $WorkerKey) { $WorkerKey = Read-Host 'GMAP_WORKER_KEY (64 hex characters)' }
$LabUrl = $LabUrl.Trim().TrimEnd('/')
$WorkerKey = $WorkerKey.Trim()
if ($LabUrl -notmatch '^https?://') { Fail 'The hub URL must start with http:// or https://' }
if ($WorkerKey.Length -lt 32) { Fail 'The key looks too short; it is the 64-character hex HMAC, not a password' }

# ------------------------------------------------------------- 1. prerequisites

# A fresh PC has neither Node nor Python. winget installs them; this session's PATH
# does not see them until it is re-read from the registry.
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Install-Winget([string]$Id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail ('winget is missing; install ' + $Id + ' by hand, then run this again.') }
  Say ('installing ' + $Id + ' with winget')
  & winget install -e --id $Id --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
function Node-Major { if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }; return [int]((& node --version).TrimStart('v').Split('.')[0]) }

if ((Node-Major) -lt 24) { Install-Winget 'OpenJS.NodeJS.LTS' }
if ((Node-Major) -lt 24) { Fail 'Node 24 or newer is still not found. Close this window, open a new one and run this again.' }
Say ('node ' + (& node --version))

if (-not $SkipFetch) {
  $havePy = $false
  if (Get-Command py -ErrorAction SilentlyContinue) { & py -3.12 --version 2>$null; $havePy = ($LASTEXITCODE -eq 0) }
  if (-not $havePy) {
    Install-Winget 'Python.Python.3.12'
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Fail 'Python 3.12 is installed but py is not found yet. Close this window, open a new one and run this again.' }
    & py -3.12 --version
    if ($LASTEXITCODE -ne 0) { Fail 'Python 3.12 not found (py -3.12 failed). Close this window, open a new one and run this again.' }
  }
}

# ------------------------------------------------------------------ 2. Gmap worker

if (-not $SkipGmap) {
  foreach ($f in 'worker.ps1', 'Start Gmap Worker.cmd', 'Enable autostart.cmd', 'Disable autostart.cmd', 'README.txt') {
    if (-not (Test-Path (Join-Path $LocalWorker $f))) { Fail ('missing ' + (Join-Path $LocalWorker $f) + '; run this from a full checkout') }
  }
  Say ('Gmap worker -> ' + $GmapDir)
  New-Item -ItemType Directory -Force (Join-Path $GmapDir 'app') | Out-Null
  foreach ($f in 'Start Gmap Worker.cmd', 'Enable autostart.cmd', 'Disable autostart.cmd', 'README.txt') {
    Write-ForWindows (Join-Path $GmapDir $f) ([IO.File]::ReadAllText((Join-Path $LocalWorker $f))) $false
  }
  Write-ForWindows (Join-Path $GmapDir 'app\worker.ps1') ([IO.File]::ReadAllText((Join-Path $LocalWorker 'worker.ps1'))) $true

  $gmapEnv = Join-Path $GmapDir 'worker.env'
  Backup $gmapEnv
  $lines = @(
    '# Gmap Local Worker settings. Keep this file private: the key lets a PC take Maps jobs from the hub.',
    ('LAB_URL=' + $LabUrl),
    ('GMAP_WORKER_KEY=' + $WorkerKey),
    ('WORKER_NAME=' + $WorkerName)
  )
  Write-ForWindows $gmapEnv (($lines -join "`n") + "`n") $false
}

# ------------------------------------------------------------ 3. Crawl4AI worker

if (-not $SkipFetch) {
  foreach ($f in 'crawl4ai_server.py', 'worker.ts', 'check.ts', 'start-windows.ps1') {
    if (-not (Test-Path (Join-Path $Here $f))) { Fail ('missing ' + (Join-Path $Here $f)) }
  }
  Say ('Crawl4AI worker -> ' + $Data)
  New-Item -ItemType Directory -Force $Data | Out-Null
  $venvPy = Join-Path $Data 'venv\Scripts\python.exe'
  if (-not (Test-Path $venvPy)) {
    Say 'creating the Python venv'
    & py -3.12 -m venv (Join-Path $Data 'venv')
    if ($LASTEXITCODE -ne 0) { Fail 'venv creation failed' }
  }
  Say 'installing crawl4ai (a few minutes)'
  & $venvPy -m pip install --disable-pip-version-check --quiet crawl4ai
  if ($LASTEXITCODE -ne 0) { Fail 'pip install crawl4ai failed' }
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Data 'ms-playwright'
  Say 'installing Chromium (about 1 GB)'
  & $venvPy -m playwright install chromium
  if ($LASTEXITCODE -ne 0) { Fail 'playwright install chromium failed' }

  $fetchEnv = Join-Path $Data 'worker.env'
  $old = Read-EnvFile $fetchEnv
  # Keep an existing token: the running server was started with it.
  $token = $old['CRAWL4AI_TOKEN']
  if (-not $token) {
    $bytes = New-Object byte[] 32
    (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
    $token = (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
  }
  Backup $fetchEnv
  $lines = @(
    '# Local Fetch Worker on this PC. Keep private: the key takes jobs from the hub.',
    ('LAB_URL=' + $LabUrl),
    ('GMAP_WORKER_KEY=' + $WorkerKey),
    'CRAWL4AI_URL=http://127.0.0.1:11235',
    ('CRAWL4AI_TOKEN=' + $token),
    ('WORKER_NAME=' + $WorkerName + '-fetch'),
    ('LANES=' + $Lanes),
    ('PAGE_CONCURRENCY=' + $PageConcurrency)
  )
  Write-ForWindows $fetchEnv (($lines -join "`n") + "`n") $false

  # ---------------------------------------------------------- 4. start and prove
  $supervisor = Join-Path $Here 'start-windows.ps1'
  Say 'starting Crawl4AI and the bridge (hidden)'
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $supervisor + '"')
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    Start-Sleep -Seconds 3
    try { $up = (Invoke-WebRequest 'http://127.0.0.1:11235/health' -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { }
  }
  if (-not $up) { Fail ('Crawl4AI did not answer /health in 3 minutes. Read ' + (Join-Path $Data 'server.err.log')) }
  Say 'Crawl4AI is up; reading 4 real pages (the first is slow, about 12 s)'
  & node (Join-Path $Here 'check.ts')
  if ($LASTEXITCODE -ne 0) { Fail ('no page could be read. Read ' + (Join-Path $Data 'server.err.log')) }

  if (-not $NoAutostart) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $supervisor -Autostart on
  }
}

# ---------------------------------------------------------------- 5. Gmap start

if (-not $SkipGmap) {
  $gmapScript = Join-Path $GmapDir 'app\worker.ps1'
  if (-not $NoAutostart) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $gmapScript -Autostart on
  }
  Say 'starting the Gmap worker (hidden)'
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $gmapScript + '"')
  Start-Sleep -Seconds 10
  $gmapLog = Join-Path $env:LOCALAPPDATA 'GmapWorker\worker.log'
  if (Test-Path $gmapLog) { Say 'Gmap worker log (last lines):'; Get-Content $gmapLog -Tail 5 }
}

Write-Host ''
Say 'done. Now check the hub lists this PC with a recent check-in:'
Write-Host ('  curl -s ' + $LabUrl + '/api/jobs -H "authorization: Bearer <LAB_TOKEN>"')
Write-Host '  A "refused this worker''s key" line in the Gmap log means the key is wrong.'
Write-Host '  Autostart runs at Windows sign-in: turn on auto-login and set sleep to Never on AC power.'
Write-Host ('  Logs: ' + (Join-Path $env:LOCALAPPDATA 'GmapWorker\worker.log') + ' and ' + (Join-Path $Data 'worker.log'))
