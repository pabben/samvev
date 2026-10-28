import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyDispatchLimitIsValid, fallbackProviderChoices } from '../src/ai-settings-presentation';

test('fallback choices require a configured runtime provider distinct from the primary and exclude ChatGPT',()=>{
 const saved=[
  {provider:'openai',configured:true,runtimeAvailable:true},
  {provider:'anthropic',configured:true,runtimeAvailable:true},
  {provider:'openai_compatible',configured:true,runtimeAvailable:false},
  {provider:'gemini',configured:true,runtimeAvailable:true},
  {provider:'chatgpt_subscription',configured:true,runtimeAvailable:true},
 ] as const;
 assert.deepEqual(fallbackProviderChoices([...saved],'openai'),['anthropic']);
 assert.deepEqual(fallbackProviderChoices([...saved],'chatgpt_subscription'),[]);
});

test('daily dispatch limit accepts only positive whole request counts up to one million',()=>{
 for(const value of ['1','20','1000000'])assert.equal(dailyDispatchLimitIsValid(true,value),true);
 for(const value of ['','0','-1','1.5','1000001','1e3'])assert.equal(dailyDispatchLimitIsValid(true,value),false);
 assert.equal(dailyDispatchLimitIsValid(false,''),true);
});
