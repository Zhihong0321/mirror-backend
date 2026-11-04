# Wave 1 contract: T10, preview editor (R7)

**Status: draft for the owner's approval (2026-11-03), third revision after codex's reviews.** Part of T5. Plan: [../overhaul-plan.md](../overhaul-plan.md).

**Builder:** codex (gpt-6.1-terra; sol high if the diff is weak). **Reviewer:** agy (gemini-3.8-flash-high).

## What it is for

T10 is the preview-editor part of R7, and only that.

Today the editor asks for "5 or 6" warnings of "at least three types", so the model makes up what the research did not
find. Gaps show as "missing". The editor sees everything.

With the switch on:
- the editor gets an allow-list;
- there is no quota;
- a warning is kept only if its exact quote is in a source it cites;
- gaps are never shown or counted.

R7's full design ("warnings come only from typed checks") waits for R2 (T9 onward).

## Owned files

- New `agy-lab/src/divedeeper/preview-v2.ts`: the switched editor and writer.
- New `agy-lab/src/divedeeper/preview-input.ts`: the allow-list.
- New `agy-lab/src/divedeeper/preview-input.test.ts`: a guard only, on a dive result recorded from the hub.
- `agy-lab/src/divedeeper/privacy.ts`: new exports only.
- `agy-lab/src/divedeeper/preview-html.ts`: one optional parameter.

`preview-editor.ts` stays untouched. Nothing else.

## Dependencies

- **Needs T6:**
  - `switches` stored on company dives (`companydive/http.ts:61` stores only `{people}`).
  - `options` loaded at `preview-writer.ts:31` and `divedeeper/http.ts:30`.
  - the global off setting.
- **Needs T6 (switch plumbing):** three call points for a dive whose run has `preview2`.
  - The writer calls `writePreviewV2` instead of `writePreviewNotes`.
  - The sweep treats that dive as unwritten while `notes_v2` is null.
  - `/dp/` calls `buildPreview(dive, offer, null, notesV2)`.
- **Needs T7:** each source's stored text (raw results in the evidence rows, matched by URL). Proof dives run with
  `evidence`.

## Switch

`preview2`, read from `dive.options.switches` with T6's reader.

**Switch off:** the old writer writes `notes`, and the old page reads only `notes`.

**Switch on:** the switched writer stores its result in a new column, `dive_preview.notes_v2`, and never writes
`notes`. The new page reads `notes_v2` only for a dive whose run had the switch. A global switch-off therefore shows
the old preview even when `notes_v2` exists.

`preview2_fail` (proof only) works only with `preview2`:
- It is accepted only through the operator API (the `LAB_TOKEN`-guarded `POST /api/company-dive`).
- It makes the switched editor skip the LLM and take its failure path.
- Every use is logged on the run: one line in the company dive's `log`, through `updateRow`.
- It is deleted in this task, right after its live proof.

## Interface

**Table:** `alter table dive_preview add column if not exists notes_v2 jsonb`, run by `preview-v2.ts`. A new row's
`notes` takes its default, `'{}'`.

**`notes_v2`:**
- `prompt`: the exact prompt string;
- `hook` and `known`;
- `warnings`, each `{ type, title, detail, risk, quote, sources: number[] }`;
- `dropped`, each `{ title, reason }`;
- `failed`;
- `meter` and `edited_at`.

**`preview-input.ts`:** `previewInput(result: DiveResult): PreviewInput`. Only this reaches the prompt.

| Goes in | Left out |
|---|---|
| legal and trading names, industry, area (town and state) | address, registration numbers, domains, summary, contradictions, gaps |
| leadership: name and title from the people step (`isLeadershipStrict`) | everyone else |
| public facts (citing a public source; ids kept) with no email, phone, URL or digit run of 6 or more | any fact with one of those |

**`preview-v2.ts`:** `writePreviewV2(dive): Promise<void>`. It never throws.
- Types are `contradiction | outdated | wrong`. No quota, no cap.
- Each warning returns `quote` and `sources`. The code keeps a warning only if the quote is found verbatim in the
  stored text of a source it cites (from the input's ids), by C-merged's rule (`quoteOnPage`,
  `sections/C-merged.ts:227`, imported).
- `sources` becomes the ids where the quote was found.

**`privacy.ts` adds three exports:**
- `isLeadershipStrict(role)`: "Art Director" and "Principal Engineer" fail it.
- `hasPrivate(text)`.
- `scrubPublic(text, officialDomains)`: removes emails, phones, URLs other than the official domains, and digit runs of
  6 or more.

**`preview-html.ts`:** `buildPreview(dive, offer, notes, notesV2?)`. Without `notesV2` the page is byte for byte
today's. With it:
- warnings come from `notesV2` only, even when the list is empty;
- fallback contradictions pass the same quote check or are dropped. They carry no quote, so in practice they are
  dropped;
- the counts (`:90`, `:92`, `:424`) count only shown warnings;
- `scrubPublic` runs on everything printed from the dive or the notes, including registration numbers (`:475`) and the
  source list (`:664`).

## Live proof (after T6, T7 and the call points are proven, one deploy)

1. **Off.** Before the deploy, save the `/dp/` HTML and `dive_preview` rows of the owner's existing dives. After the
   deploy: byte-identical.
2. **On.** One at a time, a new company dive with `evidence` and `preview2`. Suggested: Synapse Comms (neutral),
   Signmastr, TS Media, Eternalgy, and one with few findings. Compare each with that company's latest old preview,
   line by line:
   - each `quote` is in its cited source's evidence row;
   - `notes_v2.prompt` and the page hold no email, phone, staff name, digit run of 6 or more, or non-official URL;
   - no gap appears as a warning or in a count;
   - the count equals the warnings shown;
   - `notes` stays `'{}'`;
   - the few-findings dive has no padding.
3. **Global off.** With T6's global off setting (a Railway variable, owner's OK), every `/dp/` shows the old page,
   including dives that have `notes_v2`. Then set it back.
4. **Failure.** One new dive with `evidence`, `preview2` and `preview2_fail`:
   - the run's log has the line;
   - `failed` is set;
   - no unverified warning, no "missing", and counts that match.
5. **Remove `preview2_fail`**, deploy, and check that the code no longer contains it.

## Out of scope

Typed checks (R2), the recheck (T29), the preview's promises (R10), layout, E9, the research.

## Notes for Claude

- **There is no stored source text today.** A company dive keeps sources without `content` or `snippets`
  (`companydive/pipeline.ts:35`). Hence the T7 dependency, and new dives rather than old ones. Without evidence rows,
  every warning drops.
- **The editor never sees source text.** Facts are LLM summaries, so its quotes will rarely be verbatim, and most
  warnings may drop. Fix: add short source passages, filtered by `hasPrivate`, to the input, or have the research
  store a quote per fact (outside T10). Decide before the build.
- **Order:** T6 → T7 → T10 → call points → proof.
- A dive that only ever ran switched shows the old fallback wording under a global off, because its `notes` is
  `'{}'`.
- **Owner's calls (defaults set by Claude; the owner can change either at approval):**
  - `:490` ("N questions they cannot answer"): **dropped** on the switched page. A count of open questions is a warning
    quota in another form, which R7 rules out.
  - Source links on the public page: **only the company's own official domains stay**; other links go (privacy).

## Live proof, first round (2026-11-03, deploy `9c74136`, live 09:27:48 UTC)

- **Off:** all 39 existing `/dp/` pages byte-identical after the deploy (saved before, refetch-stable).
- **On, dive #51** (Synapse Comms, `evidence` + `preview2`): `notes_v2` written, `notes` left `{}`; prompt and page held
  no email, phone, digit run of 6+, off-domain URL or non-leadership name. **But all 6 candidate warnings were dropped**
  ("quote is not in a cited source"): the build had not given the editor the source text, so it could not quote verbatim;
  and the hook skipped the quote check. Not ticked.
- **Fix** (branch `wave1/t10-passages`): scrubbed passages of each cited source's stored text in the prompt (700 chars
  per source, 20 sources, 12,000 total), every quote and the hook checked by `quoteOnPage`; sentences naming a
  non-leadership person removed from passages; a warning or hook naming one dropped; the editor told to name no person
  but the listed leadership. **Residual risk, recorded:** a name the people step never found can still appear inside a
  verbatim quote from a public source; the proof's scan watches for it.
