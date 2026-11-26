import assert from 'node:assert/strict';
import test from 'node:test';
import type { DbClient } from '../db.ts';
import { discoverMonitorNames, monitorDiscoveryInputSchema, safeMonitorName } from './monitor-discovery.ts';

test('discovery rejects text filters and validates cursor and page size',()=>{
  assert.throws(()=>monitorDiscoveryInputSchema.parse({nameQuery:'Åse'}));
  assert.throws(()=>monitorDiscoveryInputSchema.parse({limit:51}));
  assert.equal(monitorDiscoveryInputSchema.parse({}).limit,20);
});

test('discovery queries only household, immutable id cursor, and limit, returning strict safe fields',async()=>{
  let queryText='';let values:unknown[]=[];
  const rows=Array.from({length:3},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+2).padStart(12,'0')}`,name:index===0?'Møteplan uke 7':index===1?'Lekser https://school.invalid/?token=synthetic-secret':'Møteplan uke 8',state:'paused' as const}));
  const cursor='00000000-0000-4000-8000-000000000001';
  const client={query:async(text:string,params:unknown[])=>{queryText=text;values=params;return{rows,rowCount:rows.length};}} as unknown as DbClient;
  const result=await discoverMonitorNames(client,'00000000-0000-4000-8000-999999999999',monitorDiscoveryInputSchema.parse({afterId:cursor,limit:1}));
  assert.match(queryText,/household_id=\$1/);assert.match(queryText,/id>\$2::uuid/);assert.doesNotMatch(queryText,/nameQuery|ILIKE|LIKE/);assert.match(queryText,/ORDER BY id ASC LIMIT \$3/);
  assert.deepEqual(values,['00000000-0000-4000-8000-999999999999',cursor,2]);
  assert.deepEqual(result,{tasks:[{id:rows[0]!.id,name:'Møteplan uke 7',state:'paused'}],nextAfterId:rows[0]!.id});
  assert.deepEqual(Object.keys(result.tasks[0]!).sort(),['id','name','state']);
});

test('discovery allows only human-name characters and withholds credential-like or opaque names whole',()=>{
  for(const name of [
    'Task https://example.invalid/path?token=abc',
    'school.invalid/path',
    'https://user:password@example.invalid/path',
    'Source:school.invalid/private/path',
    'Link=school.invalid/private/path',
    'api.key=synthetic-key',
    'api-key abc123',
    'apikey abc123',
    'access-key abc123',
    'accesskey abc123',
    'private-key abc123',
    'clientsecret abc123',
    "api'key abc123",
    'access,key abc123',
    'private(key) abc123',
    'client–secret abc123',
    'Account 1234567890123456',
    'auth=synthetic-value',
    'sig=synthetic-value',
    'code=synthetic-value',
    'Task "api_key" = "synthetic-secret"',
    "Task 'token: synthetic-secret'",
    'Task access_key=synthetic-key',
    'Task private_key: synthetic-key',
    'Task client secret review',
    'Task auth summary',
    'Task authorization update',
    'Task sig plan',
    'Task signature plan',
    'Task code plan',
    'Task credential = synthetic-value',
    'Task pwd:synthetic-value',
    'Task password recovery',
    'Task passwd note',
    'Task session=synthetic-value',
    'Task bearer family',
    'Task secret plan',
    'https://example.invalid/?access%3Ftoken=abc',
    'Plan %2Fsecret%3Dabc',
    'jwt eyJabcdefghijk.abcdefghijk.abcdefghijk',
    `opaque ${'A'.repeat(40)}`,
    'unsafe\u0000name',
    'ｈｔｔｐｓ：／／example.invalid/secret',
    'ｔｏｋｅｎ plan',
    'Token plan',
    'API key plan',
    'Parent’s code, week 7',
    'Code – uke 7',
    '😀 emoji plan',
    `${'M'.repeat(75)} token secret`,
  ]) assert.equal(safeMonitorName(name),'[name withheld]',name);
  assert.equal(safeMonitorName('Møteplan for Ålesund – uke 7'),'Møteplan for Ålesund – uke 7');
  assert.equal(safeMonitorName('Parent’s plan – week 7, (home)'),'Parent’s plan – week 7, (home)');
  assert.equal(safeMonitorName('Uke 7, møte på skolen (lille gruppe)'),'Uke 7, møte på skolen (lille gruppe)');
  const bounded=safeMonitorName('Møte '.repeat(20));assert.equal(bounded.length,80);assert.equal(bounded,'Møte '.repeat(16));
});
