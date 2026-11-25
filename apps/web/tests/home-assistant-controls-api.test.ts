import assert from 'node:assert/strict';
import test from 'node:test';
import {createHomeAssistantControlsApi} from '../src/home-assistant-controls-api';

test('manager adapters use only discovery, selection, replacement grants, and revisioned pause routes',async()=>{
  const calls:Array<{path:string;method?:string;body?:unknown}>=[];
  const api=createHomeAssistantControlsApi(async<T>(path:string,method?:string,body?:unknown)=>{calls.push({path,method,body});return{} as T});
  await api.configuration('household-1');await api.discover('household-1','connection-1',7);await api.select('household-1','connection-1',{expectedConnectionRevision:7,registryId:'registry-light',displayName:'Hall light'});
  await api.configureGrants('household-1','entity-1',{expectedRevision:3,personGrants:[{personId:'person-1',canRead:true,actions:['light.turn_on']}],displayGrants:[]});await api.deselect('household-1','entity-1',4);
  assert.deepEqual(calls.map(({path,method})=>[path,method]),[
    ['/households/household-1/home-assistant/controls/configuration',undefined],
    ['/households/household-1/calendar-connections/connection-1/home-assistant/controls/discover','POST'],
    ['/households/household-1/calendar-connections/connection-1/home-assistant/controls','POST'],
    ['/households/household-1/home-assistant/controls/entity-1/grants','PUT'],
    ['/households/household-1/home-assistant/controls/entity-1/deselect','POST'],
  ]);
  assert.deepEqual(calls[1]!.body,{expectedConnectionRevision:7});assert.deepEqual(calls[2]!.body,{expectedConnectionRevision:7,registryId:'registry-light',displayName:'Hall light'});assert.deepEqual(calls[4]!.body,{expectedRevision:4});
});

test('member and display garage flows have separate cookie-bound paths and keep the one-use token in the explicit dispatch',async()=>{
  const calls:Array<{path:string;method?:string;body?:unknown}>=[];
  const api=createHomeAssistantControlsApi(async<T>(path:string,method?:string,body?:unknown)=>{calls.push({path,method,body});return(path.endsWith('/confirm-open')?{confirmationToken:'synthetic-one-use-confirmation',expiresInSeconds:30}:{id:'receipt-1',status:'accepted'}) as T});
  await api.confirmOpen({kind:'member',householdId:'household-1'},'garage-1',2);
  await api.dispatch({kind:'member',householdId:'household-1'},'garage-1',{expectedRevision:2,action:'cover.open_cover',idempotencyKey:'synthetic-key-000001',confirmationToken:'synthetic-one-use-confirmation'});
  await api.confirmOpen({kind:'display'},'garage-1',2);
  assert.deepEqual(calls.map(({path,method})=>[path,method]),[
    ['/households/household-1/home-assistant/controls/garage-1/confirm-open','POST'],
    ['/households/household-1/home-assistant/controls/garage-1/actions','POST'],
    ['/display/home-assistant/controls/garage-1/confirm-open','POST'],
  ]);
  assert.deepEqual(calls[1]!.body,{expectedRevision:2,action:'cover.open_cover',idempotencyKey:'synthetic-key-000001',confirmationToken:'synthetic-one-use-confirmation'});
});

test('state refresh is a read-only GET separate from a single explicit dispatch POST',async()=>{
  const calls:Array<{path:string;method?:string;body?:unknown}>=[];
  const api=createHomeAssistantControlsApi(async<T>(path:string,method?:string,body?:unknown)=>{calls.push({path,method,body});return{} as T});
  await api.read({kind:'member',householdId:'household-1'},'light-1');
  await api.dispatch({kind:'member',householdId:'household-1'},'light-1',{expectedRevision:2,action:'light.turn_on',idempotencyKey:'synthetic-key-000002'});
  assert.deepEqual(calls.map(({path,method})=>[path,method]),[
    ['/households/household-1/home-assistant/controls/light-1/state',undefined],
    ['/households/household-1/home-assistant/controls/light-1/actions','POST'],
  ]);
  assert.equal(calls.filter(call=>call.path.endsWith('/actions')).length,1);
});
