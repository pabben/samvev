import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOnDate, birthdaysDueSoon, deriveAgeGroup, localDateInTimezone, nextBirthday } from './domain.ts';

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

test('due birthday projection returns every today/tomorrow match without year or age',()=>{
  const birthdays=birthdaysDueSoon([
    {id:'today-a',displayName:'Synthetic A',birthDate:'1980-02-28'},
    {id:'today-b',displayName:'Synthetic B',birthDate:'2014-02-28'},
    {id:'tomorrow',displayName:'Synthetic C',birthDate:'2000-03-01'},
    {id:'later',displayName:'Synthetic D',birthDate:'2000-03-02'}
  ],'2026-02-28');
  assert.deepEqual(birthdays,[
    {personId:'today-a',displayName:'Synthetic A',due:'today'},
    {personId:'today-b',displayName:'Synthetic B',due:'today'},
    {personId:'tomorrow',displayName:'Synthetic C',due:'tomorrow'}
  ]);
  assert.ok(birthdays.every((item)=>!('birthDate' in item)&&!('date' in item)&&!('ageTurning' in item)));
});

test('due birthdays follow household-local date rollover and leap policy',()=>{
  const leap={id:'leap',displayName:'Synthetic Leap',birthDate:'2000-02-29'};
  assert.deepEqual(birthdaysDueSoon([leap],'2026-02-27'),[{personId:'leap',displayName:'Synthetic Leap',due:'tomorrow'}]);
  assert.deepEqual(birthdaysDueSoon([leap],'2028-02-28'),[{personId:'leap',displayName:'Synthetic Leap',due:'tomorrow'}]);
  assert.deepEqual(birthdaysDueSoon([{...leap,birthDate:'2000-01-01'}],'2026-12-31'),[{personId:'leap',displayName:'Synthetic Leap',due:'tomorrow'}]);
});

test('household local birthday date advances at local midnight across DST boundaries',()=>{
  assert.equal(localDateInTimezone(new Date('2026-03-28T22:59:59Z'),'Europe/Oslo'),'2026-03-28');
  assert.equal(localDateInTimezone(new Date('2026-03-28T23:00:00Z'),'Europe/Oslo'),'2026-03-29');
  assert.equal(localDateInTimezone(new Date('2026-10-25T00:30:00Z'),'Europe/Oslo'),'2026-10-25');
});
