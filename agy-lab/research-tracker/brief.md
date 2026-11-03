# Research brief: {{INDUSTRY}} in {{COUNTRY}}

## Role and goal

You are designing how to check one kind of business in one country: **{{INDUSTRY}} in {{COUNTRY}}**.
Your output is a set of research prompts our system runs automatically on any business in this
industry and country, to find problems its owner would want to know about.

## Who reads the result

- We send the owner a free preview, then sell a full audit. The owner knows the business better than
  anyone: one false or unprovable claim loses the sale. Every prompt must lead to findings that can be
  checked in public sources.
- Most businesses are small and medium, not the largest in the market.
- What matters most: contradictions (the business's own site says A, an official body says B); licence,
  registration or membership problems; wrong or outdated information about the business on other sites;
  messy contact details (for example a named person who has left); complaints or disciplinary records.

## How the system runs your prompts

1. It reads the business's own website and listings and writes down the **claims** the business makes:
   licences, registrations, memberships, awards, certifications, grant or partner status, logos, years in
   business, client counts.
2. It runs only the prompts whose `applies_when` matches. If the business makes no such claim, the prompt
   is skipped as "not applicable". That is a normal outcome, not a failure.
3. It compares what it found with what the business says, and reports the differences.

So the most useful prompts verify **claims that businesses in this industry commonly make** against the body
that issues or lists them. Research which claims are common, who issues them, and where each can be checked.

## Already covered elsewhere (do not write prompts for these)

- Every business, any industry: website crawl and health, domains and email setup, Google Maps listing and
  rank, general news and review search, what AI assistants say about the business.
- {{COUNTRY}}, all industries (a separate "country layer" run): the company register and company status,
  courts and insolvency, general business directories, tax and registration numbers.

If a prompt would work for any industry, leave it out. Your prompts cover {{COUNTRY}}'s own bodies,
registers, sites and rules for {{INDUSTRY}} only. Do not reuse another country's bodies.

## What the system has for each business

Name, country, industry; usually its website, address, phone and Google Maps category.

## What the system can do, and cannot

It can fetch public web pages, run web searches, and ask an LLM to judge what it reads.
It cannot log in, pay, solve CAPTCHAs, post a form that needs a session, or use private APIs.
It cannot read a page whose content is loaded by script.

Many registers are behind a login, a fee, a CAPTCHA, a form post, or load their results by script, or have
no public list at all. Say so honestly: such a prompt is `manual`, not automatic.

## Your task

1. Use live, up-to-date web search to find the regulators, licences, registers, professional bodies, awards,
   directories and local sites that matter for {{INDUSTRY}} in {{COUNTRY}}. Read sources in the local
   language where they are in one.
2. If this industry covers different kinds of business that need different checks, cover each kind and name
   it in `sub_segment` (for example, a freight forwarder and a food importer are not the same business).
   Use `all` when a prompt fits every kind.
3. For each source, decide how the system can query it:
   - `url_template`: a web address where the business name (or registration number) goes into the URL and
     the answer is in the returned page. Give the exact template with `{company}` or `{reg_no}`.
   - `static_list`: a page that lists the answer (winners, members, revoked approvals) and can be read as is.
   - `manual`: anything else. Say why in `manual_reason` (login, fee, CAPTCHA, form post, loads by script,
     no public list).
4. Return up to 12 research prompts, most valuable first. Prefer prompts the system can run automatically.
   Fewer is fine. Never pad with generic checks.

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
- `applies_when`: the condition on the business that makes this prompt relevant, in plain words (for example,
  "the site shows a logo or text claiming membership of X"). Use `always` only if every business of this
  industry in {{COUNTRY}} must be on this register or list.
- `query_url`: required for `url_template` (must contain a `{placeholder}`) and `static_list`; leave empty for
  `manual`.
- `manual_reason`: required for `manual`.
- `found_when`: the problem exists. `not_found_when`: the lookup worked and the problem is absent; only when the
  lookup itself worked. `couldnt_check_when`: the lookup could not run or could not be trusted.
  `not_applicable_when`: usually "the business makes no such claim". `possible_match_when`: a name matches but
  the identity is not confirmed (optional; use it when the lookup searches names).

```json
{
  "prompts": [
    {
      "rank": 1,
      "category": "",
      "problem_type": [""],
      "sub_segment": "all",
      "applies_when": "",
      "question": "the question, in plain language, specific to this industry and country",
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
