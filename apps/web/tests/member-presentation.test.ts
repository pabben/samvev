import {test} from 'node:test';
import assert from 'node:assert/strict';
import {primaryMemberTab,type MemberTab} from '../src/member-navigation';
import {personAccent} from '../src/person-identity';
test('support pages retain More as their primary navigation without changing their own state',()=>{
 for(const page of ['home','messages','people','more'] as const)assert.equal(primaryMemberTab(page),page);
 for(const page of ['displays','integrations','monitors','ai'] as MemberTab[])assert.equal(primaryMemberTab(page),'more');
});
test('explicit illustration identities retain six stable accents across reordered or partial rosters',()=>{
 const people=Array.from({length:6},(_,i)=>({id:`synthetic-person-${i}`,avatarKey:`avatar-0${i+1}`}));
 for(const roster of [people,[...people].reverse(),people.slice(4)])for(const person of roster)assert.equal(personAccent(person.id,person.avatarKey),people.indexOf(person));
 assert.equal(new Set(people.map(p=>personAccent(p.id,p.avatarKey))).size,6);
 const initial=personAccent('synthetic-unillustrated',null);
 assert.equal(personAccent('synthetic-unillustrated'),initial);
 assert.equal(personAccent('synthetic-unillustrated','not-allowed'),initial);
 assert.ok(initial>=0&&initial<6);
});
