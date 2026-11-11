# Prompt for the public-site team: how to display a company-diver report

Paste everything below the line into the public site's agent or ticket.

---

You are working on the public site that sells company reports. Another repo, **company-diver** (the "report factory"), writes the reports. Your site is connected to the **same Postgres** as company-diver. Your job: **show the report to the buyer**. You do not make reports, and you do not change how they are made.

## 1. Two reports, two ways to show them

| | Free preview | Full report ($59, after payment) |
|---|---|---|
| What it is | The bait page. Proves the problems are real, keeps the answers back. | The complete deeper report. |
| Who may see it | Anyone with the link. | **Only the buyer who paid.** You must check this on your side. |
| Where it lives | Not stored as a page. The factory draws it on request from rows in `v21_raw`. | Stored as one finished, self-contained HTML page: `v21_deeper_run.report_html`. |
| How you show it | Open the factory's public URL `GET <HUB_URL>/v21/r/{report_id}` (no token, noindex). Embed it in an iframe, or fetch it on the server and return the HTML as is. | Read `report_html` from Postgres and return it as is. |

`{report_id}` is a UUID, the key for everything. It is `v21_report.report_id`. Your order or listing record must store the `report_id` it belongs to. If you do not have this link yet, adding it is the first job.

`<HUB_URL>` is the factory's public address. Ask the owner for it. Do not guess it, and do not use the old `ee-auto.up.railway.app`.

**Do not re-implement the preview page.** It is drawn by about 1,400 lines of code in company-diver (`agy-lab/src/v21/step3.ts`, `reportPage`) and its wording changes often. Use the hub URL so it always shows the current version.

## 2. Free preview

- Show `GET <HUB_URL>/v21/r/{report_id}`.
- If the hub answers 404 or 503, the page is not written yet or the hub is busy. Show your own friendly "Your preview is being prepared, refresh in a minute" page. Never show a blank page or a raw error.
- Do not cache it for long (it is sent with `cache-control: no-store`).
- Keep `x-robots-tag: noindex`. Do not let search engines index report pages.

## 3. Full report

Query (read only):

```sql
select run_id, status, stage, finished_at, report_html
  from v21_deeper_run
 where report_id = $1
 order by created_at desc
 limit 1;
```

Use the newest run. Status is one of `queued`, `running`, `done`, `incomplete`, `failed`. What to show:

| status | `report_html` | Show |
|---|---|---|
| `done` | set | The report, **exactly as stored**. |
| `incomplete` | set | The report as stored, with a small label above it: "Some parts of this report could not be completed." It is a real report, not an error. |
| `queued` / `running` | empty | A progress page: "Your report is being prepared. This takes about 20+ minutes." You may show `stage` as the step name. Refresh every 20 s. |
| `failed` | empty | "Something went wrong with your report. We are looking into it. Contact us." and alert the owner. Do not show the raw `error`. |
| no row | - | "Your report has not started yet." |

Fallback: if a newer run is `failed` or still running but an older run of the same `report_id` has `report_html`, show the older finished report with a note. A buyer should never see nothing when a report exists.

**How to return the HTML**

- Return `report_html` untouched, as `text/html; charset=utf-8`. Do not parse it, strip it, or re-style it.
- It is one self-contained page: images are inline (`data:` base64), styles and scripts are inline, fonts come from Google Fonts. It contains inline `<script>` (table of contents, copy buttons). If your site has a strict CSP, serve the report from its own route or an iframe so your CSP does not break it.
- Preferred: a dedicated route like `/reports/{report_id}` that returns the HTML alone, in its own page, with `x-robots-tag: noindex, nofollow` and `cache-control: private, no-store`. If you embed it, use an iframe (`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`) so its styles do not clash with your site.
- It can be several MB. Select `report_html` only when you are about to show it. Never select it in list queries.

**The payment gate is yours.** The factory has no payment code. Before returning `report_html`, check that the logged-in buyer owns an order for this `report_id`. A UUID being hard to guess is not a permission. Never show the full report on a public URL, a list page, a sitemap or an API without that check.

## 4. What to read, and what never to read

- Read only. Use a read-only Postgres user for the display code. **Never** run `create`, `alter`, `update`, `delete` or migrations on `v21_*` tables. The factory owns them.
- Read by `report_id` only. Never scan or list whole tables to find reports.
- Use only these for display:
  - `v21_report` (`report_id`, `company`, `country`, `industry`, `website`, `company_uid`, `created_at`): the title and the card.
  - `v21_deeper_run` (columns above): the full report.
- **Never read or show**: `v21_raw` (the raw research, judge answers, `llm_raw`, `log`), `v21_deeper_lane`, `v21_deeper_run.log`, `.error`, `.blocked_html`, `.gate_failures`, or any cost or meter data. Internal.
- The price is in `hub_setting`: `select value from hub_setting where key = 'full_report_price'` (USD, `59` means $59). Read it from there, do not hard-code it.

## 5. Never hide a report

If something is odd (a status you do not know, an empty field, a slow query), **show what exists with a plain label**. Do not hide it, do not return an error page where a report exists, do not crash the page. A report that is shown with a label can be fixed. A report that is hidden cannot.

## 6. How to prove it works

Use a real `report_id` from `v21_report` (ask the owner for one that has a finished full report). Check, and tell me the results:

1. The preview page loads through your site for that id.
2. The full report page shows the stored HTML, and the copy buttons and table of contents work.
3. An `incomplete` run shows the label, a `running` run shows the progress page, and a `failed` run shows the "we are looking into it" page. Test with real rows or a copy of one, not with changes to the production tables.
4. A logged-in user who did not buy that `report_id` cannot get the full report.
5. Phone width looks right.

If anything about the tables does not match this description, stop and ask. Do not guess.
