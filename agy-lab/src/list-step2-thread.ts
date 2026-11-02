// One step-2 lead read off the main thread (list-step2.ts makeReader): the
// website's pages are parsed here, so a freak page stalls this thread and never
// the hub's web server or a worker's loop.
import { parentPort } from 'node:worker_threads';
import { processLead, DEFAULT_DEPS } from './list-step2.ts';

parentPort!.on('message', (lead) => {
  processLead(lead, DEFAULT_DEPS).then(
    (result) => parentPort!.postMessage({ result }),
    (err: Error) => parentPort!.postMessage({ error: err?.message ?? String(err) }),
  );
});
