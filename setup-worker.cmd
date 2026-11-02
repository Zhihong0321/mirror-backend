@echo off
rem Sets this PC up as a hub worker (Gmap scan + Crawl4AI page fetch). Run after `git pull`.
rem Optional: setup-worker.cmd <hub-url> <worker-key> [-WorkerName pc-1]
title Worker setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agy-lab\local-fetch-worker\setup-windows.ps1" %*
pause
