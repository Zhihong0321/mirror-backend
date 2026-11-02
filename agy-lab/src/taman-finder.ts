// Finds tamans the hand-built territory list misses, one town at a time, from
// address evidence.
//
// A real taman is named in the address of many places: "12, Jalan Hulubalang,
// Taman Dawani, 81400 Senai". A private house that someone filed on Google Maps
// as a "Housing complex" is not. So the finder reads addresses, never place
// names: seven Google Maps list searches in the town plus every saved lead whose
// address names it, then keeps an area name only when at least MIN_ADDRESSES
// different addresses in this town carry it and the daerah does not list it yet.
// (The first version trusted Maps' housing categories and Tavily snippets; on
// Senai 95 of its 115 "verified" names were houses, rooms and house numbers.)
//
// It runs from a person's machine, not in the hub: Maps answers vary from run to
// run, so each town's result is read and approved by hand before anything is
// saved (agy-lab/scripts/find-tamans.ts). A saved town is a row in
// taman_finder_town, so a town is checked once.
import * as db from './reportdb.ts';
import { ALL_TERRITORIES, type DistrictLocation, type StateTerritory, type TownLocation } from './territories.ts';

/** Different addresses in the town that must name an area before it counts. */
export const MIN_ADDRESSES = 2;

const AREA = /^(taman|tmn|bandar|bdr|kampung|kg|desa)\.?\s+\S/i;
const PREFIX = /^(taman|tmn|bandar|bdr|desa|kampung|kg)\b[\s.]*/;

/**
 * Compare key for an area name. Brackets, the area word, spaces and punctuation
 * go, and Seri is Sri: "Tmn. Seri Senai" and "Taman Sri Senai" are one name,
 * and "Bandar Putra Kulai (IOI)" is "Bandar Putra Kulai".
 */
export function tamanKey(name: string): string {
  const lower = String(name ?? '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\bseri\b/g, 'sri').trim();
  const stripped = lower.replace(PREFIX, '').replace(/[^a-z0-9]+/g, '');
  return stripped || lower.replace(/[^a-z0-9]+/g, '');
}

/** The key with a trailing town name dropped: "Taman Bintang Senai" in Senai is "bintang". */
function bareKey(name: string, town: string): string {
  const key = tamanKey(name);
  const t = tamanKey(town);
  return t && key.endsWith(t) && key.length > t.length ? key.slice(0, -t.length) : key;
}

/** Words too common to name one taman on their own: "Kampung Baru", "Taman Jaya". */
const GENERIC = new Set(['baru', 'jaya', 'indah', 'utama', 'perdana', 'permai', 'mewah', 'murni', 'sentosa', 'bahagia', 'damai', 'sri', 'perindustrian']);

/**
 * Every name the daerah already lists. A listed name without its town ("Taman
 * Bintang Senai" as "bintang") counts only inside that same town, so "Kampung
 * Baru Sedenak" cannot hide "Kampung Baru Senai".
 */
export function knownKeys(district: DistrictLocation, inTown?: string): Set<string> {
  const keys = new Set<string>();
  for (const town of district.towns) {
    keys.add(tamanKey(town.name));
    for (const taman of town.tamans) {
      keys.add(tamanKey(taman.name));
      const bare = bareKey(taman.name, town.name);
      if (!inTown || tamanKey(inTown) === tamanKey(town.name)) keys.add(bare);
    }
  }
  keys.delete('');
  return keys;
}

/**
 * Maps list searches for a town: residential areas, and businesses whose
 * addresses name them. Google returns a different slice each time: four
 * searches gave Senai 288 to 494 addresses, seven gave 608 and twice the names.
 * ("restaurant" gave Senai no address that names a taman.)
 */
export function mapsQueries(townPlace: string): string[] {
  return ['taman', 'housing estate', 'shop', 'company', 'factory', 'kedai', 'services'].map((w) => `${w} in ${townPlace}`);
}

/**
 * The area names an address gives, when the address is in this town: its
 * "NNNNN Town" part names the town, or with no postcode part, it names the town
 * anywhere. Parts with a road word, a postcode, a second address or non-Latin
 * text are not area names.
 */
export function areasIn(address: string, town: string): string[] {
  const parts = String(address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const post = parts.find((p) => /^\d{5}\s+\S/.test(p));
  const townKey = tamanKey(town);
  const inTown = post
    ? tamanKey(post.replace(/^\d{5}\s+/, '')) === townKey
    : parts.some((p) => tamanKey(p) === townKey);
  if (!inTown) return [];
  return parts
    .filter((p) => AREA.test(p) && p.length <= 50 && !/\d{5}|[^\x20-\x7e]|\b(jalan|jln|lorong|lrg|persiaran)\b/i.test(p))
    .map((p) => p.replace(/\s+/g, ' '));
}

export type Evidence = { key: string; name: string; addresses: number; sample: string };

/** Count, per area name, the different addresses in the town that carry it. */
export function countEvidence(addresses: string[], town: string): Evidence[] {
  const byKey = new Map<string, { names: Map<string, number>; addresses: Set<string>; sample: string }>();
  for (const address of new Set(addresses.map((a) => String(a ?? '').trim()).filter(Boolean))) {
    for (const name of new Set(areasIn(address, town))) {
      const key = tamanKey(name);
      if (key.length < 3) continue;
      const e = byKey.get(key) ?? { names: new Map(), addresses: new Set(), sample: address };
      e.names.set(name, (e.names.get(name) ?? 0) + 1);
      e.addresses.add(address);
      byKey.set(key, e);
    }
  }
  return [...byKey.entries()].map(([key, e]) => ({
    key,
    // The spelling most addresses use.
    name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    addresses: e.addresses.size,
    sample: e.sample,
  })).sort((a, b) => b.addresses - a.addresses);
}

type MapsRow = { full_address?: unknown };

export type Deps = {
  maps: ((query: string) => Promise<MapsRow[]>) | null;
  leadAddresses: (town: string) => Promise<string[]>;
  save: (rows: Array<db.DiscoveredTaman & { name_key: string }>) => Promise<number>;
  record: (run: db.FinderTownRun) => Promise<boolean>;
  log: (message: string) => void;
};

export type TownOutcome = db.FinderTownRun & {
  found: Evidence[];
  listed: Evidence[];
  thin: Evidence[];
  vague: Evidence[];
};

/** Check one town: read its addresses, keep the well-evidenced unlisted names, save and record. */
export async function runTown(
  state: StateTerritory, district: DistrictLocation, town: TownLocation, deps: Deps,
): Promise<TownOutcome> {
  const startedAt = new Date().toISOString();
  let mapsRequests = 0;
  const failures: string[] = [];
  const addresses: string[] = [];
  const queries = deps.maps ? mapsQueries(town.queryPlace) : [];
  for (const q of queries) {
    // A dropped connection or a "failed" answer gets one more try.
    let last: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      mapsRequests++;
      try {
        for (const row of await deps.maps!(q)) if (typeof row.full_address === 'string') addresses.push(row.full_address);
        last = null;
        break;
      } catch (cause) {
        last = cause;
      }
    }
    if (last) failures.push(`${q}: ${(last as Error)?.message ?? last}`.slice(0, 200));
  }
  const failedSearches = failures.length;
  let leadCount = 0;
  try {
    const leads = await deps.leadAddresses(town.name);
    leadCount = leads.length;
    addresses.push(...leads);
  } catch (cause) {
    failures.push(`saved leads: ${(cause as Error)?.message ?? cause}`.slice(0, 200));
  }

  const known = knownKeys(district, town.name);
  const evidence = countEvidence(addresses, town.name);
  const isListed = (e: Evidence) => known.has(e.key) || known.has(bareKey(e.name, town.name));
  const isVague = (e: Evidence) => e.key.length < 4 || GENERIC.has(e.key);
  const listed = evidence.filter(isListed);
  const vague = evidence.filter((e) => !isListed(e) && isVague(e));
  const thin = evidence.filter((e) => !isListed(e) && !isVague(e) && e.addresses < MIN_ADDRESSES);
  const found = evidence.filter((e) => !isListed(e) && !isVague(e) && e.addresses >= MIN_ADDRESSES);

  // More than half the searches failed: the evidence is too thin to call the town
  // checked. It is recorded failed, still once, so it shows in the status page
  // instead of passing for a town with nothing new.
  const failed = queries.length > 0 && failedSearches * 2 > queries.length;
  const rows = found.map((e) => ({
    state: state.state, district: district.name, name: e.name, name_key: e.key,
    query_place: `${e.name}, ${town.name}, ${state.state}`,
    evidence_url: `named in ${e.addresses} addresses in ${town.name}`, maps_name: null, maps_address: e.sample, verified: true,
  }));
  const added = failed ? 0 : await deps.save(rows);
  const run: TownOutcome = {
    state: state.state, district: district.name, town: town.name, status: failed ? 'failed' : 'done', started_at: startedAt,
    maps_requests: mapsRequests, addresses_read: new Set(addresses).size, names_seen: evidence.length, added,
    detail: {
      added: found.map((e) => ({ name: e.name, addresses: e.addresses })),
      alreadyListed: listed.map((e) => e.name),
      tooVague: vague.map((e) => e.name),
      tooFewAddresses: thin.map((e) => e.name),
      leadAddresses: leadCount,
      failures,
    },
    error: failures.length ? failures.join(' | ').slice(0, 1000) : null,
    found, listed, thin, vague,
  };
  await deps.record(run);
  deps.log(`[taman-finder] ${state.state} / ${district.name} / ${town.name}: ${run.status}, ${run.addresses_read} addresses, `
    + `${evidence.length} area names, ${found.length} new (${listed.length} listed, ${thin.length} with one address)`);
  return run;
}

type TownRef = { state: StateTerritory; district: DistrictLocation; town: TownLocation };

export const townId = (state: string, district: string, town: string): string =>
  [state, district, town].map((s) => s.trim().toLowerCase()).join('|');

/**
 * Towns not checked yet, spread evenly over the daerah: the next comes from the
 * daerah with the fewest towns checked so far (list order breaks a tie).
 */
export function pendingTowns(done: Set<string>, states: string[], territories: Record<string, StateTerritory> = ALL_TERRITORIES): TownRef[] {
  const groups: Array<{ checked: number; left: TownRef[] }> = [];
  for (const key of states) {
    const state = territories[key.toLowerCase()];
    if (!state) continue;
    for (const district of state.districts) {
      const g = { checked: 0, left: [] as TownRef[] };
      for (const town of district.towns) {
        if (done.has(townId(state.state, district.name, town.name))) g.checked++; else g.left.push({ state, district, town });
      }
      groups.push(g);
    }
  }
  const out: TownRef[] = [];
  for (;;) {
    let pick: (typeof groups)[number] | null = null;
    for (const g of groups) if (g.left.length && (!pick || g.checked < pick.checked)) pick = g;
    if (!pick) return out;
    out.push(pick.left.shift()!);
    pick.checked++;
  }
}
