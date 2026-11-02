import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {countryIndustryPage} from './country-industry-page.ts';

test('country research page offers inputs, status and CSV download',()=>{
  const html=countryIndustryPage();
  for(const id of ['country','industry','start','maps-state','contacts-state','csv-state','download','jobs-list','jobs-message','token-input','connect','view-csv','csv-search','csv-email-only','csv-prev','csv-next']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/type:'country\.industry'/);
  assert.match(html,/job\.progress/);
  assert.match(html,/renderJobs\(d.jobs/);
  assert.doesNotMatch(html,/prompt\(/);
  assert.match(html,/URLSearchParams\(location.search\)/);
  assert.match(html,/searchParams.set\('job',jobId\)/);
  assert.match(html,/new Blob\(\[csv\]/);
  const script=/<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script); assert.doesNotThrow(()=>new vm.Script(script));
});
