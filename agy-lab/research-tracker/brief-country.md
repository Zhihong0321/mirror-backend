# Research brief: company due diligence in {{COUNTRY}}

## The goal

We want to do due diligence on any company from {{COUNTRY}}, whatever its industry, using **public information from the
web only**. This pass is discovery: **what** can we look at, and **where**. Be as complete as you can. A later pass
tests each source, so list every source you believe exists, even if you are not sure it can be read publicly.

## Answer these questions for {{COUNTRY}}

1. **Public business information.** Which websites publish business information, registrations, certifications or
   licences that anyone can access? (company registers, tax or business-number lookups, regulator and licensing
   bodies, court or insolvency notices, trademark registers, certification bodies)
2. **Large collections of business data.** Which websites hold a large quantity of business data? (for example the
   top local job portals, B2B directories, yellow pages, marketplaces)
3. **Local social media and forums.** What are the popular social media sites and forums in {{COUNTRY}}, **not
   counting** the global major ones (Facebook, Instagram, LinkedIn, X, YouTube, TikTok)?
4. **Business portals.** Which business portals exist in {{COUNTRY}}? (chambers of commerce, trade associations,
   business news portals, startup or SME portals)
5. **Your suggestion.** Based on what is publicly accessible on the web, how would you do due diligence on a company
   from {{COUNTRY}}? What would you look at, and where?

Read sources in the local language where they are in one.

## Output

Return JSON only, with nothing around it:

```json
{
  "sources": [
    {
      "group": "public_business_info | large_business_data | local_social_forum | business_portal",
      "name": "",
      "url": "https://",
      "what_to_see": "what a person learns about a company here",
      "language": ""
    }
  ],
  "suggestion": "your answer to question 5, in plain words"
}
```

- List as many sources as you can find. Do not leave a source out because you are unsure about it.
- Write in English even when the source is in another language.
- Never invent a URL. If you are unsure of the exact address, give the site's main address.
