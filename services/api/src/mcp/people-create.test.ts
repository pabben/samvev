import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { DbClient } from '../db.ts';
import { createMcpPersonProfile } from './people-create.ts';

const householdId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const grantId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const personId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const principal={tokenSetId:grantId,grantId,householdId,accountId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',membershipId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',installationId:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
const context=`${householdId}\0${grantId}`;
const digestKey=Buffer.from('synthetic-protected-test-key-0123456789abcdef');
const changedDigestKey=Buffer.from('different-protected-test-key-0123456789');
function keyed(purpose:string,ctx:string,value:string){
  const subkey=createHmac('sha256',digestKey).update('samvev-vault-digest-kdf:v1\0').update(purpose).digest();
  return createHmac('sha256',subkey).update('samvev-vault-digest:v1\0').update(ctx).update('\0').update(value,'utf8').digest();
}
const digestFn=async(purpose:string,ctx:string,value:string)=>keyed(purpose,ctx,value);
const changedDigestFn=async(purpose:string,ctx:string,value:string)=>{
  const subkey=createHmac('sha256',changedDigestKey).update('samvev-vault-digest-kdf:v1\0').update(purpose).digest();
  return createHmac('sha256',subkey).update('samvev-vault-digest:v1\0').update(ctx).update('\0').update(value,'utf8').digest();
};
const currentFence=keyed('mcp.people.create.key-fence',householdId,'mcp-people-create-key-fence-v1');

function fake(options:{prior?:{payload_hash:Buffer;person_id:string};fence?:Buffer;receiptsExist?:boolean;quota?:number;auditFails?:boolean}={}){
  const calls:Array<{sql:string;values?:unknown[]}>=[];
  const client={async query(sql:string,values?:unknown[]){
    calls.push({sql,values});
    if(sql.includes('SELECT id FROM households WHERE id=$1 AND installation_id=$2 FOR NO KEY UPDATE'))return{rows:[{id:householdId}],rowCount:1};
    if(sql.includes('SELECT id FROM households WHERE id=$1 FOR NO KEY UPDATE'))return{rows:[{id:householdId}],rowCount:1};
    if(sql.includes('SELECT key_check FROM mcp_people_create_key_fences'))return{rows:options.fence?[{key_check:options.fence}]:[],rowCount:options.fence?1:0};
    if(sql.includes('SELECT 1 FROM mcp_people_create_receipts')){
      const exists=options.receiptsExist??Boolean(options.prior);
      return{rows:exists?[{one:1}]:[],rowCount:exists?1:0};
    }
    if(sql.includes('SELECT payload_hash,person_id'))return{rows:options.prior?[options.prior]:[],rowCount:options.prior?1:0};
    if(sql.includes('SELECT count(*)::int AS count FROM mcp_people_create_receipts'))return{rows:[{count:options.quota??0}],rowCount:1};
    if(sql.includes('SELECT color_token,count(*)::int AS count'))return{rows:[],rowCount:0};
    if(sql.includes('INSERT INTO persons('))return{rows:[{id:personId}],rowCount:1};
    if(sql.includes('INSERT INTO audit_events')&&options.auditFails)throw new Error('synthetic audit failure');
    return{rows:[],rowCount:1};
  }} as unknown as DbClient;
  return{client,calls};
}

test('MCP profile creation makes an accountless, unspecified, least-capability person and an auditable receipt',async()=>{
  const state=fake();let checks=0;
  const result=await createMcpPersonProfile(state.client,principal,{displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111'},async()=>{checks++;},digestFn);
  assert.deepEqual(result,{creation:{personId,createdRevision:1,hadLoginAtCreation:false}});
  assert.equal(checks,3,'authority is checked before work and rechecked after receipt locking and before commit');
  assert.match(state.calls[0]!.sql,/FOR NO KEY UPDATE/,'household creation lock serializes creators but permits foreign-key key-share locks');
  const personInsert=state.calls.find(call=>call.sql.includes('INSERT INTO persons('))!;
  assert.deepEqual(personInsert.values?.slice(1,5),['Synthetic profile',null,'unspecified',null]);
  const membership=state.calls.find(call=>call.sql.includes('INSERT INTO memberships'))!;
  assert.match(membership.sql,/VALUES\(\$1,NULL,\$2,'limited','\["household\.view"\]'::jsonb\)/);
  assert.equal(state.calls.some(call=>call.sql.includes('mcp_oauth_grant_people')),false);
  assert.ok(state.calls.some(call=>call.sql.includes('INSERT INTO mcp_people_create_key_fences')),'first successful creation installs the per-household key fence');
  assert.match(state.calls.at(-1)!.sql,/mcp\.person_profile_created/);
});

test('MCP profile creation replays its hashed receipt before quota and survives a removed profile',async()=>{
  const input={displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111'};
  const state=fake({prior:{payload_hash:keyed('mcp.people.create.payload',context,JSON.stringify({displayName:input.displayName})),person_id:personId},fence:currentFence,receiptsExist:true,quota:20});
  const result=await createMcpPersonProfile(state.client,principal,input,async()=>{},digestFn);
  assert.deepEqual(result,{creation:{personId,createdRevision:1,hadLoginAtCreation:false}});
  assert.equal(state.calls.some(call=>call.sql.includes('SELECT count(*)::int')),false);
  assert.equal(state.calls.some(call=>call.sql.includes('INSERT INTO persons(')),false);
});

test('MCP profile request key cannot be reused with a different payload and quota rejects only new receipts',async()=>{
  const input={displayName:'Synthetic changed profile',requestKey:'11111111-1111-4111-8111-111111111111'};
  const mismatch=fake({prior:{payload_hash:keyed('mcp.people.create.payload',context,JSON.stringify({displayName:'Synthetic old profile'})),person_id:personId},fence:currentFence,receiptsExist:true});
  await assert.rejects(createMcpPersonProfile(mismatch.client,principal,input,async()=>{},digestFn),(error:unknown)=>{
    assert.equal((error as {status?:number}).status,409);return true;
  });
  assert.equal(mismatch.calls.some(call=>call.sql.includes('SELECT count(*)::int')),false);
  const full=fake({quota:20,fence:currentFence,receiptsExist:true});
  await assert.rejects(createMcpPersonProfile(full.client,principal,input,async()=>{},digestFn),(error:unknown)=>{
    assert.equal((error as {status?:number}).status,429);return true;
  });
  assert.equal(full.calls.some(call=>call.sql.includes('INSERT INTO persons(')),false);
});

test('MCP profile creation fails closed when the protected key changes or a receipt fence is missing',async()=>{
  const input={displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111'};
  const changedKey=fake({fence:currentFence,receiptsExist:true});
  await assert.rejects(createMcpPersonProfile(changedKey.client,principal,input,async()=>{},changedDigestFn),(error:unknown)=>{
    assert.equal((error as {status?:number}).status,409);return true;
  });
  assert.equal(changedKey.calls.some(call=>call.sql.includes('SELECT payload_hash,person_id')),false,'changed key rejects before receipt lookup');
  assert.equal(changedKey.calls.some(call=>call.sql.includes('INSERT INTO persons(')),false);

  const missingFence=fake({receiptsExist:true});
  await assert.rejects(createMcpPersonProfile(missingFence.client,principal,input,async()=>{},digestFn),(error:unknown)=>{
    assert.equal((error as {status?:number}).status,409);return true;
  });
  assert.equal(missingFence.calls.some(call=>call.sql.includes('SELECT payload_hash,person_id')),false,'an un-fenced historical receipt rejects before matching');
  assert.equal(missingFence.calls.some(call=>call.sql.includes('INSERT INTO mcp_people_create_key_fences')),false);
});

test('MCP profile audit failure aborts the caller transaction',async()=>{
  const state=fake({auditFails:true});
  await assert.rejects(createMcpPersonProfile(state.client,principal,{displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111'},async()=>{},digestFn),/synthetic audit failure/);
});
