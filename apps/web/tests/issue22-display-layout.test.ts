import test from 'node:test';
import assert from 'node:assert/strict';
import { closureTitle, displayFixture } from './issue22-display-fixture';
import { displaySecondaryCardVisible } from '../src/display-admin-presentation';

test('paired display and preview share a policy that preserves explicit extras without duplicating the default board',()=>{
  for(const card of ['family_layout','household_messages','people','today','tomorrow','week','next','external_items','photos','dinners'])assert.equal(displaySecondaryCardVisible(card,true),false,card);
  for(const card of ['groceries','home_assistant','new_message','worth_remembering'])assert.equal(displaySecondaryCardVisible(card,true),true,card);
  for(const card of ['today','tomorrow','week','groceries','dinners','photos'])assert.equal(displaySecondaryCardVisible(card,false),true,card);
  assert.equal(displaySecondaryCardVisible('external_items',true,false),true,'empty scaffold keeps the calendar sharing reason');
});

test('short landscape reserves a note/photo row and keeps every event reachable',()=>{
  for(const theme of ['light','dark'] as const){
    const markup=displayFixture({theme});
    const today=markup.match(/<section[^>]*data-hub-scope="today"[\s\S]*?<\/section>/)![0];
    assert.equal((today.match(/data-item-id=/g)??[]).length,3);
    assert.match(today,/data-hub-detail="today"/);
    assert.match(today,/<span class="hub-count">7<\/span>/,'meal footer does not inflate the agenda badge');
    assert.match(today,/Se I dag · 7 totalt/,'collection and agenda badge count the same seven events');
    assert.ok(today.includes(closureTitle));
    assert.equal((markup.match(/data-review-private="person-card"/g)??[]).length,6);
    assert.match(markup,/hub-display-photo/);
    assert.match(markup,/synthetic-message/);
  }
});
test('portrait keeps four agenda entries and empty boards retain all six people',()=>{
  const portrait=displayFixture({orientation:'portrait'});
  const today=portrait.match(/<section[^>]*data-hub-scope="today"[\s\S]*?<\/section>/)![0];
  assert.equal((today.match(/data-item-id=/g)??[]).length,4);
  const empty=displayFixture({empty:true});
  assert.equal((empty.match(/data-review-private="person-card"/g)??[]).length,6);
  assert.doesNotMatch(empty,/data-review-private="day-event"/);
});
