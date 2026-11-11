// usage: node dive-run.mjs <concurrency> [Country ...]   (no countries = all of picks.json)
import fs from 'node:fs';
const U = 'https://company-diver-production.up.railway.app';
const T = fs.readFileSync('.env', 'utf8').match(/^LAB_TOKEN=(.*)$/m)[1].trim();
const H = { authorization: 'Bearer ' + T, 'content-type': 'application/json' };
const picks = JSON.parse(fs.readFileSync('picks.json', 'utf8'));
const conc = Number(process.argv[2] || 3);
const want = process.argv.slice(3);
const todo = picks.filter((p) => !want.length || want.includes(p.country));
const out = fs.existsSync((process.env.RES || 'dive-results.json')) ? JSON.parse(fs.readFileSync((process.env.RES || 'dive-results.json'), 'utf8')) : {};
const save = () => fs.writeFileSync((process.env.RES || 'dive-results.json'), JSON.stringify(out, null, 1));
const call = async (m, p, b) => { const r = await fetch(U + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return j; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(path, label, max = 90) {
  for (let i = 0; i < max * 6; i++) {
    await sleep(10_000);
    const j = await call('GET', path);
    if (['done', 'failed', 'error', 'partial'].includes(j.status)) return j;
  }
  return { status: 'timeout' };
}
async function one(p) {
  const rec = out[p.country] = out[p.country] || { company: p.name, website: p.website };
  try {
    if (!rec.dive_id) { const d = await call('POST', '/api/company-dive', { company: p.name + ' (' + p.website + ')', country: p.country }); rec.dive_id = d.id; rec.dive_public = d.public_id; rec.dive_link = d.report_url || d.url || d.links; save(); }
    const d = await poll('/api/company-dive/' + rec.dive_id); rec.dive_status = d.status; rec.dive_error = d.error || null; rec.dive_cost = d.cost?.total ?? d.cost; save();
    if (d.status === 'failed') return;
    if (!rec.deeper_id) { const e = await call('POST', '/api/dive-deeper', { dive_id: rec.dive_id }); rec.deeper_id = e.id; rec.deeper_public = e.public_id; rec.deeper_link = e.report_url || e.url || e.links; save(); }
    const e = await poll('/api/dive-deeper/' + rec.deeper_id, '', 120); rec.deeper_status = e.status; rec.deeper_error = e.error || null; rec.deeper_cost = e.cost?.total ?? e.cost; save();
  } catch (err) { rec.error = err.message; save(); }
  console.log(p.country, rec.dive_status, rec.deeper_status, rec.error || '');
}
let i = 0;
await Promise.all(Array.from({ length: conc }, async () => { while (i < todo.length) await one(todo[i++]); }));
console.log('all done');
