import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinnedLookup } from './pinned-lookup.ts';

type Callback=(error:Error|null,address:string|Array<{address:string;family:number}>,family?:number)=>void;

test('pinned lookup supports Node single-address and all-address callback forms',()=>{
  const lookup=createPinnedLookup({address:'192.0.2.10',family:4}) as unknown as (hostname:string,options:{all?:boolean},callback:Callback)=>void;
  lookup('synthetic.test',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'192.0.2.10');assert.equal(family,4);});
  lookup('synthetic.test',{all:true},(error,address,family)=>{assert.equal(error,null);assert.deepEqual(address,[{address:'192.0.2.10',family:4}]);assert.equal(family,undefined);});
});
