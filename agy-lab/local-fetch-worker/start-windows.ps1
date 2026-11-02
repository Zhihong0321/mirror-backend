# Local Fetch Worker on a Windows PC: keeps Crawl4AI (crawl4ai_server.py) and
# the hub bridge (worker.ts, the same file the Mac mini runs) up, restarting
# either one that stops. Runs from the repo checkout; restart it after a
# `git pull` that changes either file.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-windows.ps1              run it
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-windows.ps1 -Autostart on  start it, hidden, at every sign-in
#
# Everything lives in %USERPROFILE%\.local-fetch-worker, outside AppData on
# purpose: a process in the Claude app's container sees its own private copy of
# AppData, so files kept there are not the files this worker reads.
#   worker.env     LAB_URL, GMAP_WORKER_KEY, CRAWL4AI_TOKEN, WORKER_NAME, LANES, PAGE_CONCURRENCY
#   venv\          Python with crawl4ai;  ms-playwright\  its Chromium
#   worker.log     the bridge's own log;  server.log  Crawl4AI;  supervisor.log  this script
#
# Windows PowerShell 5.1, ASCII only.
param([ValidateSet('on', 'off', '')][string]$Autostart = '')

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Data = Join-Path $env:USERPROFILE '.local-fetch-worker'
$LogFile = Join-Path $Data 'supervisor.log'

function Log([string]$Message) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
}

if ($Autostart) {
  $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Local Fetch Worker.lnk'
  if ($Autostart -eq 'on') {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    $shortcut.WorkingDirectory = $Here
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Local Fetch Worker'
    $shortcut.Save()
    Write-Host "Autostart is on: $link"
  } else {
    if (Test-Path $link) { Remove-Item $link -Force }
    Write-Host 'Autostart is off.'
  }
  exit 0
}

$mutex = New-Object Threading.Mutex($false, 'Local\LocalFetchWorker')
if (-not $mutex.WaitOne(0)) { Write-Host 'The Local Fetch Worker is already running.'; exit 2 }

$cfg = @{}
foreach ($line in Get-Content (Join-Path $Data 'worker.env')) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2] }
}
if (-not $cfg['CRAWL4AI_TOKEN']) { Log 'worker.env has no CRAWL4AI_TOKEN; not starting an open page fetcher'; exit 2 }
$env:CRAWL4AI_TOKEN = $cfg['CRAWL4AI_TOKEN']
if ($cfg['CRAWL4AI_URL'] -match ':(\d+)/?$') { $env:CRAWL4AI_PORT = $Matches[1] }
# Chromium tabs Crawl4AI keeps open: every lane's pages at once.
$lanes = if ($cfg['LANES']) { [int]$cfg['LANES'] } else { 2 }
$perJob = if ($cfg['PAGE_CONCURRENCY']) { [int]$cfg['PAGE_CONCURRENCY'] } else { 4 }
$env:CRAWL4AI_SLOTS = [string]($lanes * $perJob)
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Data 'ms-playwright'
$env:PYTHONUTF8 = '1'

$python = Join-Path $Data 'venv\Scripts\python.exe'
$node = (Get-Command node).Source
$server = Join-Path $Here 'crawl4ai_server.py'
$worker = Join-Path $Here 'worker.ts'

# A supervisor that died leaves its children running; a second Crawl4AI could
# not bind the port and would restart forever.
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains($server) -or $_.CommandLine.Contains($worker))
} | ForEach-Object { Log "stopping a leftover $($_.Name) $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

function Start-Server {
  Start-Process -FilePath $python -ArgumentList ('"' + $server + '"') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Data 'server.log') -RedirectStandardError (Join-Path $Data 'server.err.log')
}
function Start-Bridge {
  Start-Process -FilePath $node -ArgumentList ('"' + $worker + '"') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Data 'worker.out.log') -RedirectStandardError (Join-Path $Data 'worker.err.log')
}

Log "Local Fetch Worker: crawl4ai on port $($env:CRAWL4AI_PORT), $($env:CRAWL4AI_SLOTS) pages at once, bridge $worker"
$c4a = Start-Server
$bridge = Start-Bridge
while ($true) {
  Start-Sleep -Seconds 15
  # A process that stops straight after starting (a bad token, a taken port)
  # would otherwise restart four times a minute; a minute apart is enough.
  if ($c4a.HasExited) { Log "crawl4ai stopped (exit $($c4a.ExitCode)); restarting in 60 s"; Start-Sleep -Seconds 60; $c4a = Start-Server }
  if ($bridge.HasExited) { Log "the bridge stopped (exit $($bridge.ExitCode)); restarting in 60 s"; Start-Sleep -Seconds 60; $bridge = Start-Bridge }
}
