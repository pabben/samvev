import assert from 'node:assert/strict';
import test from 'node:test';
import {allowedHomeAssistantActions,homeAssistantActionsForObservation,homeAssistantConfigurationForConnection,homeAssistantGrantReplacement,homeAssistantStateKey,newHomeAssistantIdempotencyKey} from '../src/home-assistant-control-presentation';
import type {HomeAssistantEntity,ManagedHomeAssistantEntity} from '../src/home-assistant-control-types';

test('control actions stay within the discovered entity domain and server allowlist',()=>{
  const light:HomeAssistantEntity={registryId:'synthetic-light',entityId:'light.test_lamp',deviceRegistryId:'synthetic-device',domain:'light',name:'Test lamp',supportedActions:['light.turn_on','cover.open_cover'],state:'off',stateStatus:'current',lastChangedAt:null};
  const cover={...light,entityId:'cover.test_garage',domain:'cover' as const,supportedActions:['cover.open_cover','light.turn_off'] as HomeAssistantEntity['supportedActions']};
  assert.deepEqual(allowedHomeAssistantActions(light),['light.turn_on']);
  assert.deepEqual(allowedHomeAssistantActions(cover),['cover.open_cover']);
});

test('grant replacement omits unchecked targets instead of sending invalid false-read grants',()=>{
  const result=homeAssistantGrantReplacement([
    {personId:'person-read',canRead:true,actions:['light.turn_on']},
    {personId:'person-unchecked',canRead:false,actions:[]},
  ],[
    {displayId:'display-read-only',canRead:true,actions:[]},
    {displayId:'display-unchecked',canRead:false,actions:[]},
  ]);
  assert.deepEqual(result,{personGrants:[{personId:'person-read',canRead:true,actions:['light.turn_on']}],displayGrants:[{displayId:'display-read-only',canRead:true,actions:[]}]});
});

test('state status remains explicit when Home Assistant cannot provide a current value',()=>{
  assert.equal(homeAssistantStateKey('current'),'homeAssistantStateCurrent');
  assert.equal(homeAssistantStateKey('unavailable'),'homeAssistantStateUnavailable');
  assert.equal(homeAssistantStateKey('unknown'),'homeAssistantStateUnknown');
});

test('idempotency keys use the secure UUID fallback when randomUUID is unavailable',()=>{
  assert.equal(newHomeAssistantIdempotencyKey({getRandomValues:bytes=>{bytes.fill(0x11);return bytes}}),'ha-11111111-1111-4111-9111-111111111111');
  assert.throws(()=>newHomeAssistantIdempotencyKey({}),/cryptographically secure/);
});

test('configuration is connection-scoped even when registry IDs collide',()=>{
  const entity={id:'entity-a',connectionId:'connection-a',registryId:'same-registry',entityId:'light.a',deviceRegistryId:null,domain:'light' as const,name:'A',supportedActions:['light.turn_on'] as HomeAssistantEntity['supportedActions'],revision:1,selected:true,requiresReselection:false,personGrants:[],displayGrants:[]} satisfies ManagedHomeAssistantEntity;
  const other={...entity,id:'entity-b',connectionId:'connection-b',name:'B'};
  assert.deepEqual(homeAssistantConfigurationForConnection([entity,other],'connection-a'),[entity]);
});

test('read response actions narrow currently granted actions and stale states cannot dispatch',()=>{
  const entity:HomeAssistantEntity={registryId:'synthetic-light',entityId:'light.test_lamp',deviceRegistryId:null,domain:'light',name:'Test lamp',supportedActions:['light.turn_on','light.turn_off'],state:'off',stateStatus:'current',lastChangedAt:null};
  assert.deepEqual(homeAssistantActionsForObservation(entity,{supportedActions:['light.turn_off'],stateStatus:'current'}),['light.turn_off']);
  assert.deepEqual(homeAssistantActionsForObservation(entity,{supportedActions:['light.turn_off'],stateStatus:'unknown'}),[]);
  assert.deepEqual(homeAssistantActionsForObservation(entity,{supportedActions:['light.turn_off'],stateStatus:'current'},true),[]);
});
