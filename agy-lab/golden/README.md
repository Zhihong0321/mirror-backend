# Golden set: how accurate is each generator version?

The owner labels real reports by hand. The scorer then says, per version and per section, how many of the
labelled items were true. Nothing here runs the pipeline or touches the network.

## Files

- `labels/<company>.json` - one file per company (5-10 companies, Eternalgy first). Written by the owner.
- `reports/<version>/<company>.json` - the saved report JSON of one generator version for that company
  (the Step 2 / Step 3 result as stored, with a `report_id` field). Same file name as the label file.
- `accuracy.html` - written by the scorer: one table, version x section.

## Label file

```json
{
  "company": "Name as shown",
  "report_ids": ["uuid of each labelled report"],
  "items": [
    { "report_id": "uuid", "id": "f3", "section": "problems", "verdict": "true", "note": "why you decided so" }
  ]
}
```

- `id` is the item's id in that report (`f` finding, `c` conflict, `n` signal, `s` step).
- `section` is one of `strengths`, `problems`, `contradictions`, `notes`, `suggestions`.
- `verdict` is `"true"` (the item is correct and its evidence says so), `"false"` (wrong, or not backed by its
  quote) or `"unsure"` (you could not tell; it is left out of the percentage).
- `report_id` may be left out when the file has one report.
- Label what is on the page, not what you think should be there: a missed finding is not an item.

## Scoring

For each version, each label is matched to the item with the same `id` (and `report_id`, when both have one)
in that version's report for the company. Per section: `% true = true / (true + false)`, and `n = true + false`.
An item a version did not produce is not counted for that version. Run:

```
node scripts/golden-score.ts            # reads golden/, writes golden/accuracy.html
```
