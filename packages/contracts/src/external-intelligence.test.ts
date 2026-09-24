import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationItemUpsertSchema } from './index.ts';

const base={
  externalId:'family-brief:2026-09-25:rain',expectedRevision:0,kind:'reminder' as const,
  contentLocale:'nb' as const,
  targets:{household:true,personIds:[],displayIds:[]},title:'Remember rainwear',body:'Rain is expected after lunch.',entries:[],priority:'high' as const,
  publishAt:'2026-09-24T18:00:00.000Z',startsAt:null,endsAt:null,expiresAt:'2026-09-25T18:00:00.000Z',
  source:{label:'Synthetic family brief',links:[],observedAt:'2026-09-24T17:55:00.000Z',generatedAt:'2026-09-24T17:56:00.000Z',uncertainty:'low' as const},
  metadata:{category:'weather' as const}
};

test('external intelligence contract accepts the six kinds and rejects unsafe or secret-bearing source URLs',()=>{
  for(const kind of ['reminder','alert','summary','observation'] as const)assert.equal(integrationItemUpsertSchema.safeParse({...base,kind}).success,true,kind);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'event',startsAt:'2026-09-25T08:00:00.000Z'}).success,true);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'list',entries:[{label:'Pack rainwear'}]}).success,true);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'event'}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'list'}).success,false);
  for(const url of [
    'javascript:alert(1)','data:text/html,unsafe','ftp://example.invalid/file',
    'https://user:password@example.invalid/path','https://example.invalid/path?token=secret',
    'https://example.invalid/path?sig=secret','https://example.invalid/path?X-Amz-Credential=secret',
    'https://example.invalid/path#access_token=synthetic-secret','https://example.invalid/path#token=synthetic-secret'
  ])assert.equal(integrationItemUpsertSchema.safeParse({...base,source:{...base.source,url}}).success,false,url);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,source:{...base.source,links:[{label:'Unsafe',url:'https://example.invalid/path#token=synthetic-secret'}]}}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,metadata:{actionUrl:'https://example.invalid/path#access_token=synthetic-secret'}}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,source:{...base.source,url:'https://example.invalid/forecast?day=tomorrow'}}).success,true);
});

test('external intelligence contract enforces targets, event ordering and strict metadata',()=>{
  const {contentLocale:_contentLocale,...missingLocale}=base;
  assert.equal(integrationItemUpsertSchema.safeParse(missingLocale).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,targets:{household:false,personIds:[],displayIds:[]}}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,metadata:{unexpected:'raw-json'}}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,source:{...base.source,links:[
    {label:'One',url:`https://example.invalid/${'a'.repeat(1800)}`},
    {label:'Two',url:`https://example.invalid/${'b'.repeat(1800)}`}
  ]}}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'event',startsAt:'2026-09-25T10:00:00.000Z',endsAt:'2026-09-25T09:00:00.000Z'}).success,false);
  assert.equal(integrationItemUpsertSchema.safeParse({...base,kind:'event',startsAt:'2026-09-25T10:00:00.000Z',expiresAt:'2026-09-25T09:00:00.000Z'}).success,false);
});
