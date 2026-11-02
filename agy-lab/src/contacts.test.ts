import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCompanyContacts, buildMasterContactsResponse, generateContactsCsv } from './contacts.ts';
import type { RawCompanyContactRow } from './reportdb.ts';
import { page } from './portal.ts';

test('Contacts Master combines Parallel people with existing contact phones', () => {
  const row: RawCompanyContactRow = {
    id: '42', name: 'Acme Energy', category: null, address: null, phone: null,
    website: null, maps_url: null, rating: null, reviews: null,
    lead_status: 'unassigned', assigned_to: null,
    contact_public_id: 'parallel-run', contact_status: 'completed',
    contact_result: { decision_makers: [{ name: 'Jane Lee', role: 'Managing Director', profile_url: 'https://example.com/jane' }] },
    contact_results: [
      { decision_makers: [{ name: 'Jane Lee', role: 'Managing Director', profile_url: 'https://example.com/jane' }] },
      { phone_contacts: [{ number_raw: '012-7654321', type: 'mobile_whatsapp' }], email_contacts: [{ email: 'info@acme.example' }] },
    ],
    research_public_id: null, research_status: null, research_result: null,
  };
  const group = extractCompanyContacts(row);
  assert.deepEqual(group.people.map(person => person.name), ['Jane Lee']);
  assert.equal(group.phones.length, 1);
  assert.equal(group.emails.length, 1);
});

test('extractCompanyContacts extracts people, phones, cheat sheet and normalizes entries', () => {
  const mockRow: RawCompanyContactRow = {
    id: 'comp-01',
    name: 'Acme Solar Sdn Bhd',
    address: '12 Jalan Industri, Johor Bahru',
    phone: '07-3331122',
    website: 'https://acmesolar.com.my',
    maps_url: 'https://maps.google.com/?cid=123',
    category: 'Solar energy equipment supplier',
    rating: 4.8,
    reviews: 35,
    lead_status: 'assigned',
    assigned_to: 'Sarah Tan',
    contact_public_id: 'crep-abc',
    contact_status: 'completed',
    contact_result: {
      decision_makers: [
        { name: 'Tan Ah Kow', role: 'Managing Director', seniority: 10, is_primary: true, direct_phone: '012-7654321', direct_email: 'tan@acmesolar.com.my' },
        { name: 'David Lee', role: 'Sales Manager', seniority: 5, is_primary: false, direct_phone: '+60 19-8887766' }
      ],
      phone_contacts: [
        { number_raw: '07-3331122', type: 'office', label: 'HQ General Line', is_primary: false },
        { number_raw: '012-7654321', type: 'mobile_whatsapp', label: 'Director Direct WhatsApp', is_primary: true }
      ],
      email_contacts: [
        { email: 'info@acmesolar.com.my', label: 'General Office' },
        { email: 'tan@acmesolar.com.my', label: 'Director Email' }
      ],
      cheat_sheet: {
        primary_decision_maker: 'Tan Ah Kow',
        gatekeeper_phrase: 'May I speak with Mr. Tan regarding solar EPC partnerships?',
        dial_url: 'tel:+60127654321',
        whatsapp_url: 'https://wa.me/60127654321'
      }
    },
    research_public_id: 'rep-xyz',
    research_status: 'completed',
    research_result: {
      people: [
        { name: 'Tan Ah Kow', role: 'Founder & MD', seniority: 10 },
        { name: 'Jessica Lim', role: 'Head of Engineering', seniority: 8, evidence_url: 'https://acmesolar.com.my/team' }
      ],
      contacts: [
        { value_as_published: '07-3331122', type: 'phone', purpose: 'office' },
        { value_as_published: '016-1112233', type: 'phone', purpose: 'technical support' }
      ]
    }
  };

  const group = extractCompanyContacts(mockRow);

  assert.equal(group.company_name, 'Acme Solar Sdn Bhd');
  assert.equal(group.assigned_to, 'Sarah Tan');

  // Decision makers check: Tan Ah Kow should be primary and deduplicated
  assert.equal(group.people.length, 3); // Tan Ah Kow, Jessica Lim, David Lee
  const primaryDM = group.people[0];
  assert.equal(primaryDM.name, 'Tan Ah Kow');
  assert.equal(primaryDM.is_primary, true);
  assert.equal(primaryDM.direct_phone, '+60127654321');
  assert.equal(primaryDM.source, 'Contact research');
  const jessica = group.people.find((p) => p.name === 'Jessica Lim');
  assert.equal(jessica?.role, 'Head of Engineering');
  assert.equal(jessica?.source, 'acmesolar.com.my');
  assert.equal(jessica?.evidence_url, 'https://acmesolar.com.my/team');

  // Phone routes check: Mobile/WhatsApp should come before landlines
  assert.ok(group.phones.length >= 3);
  assert.equal(group.phones[0].is_mobile, true);
  assert.ok(group.phones[0].number.includes('012') || group.phones[0].number.includes('016'));

  // Gatekeeper phrase check
  assert.ok(group.gatekeeper_phrase?.includes('Mr. Tan'));

  // Direct emails check
  assert.ok(group.emails.some(e => e.email === 'tan@acmesolar.com.my'));
  assert.ok(group.emails.some(e => e.email === 'info@acmesolar.com.my'));
});

test('buildMasterContactsResponse sorts companies alphabetically, applies search & filters, calculates stats', () => {
  const rows: RawCompanyContactRow[] = [
    {
      id: 'c-b',
      name: 'Bintang Engineering Sdn Bhd',
      address: 'Kulai, Johor',
      phone: '07-6621122',
      website: 'https://bintang.com',
      maps_url: '',
      category: 'Machinery manufacturer',
      rating: 4.2,
      reviews: 10,
      lead_status: 'contacted',
      assigned_to: 'Sarah Tan',
      contact_public_id: 'cr-b',
      contact_status: 'completed',
      contact_result: {
        decision_makers: [{ name: 'Boon Lee', role: 'Operations Director', seniority: 8, is_primary: true, direct_phone: '019-7112233' }],
        phone_contacts: [{ number_raw: '019-7112233', type: 'mobile_whatsapp', is_primary: true }]
      },
      research_public_id: null,
      research_status: null,
      research_result: null
    },
    {
      id: 'c-a',
      name: 'Alpha Cold Storage Sdn Bhd',
      address: 'Johor Bahru',
      phone: '07-2223344',
      website: '',
      maps_url: '',
      category: 'Cold storage warehouse',
      rating: 4.0,
      reviews: 5,
      lead_status: 'unassigned',
      assigned_to: null,
      contact_public_id: null,
      contact_status: null,
      contact_result: null,
      research_public_id: null,
      research_status: null,
      research_result: null
    }
  ];

  // 1. Check alphabetical sorting (Alpha before Bintang)
  const resAll = buildMasterContactsResponse(rows, { filter: 'all' });
  assert.equal(resAll.groups.length, 2);
  assert.equal(resAll.total, 2);
  assert.equal(resAll.totalCompanies, 2);
  assert.equal(resAll.groups[0].company_name, 'Alpha Cold Storage Sdn Bhd');
  assert.equal(resAll.groups[1].company_name, 'Bintang Engineering Sdn Bhd');
  const alphaLine = resAll.groups[0].people.find((p) => p.unnamed);
  assert.ok(alphaLine, 'a company phone with no person still becomes a contact row');
  assert.equal(alphaLine?.name, '');
  assert.ok(String(alphaLine?.direct_phone || '').includes('07') || String(alphaLine?.direct_phone || '').includes('2223344'));
  assert.equal(alphaLine?.role, 'Google Maps Main Line');

  // Stats verification
  assert.equal(resAll.stats.totalCompaniesWithContacts, 2);
  assert.equal(resAll.stats.totalDecisionMakers, 1); // Boon Lee
  assert.equal(resAll.stats.totalMobileWhatsapp, 1); // 019-7112233
  assert.ok(resAll.stats.totalPhones >= 2);

  // 2. Search filter test by person name
  const resSearchPerson = buildMasterContactsResponse(rows, { search: 'Boon Lee' });
  assert.equal(resSearchPerson.groups.length, 1);
  assert.equal(resSearchPerson.groups[0].company_name, 'Bintang Engineering Sdn Bhd');

  // 3. Search filter test by phone digits
  const resSearchPhone = buildMasterContactsResponse(rows, { search: '0197112233' });
  assert.equal(resSearchPhone.groups.length, 1);
  assert.equal(resSearchPhone.groups[0].company_name, 'Bintang Engineering Sdn Bhd');

  // 4. Type filter: has_decision_makers / with_decision_makers
  const resDMs = buildMasterContactsResponse(rows, { filter: 'has_decision_makers' });
  assert.equal(resDMs.groups.length, 1);
  assert.equal(resDMs.groups[0].company_name, 'Bintang Engineering Sdn Bhd');

  // 5. Assigned telemarketer filter
  const resTele = buildMasterContactsResponse(rows, { assignedTo: 'Sarah Tan' });
  assert.equal(resTele.groups.length, 1);
  assert.equal(resTele.groups[0].company_name, 'Bintang Engineering Sdn Bhd');
});

test('generateContactsCsv generates CSV sorted by company, then person and phone routes', () => {
  const rows: RawCompanyContactRow[] = [
    {
      id: 'c-1',
      name: 'Zeta Technologies Sdn Bhd',
      address: 'Skudai, Johor',
      phone: '07-5556677',
      website: 'https://zeta.my',
      maps_url: '',
      category: 'Software development',
      rating: 5.0,
      reviews: 12,
      lead_status: 'contacted',
      assigned_to: 'John Doe',
      contact_public_id: 'cr-z',
      contact_status: 'completed',
      contact_result: {
        decision_makers: [
          { name: 'Dr. Chong Wei', role: 'Chief Executive Officer', seniority: 10, is_primary: true, direct_phone: '012-9988776', direct_email: 'chong@zeta.my' }
        ],
        phone_contacts: [
          { number_raw: '012-9988776', type: 'mobile_whatsapp', is_primary: true },
          { number_raw: '07-5556677', type: 'office', is_primary: false }
        ],
        email_contacts: [
          { email: 'chong@zeta.my', label: 'CEO Direct' }
        ],
        cheat_sheet: {
          primary_decision_maker: 'Dr. Chong Wei',
          gatekeeper_phrase: 'Calling for Dr. Chong Wei regarding enterprise cloud tools'
        }
      },
      research_public_id: null,
      research_status: null,
      research_result: null
    }
  ];

  const res = buildMasterContactsResponse(rows);
  const csv = generateContactsCsv(res.groups);

  assert.ok(csv.startsWith('Company Name,Category,Address,Company Phone,Assigned To,Lead Status,Record Type,Person Name,Role / Title,Seniority,Contact Label,Phone Number,Phone E164,WhatsApp URL,Email,Receptionist / Gatekeeper Script,Evidence Source,Report Link'));
  assert.ok(csv.includes('Zeta Technologies Sdn Bhd'));
  assert.ok(csv.includes('Dr. Chong Wei'));
  assert.ok(csv.includes('Chief Executive Officer'));
  assert.ok(csv.includes('012-9988776'));
  assert.ok(csv.includes('Calling for Dr. Chong Wei regarding enterprise cloud tools'));
});

test('portal page integrates Contacts Master view, navigation, styles and scripts', () => {
  const html = page();

  // Desktop navigation
  assert.ok(html.includes('data-view="contacts"'), 'portal must have desktop contacts view nav button');
  assert.ok(html.includes('Contacts Master'), 'portal must display Contacts Master in nav');

  // Mobile navigation
  assert.ok(html.includes('<button class="mobile-tab" data-view="contacts"'), 'portal must have mobile contacts tab');

  // Contacts Master Section
  assert.ok(html.includes('id="contactsView"'), 'portal must contain contactsView section');
  assert.ok(html.includes('id="contactsSearch"'), 'portal must have contactsSearch input');
  assert.ok(html.includes('id="contactsTypeFilter"'), 'portal must have contactsTypeFilter select');
  assert.ok(html.includes('id="contactsTeleFilter"'), 'portal must have contactsTeleFilter select');
  assert.ok(html.includes('id="contactsContainer"'), 'portal must have contactsContainer');
  assert.ok(html.includes('id="contactsPageInfo"'), 'portal must have contacts pagination info');

  // Metrics in contacts summary
  assert.ok(html.includes('id="statContactsTotalCompanies"'));
  assert.ok(html.includes('id="statContactsTotalDMs"'));
  assert.ok(html.includes('id="statContactsTotalPhones"'));
  assert.ok(html.includes('id="statContactsTotalMobile"'));
  assert.ok(html.includes('id="statContactsTotalEmails"'));

  // JavaScript functions
  assert.ok(html.includes('function loadContactsView()'));
  assert.ok(html.includes('option value="all" selected'), 'default filter must include unnamed company lines');
  assert.ok(html.includes('typeFilter:\'all\''), 'contactsState must default to all contacts');
  assert.ok(html.includes('Named people only'), 'named-only filter remains available');
  assert.ok(html.includes('Not identified'), 'unnamed company lines render as Not identified');
  assert.ok(html.includes('Name</th><th>Position</th><th>Contact info</th><th>Source'), 'people table must list name, position, contact, source');
  assert.ok(html.includes('function exportContactsCsv()'));
  assert.ok(html.includes('function copyText('));
});
