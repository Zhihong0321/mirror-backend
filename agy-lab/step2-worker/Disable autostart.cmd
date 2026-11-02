@echo off
powershell.exe -NoProfile -Command "$l=[Environment]::GetFolderPath('Startup')+'\Step 2 Worker.lnk'; if (Test-Path $l) { Remove-Item $l -Force }; Write-Host 'Autostart is off.'"
pause
