import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';
import {personColorTokens} from '@samvev/contracts';
registerHooks({load(url,context,nextLoad){return url.endsWith('.webp')?{format:'module',source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const {Avatar}=await import('../src/ui');

test('persisted identity tokens take precedence over conflicting legacy avatar choices',()=>{
 for(const colorToken of personColorTokens){
  const markup=renderToStaticMarkup(createElement(Avatar,{name:'Synthetic identity',personId:'synthetic-person',avatarKey:'avatar-02',colorToken}));
  assert.match(markup,new RegExp(`data-color-token="${colorToken}"`));
  assert.doesNotMatch(markup,/class="[^"]*accent-\d/,'semantic avatars must not activate legacy accent CSS');
 }
});
test('stable person identity without a persisted token is semantic; anonymous index avatars retain legacy fallback',()=>{
 const identity=renderToStaticMarkup(createElement(Avatar,{name:'Synthetic identity',personId:'synthetic-person',index:5}));
 assert.match(identity,/data-color-token="[a-z]+"/);
 assert.doesNotMatch(identity,/accent-\d/);
 const anonymous=renderToStaticMarkup(createElement(Avatar,{name:'Synthetic identity',index:5}));
 assert.match(anonymous,/accent-5/);
 assert.doesNotMatch(anonymous,/data-color-token/);
});

test('both mobile appearances retain permission-gated message creation',async()=>{
 const {FamilyHub}=await import('../src/family-hub');
 const {LocaleProvider}=await import('../src/ui');
 Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:(query:string)=>({matches:query.includes('max-width')})});
 for(const theme of ['light','dark']){
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme}}}});
  const home=(onCompose?:()=>void)=>renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(FamilyHub,{people:[],items:[],messages:[],zone:'UTC',householdName:'Synthetic household',now:Date.parse('2026-10-28T12:00:00Z'),onCompose,displaySections:{week:false}})}));
  assert.match(home(()=>{}),/>New message</);
  assert.doesNotMatch(home(),/>New message</);
 }
});
