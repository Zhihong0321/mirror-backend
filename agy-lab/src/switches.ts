// ---------------------------------------------------------------- switches
// Per-run feature switches: stored on the run's options, parsed on input,
// and checked by owning modules. OVERHAUL_SWITCHES_OFF disables every switch.

export type SwitchOptions = { switches?: string[] };

const SWITCH_NAME_RE = /^[a-z][a-z0-9_]*$/;
const GLOBAL_OFF_RE = /^(1|true|on|yes)$/i;

/** Parses a switches input. Missing value returns []; anything else must be an array (null throws). Throws TypeError on invalid input. */
export function parseSwitches(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('switches must be an array of strings');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !SWITCH_NAME_RE.test(item)) {
      throw new TypeError(`invalid switch name: ${String(item)}`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/** True when the named switch is present on options and global off is inactive. */
export function switchOn(options: SwitchOptions | null | undefined, name: string, env?: NodeJS.ProcessEnv): boolean {
  const e = env ?? process.env;
  if (GLOBAL_OFF_RE.test(String(e.OVERHAUL_SWITCHES_OFF ?? '').trim())) return false;
  if (!options || typeof options !== 'object') return false;
  // A stored list that is not all valid names is malformed: fail closed for every switch.
  const list: unknown = options.switches;
  if (!Array.isArray(list) || !list.every((s) => typeof s === 'string' && SWITCH_NAME_RE.test(s))) return false;
  return list.includes(name);
}
