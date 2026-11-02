// Parse the worker's RFC 4180-style CSV, including quotes and embedded newlines.
export function parseCountryCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (quoted) {
      if (c==='"' && text[i+1]==='"') {field+='"';i++;}
      else if (c==='"') quoted=false;
      else field+=c;
    } else if (c==='"' && field==='') quoted=true;
    else if (c===',') {row.push(field);field='';}
    else if (c==='\r' || c==='\n') {
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(field);rows.push(row);row=[];field='';
    } else field+=c;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  if (field!=='' || row.length) {row.push(field);rows.push(row);}
  return rows;
}

// Count only rows with a named company, an accessible website and a found email.
export function countQualifiedLeads(rows) {
  if (!rows.length) return null;
  const headers=rows[0].map(x=>x.trim().toLowerCase());
  const indexes=['name','website','emails','research_status'].map(name=>headers.indexOf(name));
  if (indexes.some(i=>i<0)) return null;
  const [name,website,email,status]=indexes;
  return rows.slice(1).filter(row=>String(row[name]||'').trim() && String(row[website]||'').trim() && String(row[email]||'').trim() && ['ok','partial'].includes(String(row[status]||'').trim().toLowerCase())).length;
}
