import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOnDate, deriveAgeGroup, nextBirthday } from './domain.ts';

test('age and age group are calculated from full birth date',()=>{
  assert.equal(ageOnDate('2012-09-10','2026-09-09'),13);
  assert.equal(ageOnDate('2012-09-10','2026-09-10'),14);
  assert.equal(deriveAgeGroup('2012-09-10','2026-09-09'),'teen');
  assert.equal(deriveAgeGroup(null,'2026-09-09'),'unspecified');
});

test('next birthday handles year rollover and deterministic ties',()=>{
  const result=nextBirthday([
    {id:'b',displayName:'Synthetic B',birthDate:'2017-12-24'},
    {id:'a',displayName:'Synthetic A',birthDate:'2020-01-03'}
  ],'2026-12-26');
  assert.deepEqual(result,{personId:'a',displayName:'Synthetic A',date:'2027-01-03',daysUntil:8,ageTurning:7});
});

test('29 February birthdays use 28 February in non-leap years',()=>{
  const person={id:'leap',displayName:'Synthetic Leap',birthDate:'2000-02-29'};
  assert.deepEqual(nextBirthday([person],'2026-02-27'),{personId:'leap',displayName:'Synthetic Leap',date:'2026-02-28',daysUntil:1,ageTurning:26});
  assert.equal(nextBirthday([person],'2028-02-28')?.date,'2028-02-29');
});
