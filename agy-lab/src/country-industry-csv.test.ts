import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCountryCsv, countQualifiedLeads} from './country-industry-csv.js';

test('parses quoted commas, escaped quotes, embedded newlines and CRLF',()=>{
  assert.deepEqual(parseCountryCsv('name,email,notes\r\n"Acme, Inc",a@example.com,"one\ntwo ""quoted"""\r\n'),[
    ['name','email','notes'],['Acme, Inc','a@example.com','one\ntwo "quoted"']]);
});
test('handles empty values, final row without newline and malformed quotes',()=>{
  assert.deepEqual(parseCountryCsv('a,b,c\n1,,3\n4,5,'),[['a','b','c'],['1','','3'],['4','5','']]);
  assert.throws(()=>parseCountryCsv('"unclosed'),/unclosed/);
});

test('qualifies only named companies with a reachable website and email',()=>{
  const rows=parseCountryCsv('name,website,emails,research_status\nAcme,https://acme.test,hello@acme.test,ok\nPartial,https://partial.test,hi@partial.test,partial\nBlocked,https://blocked.test,hi@blocked.test,blocked\nFailed,https://failed.test,hi@failed.test,failed\n,https://unnamed.test,hi@unnamed.test,ok\nNo email,https://no.test,,ok\nNo site,,hi@no.test,ok');
  assert.equal(countQualifiedLeads(rows),2);
  assert.equal(countQualifiedLeads([['name','emails'],['Acme','hi@example.com']]),null);
});
