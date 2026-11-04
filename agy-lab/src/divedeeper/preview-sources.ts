// Stored text for one source URL, read from the company dive's evidence rows.
// writePreviewV2 checks a quote against this and never imports the evidence store itself.
import { textForUrl } from '../evidence/store.ts';

/** `(url) => text` for one dive. Null when that run stored nothing for the URL. */
export function sourceText(dive: { public_id?: unknown } | null | undefined): (url: string) => Promise<string | null> {
  const reportUid = dive?.public_id == null || dive.public_id === '' ? '' : String(dive.public_id);
  return (url: string) => textForUrl(reportUid, url);
}
