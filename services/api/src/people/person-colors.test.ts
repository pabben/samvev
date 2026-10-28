import assert from 'node:assert/strict';
import test from 'node:test';
import { personColorTokens } from '@samvev/contracts';
import { leastUsedPersonColor } from './person-colors.ts';

test('person color palette has twelve stable tokens and deterministic least-used ties',()=>{
  assert.equal(personColorTokens.length,12);
  assert.equal(new Set(personColorTokens).size,12);
  assert.equal(leastUsedPersonColor({}),personColorTokens[0]);
  assert.equal(leastUsedPersonColor(Object.fromEntries(personColorTokens.map((token)=>[token,1]))),personColorTokens[0]);
  assert.equal(leastUsedPersonColor({[personColorTokens[0]]:1}),personColorTokens[1]);
});

test('assignment repeats the palette in stable order after twelve equal-usage colors',()=>{
  const counts:Record<string,number>={};
  const assigned=Array.from({length:15},()=>{
    const token=leastUsedPersonColor(counts);
    counts[token]=(counts[token]??0)+1;
    return token;
  });
  assert.deepEqual(assigned.slice(0,12),personColorTokens);
  assert.deepEqual(assigned.slice(12),[personColorTokens[0],personColorTokens[1],personColorTokens[2]]);
});
