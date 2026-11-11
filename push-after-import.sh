#!/bin/bash
cd /g/company-diver
while true; do
  p=$(timeout 60 railway ssh --service company-diver -- "pgrep -f import-from-pg2nd | head -1" 2>/dev/null | grep -E '^[0-9]+$')
  echo "$(date +%H:%M:%S) import pid: ${p:-none}"
  [ -z "$p" ] && break
  sleep 60
done
timeout 60 railway ssh --service company-diver -- "tr '\r' '\n' < /data/import-leads2.log | grep -E 'MISMATCH|All counts|error' | tail -5" 2>&1 | grep -v -i "config as\|migrate\b.*railway\|Existing\|SSH key"
FILES="agy-lab/src/core/brave.ts agy-lab/src/core/exa.ts agy-lab/src/core/llm.ts agy-lab/src/core/maps.ts agy-lab/src/core/tavily.ts agy-lab/src/core/neterr.ts agy-lab/src/core/maps.test.ts agy-lab/src/divedeeper/sections/E-maps.ts agy-lab/src/maps-worker.ts agy-lab/scripts/count-tables.ts"
git add $FILES && git commit -q -m "fix: a scraper.tech error answer is a failure, not an empty result; lanes no longer report 'no listing' when Maps could not be searched; failed fetches name their real cause" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- $FILES && git push -q && echo "PUSHED $(git log --oneline | head -1)"
