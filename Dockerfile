# agy-lab: the research hub. Runs the Pi worker (MiniMax, through the Pi SDK in
# package.json) and contact research.
#
# Lives at the repo root, not next to the app it builds. Railway's builder looks
# for a Dockerfile at the root of the build context and falls back to language
# autodetection when it finds none — which is how a Dockerfile one directory down
# gets silently ignored and the deploy fails claiming it cannot tell what the app
# is. Keeping it here means the service needs no Root Directory setting to work.
#
# Chrome, Xvfb and the browser fonts went with the ChatGPT and Meta AI engines on
# 2026-10-26. The old browser profiles under /data/profiles are inert; delete
# them from the volume when convenient.
#
# Debian's headless Chromium came back on 2026-10-28 for one job: the dive-deeper
# editor's proof screenshots of a client's own pages (src/divedeeper/shots.ts, via
# puppeteer-core). One browser per report, closed after its few shots.
FROM node:24-slim

# curl, git, less, procps, util-linux - for the /api/exec shell
# chromium, fonts-* - proof screenshots; without CJK fonts Chinese pages render as boxes
# tini - a real init. Without one, node is PID 1, and PID 1 must reap orphaned
#        children; anything /api/exec spawns and abandons would pile up as zombies.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates util-linux procps git less tini \
      chromium fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# HOME is the volume mount point. Pi's working folder lives under $HOME/.pi-lab:
# one volume, one persistence story.
ENV HOME=/data \
    PATH=/data/.local/bin:/usr/local/bin:/usr/bin:/bin \
    NODE_ENV=production
RUN mkdir -p /data

WORKDIR /app
COPY agy-lab/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY agy-lab/src ./src
# The Gmap Local Worker package, zipped on download by src/gmap-worker.ts.
COPY agy-lab/local-worker ./local-worker

EXPOSE 8080
# tini forwards signals, so SIGTERM on a redeploy still reaches the app.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.ts"]
