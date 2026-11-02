// Dive-deeper: the paid stage after a company-dive (docs/dive-deeper-plan.md, step 5).
//
// This is the malaysia-deeper-dive pipeline (docs/country-deeper-dive-plan.md): Malaysian
// registers, regulators, courts and phone formats. One run per company: the company-dive first
// (started through its own public API, never touched), then stage 1, whose lanes feed the report's
// six research parts (contact and reachability; how the internet understands the brand; reviews,
// discussion and news; credibility and official records; digital assets; website speed and quality
// from Google PageSpeed Insights), stage 2 (the ready-to-use drafts), stage 3 (the editor's plain
// titles and screenshots), stage 4 (one full analysis across all six parts) and stage 5 (the action
// plan, one task list per department), then one report stored in the dive_deeper table and served at /dd/<public id>.
//
// Isolation from company-dive (plan §2): own files, own table, own queue (one run at a time,
// never in company-dive's queue), read-only on company_dive (plain selects). Everything here
// is off unless DIVE_DEEPER_ENABLED is set: with it off, every handler declines and the hub
// behaves exactly as before.
//
// No kill gates: no timeouts or token caps; a lane that fails comes back partial and the run
// still finishes with a report.
import http from 'node:http';
export { enabled, STAGE1_FIRST, STAGE1_AFTER_H, STAGE1_LAST, STAGE2, STAGE3, STAGE4, STAGE5 } from './divedeeper/stages.ts';
export { resumeInterrupted } from './divedeeper/run.ts';
export { previewAuto, startPreviewWorker } from './divedeeper/preview-writer.ts';
export { handlePage, handlePublic, handle } from './divedeeper/http.ts';
