import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { pool } from '../db.ts';
import { replaceMonitorSubjects } from './subjects.ts';

const inputSchema=z.object({
  householdId:z.string().uuid(),
  personId:z.string().uuid(),
  taskIds:z.array(z.string().uuid()).min(1).max(20),
  actorAccountId:z.string().uuid()
}).strict();

async function main():Promise<void>{
  const fileIndex=process.argv.indexOf('--file');const inputPath=fileIndex>=0?process.argv[fileIndex+1]:process.argv[2];
  const path=resolve(inputPath??'');if(!inputPath)throw new Error('usage: monitor:link-subjects --file <private-json-path>');
  const stat=await fs.stat(path);if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error('private input must be a mode 0600 file');
  const input=inputSchema.parse(JSON.parse(await fs.readFile(path,'utf8')));
  const actor=(await pool.query<{account_id:string;installation_id:string;household_id:string;membership_id:string;capabilities:string[]}>(`SELECT a.id account_id,a.installation_id,m.household_id,m.id membership_id,m.capabilities FROM accounts a JOIN memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.household_id=$2 AND a.disabled_at IS NULL`,[input.actorAccountId,input.householdId])).rows[0];
  if(!actor||!actor.capabilities.includes('household.manage'))throw new Error('authorized household manager required');
  const person=await pool.query('SELECT 1 FROM persons WHERE id=$1 AND household_id=$2',[input.personId,input.householdId]);if(!person.rowCount)throw new Error('person not found');
  let linked=0;
  for(const taskId of input.taskIds){
    const task=(await pool.query<{subjects_revision:number;person_ids:string[]}>(`SELECT t.subjects_revision,COALESCE((SELECT array_agg(person_id ORDER BY person_id) FROM monitor_task_subjects WHERE task_id=t.id),'{}'::uuid[]) person_ids FROM monitor_tasks t WHERE t.id=$1 AND t.household_id=$2`,[taskId,input.householdId])).rows[0];
    if(!task)throw new Error('task not found');
    const personIds=[...new Set([...task.person_ids,input.personId])];
    if(task.person_ids.includes(input.personId))continue;
    await replaceMonitorSubjects({accountId:actor.account_id,installationId:actor.installation_id,householdId:actor.household_id,membershipId:actor.membership_id},taskId,{expectedSubjectsRevision:task.subjects_revision,personIds});linked++;
  }
  process.stdout.write(JSON.stringify({ok:true,requested:input.taskIds.length,linked})+'\n');
}

main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:'subject link failed'}\n`);process.exitCode=1;}).finally(()=>pool.end());
