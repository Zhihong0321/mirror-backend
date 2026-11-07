// Step 1.5 answers include failed checks. Do not turn a saved failure into a new lookup.
export function savedDomain(dive: any, domain: string): any | undefined {
  const clean = (s: string) => s.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return (dive.v21?.assets?.domains ?? []).find((row: any) => clean(String(row.domain ?? '')) === clean(domain));
}
