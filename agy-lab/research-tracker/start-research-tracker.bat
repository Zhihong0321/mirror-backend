@echo off
rem Starts the research tracker on this PC and opens it in the browser.
rem Keep this window open while you use it. Closing it stops the server.
cd /d "%~dp0\.."
echo Research tracker: http://127.0.0.1:4777
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:4777"
node research-tracker\server.mjs
pause
