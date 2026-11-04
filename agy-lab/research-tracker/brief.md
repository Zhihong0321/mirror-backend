# Research brief: {{INDUSTRY}} in {{COUNTRY}}

## The goal

We run a free check on small and medium businesses ({{INDUSTRY}} in {{COUNTRY}}). It is a sample: its only job is to
make the owner want the paid report.

The owner knows their own business better than anyone, so a report that tells them what they already know is
worthless. What they do **not** know is what the internet says about them in places they do not watch: an old phone
number on a directory, an award they won but never show, a licence near its end date, a legal name that differs
between sources, a sanction or complaint listed on a regulator's page.

**Your job:** find the places, specific to {{INDUSTRY}} in {{COUNTRY}}, where a business of this kind appears without
its owner watching, and say exactly how our system can read each one for any business name.

## What is worth finding, best first

1. **Award and winner lists** for this industry in {{COUNTRY}}: a business may have won and not show it, or show an
   award it is not listed for.
2. **Industry review, quote and listing platforms**: the sites where customers find, compare and review businesses of
   this trade. They carry ratings, reviews, and old phones and addresses.
3. **Member directories** of this industry's associations and professional bodies: stale details, lapsed membership,
   a name that differs from the business's own.
4. **Licence and registration registers for this trade that anyone can read free**: grade, status, end date, legal
   name.
5. **Regulator action lists**: sanctions, disciplinary decisions, revoked or suspended licences, warning lists.
6. **Industry rankings and press lists**: "top 50" lists, who's-who lists, trade press features.

Not worth a prompt:

- A register or directory that needs a login, a fee, a CAPTCHA, a form post or a session to show a result. Put it
  in `sources_rejected` with the reason.
- Anything the owner watches already (their own website and social pages).

## Already covered (do not write prompts for these)

For every business, in every country and industry, the system already:

- reads the business's own website (home, about, contact);
- reads its Google Maps listings (rating, review count, phone, address);
- reads its LinkedIn company page;
- searches the web for `"<business>" {{COUNTRY}} reviews`, `... employee reviews` and `... news`, which brings back
  general review sites, job sites and news.

A separate run covers {{COUNTRY}}'s checks for every industry: the company register, courts and insolvency, general
business directories.

If a prompt would work for any industry, leave it out. Do not reuse another country's bodies.

## How the system runs your prompts

- **No person is involved.** Every prompt runs automatically on **every** business of this industry in {{COUNTRY}}.
  Nothing checks first whether the prompt applies to that business.
- The system knows the business's name, country and industry, and usually its website. It does **not** know its
  registration number.
- It saves what it read, raw. A later step compares that with what the business says about itself and decides what
  matters.

So a good prompt can be read without a person, is cheap to run on every business, and returns a page or search result
that **names the business when the business is there**.

The system can run web searches, fetch pages (including pages that load their content by script) and read PDFs. It
reads a list up to about one million characters. It cannot log in, pay, solve a CAPTCHA, post a form or keep a
session.

## The three ways a prompt can run (`query_type`)

- **`site_search`**: the system searches `"<business name>" site:<host of source.url>` and keeps the top three results.
  Use it for award, platform, directory and member sites that have a page per business which search engines index.
  `source.url` must be on the **narrowest host** that holds those pages (for example the awards site itself, not the
  parent organisation). Never a broad government or portal domain: there the name matches unrelated pages. Leave
  `query_url` empty.
- **`url_template`**: `query_url` contains `{company}`. The system puts the business name there and reads the page
  that comes back. Use it only if you opened such an address yourself and the results were in the page.
  `{company}` is the only placeholder: the system has no registration number.
- **`static_list`**: `query_url` is one page or PDF that lists the businesses itself (winners, members, sanctions,
  approvals). The system reads it whole and looks for the name. Give the address of the list, not of a page that
  links to it. If the list is split by year or by page, give the current or main one and say so in `how_to_query`.

If none of the three works for a source, it goes in `sources_rejected`.

## Your task

1. Use live web search to find the sources above for {{INDUSTRY}} in {{COUNTRY}}. Read sources in the local language
   where they are in one.
2. Open every source yourself and choose its `query_type`.
3. Check that it works: take a business you can see on the source, run the same search or open the same address, and
   confirm its name comes back. A prompt that cannot bring back a business you know is listed goes in
   `sources_rejected`.
4. If this industry covers different kinds of business that appear in different places (for example a freight
   forwarder and a food importer), cover each kind and name it in `sub_segment`. Use `all` when a prompt fits every
   kind.
5. Return up to 12 prompts, most valuable first. Fewer is fine. Never pad with generic checks.

## Output

Return JSON only, with nothing around it. The tracker rejects anything outside these lists.

- `category`: identity_registration, licence, regulator_action, professional_membership, register, awards,
  directory, reviews, people, claims_check, tenders_partnerships, local_social, court_insolvency, news_press
- `problem_type` (one or more): contradiction, legal, misinformation, contact_mess, missing_credential, reputation,
  missed_advantage
- `query_type`: site_search, url_template, static_list
- `confidence`: high, medium, low (how sure you are the source works as described)

Field rules:

- `applies_when`: which businesses of this industry are expected on this source, in plain words (for example
  "renovation contractors who take on structural work"). Use `always` when any business of this industry may be on
  it. It does not stop the prompt from running; the later step uses it to read the result.
- `query_url`: required for `url_template` (with `{company}`) and `static_list`; empty for `site_search`.
- `found_when`: what in the result is worth telling the owner (for example a listing with a different phone, a win
  the business does not show, a sanction).
- `not_found_when`: what the result looks like when the business is not on the source. Not being on a list is often
  normal and is not a problem by itself.
- `couldnt_check_when`: when the result cannot be trusted (the page did not load, the list is out of date, the name
  is shared by other businesses).

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
      "why_it_matters": "one sentence: what the owner may not know that this can show",
      "source": {"name": "", "url": "https://", "type": "", "language": ""},
      "query_type": "",
      "query_url": "",
      "how_to_query": "in words: what is searched or read, and which part of the page answers",
      "found_when": "",
      "not_found_when": "",
      "couldnt_check_when": "",
      "confidence": ""
    }
  ],
  "sources_rejected": [{"name": "", "url": "", "why": ""}],
  "open_questions": []
}
```

## Rules

- Never guess. Never give a URL you have not opened yourself.
- Never bypass a login, paywall or CAPTCHA.
- Write in English even when the source is in another language.
- Do not copy any example above. Every value must come from your own research.
