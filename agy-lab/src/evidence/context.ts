// The report a call belongs to, carried on Node's async context.
// A run sets it once. step() names a child (people, a lane) on a copy,
// so the parent context is left as it was. No enterWith.
import { AsyncLocalStorage } from 'node:async_hooks';

export type ReportCtx = {
  reportUid: string;
  parentReportUid: string | null;
  kind: 'company_dive' | 'dive_deeper' | 'preview';
  step: string;
  weight: number;
  on: boolean;
};

const storage = new AsyncLocalStorage<ReportCtx>();

/**
 * Run `fn` under `ctx`. If the context cannot be set up, `fn` still runs,
 * and nothing is recorded for it.
 */
export function runWithReport<T>(ctx: ReportCtx, fn: () => Promise<T>): Promise<T> {
  let started = false;
  try {
    return storage.run(ctx, () => {
      started = true;
      return fn();
    });
  } catch (err) {
    if (started) throw err;
    return fn();
  }
}

/** `fn` sees the same report with `step` set to `name`. Does not write the parent. */
export function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  let parent: ReportCtx | undefined;
  try { parent = storage.getStore(); } catch { return fn(); }
  if (!parent) return fn();
  let started = false;
  try {
    return storage.run({ ...parent, step: name }, () => {
      started = true;
      return fn();
    });
  } catch (err) {
    if (started) throw err;
    return fn();
  }
}

export function current(): ReportCtx | undefined {
  try { return storage.getStore(); } catch { return undefined; }
}

/** True when this call sits in a report whose evidence switch is on. One store read. */
export function evidenceActive(): boolean {
  return current()?.on === true;
}
