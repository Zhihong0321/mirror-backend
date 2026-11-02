// Contact-form delivery: one lead in, one message delivered through the contact form on the
// lead's own website, and a record of what happened.
//
// Open the homepage, then its contact pages, find the form that is a contact form (a message box
// plus an email or phone box), fill the boxes a visitor would see, press its send button and read
// the answer. A form behind a captcha (reCAPTCHA, hCaptcha, Turnstile, a Cloudflare check or a
// typed question) is left alone and reported as `captcha`: that site has said no to automated
// messages. Boxes a visitor cannot see are never filled.
//
// Where the leads come from is the caller's business. No kill gates: pages load as slowly as they
// load, and every failure comes back as a status, never a throw.
import http from 'node:http';
import { browserPath } from './divedeeper/shots.ts';
import { contactLinks, ownSiteUrl } from './site-emails.ts';

export interface Sender { name: string; email: string; phone?: string; company?: string; website?: string }
export interface DeliverInput {
  lead: { company_name: string; website: string; contact_name?: string };
  sender: Sender;
  subject?: string;
  /** Plain text. {{company_name}}, {{website}} and {{contact_name}} are filled in. */
  message: string;
  /** Fill the form and keep the screenshot, but do not press send. */
  dry_run?: boolean;
}
export type Status = 'sent' | 'submitted_unconfirmed' | 'dry_run' | 'captcha' | 'no_form' | 'not_own_site' | 'site_unreachable' | 'failed';
export interface DeliverResult {
  status: Status;
  website: string;
  form_url: string | null;
  detail: string;
  filled: Array<{ field: string; as: string }>;
  pages_checked: string[];
  /** data:image/jpeg;base64 of the form, filled (and after sending when sent). */
  screenshot: string | null;
  finished_at: string;
}

/** One box of a form, as the page snapshot reports it. */
export interface Field {
  id: string; tag: string; type: string; name: string; label: string; required: boolean;
  options?: string[]; group?: string;
}
export interface FormInfo { id: string; fields: Field[]; submitText: string; captcha: string | null }

export type Kind = 'email' | 'phone' | 'first_name' | 'last_name' | 'name' | 'company' | 'subject' | 'website' | 'message' | 'consent';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a box is for, from its type, name, label and placeholder (English and Malay). */
export function classify(f: Field): Kind | null {
  const t = (f.type || '').toLowerCase();
  const s = `${f.name} ${f.label}`.toLowerCase().replace(/[_\-[\]]+/g, ' ');
  if (f.tag === 'textarea') return 'message';
  if (t === 'checkbox') return /agree|consent|privacy|terms|accept|setuju|pdpa|gdpr/.test(s) ? 'consent' : null;
  if (t === 'email' || /e-?mail|emel/.test(s)) return 'email';
  if (t === 'tel' || /phone|mobile|tel\b|telefon|whatsapp|contact no|hp\b|handphone/.test(s)) return 'phone';
  if (t === 'url' || /website|web site|url|laman web/.test(s)) return 'website';
  if (/company|organi[sz]ation|business|syarikat|firm\b/.test(s)) return 'company';
  if (/subject|topic|tajuk|perkara|regarding/.test(s)) return 'subject';
  if (/first ?name|given name|fname|nama pertama/.test(s)) return 'first_name';
  if (/last ?name|surname|family name|lname/.test(s)) return 'last_name';
  if (/name|nama/.test(s)) return 'name';
  if (/message|comment|enquiry|inquiry|mesej|pertanyaan|details|how can we help/.test(s)) return 'message';
  return null;
}

/** The contact form among a page's forms: a message box plus a way to answer. Newsletter, search and login forms never qualify. */
export function pickForm(forms: FormInfo[]): FormInfo | null {
  let best: FormInfo | null = null;
  let bestScore = 0;
  for (const form of forms) {
    const kinds = form.fields.map(classify);
    if (form.fields.some((f) => f.type === 'password' || f.type === 'search')) continue;
    if (!kinds.includes('message') || !(kinds.includes('email') || kinds.includes('phone'))) continue;
    const score = 4 + (kinds.includes('email') ? 3 : 0) + (kinds.includes('name') || kinds.includes('first_name') ? 1 : 0)
      + (/send|submit|hantar|contact|enquir|hubungi/i.test(form.submitText) ? 1 : 0);
    if (score > bestScore) { best = form; bestScore = score; }
  }
  return best;
}

export function fillTemplate(text: string, lead: DeliverInput['lead']): string {
  return text
    .replace(/\{\{\s*company_name\s*\}\}/g, lead.company_name)
    .replace(/\{\{\s*website\s*\}\}/g, lead.website)
    .replace(/\{\{\s*contact_name\s*\}\}/g, lead.contact_name || 'there');
}

export type Step = { id: string; field: string; as: string; action: 'type' | 'select' | 'check'; value: string };

/** What goes in each box. Required boxes we cannot place get a neutral answer, and are reported. */
export function planFill(form: FormInfo, input: DeliverInput): Step[] {
  const s = input.sender;
  const [first, ...rest] = s.name.trim().split(/\s+/);
  const kinds = form.fields.map(classify);
  const split = kinds.includes('first_name') || kinds.includes('last_name');
  const message = fillTemplate(input.message, input.lead);
  const subject = fillTemplate(input.subject || 'Enquiry', input.lead);
  const value: Record<Kind, string> = {
    email: s.email, phone: s.phone ?? '', company: s.company ?? '', website: s.website ?? '', subject,
    first_name: first ?? s.name, last_name: rest.join(' ') || first || s.name,
    name: split ? first ?? s.name : s.name, message, consent: 'on',
  };
  const steps: Step[] = [];
  const radioDone = new Set<string>();
  let messageDone = false;
  form.fields.forEach((f, i) => {
    const kind = kinds[i];
    const field = f.label || f.name || f.type;
    if (f.type === 'radio') {
      if (f.required && f.group && !radioDone.has(f.group)) { radioDone.add(f.group); steps.push({ id: f.id, field, as: 'first choice', action: 'check', value: 'on' }); }
      return;
    }
    if (f.type === 'checkbox') {
      if (kind === 'consent' || f.required) steps.push({ id: f.id, field, as: kind ?? 'required box', action: 'check', value: 'on' });
      return;
    }
    if (f.tag === 'select') {
      const choice = f.options?.[0];
      if (f.required && choice) steps.push({ id: f.id, field, as: 'first choice', action: 'select', value: choice });
      return;
    }
    if (kind === 'message') {
      if (messageDone) return;
      messageDone = true;
    }
    const v = kind ? value[kind] : '';
    if (v) steps.push({ id: f.id, field, as: kind!, action: 'type', value: v });
    else if (f.required) steps.push({ id: f.id, field, as: 'unknown, required', action: 'type', value: kind === 'phone' ? '-' : s.company || '-' });
  });
  return steps;
}

const SUCCESS = /thank you|thanks for|thank-you|successfully|has been sent|have been sent|was sent|received your|we will (get back|contact|be in touch)|we'll (get back|be in touch)|message sent|terima kasih|berjaya dihantar|telah dihantar/i;
const REJECTED = /(error|failed|invalid|problem) (occurred|sending|submitting|with your)|please (fill|enter|complete|correct)|field is required|is required|try again|ralat|sila isi/i;

/** The answer a page gave after send: success words, an error, or nothing to go on. */
export function readOutcome(textAfter: string, textBefore: string, formGone: boolean, urlChanged: boolean): { status: Status; detail: string } {
  // Only the lines the send added count: a footer that always says "thank you" proves nothing.
  const had = new Set(textBefore.split('\n').map((l) => l.trim()));
  const fresh = textAfter.split('\n').map((l) => l.trim()).filter((l) => l && !had.has(l)).join('\n');
  const ok = SUCCESS.exec(fresh);
  if (ok) return { status: 'sent', detail: `the site answered "${ok[0]}"` };
  const bad = REJECTED.exec(fresh);
  if (bad) return { status: 'failed', detail: `the form answered "${bad[0]}"` };
  if (formGone) return { status: 'sent', detail: 'the form was replaced after sending' };
  if (urlChanged) return { status: 'submitted_unconfirmed', detail: 'the page moved on after sending, with no thank-you text' };
  return { status: 'submitted_unconfirmed', detail: 'sent, but the page gave no clear answer' };
}

// Runs inside each page and frame: tags every visible box and send button with data-cfd, and
// reports the forms. Self-contained, because it is serialised into the browser.
function snapshot(prefix: string): { forms: FormInfo[]; pageCaptcha: string | null } {
  const visible = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const st = getComputedStyle(el);
    // Off-screen and aria-hidden boxes are traps for robots; a visitor never sees them.
    const onPage = r.right > 0 && r.bottom + window.scrollY > 0 && r.left < document.documentElement.scrollWidth;
    return r.width > 2 && r.height > 2 && onPage && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05
      && !el.closest('[aria-hidden="true"]');
  };
  const labelOf = (el: Element): string => {
    const id = el.getAttribute('id');
    const parts: string[] = [];
    if (id) document.querySelectorAll(`label[for="${CSS.escape(id)}"]`).forEach((l) => parts.push(l.textContent || ''));
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent || '');
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('title') || '');
    if (!parts.join('').trim()) {
      const prev = el.parentElement?.previousElementSibling ?? el.previousElementSibling;
      if (prev) parts.push((prev.textContent || '').slice(0, 80));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const html = document.documentElement.outerHTML.slice(0, 2_000_000);
  let pageCaptcha: string | null = null;
  if (/just a moment|attention required|verify you are human/i.test(document.title)) pageCaptcha = 'a Cloudflare check guards the page';
  else if (/google\.com\/recaptcha|recaptcha\/api\.js|grecaptcha|g-recaptcha/i.test(html)) pageCaptcha = 'reCAPTCHA';
  else if (/hcaptcha\.com|h-captcha/i.test(html)) pageCaptcha = 'hCaptcha';
  else if (/challenges\.cloudflare\.com|cf-turnstile/i.test(html)) pageCaptcha = 'Cloudflare Turnstile';
  else if (/friendlycaptcha|frc-captcha|mtcaptcha|captcha\.(png|jpg|php)|really-simple-captcha|wpcf7-quiz|si_captcha/i.test(html)) pageCaptcha = 'a captcha';

  const containers: Element[] = Array.from(document.querySelectorAll('form'));
  // Forms built without a <form> (Wix, some page builders): the smallest block holding a message box and two or more inputs.
  document.querySelectorAll('textarea').forEach((ta) => {
    if (ta.closest('form')) return;
    let el: Element | null = ta.parentElement;
    while (el && el !== document.body && el.querySelectorAll('input:not([type=hidden])').length < 2) el = el.parentElement;
    if (el && !containers.includes(el)) containers.push(el);
  });
  const forms: FormInfo[] = [];
  containers.forEach((c, fi) => {
    if (!visible(c)) return;
    const formId = `${prefix}f${fi}`;
    const fields: Field[] = [];
    c.querySelectorAll('input, textarea, select').forEach((el, i) => {
      const type = (el.getAttribute('type') || (el.tagName === 'INPUT' ? 'text' : '')).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
      if (!visible(el) && !(type === 'checkbox' || type === 'radio')) return;
      if ((type === 'checkbox' || type === 'radio') && !visible(el) && !(el.closest('label') && visible(el.closest('label')!))) return;
      if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return;
      const id = `${formId}-${i}`;
      el.setAttribute('data-cfd', id);
      const label = labelOf(el);
      const options = el.tagName === 'SELECT'
        ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value && !o.disabled && !/select|choose|pilih|--/i.test(o.text)).map((o) => o.value)
        : undefined;
      fields.push({
        id, tag: el.tagName.toLowerCase(), type, name: el.getAttribute('name') || el.getAttribute('id') || '', label,
        required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*/.test(label),
        options, group: type === 'radio' ? el.getAttribute('name') || undefined : undefined,
      });
    });
    const buttons = Array.from(c.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a.button, .btn')).filter(visible);
    const send = buttons.find((b) => (b.getAttribute('type') || '').toLowerCase() === 'submit')
      ?? buttons.find((b) => /send|submit|hantar|hubungi|contact|enquir/i.test((b.textContent || '') + ' ' + (b.getAttribute('value') || '')))
      ?? buttons.find((b) => b.tagName === 'BUTTON' && !b.getAttribute('type'));
    if (send) send.setAttribute('data-cfd', `${formId}-send`);
    c.setAttribute('data-cfd-form', formId);
    const localCaptcha = c.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], iframe[src*="captcha"], iframe[src*="turnstile"], img[src*="captcha"], input[name*="captcha" i]');
    const quiz = Array.from(c.querySelectorAll('label, span, p')).some((n) => /\d+\s*[+x×*-]\s*\d+\s*=|captcha|are you human|bukan robot/i.test(n.textContent || ''));
    forms.push({
      id: formId, fields, submitText: send ? ((send.textContent || '') + ' ' + (send.getAttribute('value') || '')).trim() : '',
      captcha: localCaptcha ? 'a captcha on the form' : quiz ? 'a question that checks for robots' : null,
    });
  });
  return { forms, pageCaptcha };
}

const FALLBACK_PATHS = ['/contact', '/contact-us', '/contactus', '/hubungi-kami', '/contact.html'];

let chain: Promise<unknown> = Promise.resolve();

/** One delivery at a time on this machine: each opens its own browser and closes it. Never throws. */
export function deliver(input: DeliverInput): Promise<DeliverResult> {
  const run = chain.then(() => deliverNow(input), () => deliverNow(input));
  chain = run.catch(() => {});
  return run;
}

async function deliverNow(input: DeliverInput): Promise<DeliverResult> {
  const out: DeliverResult = {
    status: 'failed', website: input.lead?.website ?? '', form_url: null, detail: '', filled: [], pages_checked: [], screenshot: null, finished_at: '',
  };
  const done = (status: Status, detail: string) => Object.assign(out, { status, detail, finished_at: new Date().toISOString() });
  const home = ownSiteUrl(input.lead?.website);
  if (!home) return done('not_own_site', 'the website is missing, or is a social page or marketplace rather than their own site');
  const exe = browserPath();
  if (!exe) return done('failed', 'no browser on this machine (set CHROME_PATH)');
  let browser: any = null;
  try {
    const { default: puppeteer } = await import('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: exe, headless: true, protocolTimeout: 0,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-GB'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);

    const open = async (url: string): Promise<boolean> => {
      out.pages_checked.push(url);
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
        await sleep(2500);
        return !!res && res.status() < 400;
      } catch { return false; }
    };
    const look = async () => {
      const found: Array<{ frame: any; form: FormInfo; pageCaptcha: string | null }> = [];
      let pageCaptcha: string | null = null;
      for (const [n, frame] of page.frames().entries()) {
        try {
          const snap = await frame.evaluate(snapshot, `p${n}`);
          pageCaptcha ??= snap.pageCaptcha;
          for (const form of snap.forms) found.push({ frame, form, pageCaptcha: snap.pageCaptcha });
        } catch { /* a frame that went away while we looked */ }
      }
      return { found, pageCaptcha };
    };

    if (!(await open(home))) return done('site_unreachable', `${home} did not load`);
    let homeHtml = '';
    try { homeHtml = await page.content(); } catch { /* keep going with fallbacks */ }
    const candidates = [home, ...contactLinks(homeHtml, page.url(), 3), ...FALLBACK_PATHS.map((p) => new URL(p, page.url()).toString())];
    const seen = new Set<string>();
    let lastCaptcha: string | null = null;
    for (const url of candidates) {
      const key = url.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      if (url !== home && !(await open(url))) continue;
      const { found, pageCaptcha } = await look();
      const pick = pickForm(found.map((f) => f.form));
      if (!pick) { lastCaptcha ??= /Cloudflare check/.test(pageCaptcha ?? '') ? pageCaptcha : null; continue; }
      const hit = found.find((f) => f.form === pick)!;
      out.form_url = page.url();
      const shot = async () => {
        try {
          await hit.frame.evaluate((id: string) => document.querySelector(`[data-cfd-form="${id}"]`)?.scrollIntoView({ block: 'center' }), pick.id);
          await sleep(400);
          out.screenshot = 'data:image/jpeg;base64,' + await page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64' });
        } catch { /* no screenshot, the result still stands */ }
      };
      const captcha = pick.captcha ?? hit.pageCaptcha ?? pageCaptcha;
      if (captcha) { await shot(); return done('captcha', `skipped: the contact form is guarded by ${captcha}`); }

      for (const step of planFill(pick, input)) {
        const el = await hit.frame.$(`[data-cfd="${step.id}"]`);
        if (!el) continue;
        try {
          if (step.action === 'select') await hit.frame.select(`[data-cfd="${step.id}"]`, step.value);
          else if (step.action === 'check') {
            const checked = await el.evaluate((e: HTMLInputElement) => e.checked);
            if (!checked) await el.evaluate((e: HTMLInputElement) => (e.closest('label') as HTMLElement ?? e).click());
          } else {
            await el.click({ clickCount: 3 }).catch(() => el.focus());
            await el.type(step.value, { delay: 15 });
          }
          out.filled.push({ field: step.field, as: step.as });
        } catch (err) { out.filled.push({ field: step.field, as: `${step.as} (could not fill: ${(err as Error).message.slice(0, 80)})` }); }
      }
      await shot();
      if (input.dry_run) return done('dry_run', `filled the form on ${out.form_url}; not sent (dry run)`);

      const before = await hit.frame.evaluate(() => document.body.innerText).catch(() => '');
      const urlBefore = page.url();
      const sendBtn = await hit.frame.$(`[data-cfd="${pick.id}-send"]`);
      if (sendBtn) await sendBtn.click().catch(() => sendBtn.evaluate((b: HTMLElement) => b.click()));
      else await hit.frame.evaluate((id: string) => {
        const f = document.querySelector(`[data-cfd-form="${id}"]`);
        if (f instanceof HTMLFormElement) f.requestSubmit();
      }, pick.id);
      await sleep(7000);
      const frame = page.frames().includes(hit.frame) ? hit.frame : page.mainFrame();
      const after = await frame.evaluate(() => document.body.innerText).catch(() => '');
      const formGone = await frame.evaluate((id: string) => {
        const f = document.querySelector(`[data-cfd-form="${id}"]`);
        return !f || (f as HTMLElement).getBoundingClientRect().height < 5;
      }, pick.id).catch(() => true);
      const outcome = readOutcome(after, before, formGone, page.url() !== urlBefore);
      try { out.screenshot = 'data:image/jpeg;base64,' + await page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64' }); } catch { /* keep the filled shot */ }
      return done(outcome.status, outcome.detail);
    }
    if (lastCaptcha) return done('captcha', `skipped: ${lastCaptcha}`);
    return done('no_form', `no contact form on ${out.pages_checked.length} page(s) checked`);
  } catch (err) {
    return done('failed', (err as Error).message.slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Checks a request body; returns the problem, or null when it can go. */
export function invalid(b: any): string | null {
  if (!b || typeof b !== 'object') return 'send a JSON body';
  if (!b.lead?.website) return 'lead.website is required';
  if (!b.lead?.company_name) return 'lead.company_name is required';
  if (!b.sender?.name || !/@/.test(b.sender?.email ?? '')) return 'sender.name and sender.email are required';
  if (!String(b.message ?? '').trim()) return 'message is required';
  return null;
}

type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void; readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>> };

/** POST /api/contact-form-delivery/deliver: one lead, one message, the result. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (url.pathname !== '/api/contact-form-delivery/deliver') return false;
  if (req.method !== 'POST') { ctx.json(res, 405, { error: 'POST a lead, sender and message' }); return true; }
  const body: any = await ctx.readJson(req);
  const problem = invalid(body);
  if (problem) { ctx.json(res, 400, { error: problem }); return true; }
  ctx.json(res, 200, await deliver({
    lead: { company_name: String(body.lead.company_name), website: String(body.lead.website), contact_name: body.lead.contact_name ? String(body.lead.contact_name) : undefined },
    sender: body.sender, subject: body.subject ? String(body.subject) : undefined, message: String(body.message), dry_run: body.dry_run === true,
  }));
  return true;
}
