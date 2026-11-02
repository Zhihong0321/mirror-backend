@echo off
rem Starts the Step 2 Worker, minimised, every time you sign in to Windows.
powershell.exe -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Step 2 Worker.lnk'); $s.TargetPath='%~dp0Start Step 2 Worker.cmd'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Step 2 Worker'; $s.Save(); Write-Host 'Autostart is on.'"
pause
