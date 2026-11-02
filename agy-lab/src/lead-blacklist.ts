// Leads a solar EPC will not sell to, kept out of contact research. Approved
// 2026-10-24 from the 12,307-lead master list; the lists and what each one
// caught are in docs/lead-blacklist.md.
//
// A lead is out when its Google category is on a group's list or its name
// matches the group's words. Names are matched whole-word and without the
// landmark a business gives for itself ("HS TYRES (beside burger king)" is not
// Burger King). "Solar" alone is not a competitor: it also names tint, watch and
// LPG shops.

const words = (list: string[]): RegExp => new RegExp('\\b(?:' + list.join('|') + ')\\b', 'i');

type Group = { categories: string[]; names: RegExp; namesOnlyWhenUncategorised?: boolean };

export const GROUPS: Record<string, Group> = {
  government: {
    categories: ['Government office', 'City Hall', 'City government office', 'Local government office', 'Police station',
      'Fire station', 'Post office', 'Courthouse', 'Public health department', 'Public medical center', 'Embassy',
      'Primary school', 'Secondary school', 'High school', 'Public school', 'Public library', 'Community center',
      'Electric utility company', 'Water utility company', 'Social security financial department'],
    names: words(['jabatan', 'kementerian', 'majlis (?:bandaraya|perbandaran|daerah|agama)',
      'pejabat (?:pos|daerah|tanah|kesihatan|agama|pendidikan)', 'balai polis', 'polis diraja', 'pdrm', 'bomba',
      'klinik kesihatan', 'hospital (?:sultan|sultanah|permai|enche besar|temenggong)',
      'sekolah (?:kebangsaan|jenis kebangsaan|menengah|rendah|agama)', 'tadika kemas', 'kemas',
      'dewan (?:orang ramai|serbaguna|bandaraya)', 'lhdn', 'kwsp', 'perkeso', 'jpj', 'imigresen', 'mahkamah', 'kastam',
      'tenaga nasional', 'tnb', 'ranhill saj', 'indah water', 'pos malaysia', 'pos mini', 'politeknik', 'giatmara',
      'kerajaan', 'pusat khidmat', 'adun']),
  },
  bank_finance: {
    categories: ['Bank', 'ATM', 'Financial institution', 'Credit union', 'Money transfer service', 'Currency exchange service'],
    names: words(['maybank', 'cimb', 'public bank', 'rhb', 'hong leong bank', 'ambank', 'bank islam', 'bank rakyat', 'bsn',
      'affin', 'alliance bank', 'uob', 'ocbc', 'hsbc', 'standard chartered', 'citibank', 'agrobank', 'bank muamalat', 'mbsb',
      'al rajhi', 'ar-?rahnu', 'western union', 'merchantrade', 'aeon credit']),
  },
  hypermarket_mall: {
    categories: ['Hypermarket', 'Shopping mall', 'Department store'],
    // A shop inside a mall names the mall, and rents a roof it does not own.
    names: words(['aeon', 'jusco', 'giant (?:hyper|super)\\w*', "lotus'?s", 'tesco', 'mydin', 'econsave', 'the store',
      'pacific hypermarket', 'ksl city', 'paradigm mall', 'city square', 'komtar', 'toppen', 'sogo', 'parkson',
      'mid ?valley', 'ioi (?:mall|city)', 'sunway \\w+ mall', 'ikea', 'village grocer', 'hero ?market', 'ninso', 'eco-? ?shop']),
  },
  chain_store: {
    categories: [],
    names: words(['99 ?speed ?mart', '7-?eleven', 'family ?mart', 'kk (?:super )?mart', 'mynews', 'emart24', 'cu mart',
      'mr\\.? ?diy', 'daiso', 'watsons', 'guardian', 'caring pharmacy', 'big pharmacy', 'alpro pharmacy', 'aa pharmacy',
      'health lane', 'am pm pharmacy', 'senheng', 'harvey norman', 'senq', 'uniqlo', 'padini', 'brands outlet',
      'the body shop', 'bata', 'popular book', 'mph', 'toys ?.?r.? ?us', 'poh kong', 'habib jewel', 'wah chan', 'tomei',
      'sk jewellery', 'sasa', 'crocs', 'lionmas']),
  },
  chain_fnb: {
    categories: ['Fast food restaurant'],
    names: words(['starbucks', 'zus coffee', 'tealive', 'chatime', 'coolblog', 'gigi coffee', 'kenangan', 'bask bear',
      'mixue', 'luckin', 'secret recipe', 'oldtown', "mcdonald'?s?", 'kfc', 'pizza hut', "domino'?s", 'subway',
      'marrybrown', 'texas chicken', 'a ?& ?w', 'burger king', 'sushi king', 'sukiya', "nando'?s", 'baskin', 'llaollao',
      'inside scoop', "dunkin'?", 'krispy kreme', 'richiamo', 'tea garden', 'thai odyssey', 'absolute thai', 'jom ch[aá]',
      'bingxue', 'richeese']),
  },
  // Petrol stations are not here: the team has petrol station clients (2026-10-26).
  // A chain shop at a station ("Subway @ Caltex", "FamilyMart Petron") still matches its own chain.
  telco_courier: {
    categories: ['Telecommunications service provider', 'Courier service', 'Shipping and mailing service'],
    names: words(['u ?mobile', 'celcom(?:digi)?', 'digi', 'maxis',
      'unifi', 'redone', 'onexox', 'tunetalk', 'hotlink', 'tm point', 'ninja ?van', 'j ?& ?t', 'dhl', 'pos ?laju', 'gdex',
      'city-?link', 'flash express', 'shopee express', 'spx', 'lazada express', 'lalamove', 'mail boxes etc', 'skynet',
      'best express', 'collectco']),
  },
  franchise_agent: {
    categories: ['Insurance agency', 'Life insurance agency'],
    names: words(['amway', 'coway', 'cuckoo', 'tupperware', 'herbalife', 'shaklee', 'elken', 'cosway', 'great eastern',
      'prudential', 'aia', 'allianz', 'etiqa', 'tyreplus', 'tayaria', 'anytime fitness', 'celebrity fitness', 'laundrybar',
      'cuci express', 'dobi king']),
  },
  not_a_business: {
    categories: ['Housing Estate', 'Housing complex', 'Housing society', 'Apartment building', 'Apartment complex',
      'Condominium complex', 'Serviced apartment', 'Housing development', 'Residential complex', 'Park', 'Playground',
      'Bus stop', 'Bus station', 'Parking lot', 'Free parking lot', 'Parking garage', 'Tourist attraction',
      'Electronics vending machine', 'Vending machine', 'Mosque', 'Church', 'Hindu temple', 'Buddhist temple',
      'Chinese temple', 'Taoist temple', 'Place of worship', 'Cemetery', 'Neighborhood', 'Lake', 'Hiking area'],
    // Place names Google returned with no category: "Taman Sri Pulai", "Kampung Gajah".
    names: /^(?:taman|flat|pangsapuri|rumah pangsa|kampung|kg\.?|jalan|apartment|kondominium|residensi|kuarters|kuaters)\b/i,
    namesOnlyWhenUncategorised: true,
  },
  competitor_solar: {
    categories: ['Solar energy company', 'Solar energy equipment supplier', 'Solar energy system service',
      'Solar photovoltaic power plant', 'Solar hot water system supplier'],
    names: /\bsolar\b.*\b(?:energy|power|pv|photovoltaic|panel|system|renewable|tenaga|epc|install\w*)\b|\b(?:tenaga|sistem) solar\b/i,
  },
};

/** "(beside burger king)", "- opposite Maybank": where the business is, not what it is. */
const LANDMARK = /[(\-–,|]\s*(?:beside|besides|near|next to|opposite|opp\.?|sebelah|depan|belakang|berhampiran)\b[^)]*\)?/gi;

/** The group a lead belongs to, or null when contact research may run on it. */
export function blacklistReason(name: unknown, category: unknown): string | null {
  const cat = typeof category === 'string' && category.trim() ? category.trim() : null;
  const bare = String(name ?? '').replace(LANDMARK, ' ');
  for (const [group, rule] of Object.entries(GROUPS)) {
    if (cat && rule.categories.includes(cat)) return group;
    if (rule.namesOnlyWhenUncategorised && cat) continue;
    if (rule.names.test(bare)) return group;
  }
  return null;
}
