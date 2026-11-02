// Public OpenAPI contract for business discovery, company dossiers and VIP briefs.
// Keep this focused on requester-facing endpoints; the operational gateway and
// worker routes remain documented in /docs but are not part of this product API.

export const document = {
  openapi: '3.1.0',
  info: {
    title: 'EE Business Intelligence API',
    version: '1.0.0',
    description: 'Asynchronous Google Maps business discovery, evidence-guarded company research and public-professional VIP briefs, with durable public report links.',
  },
  servers: [{ url: 'https://ee-auto.up.railway.app', description: 'Production' }],
  tags: [
    { name: 'Business search', description: 'Discover and persist a ranked business list from Google Maps.' },
    { name: 'Company research', description: 'Enrich one persisted company through the four-round research workflow.' },
    { name: 'Person research', description: 'Create a public-professional VIP brief from a validated person in a completed company report.' },
    { name: 'Published reports', description: 'Read final public output using an opaque report identifier.' },
    { name: 'Company dive', description: 'Deep dive one company by name: a cited dossier plus linked people, behind a public report link that shows live progress.' },
    { name: 'Telemarketing', description: 'Telemarketer agent lead distribution, disposition updates, and notes authenticated by Telemarketer UID.' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/reports': {
      get: {
        operationId: 'listReports',
        tags: ['Published reports'],
        summary: 'Browse the combined report library',
        description: 'Returns business searches and company research reports newest first. This is the data source for the end-user research workspace.',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['business_search', 'company_research', 'person_research', 'ads_research'] } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/ReportStatus' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 40 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': { description: 'Combined report library', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportListResponse' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/reports/{reportId}': {
      delete: {
        operationId: 'deleteReport',
        tags: ['Published reports'],
        summary: 'Delete a report permanently',
        description: 'Removes the report, its research runs and its run trail, and kills the public /r/{reportId} link. Works on any report type and any status, including a run still in flight. The persisted company and person dataset is never touched. This cannot be undone.',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Report deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/DeletedReport' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/reports/{reportId}/retry': {
      post: {
        operationId: 'retryReport',
        tags: ['Published reports'],
        summary: 'Re-run a failed report in place',
        description: 'Re-queues a failed report on its own row: the same public /r/{reportId} link, the same title, and the original request inputs replayed through the normal pipeline. The claim is an atomic compare-and-swap on status, so a double click or two racing callers still produce exactly one run — the loser gets 409. Completed and partial reports are refused: researching the same company again is a new report, never an overwrite of a finished one. 409 also covers original inputs that are gone (the company row was deleted, the source person no longer has an evidenced role); the report then keeps its failed status and its original error.',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '202': { description: 'Report queued for a fresh run', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { description: 'Report is not failed, was already claimed by another caller, or its original inputs are no longer available', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/reports/{reportId}/repair': {
      post: {
        operationId: 'repairBusinessSearch',
        tags: ['Published reports'],
        summary: 'Save a captured business list without scanning again',
        description: 'For a partial or failed business-list report, replay its captured companies or recover the worker-saved search by job id, verify the company links, and mark the same report completed. Safe to retry after a database outage; existing companies and links are reused. A worker recovery copy may be uploaded as snapshot only with LAB_TOKEN; this also supports a stranded running report after a restart.',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Captured businesses saved and verified' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { description: 'No captured business list is available for repair' },
          '500': { description: 'Database repair failed; the captured report remains available' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/business-search': {
      post: {
        operationId: 'createBusinessSearch',
        tags: ['Business search'],
        summary: 'Start a business-list search',
        description: 'Search by business keyword, location, or both. Returns immediately with a durable report id. Poll api_url until status is completed, partial, or failed.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BusinessSearchRequest' }, examples: { solarKualaLumpur: { value: { keyword: 'solar installer', place: 'Kuala Lumpur', max: 40, requesterId: 'crm-42' } }, locationOnly: { value: { place: 'Petaling Jaya', max: 25, requesterId: 'crm-42' } } } } } },
        responses: {
          '202': { description: 'Search accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/business-search/{reportId}': {
      get: {
        operationId: 'getBusinessSearch',
        tags: ['Business search'],
        summary: 'Poll a business-list report',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Current report state and discovered companies', content: { 'application/json': { schema: { $ref: '#/components/schemas/BusinessSearchResponse' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/company-research': {
      post: {
        operationId: 'createCompanyResearch',
        tags: ['Company research'],
        summary: 'Start deep research for one company',
        description: 'companyId must be the numeric id returned in data.companies[] by a completed business search.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyResearchRequest' }, examples: { persistedCompany: { value: { companyId: '69', requesterId: 'crm-42' } } } } } },
        responses: {
          '202': { description: 'Research accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { description: 'The company id is not present in the persisted company table', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/company-research/{reportId}': {
      get: {
        operationId: 'getCompanyResearch',
        tags: ['Company research'],
        summary: 'Poll a company research report',
        description: 'Authenticated response includes canonical English final output, final_cn when the zh-CN translation is ready, validated ledger, raw round artifacts and round statuses for benchmarking.',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Current research state', content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyResearchResponse' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/contact-research': {
      post: {
        operationId: 'createContactResearch',
        tags: ['Contact research'],
        summary: 'Start telemarketing contact and decision-maker research',
        description: 'Lightweight, fast contact research optimized for outbound sales and telemarketing. Either companyId or company name is required. Returns verified decision makers, dialable phone numbers (with WhatsApp links and E.164 normalization), and gatekeeper call scripts.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  companyId: { type: 'string', description: 'Numeric company ID from a business search.' },
                  name: { type: 'string', description: 'Company name if researching without a prior Maps scan.' },
                  targetRole: { type: 'string', description: 'Optional target persona or role filter (e.g. Procurement, CEO, GM).' },
                  compareToReportId: { type: 'string', description: 'Optional earlier contact report for a comparison link in the new report.' },
                  requesterId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Research already in flight for this company; existing report returned', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '202': { description: 'Contact research accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/contact-research/{reportId}': {
      get: {
        operationId: 'getContactResearch',
        tags: ['Contact research'],
        summary: 'Poll a contact research report',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Current contact research report state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportEnvelope' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/parallel-contact-research': {
      post: {
        operationId: 'createParallelContactResearch',
        tags: ['Contact research'],
        summary: 'Find company decision makers with Parallel Entity Search',
        description: 'Uses PARALLEL_API_KEY on the server. Accepts companyId or company name and optional targetRole. Saves to the same contact research report and ledger as the existing provider. Entity Search returns names, profile URLs and descriptions; it does not supply direct phone numbers or emails.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          companyId: { type: 'string' }, name: { type: 'string' }, targetRole: { type: 'string' }, requesterId: { type: 'string' },
          compareToReportId: { type: 'string', description: 'Optional earlier contact report for comparison.' },
        } } } } },
        responses: {
          '200': { description: 'Parallel run already in flight', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '202': { description: 'Parallel contact research accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/parallel-contact-research/{reportId}': {
      get: {
        operationId: 'getParallelContactResearch', tags: ['Contact research'], summary: 'Poll a Parallel contact report',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Current contact research report state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportEnvelope' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/person-research': {
      post: {
        operationId: 'createPersonResearch',
        tags: ['Person research'],
        summary: 'Start a public-professional VIP brief',
        description: 'Starts from a validated person in a completed company-research report. Optional email and mobile resolvers are used only during the live identifier-assisted discovery pass via Pi, then discarded. They are not persisted in the report request, audit record, or published output. One brief per person per source report: if a brief already exists — including the automatic P01 one — the existing report is returned with 200 instead of a second run being started.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonResearchRequest' } } } },
        responses: {
          '200': { description: 'A brief for this person already exists; the existing report is returned', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '202': { description: 'VIP brief accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/person-research/{reportId}': {
      get: {
        operationId: 'getPersonResearch', tags: ['Person research'], summary: 'Poll a VIP brief',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: { '200': { description: 'Current VIP brief state', content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonResearchResponse' } } } }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/api/ads-research': {
      post: {
        operationId: 'createAdsResearch',
        tags: ['Ads research'],
        summary: 'Capture the ads a company is running',
        description: 'Captures live ads for a company from the Facebook Ad Library and the Google Ads Transparency Center via the ads.company worker. Deterministic: no model is called. Google publishes no ad text, so its rows carry format and dates only \u2014 the wording exists solely inside the creative image.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdsResearchRequest' } } } },
        responses: {
          '200': { description: 'A capture for this companyId is already running; the existing report is returned', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '202': { description: 'Ads capture accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/api/ads-research/{reportId}': {
      get: {
        operationId: 'getAdsResearch', tags: ['Ads research'], summary: 'Poll an ads report',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: { '200': { description: 'Current ads report state', content: { 'application/json': { schema: { $ref: '#/components/schemas/AdsResearchResponse' } } } }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/api/ads-market': {
      post: {
        operationId: 'createAdsMarket',
        tags: ['Ads research'],
        summary: 'Research a whole market from a product keyword',
        description: 'Captures every live Facebook ad matching the keyword via the ads.market worker, rolls it up deterministically, then writes one report from that rollup. Facebook only: the Google Ads Transparency Center has no keyword search of ad content. The Ad Library carries no spend, impressions or reach for commercial ads, so advertisers are ranked by ad count, distinct creatives and days running \u2014 never by budget.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdsMarketRequest' } } } },
        responses: {
          '200': { description: 'A capture for these keywords is already in flight; the existing report is returned', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '202': { description: 'Market research accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedReport' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/api/ads-market/{reportId}': {
      get: {
        operationId: 'getAdsMarket', tags: ['Ads research'], summary: 'Poll a market report',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: { '200': { description: 'Current market report state', content: { 'application/json': { schema: { $ref: '#/components/schemas/AdsMarketResponse' } } } }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/public/reports/{reportId}': {
      get: {
        security: [],
        operationId: 'getPublishedReportJson',
        tags: ['Published reports'],
        summary: 'Read final public report JSON',
        description: 'No bearer token. Returns the public report envelope and final output only; raw research rounds are never exposed.',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Published final report', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicReportResponse' } } } },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/company-dive': {
      post: {
        operationId: 'createCompanyDive',
        tags: ['Company dive'],
        summary: 'Start a company deep dive and get its public report link at once',
        description: 'Brave discovery, at most 15 Tavily calls, deepseek analysis, then (unless people is false) an Exa search for people linked to the company. Takes 5 to 10 minutes. report_url works immediately: it shows live progress, then the finished report. Reports run one at a time; a later request waits its turn.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyDiveRequest' }, examples: { eternalgy: { value: { company: 'Eternalgy Sdn Bhd', country: 'Malaysia' } } } } } },
        responses: {
          '202': { description: 'Dive queued; report link ready', content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyDiveAccepted' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { description: 'No report database, or no Brave keys', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        operationId: 'listCompanyDives',
        tags: ['Company dive'],
        summary: 'The 50 newest company dives',
        responses: {
          '200': { description: 'Recent dives, newest first', content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyDiveList' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/company-dive/{diveId}': {
      get: {
        operationId: 'getCompanyDive',
        tags: ['Company dive'],
        summary: 'One dive in full, including internal call details',
        description: 'Everything /d/{publicId}/data shows, plus every source found, every fact, each Tavily call with its credits and each LLM call with its model and time.',
        parameters: [{ $ref: '#/components/parameters/DiveId' }],
        responses: {
          '200': { description: 'The dive record', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/company-dive/{diveId}/people': {
      post: {
        operationId: 'runCompanyDivePeople',
        tags: ['Company dive'],
        summary: 'Run the Exa people step again on a finished dive',
        description: 'Reads the saved research and does not redo it. At most 20 Exa calls. The result lands in the report people section.',
        parameters: [{ $ref: '#/components/parameters/DiveId' }],
        responses: {
          '202': { description: 'People step started', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, people: { type: 'string', enum: ['running'] }, view_url: { type: 'string' } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { description: 'The dive has no saved research yet, or the people step is already running', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        operationId: 'getCompanyDivePeople',
        tags: ['Company dive'],
        summary: 'The people step result in full',
        description: 'Includes the rejected lookalikes and every Exa query with its cost.',
        parameters: [{ $ref: '#/components/parameters/DiveId' }],
        responses: {
          '200': { description: 'People step result, or null if it never ran', content: { 'application/json': { schema: { type: 'object', properties: { people: { oneOf: [{ $ref: '#/components/schemas/CompanyDivePeople' }, { type: 'null' }] } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/d/{publicId}/data': {
      get: {
        security: [],
        operationId: 'getCompanyDivePublic',
        tags: ['Company dive'],
        summary: 'Public status and report JSON for one dive',
        description: 'No bearer token: the opaque id is the permission. Poll every 5 to 10 seconds until status is done, partial or failed. No keys or internal call details are exposed.',
        parameters: [{ $ref: '#/components/parameters/DivePublicId' }],
        responses: {
          '200': { description: 'Current state of the dive', content: { 'application/json': { schema: { $ref: '#/components/schemas/CompanyDivePublic' } } } },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/d/{publicId}': {
      get: {
        security: [],
        operationId: 'viewCompanyDiveReport',
        tags: ['Company dive'],
        summary: 'The public report page',
        description: 'No bearer token. Shows the stages and live log while the dive runs, then renders the report in place. Mobile friendly, light and dark, printable.',
        parameters: [{ $ref: '#/components/parameters/DivePublicId' }],
        responses: {
          '200': { description: 'HTML report page', content: { 'text/html': { schema: { type: 'string' } } } },
          '404': { description: 'Report not found page', content: { 'text/html': { schema: { type: 'string' } } } },
        },
      },
    },
    '/r/{reportId}': {
      get: {
        security: [],
        operationId: 'viewPublishedReport',
        tags: ['Published reports'],
        summary: 'Open the mobile report page',
        parameters: [{ $ref: '#/components/parameters/ReportId' }],
        responses: {
          '200': { description: 'Mobile-first HTML report', content: { 'text/html': { schema: { type: 'string' } } } },
          '404': { description: 'Report page not found' },
        },
      },
    },
    '/api/telemarketer/roster': {
      get: {
        security: [],
        operationId: 'listTelemarketerRoster',
        tags: ['Telemarketing'],
        summary: 'List active telemarketers roster and discovery endpoint',
        description: 'Returns all active telemarketers with their unique UID, phone, email, and pipeline stats to discover agent IDs.',
        responses: {
          '200': { description: 'Roster of active telemarketers' },
        },
      },
    },
    '/api/telemarketer/leads': {
      get: {
        security: [],
        operationId: 'listTelemarketerLeads',
        tags: ['Telemarketing'],
        summary: 'Read assigned leads for a telemarketer',
        description: 'Requires Telemarketer UID via query param ?uid=, header X-Telemarketer-UID, or Bearer auth. No operator token required.',
        parameters: [
          { name: 'uid', in: 'query', schema: { type: 'string' }, description: 'Telemarketer UID (e.g. TM-SARAH)' },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['assigned', 'contacted', 'interested', 'not_interested', 'do_not_call'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'sort', in: 'query', schema: { type: 'string', default: 'created_at' } },
        ],
        responses: {
          '200': { description: 'Assigned leads list and disposition statistics' },
          '401': { description: 'Missing Telemarketer UID' },
          '403': { description: 'Invalid or inactive Telemarketer UID' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/api/telemarketer/{uid}/leads': {
      get: {
        security: [],
        operationId: 'listTelemarketerLeadsByPath',
        tags: ['Telemarketing'],
        summary: 'Read assigned leads by path UID',
        parameters: [
          { name: 'uid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': { description: 'Assigned leads list' },
          '403': { description: 'Invalid or inactive Telemarketer UID' },
        },
      },
    },
    '/api/telemarketer/leads/{id}': {
      get: {
        security: [],
        operationId: 'getTelemarketerLeadDetail',
        tags: ['Telemarketing'],
        summary: 'Read single lead details with contacts and decision makers',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Company / Lead ID' },
          { name: 'uid', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Lead detail including phone contacts and decision makers' },
          '403': { description: 'Lead assigned to another agent or invalid UID' },
          '404': { description: 'Lead not found' },
        },
      },
      patch: {
        security: [],
        operationId: 'updateTelemarketerLead',
        tags: ['Telemarketing'],
        summary: 'Update lead status and add / append notes',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'uid', in: 'query', schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  leadStatus: { type: 'string', enum: ['assigned', 'contacted', 'interested', 'not_interested', 'do_not_call', 'unassigned'] },
                  notes: { type: 'string', description: 'Replaces lead notes entirely' },
                  appendNotes: { type: 'string', description: 'Appends to notes with date prefix' },
                  uid: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Lead updated successfully' },
          '400': { description: 'Invalid status or missing update fields' },
          '403': { description: 'Lead assigned to another telemarketer' },
          '404': { description: 'Lead not found' },
        },
      },
    },
    '/api/telemarketer/me': {
      get: {
        security: [],
        operationId: 'getTelemarketerProfile',
        tags: ['Telemarketing'],
        summary: 'Telemarketer profile and pipeline status counts',
        parameters: [
          { name: 'uid', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Telemarketer profile and statistics' },
          '403': { description: 'Invalid or inactive Telemarketer UID' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'LAB_TOKEN', description: 'Send the EE Auto service token. Never place it in a public report URL.' },
    },
    parameters: {
      DiveId: { name: 'diveId', in: 'path', required: true, description: 'Numeric dive id returned as id', schema: { type: 'integer' }, example: 4 },
      DivePublicId: { name: 'publicId', in: 'path', required: true, description: 'Opaque 20-character id returned as public_id', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$' }, example: 'sf9S9f84Sfi3cx0KGtBW' },
      ReportId: { name: 'reportId', in: 'path', required: true, description: 'Opaque 20-character id returned as report.id', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$' }, example: 'AbCdEfGhIjKlMnOpQrSt' },
    },
    responses: {
      BadRequest: { description: 'Invalid request body', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Unauthorized: { description: 'Missing or invalid bearer token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'Report not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Unavailable: { description: 'Report database is unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    schemas: {
      ReportStatus: { type: 'string', enum: ['queued', 'running', 'completed', 'partial', 'failed'], description: 'completed and partial contain publishable output; partial means at least one research round or validation step had a gap.' },
      ReportEnvelope: {
        type: 'object', required: ['id', 'type', 'status', 'title', 'created_at', 'updated_at', 'view_url', 'api_url'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$' },
          type: { type: 'string', enum: ['business_search', 'company_research', 'person_research', 'ads_research'] },
          status: { $ref: '#/components/schemas/ReportStatus' },
          title: { type: 'string' },
          version: { type: 'integer', minimum: 1, description: 'Which research pass this is on the same company. 1 is the first; re-researching the same company produces V2, V3, ... and never overwrites an earlier dossier. Always 1 for a business search.' },
          created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
          completed_at: { type: ['string', 'null'], format: 'date-time' }, view_url: { type: 'string', format: 'uri' }, api_url: { type: 'string', format: 'uri' },
          error: { type: ['string', 'null'], description: 'Failure detail or partial-run warning.' },
        },
      },
      ReportListItem: { allOf: [{ $ref: '#/components/schemas/ReportEnvelope' }, { type: 'object', properties: { preview: { type: 'object', additionalProperties: true } } }] },
      ReportListResponse: { type: 'object', required: ['reports', 'total', 'limit', 'offset'], properties: { reports: { type: 'array', items: { $ref: '#/components/schemas/ReportListItem' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
      AcceptedReport: { type: 'object', required: ['report'], properties: { report: { $ref: '#/components/schemas/ReportEnvelope' } } },
      DeletedReport: {
        type: 'object', required: ['deleted', 'id'],
        properties: {
          deleted: { type: 'boolean' },
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$' },
          type: { type: 'string', enum: ['business_search', 'company_research', 'person_research', 'ads_research'] },
          title: { type: ['string', 'null'] },
        },
      },
      BusinessSearchRequest: {
        type: 'object', additionalProperties: false,
        anyOf: [{ required: ['keyword'] }, { required: ['place'] }, { required: ['location'] }],
        properties: {
          keyword: { type: 'string', minLength: 1, description: 'Business category, service or keyword. Optional when place/location is supplied.' },
          place: { type: 'string', minLength: 1, description: 'City, district, state or country. Optional when keyword is supplied.' },
          location: { type: 'string', minLength: 1, description: 'Alias for place.' },
          max: { type: 'integer', minimum: 1, maximum: 2000, default: 200 },
          requesterId: { type: 'string', description: 'Optional caller-owned correlation id. userId is accepted as an alias.' },
          userId: { type: 'string', description: 'Alias for requesterId.' },
          timeoutMs: { type: 'integer', minimum: 1, default: 600000, description: 'Worker deadline; this does not make the POST synchronous.' },
        },
      },
      CompanyResearchRequest: {
        type: 'object', required: ['companyId'], additionalProperties: false,
        description: 'Researching a company that already has a dossier is allowed and produces the next version (V2, V3, ...) rather than returning the old one. A run still in flight is joined, not duplicated. Once the people audit identifies P01, a separate person_research report starts automatically in parallel with the remaining company rounds and translation. It uses the identical current VIP pipeline as POST /api/person-research: Pi primary discovery, capability-gated Facebook/Instagram/Threads and xAI/X scouts, independent audit, and validated synthesis.',
        properties: {
          companyId: { type: 'string', pattern: '^\\d+$', description: 'Persisted company id from data.companies[].id. company_id is accepted as an alias.' },
          requesterId: { type: 'string', description: 'Optional caller-owned correlation id. userId is accepted as an alias.' },
        },
      },
      PersonResearchRequest: {
        type: 'object', additionalProperties: false,
        anyOf: [
          { required: ['companyResearchId', 'personId'] },
          { required: ['companyResearchId', 'person_id'] },
          { required: ['company_research_id', 'personId'] },
          { required: ['company_research_id', 'person_id'] },
        ],
        properties: {
          companyResearchId: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$', description: 'Completed company-research report id. company_research_id is accepted as an alias.' },
          company_research_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{20}$', description: 'Alias for companyResearchId.' },
          personId: { type: 'string', minLength: 1, description: 'Validated person id from final.people[].id. person_id is accepted as an alias.' },
          person_id: { type: 'string', minLength: 1, description: 'Alias for personId.' },
          email: { type: 'string', format: 'email', description: 'Optional caller-supplied identity resolver. Used only for the live discovery pass; never persisted or published.' },
          mobile: { type: 'string', pattern: '^[+()\\d.\\s-]{7,32}$', description: 'Optional caller-supplied mobile resolver. It must contain 7–15 digits and may include formatting. Used only for the live discovery pass; never persisted or published.' },
          mobileNumber: { type: 'string', pattern: '^[+()\\d.\\s-]{7,32}$', description: 'Alias for mobile.' },
          phone: { type: 'string', pattern: '^[+()\\d.\\s-]{7,32}$', description: 'Alias for mobile.' },
          requesterId: { type: 'string' }, userId: { type: 'string' },
        },
      },
      AdsResearchRequest: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, description: 'Company or advertiser name. company is accepted as an alias.' },
          company: { type: 'string' },
          region: { type: 'string', description: 'Ad-library region code. Defaults to MY.' },
          fbMax: { type: 'integer', description: 'Cap on Facebook ads. 0 means keep going until the list stops growing.' },
          gMax: { type: 'integer', description: 'Cap on Google ads. Google costs one page load per ad, so it is capped at 30 by default.' },
          companyId: { type: 'string', description: "Links the report to a company dossier, and makes the call idempotent while a capture for that company is still in flight. company_id is accepted as an alias." },
          requesterId: { type: 'string' }, userId: { type: 'string' },
        },
      },
      AdsMarketRequest: {
        type: 'object', additionalProperties: false,
        properties: {
          keyword: { type: 'string', minLength: 1, description: 'The product keyword to research. product and query are accepted as aliases.' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Several keywords, fetched concurrently. Capped at 8. Supply this or keyword.' },
          product: { type: 'string' }, query: { type: 'string' },
          country: { type: 'string', description: 'Country name, mapped to the ad-library region. Defaults to Malaysia.' },
          region: { type: 'string', description: 'Two-letter ad-library region, if you would rather set it directly. Defaults to MY.' },
          pages: { type: 'integer', description: 'Pages per keyword at 30 ads each, 1-40. Defaults to 12, so up to 360 ads per keyword. A keyword that hits this cap is reported as truncated.' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Reasoning tier for the single report call. Defaults to high.' },
          requesterId: { type: 'string' }, userId: { type: 'string' },
        },
      },
      AdsMarketResponse: {
        type: 'object', required: ['report', 'data'], properties: {
          report: { $ref: '#/components/schemas/ReportEnvelope' },
          data: { type: 'object', properties: { report: { $ref: '#/components/schemas/ReportEnvelope' }, final: { type: ['object', 'null'], additionalProperties: true } } },
          research_run: { type: ['object', 'null'], additionalProperties: true, description: 'The ads_market_run row: keywords, region, per-keyword fetch stats, the digest the report was written from, the report markdown, and the promoted counts.' },
        },
      },
      Company: {
        type: 'object', required: ['id', 'name'],
        properties: {
          id: { type: 'string', description: 'Use this value as companyId for deep research.' }, place_id: { type: ['string', 'null'] }, name: { type: 'string' },
          rating: { type: ['number', 'string', 'null'] }, reviews: { type: ['integer', 'null'] }, category: { type: ['string', 'null'] }, address: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] }, website: { type: ['string', 'null'], format: 'uri' }, maps_url: { type: ['string', 'null'], format: 'uri' },
          source: { type: ['string', 'null'] }, first_seen_at: { type: ['string', 'null'], format: 'date-time' }, last_seen_at: { type: ['string', 'null'], format: 'date-time' }, rank: { type: ['integer', 'null'] },
        },
      },
      BusinessSearchResponse: {
        type: 'object', required: ['report', 'data'], properties: {
          report: { $ref: '#/components/schemas/ReportEnvelope' },
          data: { type: 'object', required: ['companies'], properties: { report: { type: 'object', additionalProperties: true }, search: { type: ['object', 'null'], additionalProperties: true }, companies: { type: 'array', items: { $ref: '#/components/schemas/Company' } } } },
          research_run: { type: 'null' },
        },
      },
      FinalCompanyReport: {
        type: 'object',
        properties: {
          entity: { type: 'object', additionalProperties: true }, summary: { type: ['string', 'null'] }, contacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
          people: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'People whose current role has direct evidence.' },
          candidate_people: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Named public-source leads that require direct current-role verification; they are not eligible for automatic VIP research.' },
          signals: { type: 'array', items: { type: 'object', additionalProperties: true } },
          outreach_angles: { type: 'array', items: { type: 'string' } }, conflicts_and_unknowns: { type: 'array', items: { type: 'object', additionalProperties: true } },
          auto_person_research: { type: ['object', 'null'], additionalProperties: true, description: 'Separate automatically triggered P01 VIP report reference. The child uses the same current VIP pipeline as POST /api/person-research.' },
          synthesis_mode: { type: 'string', enum: ['pi_validated', 'gemini_validated', 'validated_ledger_fallback'] },
        }, additionalProperties: true,
      },
      FinalPersonReport: {
        type: 'object', properties: {
          person: { type: 'object', additionalProperties: true }, summary: { type: ['string', 'null'] },
          contacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
          facts: { type: 'array', items: { type: 'object', additionalProperties: true } }, signals: { type: 'array', items: { type: 'object', additionalProperties: true } },
          research_angles: { type: 'array', items: { type: 'string' } },
          synthesis_mode: { type: 'string', enum: ['pi_validated', 'chatgpt_validated', 'validated_ledger_fallback'], description: 'chatgpt_validated appears only on reports written before 2026-10-26.' },
        }, additionalProperties: true,
      },
      ResearchRun: {
        type: ['object', 'null'], description: 'Authenticated benchmark record. Round artifacts may be null until that round is saved.',
        properties: {
          report_id: { type: 'string' },
          round01: { type: ['object', 'null'], additionalProperties: true, description: 'Pi discovery.' },
          round02: { type: ['object', 'null'], additionalProperties: true, description: 'Three split Pi audits: contacts, people, signals.' },
          round03: { type: ['object', 'null'], additionalProperties: true, description: 'Facebook evidence from the read-only fb-recon crawler on the home worker. access_mode is live_facebook_pages or no_live_access; rows carry the facebook.com URL each field was read from. Status is skipped when no worker is claiming fb.company.' },
          round04: { type: ['object', 'null'], additionalProperties: true, description: 'Pi synthesis, rejected and replaced by the ledger if it invents a row or a URL.' },
          validated_ledger: { type: ['object', 'null'], additionalProperties: true }, final_report: { oneOf: [{ $ref: '#/components/schemas/FinalCompanyReport' }, { type: 'null' }] },
          round_status: { type: 'object', additionalProperties: { type: 'string' } }, engine_metadata: { type: 'object', additionalProperties: true },
          started_at: { type: ['string', 'null'], format: 'date-time' }, completed_at: { type: ['string', 'null'], format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
        },
      },
      PersonResearchRun: {
        type: ['object', 'null'], description: 'Authenticated VIP-brief audit record. It retains validated public-professional evidence plus primary discovery, Facebook/Instagram/Threads scout, xAI/X scout, independent-audit, and synthesis metadata; it never retains caller-supplied email or mobile resolvers. Social lanes are capability-gated and may report unavailable when their worker is offline.',
        properties: {
          report_id: { type: 'string' }, discovery: { type: ['object', 'null'], additionalProperties: true }, synthesis: { type: ['object', 'null'], additionalProperties: true },
          validated_ledger: { oneOf: [{ $ref: '#/components/schemas/FinalPersonReport' }, { type: 'null' }] }, final_report: { oneOf: [{ $ref: '#/components/schemas/FinalPersonReport' }, { type: 'null' }] },
          run_status: { type: 'object', additionalProperties: true }, engine_metadata: { type: 'object', additionalProperties: true },
          started_at: { type: ['string', 'null'], format: 'date-time' }, completed_at: { type: ['string', 'null'], format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CompanyResearchResponse: {
        type: 'object', required: ['report', 'data'], properties: {
          report: { $ref: '#/components/schemas/ReportEnvelope' },
          data: { type: 'object', properties: { report: { type: 'object', additionalProperties: true }, final: { oneOf: [{ $ref: '#/components/schemas/FinalCompanyReport' }, { type: 'null' }] }, final_cn: { oneOf: [{ $ref: '#/components/schemas/FinalCompanyReport' }, { type: 'null' }], description: 'Simplified Chinese translation of final. Source URLs, IDs and published contact values are unchanged.' }, translation: { type: ['object', 'null'], additionalProperties: true } } },
          research_run: { $ref: '#/components/schemas/ResearchRun' },
        },
      },
      PersonResearchResponse: {
        type: 'object', required: ['report', 'data'], properties: {
          report: { $ref: '#/components/schemas/ReportEnvelope' },
          data: { type: 'object', properties: { report: { $ref: '#/components/schemas/ReportEnvelope' }, final: { oneOf: [{ $ref: '#/components/schemas/FinalPersonReport' }, { type: 'null' }] } } },
          research_run: { $ref: '#/components/schemas/PersonResearchRun' },
        },
      },
      AdsResearchRun: {
        type: ['object', 'null'], description: 'Authenticated ads-capture audit record: the raw per-network captures plus execution metadata.',
        properties: {
          report_id: { type: 'string' },
          facebook: { type: ['object', 'null'], additionalProperties: true },
          google: { type: ['object', 'null'], additionalProperties: true },
          ads: { type: ['object', 'null'], additionalProperties: true },
          final_report: { type: ['object', 'null'], additionalProperties: true },
          run_status: { type: 'object', additionalProperties: true }, engine_metadata: { type: 'object', additionalProperties: true },
          started_at: { type: ['string', 'null'], format: 'date-time' }, completed_at: { type: ['string', 'null'], format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
        },
      },
      AdsResearchResponse: {
        type: 'object', required: ['report', 'data'], properties: {
          report: { $ref: '#/components/schemas/ReportEnvelope' },
          data: { type: 'object', properties: { report: { $ref: '#/components/schemas/ReportEnvelope' }, final: { type: ['object', 'null'], additionalProperties: true } } },
          research_run: { $ref: '#/components/schemas/AdsResearchRun' },
        },
      },
      PublicSearchReportResponse: { type: 'object', required: ['report', 'companies'], properties: { report: { type: 'object', additionalProperties: true }, search: { type: ['object', 'null'], additionalProperties: true }, companies: { type: 'array', items: { $ref: '#/components/schemas/Company' } } } },
      PublicCompanyReportResponse: { type: 'object', required: ['report', 'final'], properties: { report: { type: 'object', additionalProperties: true }, final: { oneOf: [{ $ref: '#/components/schemas/FinalCompanyReport' }, { type: 'null' }] }, final_cn: { oneOf: [{ $ref: '#/components/schemas/FinalCompanyReport' }, { type: 'null' }] }, translation: { type: ['object', 'null'], additionalProperties: true } } },
      PublicPersonReportResponse: { type: 'object', required: ['report', 'final'], properties: { report: { type: 'object', additionalProperties: true }, final: { oneOf: [{ $ref: '#/components/schemas/FinalPersonReport' }, { type: 'null' }] } } },
      PublicReportResponse: { oneOf: [{ $ref: '#/components/schemas/PublicSearchReportResponse' }, { $ref: '#/components/schemas/PublicCompanyReportResponse' }, { $ref: '#/components/schemas/PublicPersonReportResponse' }] },
      CompanyDiveRequest: {
        type: 'object',
        required: ['company'],
        properties: {
          company: { type: 'string', minLength: 2, maxLength: 200, description: 'Company name. name is accepted as an alias.' },
          country: { type: 'string', default: 'Malaysia' },
          people: { type: 'boolean', default: true, description: 'Run the Exa people step after the research.' },
        },
      },
      CompanyDiveAccepted: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          public_id: { type: 'string' },
          status: { type: 'string', enum: ['queued'] },
          company: { type: 'string' },
          country: { type: 'string' },
          people: { type: 'boolean' },
          queued_behind_another: { type: 'boolean', description: 'True when another dive holds the one research slot.' },
          report_url: { type: 'string', format: 'uri', description: 'Public link: live progress now, the report when done.' },
          status_url: { type: 'string', format: 'uri', description: 'Public JSON to poll.' },
          api_url: { type: 'string', format: 'uri' },
          expected_minutes: { type: 'string', example: '5-10' },
        },
      },
      CompanyDiveStatus: { type: 'string', enum: ['queued', 'running', 'done', 'partial', 'failed'], description: 'partial = finished, but a step used a fallback.' },
      CompanyDiveList: {
        type: 'object',
        properties: {
          dives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' }, public_id: { type: 'string' }, company: { type: 'string' }, country: { type: 'string' },
                status: { $ref: '#/components/schemas/CompanyDiveStatus' }, stage: { type: 'string' },
                tavily_calls: { type: 'integer' }, tavily_credits: { type: 'integer' }, brave_calls: { type: 'integer' }, llm_calls: { type: 'integer' },
                created_at: { type: 'string', format: 'date-time' }, finished_at: { type: ['string', 'null'], format: 'date-time' },
                report_url: { type: 'string', format: 'uri' }, status_url: { type: 'string', format: 'uri' }, api_url: { type: 'string', format: 'uri' },
              },
            },
          },
        },
      },
      CompanyDivePerson: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          relation: { type: 'string', enum: ['founder', 'director', 'shareholder', 'management', 'employee', 'agent', 'partner', 'former', 'other'] },
          current: { type: ['boolean', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, quote: { type: 'string' } } } },
          notes: { type: 'string' },
        },
      },
      CompanyDivePeople: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'done', 'partial', 'failed'] },
          people: { type: 'array', items: { $ref: '#/components/schemas/CompanyDivePerson' } },
          rejected: { description: 'Public view: a count. Full record: [{name, reason}].' },
          log: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, msg: { type: 'string' } } } },
        },
        additionalProperties: true,
      },
      CompanyDivePublic: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          country: { type: 'string' },
          status: { $ref: '#/components/schemas/CompanyDiveStatus' },
          stage: { type: 'string', enum: ['', 'discover', 'triage', 'read', 'analyse', 'fill', 'reflect', 'write', 'people', 'done'] },
          error: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          finished_at: { type: ['string', 'null'], format: 'date-time' },
          log: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, stage: { type: 'string' }, msg: { type: 'string' } } } },
          dossier: { type: ['string', 'null'], description: 'Markdown with citations like [12]; present from the people stage on.' },
          identity: { type: ['object', 'null'], additionalProperties: true },
          sources: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' }, url: { type: 'string' } } } },
          stats: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          people: { oneOf: [{ $ref: '#/components/schemas/CompanyDivePeople' }, { type: 'null' }] },
        },
      },
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, companyId: { type: 'string' } } },
    },
  },
} as const;
