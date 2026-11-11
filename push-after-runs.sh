#!/bin/bash
cd /g/company-diver
T=$(grep '^LAB_TOKEN=' .env | cut -d= -f2); U=https://company-diver-production.up.railway.app
while true; do
  s7=$(curl -s -m 20 $U/api/dive-deeper/7 -H "Authorization: Bearer $T" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).status)}catch{console.log('err')}})")
  s8=$(curl -s -m 20 $U/api/dive-deeper/8 -H "Authorization: Bearer $T" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).status)}catch{console.log('err')}})")
  echo "$(date +%H:%M:%S) 7=$s7 8=$s8"
  case "$s7" in done|partial|failed) case "$s8" in done|partial|failed) break;; esac;; esac
  sleep 30
done
FILES="agy-lab/src/cost.ts agy-lab/src/cost.test.ts agy-lab/src/companydive.ts agy-lab/src/divedeeper.ts agy-lab/src/divedeeper/lib.ts agy-lab/src/divedeeper/sections/B-brand.ts agy-lab/src/divedeeper/sections/S2-consult.ts agy-lab/src/company-uid.ts agy-lab/src/company-page.ts agy-lab/src/nav.ts agy-lab/src/nav.test.ts agy-lab/src/server.ts"
git add $FILES && git commit -q -m "feat: every report belongs to a company UID; /companies/<uid> lists all its dives and deeper dives; fetch-worker page reads get their own cost line" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- $FILES && git push -q && echo "PUSHED $(git log --oneline | head -1)"
