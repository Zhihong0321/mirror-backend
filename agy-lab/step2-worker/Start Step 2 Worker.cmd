@echo off
rem Step 2 Worker: list processing step 2 on this PC. Restarts itself if it ever stops.
title Step 2 Worker
cd /d "%~dp0"
:run
node worker.ts
if errorlevel 2 if not errorlevel 3 goto done
echo The worker stopped. Restarting in 15 seconds...
timeout /t 15 /nobreak >nul
goto run
:done
pause
