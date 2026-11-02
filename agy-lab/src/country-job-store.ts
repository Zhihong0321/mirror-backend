// Durable country-research job snapshots on the hub's /data volume.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Job} from './jobs.ts';

function directory(): string | null {
  if (process.env.COUNTRY_JOB_STORE_DIR) return process.env.COUNTRY_JOB_STORE_DIR;
  return process.env.NODE_ENV === 'production' ? path.join(os.homedir(), '.agy-lab', 'country-jobs') : null;
}
function fileFor(dir:string,id:string):string {
  if(!/^[a-f0-9]{12}$/.test(id)) throw new Error('invalid country job id');
  return path.join(dir,id+'.json');
}
export function saveCountryJob(job: Job): void {
  if(job.type!=='country.industry') return;
  const dir=directory();if(!dir)return;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=fileFor(dir,job.id), tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(job),{mode:0o600});
  fs.renameSync(tmp,file);
}
export function loadCountryJob(id:string):Job|null {
  const dir=directory();if(!dir)return null;
  const file=fileFor(dir,id);if(!fs.existsSync(file))return null;
  const job=JSON.parse(fs.readFileSync(file,'utf8')) as Job;
  if(job.id!==id||job.type!=='country.industry')throw new Error('invalid country job snapshot');
  return job;
}
export function loadCountryJobs():Job[] {
  const dir=directory();if(!dir||!fs.existsSync(dir))return [];
  const files=fs.readdirSync(dir).filter(f=>/^[a-f0-9]{12}\.json$/.test(f));
  const jobs:Job[]=[];
  for(const file of files){
    try {const job=loadCountryJob(file.slice(0,12));if(job)jobs.push(job);}
    catch(error){console.error('[country-jobs] unable to read '+file+': '+(error as Error).message);}
  }
  return jobs;
}
