# T8: Identity anchors (R3)

**Status: draft for the owner's approval.** Part of T5. Needs T1, T6 and T7. **Builder:** codex. **Reviewer:** grok.

The dive starts with the lead's known identity and category, and triage checks them against research instead of guessing from a name. A company can have several identifiers and resolve to one UID. Existing duplicate UIDs are not merged by this task.

**Owned files:** `agy-lab/src/company-uid.ts`, `agy-lab/src/company-page.ts`, `agy-lab/src/companydive/pipeline.ts`, `agy-lab/src/companydive/http.ts`, `agy-lab/src/companydive/runner.ts`, and the options type in `agy-lab/src/companydive/store.ts`.

**Switch:** `identity` in the run's `options.switches`, subject to T6's global off setting. No identifier writes when off.
The Run POST keeps today's exact shape unless this run's options include `identity` and the switch is effective.
`GET /api/companies/:uid` has no run behind it, so it gets its own explicit opt-in: it returns the listing anchors only
for `?identity=1`, and otherwise today's exact JSON. The page sends `?identity=1` only while its new "use the lead's
anchors" control is checked; **that control defaults to unchecked**, and T6's global off hides it.

## Interface

| Where | What |
|---|---|
| `company_identifier` | `uid text not null references company(uid)`; `kind text not null check (kind in ('registration_number','place_id','domain','phone'))`; `value text not null`; primary key `(kind, value)`; index on `(uid)`. Create only on the switched path. Keep existing tables and data. |
| Lead anchors | `{ place_id?: string; website?: string; phone?: string; address?: string; category?: string; registration_number?: string }`. Missing values stay absent. Name and country remain run inputs. Listings do not currently supply registration numbers. |
| Resolution | Match normalized identifiers in strength order: registration number, place id, domain, phone. Use `companyDomain` for domains, excluding shared hosts; DNS alone is not ownership. Reuse existing `company_place` and `company.domain` mappings when no identifier row exists. An explicit UID must exist and agree with matched identifiers. Leave existing `resolve()` unchanged. |
| Conflicts | If supplied identifiers or legacy mappings point to different UIDs, return a conflict with the candidates; do not select one, attach identifiers, create a UID, or merge. Never silently fall back. |
| New identifiers | Attach only supplied lead identifiers or identifiers confirmed by evidence. Canonicalize phone to E.164 using `libphonenumber-js`, without guessing an ambiguous country code; canonicalize registration numbers to uppercase letters and digits only. Do not store a kind without a valid canonical form. A new UID may be created when at least one usable identifier is available and none matches. Insert the company and identifiers atomically; never reassign an existing identifier. |
| Triage | Pass all known anchors and the Maps category to triage as supplied lead data. Keep confirmation, conflict and unknown distinct; do not promote a model assertion or a resolving social domain to a confirmed identifier. Preserve category in the switched result for later industry selection. If the lead site is dead or evidence conflicts, record uncertainty; do not substitute an unrelated live domain. |

**Exports:**

- `resolveAnchors(input: { uid?: string; anchors: Anchors; create?: boolean }): Promise<{ status: 'resolved'; uid: string } | { status: 'unresolved' } | { status: 'conflict'; uids: string[] }>`
- `run(company: string, country: string, progress: Progress, alongside?: Alongside, identityContext?: { anchors: Anchors; switches: string[] }): Promise<DiveOut>`

`Anchors` has the fields in the table. Keep existing exports and old calls intact. Add an explicit per-run identity control on the company page. When enabled, request identity-enriched company details explicitly and select a listing; read phone, category, place id, website and address from `search_list_place.business` through the existing `company_place.place_key` join. Keep fields tied to the selected listing; do not guess when the lead is missing or multiple listings require a choice. Leave `company_data` alone. Without that opt-in, the detail response stays exactly as today; with it off, the page posts today's `{ company, country, company_uid }` shape.

For an effective switched run, the page sends the selected anchors, UID and `options.switches`. `http.ts` accepts them
and calls `resolveAnchors` **before** today's `resolve({ uid, website, text, create: true })` (`companydive/http.ts:64`):
on a conflict it returns 409 with the candidates and never reaches the creating `resolve`, so a conflict leaves no new
company row. It resolves anchors before starting, returns conflicts and candidates to the caller without starting a run, and stores the anchors and effective switches with the run. Extend the `store.ts` options type accordingly. `runner.ts` passes the stored context to `run` on every try, including retries and resumed runs. On this path, guard `giveUid` so an unconfirmed first official domain cannot assign a UID; use only the resolved UID or evidence-confirmed identifiers. Preserve the existing start and fallback behavior when off.

**Dependencies:** T6's switch plumbing in `http.ts` and options in `store.ts` merges first; T7's report-UID hook in `runner.ts` merges next; T8 rebases on both and integrates its owned edits without losing either. The current handler drops anchors, the runner passes neither options nor anchors to `run`, and `giveUid` uses the first official domain. The live proof requires all three tracks deployed.

## Live proof

After owner approval, review and merge, and after T6, T7 and T8 are deployed, the owner picks the real records. Run Signmastr, TS Media and Eternalgy with `identity` on and off, one run at a time; Synapse Comms is a neutral comparison. Save inputs, identifier rows, UIDs, triage and results; compare each pair line by line. Check the right domain and category against the lead and sources, and repeated switched runs for each company resolve consistently to one UID. For Eternalgy, show the existing duplicate UIDs separately; one UID across those records requires the later approved data merge.

Make a conflicting identifier and a dead or unreachable lead domain fail on purpose live, with owner-selected records and a reversible setup. Show the conflict or uncertainty, no reassignment or false official domain, and the off path unchanged. Local tests and type checks are guards, never proof.

## Out of scope

No duplicate merge, data cleanup, other R-items, industry picker or preview redesign. Builders do not deploy or access production, Railway or the vault.

## Notes for Claude

The listing join is by `place_key`, a key, not a place id: `businessKey` (`agy-lab/src/country/gmap-industry.mjs:26-35`) writes `place:`
plus the Google id, or `name-address:`, `url:` or `name:`. Lookups use the stored `place_key` exactly as written; the
`place_id` anchor comes only from `business.place_id`, never parsed out of the key. It is not a `company_data.place_id` join. Existing UIDs are random, not domain hashes. DNS success and model output do not establish ownership.
