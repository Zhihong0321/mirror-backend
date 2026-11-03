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

## Already covered elsewhere (do not write prompts for these)

- Every business, any industry: website crawl and health, domains and email setup, Google Maps listing and
  rank, general news and review search, what AI assistants say about the business.
- {{COUNTRY}}, all industries (researched separately): the company register, courts and insolvency,
  general business directories.

If a prompt would work for any industry, leave it out. Your prompts cover {{COUNTRY}}'s own bodies,
registers, sites and rules for {{INDUSTRY}} only. Do not reuse another country's bodies.

## What the system has for each business

Name, country, industry; usually its website, address, phone and Google Maps category.

## What the system can do

Web search, reading public web pages, and an LLM that judges the results.
It cannot log in, pay, solve CAPTCHAs or use private APIs.

## Your task

1. Use live, up-to-date web search to find the regulators, licences, registers, professional bodies,
   awards, directories and local sites that matter for {{INDUSTRY}} in {{COUNTRY}}. Write in the local
   language where the source is in one.
2. Open every source yourself. Test it on three real {{INDUSTRY}} businesses in {{COUNTRY}} taken from
   public listings. Name them in `test_firms`. Record what each lookup returned, with the date.
   If a source needs a login, payment or CAPTCHA, say so: it cannot be used automatically.
3. Return up to 12 research prompts, most valuable first. Fewer is fine. Never pad with generic checks.

## Output

Return JSON only, no prose around it. The tracker rejects anything outside these lists.

- `category`: identity_registration, licence, regulator_action, professional_membership, register,
  awards, directory, reviews, people, claims_check, tenders_partnerships, local_social, court_insolvency,
  news_press
- `problem_type` (one or more): contradiction, legal, misinformation, contact_mess, missing_credential,
  reputation
- `source.access`: open, walled, paid, captcha
- `used_in`: preview (cheap, runs in the free preview) or paid (only in the full audit)
- `confidence`: high, medium, low

```json
{
  "test_firms": ["name 1", "name 2", "name 3"],
  "prompts": [
    {
      "rank": 1,
      "category": "",
      "problem_type": [""],
      "question": "the question, in plain language, specific to this industry and country",
      "why_it_matters": "one sentence: the problem this can reveal for the owner",
      "source": {"name": "", "url": "https://", "type": "", "access": "", "language": ""},
      "how_to_query": "search template using {company}, {reg_no} or {person}, or the page and field to read",
      "found_when": "",
      "not_found_when": "only when the lookup itself worked",
      "couldnt_check_when": "",
      "used_in": "",
      "tested": [{"firm": "", "date": "YYYY-MM-DD", "result": ""}],
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
