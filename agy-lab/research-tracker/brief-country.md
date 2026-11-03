# Research brief: country layer for {{COUNTRY}}

## Role and goal

You are designing the checks that apply to **any business in {{COUNTRY}}, whatever its industry**.
Your output is a set of research prompts our system runs automatically on every business in {{COUNTRY}}
to find problems its owner would want to know about. Industry-specific checks (licences, professional
bodies, awards for one trade) are researched separately; do not write them here.

## Who reads the result

- We send the owner a free preview, then sell a full audit. The owner knows the business better than
  anyone: one false or unprovable claim loses the sale. Every prompt must lead to findings that can be
  checked in public sources.
- Most businesses are small and medium.
- What matters most: contradictions (the business's own site says A, an official record says B); wrong or
  outdated registration details; messy or inconsistent contact details; complaints or enforcement records.

## How the system runs your prompts

1. It reads the business's own website and listings and writes down the **claims** it makes: legal name,
   registration number, years in business, address, phone numbers, emails, licences, certifications.
2. It runs only the prompts whose `applies_when` matches. If the business makes no such claim, the prompt is
   skipped as "not applicable", a normal outcome.
3. It compares what it found with what the business says, and reports the differences.

## What to research

Everything that applies to any business in {{COUNTRY}}. Start with the **company register**: the strongest
anchor, because it holds the legal facts the business should match. Cover, where they exist:

- The company register: legal name, registration number and its format, incorporation date, status (active,
  dormant, struck off, in liquidation), registered address, and which of these are free to read. Think about how
  to compare the register's incorporation date with the "since" or "years in business" claims businesses
  make, and its name and address with what the business shows.
- Other official registration or tax identifiers a business may show (business licence, tax number), and
  whether they can be checked publicly.
- Courts, insolvency and winding-up notices.
- Regulator warning or alert lists, and consumer complaint or enforcement bodies.
- The trademark register and the national domain registry (who holds a business's name and domain).
- The main general business directories and the local sites where a business's name, address and phone are
  often listed, since wrong or conflicting details there are a common problem.

## Already covered elsewhere (do not write prompts for these)

- Every business, any country: website crawl and health, domains and email setup, Google Maps listing and
  rank, general news and review search, what AI assistants say about the business.
- Checks specific to one industry in {{COUNTRY}}.

## What the system has for each business

Name, country, industry; usually its website, address, phone and Google Maps category.

## What the system can do, and cannot

It can fetch public web pages, run web searches, and ask an LLM to judge what it reads.
It cannot log in, pay, solve CAPTCHAs, post a form that needs a session, or use private APIs.
It cannot read a page whose content is loaded by script.

Many registers are behind a login, a fee, a CAPTCHA, a form post, or load their results by script, or have
no public list at all. Say so honestly: such a prompt is `manual`, not automatic.

## Your task

1. Use live, up-to-date web search to find these registers, lists and sites for {{COUNTRY}}. Read sources in
   the local language where they are in one.
2. For each source, decide how the system can query it:
   - `url_template`: a web address where the business name (or registration number) goes into the URL and
     the answer is in the returned page. Give the exact template with `{company}` or `{reg_no}`.
   - `static_list`: a page that lists the answer and can be read as is.
   - `manual`: anything else. Say why in `manual_reason` (login, fee, CAPTCHA, form post, loads by script,
     no public list).
3. Return up to 12 research prompts, most valuable first. Prefer prompts the system can run automatically.
   Fewer is fine. Never pad.

## Output

Return JSON only, no prose around it. The tracker rejects anything outside these lists.

- `category`: identity_registration, licence, regulator_action, professional_membership, register,
  awards, directory, reviews, people, claims_check, tenders_partnerships, local_social, court_insolvency,
  news_press
- `problem_type` (one or more): contradiction, legal, misinformation, contact_mess, missing_credential,
  reputation
- `source.access`: open, walled, paid, captcha
- `query_type`: url_template, static_list, manual
- `used_in`: preview (cheap, runs in the free preview) or paid (only in the full audit)
- `confidence`: high, medium, low

Field rules:
- `sub_segment`: use `all` (this layer applies to every kind of business).
- `applies_when`: the condition on the business that makes this prompt relevant, in plain words. Use `always`
  for checks that apply to every business in {{COUNTRY}}.
- `query_url`: required for `url_template` (must contain a `{placeholder}`) and `static_list`; leave empty for
  `manual`.
- `manual_reason`: required for `manual`.
- `found_when`: the problem exists. `not_found_when`: the lookup worked and the problem is absent; only when the
  lookup itself worked. `couldnt_check_when`: the lookup could not run or could not be trusted.
  `not_applicable_when`: usually "the business makes no such claim", or "never" for `always`.
  `possible_match_when`: a name matches but the identity is not confirmed (optional; use it when the lookup
  searches names).

```json
{
  "prompts": [
    {
      "rank": 1,
      "category": "",
      "problem_type": [""],
      "sub_segment": "all",
      "applies_when": "",
      "question": "the question, in plain language, specific to {{COUNTRY}}",
      "why_it_matters": "one sentence: the problem this can reveal for the owner",
      "source": {"name": "", "url": "https://", "type": "", "access": "", "language": ""},
      "query_type": "",
      "query_url": "",
      "manual_reason": "",
      "how_to_query": "in words: what to enter, and which page or field to read",
      "found_when": "",
      "not_found_when": "",
      "couldnt_check_when": "",
      "not_applicable_when": "",
      "possible_match_when": "",
      "used_in": "",
      "confidence": ""
    }
  ],
  "sources_rejected": [{"name": "", "url": "", "why": ""}],
  "open_questions": []
}
```

## Rules

- Never guess. "unknown" is a correct answer. Never invent a URL.
- Never bypass a login, paywall or CAPTCHA.
- Write in English even when the source is in another language.
- Do not copy any example above. Every value must come from your own research.
