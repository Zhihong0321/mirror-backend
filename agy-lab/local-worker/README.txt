GMAP LOCAL WORKER
=================

Turns this Windows PC into a Google Maps scan worker for the EE Auto hub.
The hub hands it a Maps job (for example "business in Taman Daya"), the PC
reads the businesses from Google Maps on its own internet line, and posts them
back. The scans are free: they do not use the scraper.tech budget.

START
  1. Unzip this folder somewhere it can stay (for example C:\GmapWorker).
  2. Double-click "Start Gmap Worker.cmd". A window opens and shows what the
     worker is doing. If Windows asks whether to run the file, choose Run.
  3. Double-click "Enable autostart.cmd" so the worker starts by itself each
     time you sign in to Windows. "Disable autostart.cmd" undoes it.

NEEDS
  Windows 10 or 11. Nothing to install and no browser: it uses Windows
  PowerShell, which Windows already has, and almost no memory.

HOW IT WORKS
  Google Maps fills its result list from pages of 20 businesses, each with its
  phone, website, address, rating, category and Google place id. The worker
  reads those pages directly, one after another, half a second apart. The
  field positions come from gosom/google-maps-scraper (MIT licence).

  For each job it runs the hub's sweep: "<word> in <place>" for each word of
  the keyword's family, pinned to the place on the map, then, for a Business
  scan, "shop in <street>" and "company in <street>" for the streets it found.
  It stops at the hub's deadline and posts what it has.

  If Google refuses this line, the worker posts what it found, rests for 30
  minutes, and the hub gives its jobs to its other workers meanwhile. It keeps
  the PC awake only while a job runs.

SETTINGS (worker.env)
  LAB_URL            the hub
  GMAP_WORKER_KEY    this worker's key. It can only take Maps jobs.
  WORKER_NAME        optional; default pc-<computer name>
  GMAP_PACE_MS       optional; pause between Google requests, default 500

FILES ON THIS PC
  %LOCALAPPDATA%\GmapWorker\worker.log   what the worker did
  %LOCALAPPDATA%\GmapWorker\unsaved\     results the hub could not take
