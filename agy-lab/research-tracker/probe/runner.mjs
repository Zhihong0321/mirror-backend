// Runs ONE handler once, the way the worker PC does: its own Node process, --permission (no file or child-process
// access), --use-system-ca, an empty environment. Prints the handler's answer as one JSON line. Never throws.
//   node --permission --use-system-ca --allow-fs-read=<this file> --allow-fs-read=<handler> runner.mjs <handler.mjs> "<keyword>"
import { pathToFileURL } from 'node:url';

const [file, keyword] = process.argv.slice(2);
const answer = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
setTimeout(() => answer({ status: 'couldnt_check', reason: 'timeout', records: [], source_url: '', excerpt: 'the handler did not finish in 60 s' }), 60_000).unref();
try {
  const mod = await import(pathToFileURL(file).href);
  answer(await mod.default(keyword));
} catch (e) {
  answer({ status: 'couldnt_check', reason: 'other', records: [], source_url: '', excerpt: 'the handler threw: ' + String(e).slice(0, 300) });
}
