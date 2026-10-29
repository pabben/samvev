import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

registerHooks({load(url,context,nextLoad){return url.endsWith(".webp")?{format:"module",source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const [{FamilyHub},{LocaleProvider}]=await Promise.all([import("../src/family-hub"),import("../src/ui")]);

function setViewport(mobile=false){
 Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{dataset:{theme:"light"}}}});
 Object.defineProperty(globalThis,"matchMedia",{configurable:true,value:(query:string)=>({matches:mobile&&query.includes("max-width: 640px")})});
}
function homeMarkup(people:Parameters<typeof FamilyHub>[0]["people"],extras:Partial<Parameters<typeof FamilyHub>[0]>={}){
 const props:Parameters<typeof FamilyHub>[0]={people,items:[],messages:[],zone:"Europe/Oslo",householdName:"Synthetic household",localDate:"2026-10-28",now:Date.parse("2026-10-28T12:00:00Z"),displaySections:{week:false},...extras};
 return renderToStaticMarkup(createElement(LocaleProvider,{locale:"en",children:createElement(FamilyHub,props)}));
}

test("household board module stays mounted in Home independently of message presence",()=>{
 setViewport();
 const module=createElement("section",{className:"synthetic-stable-board"},"Synthetic board action");
 for(const messages of [[],[{id:"synthetic-message",body:"Synthetic note",importance:"normal" as const,authorName:"Synthetic sender",publishAt:"2026-10-28T11:00:00Z",expiresAt:"2026-10-29T00:00:00Z",revision:1}]]){
  const html=homeMarkup([{id:"synthetic-one",displayName:"Synthetic one"}],{homeModules:module,messages});
  assert.equal((html.match(/synthetic-stable-board/g)??[]).length,1);
  assert.match(html,/<div class="hub-home-modules"><section class="synthetic-stable-board">/);
 }
});

test("an empty family roster and empty message preview produce no placeholder sections",()=>{
 setViewport();
 const html=homeMarkup([]);
 assert.match(html,/class="hub-home-board"/);
 assert.doesNotMatch(html,/class="hub-person-section/);
 assert.doesNotMatch(html,/class="hub-messages/);
 assert.match(html,/class="hub-home-smart"><\/div>/,"empty smart-home content remains an actual empty layout child for CSS reflow");
});

test("rich Home retains six people, authorized human messages, smart content and photo content in DOM order",()=>{
 setViewport();
 const people=Array.from({length:6},(_,i)=>({id:`synthetic-${i}`,displayName:`Synthetic person ${i+1}`}));
 const html=homeMarkup(people,{
  messages:[{id:"synthetic-message",body:"A synthetic note",importance:"normal",authorName:"Synthetic sender",publishAt:"2026-10-28T11:00:00Z",expiresAt:"2026-10-29T00:00:00Z",revision:1}],
  homeSmartHome:createElement("section",{className:"synthetic-smart"},"Synthetic smart status"),
  homePhoto:createElement("section",{className:"hub-home-photos"},"Synthetic family photo"),
 });
 assert.equal((html.match(/data-review-private="person-card"/g)??[]).length,6);
 assert.ok(html.indexOf("hub-today")<html.indexOf("hub-tomorrow"));
 assert.ok(html.indexOf("hub-tomorrow")<html.indexOf("hub-person-section"));
 assert.ok(html.indexOf("hub-tomorrow")<html.indexOf("hub-messages"));
 assert.ok(html.indexOf("hub-messages")<html.indexOf("hub-person-section"));
 assert.ok(html.indexOf("hub-person-section")<html.indexOf("synthetic-smart"));
 assert.match(html,/<div class="hub-home-column hub-home-tomorrow"><section[^>]*hub-tomorrow[\s\S]*?<\/section><section[^>]*hub-messages/);
 assert.ok(html.indexOf("hub-messages")<html.indexOf("hub-home-photos"));
 assert.match(html,/Synthetic sender/);
});

test("mobile Home retains birthday identities and uses the single-column mobile composition",()=>{
 setViewport(true);
 const html=homeMarkup([{id:"synthetic-person",displayName:"Synthetic child"}],{birthdays:[{personId:"synthetic-person",displayName:"Synthetic child",due:"today"}]});
 assert.match(html,/class="hub-home-primary-grid hub-home-mobile"/);
 assert.match(html,/data-review-private="birthday-badge"/);
});


test("display message section is absent when empty, future, or expired, and retains real live messages",()=>{
 setViewport();
 const message={id:"synthetic-message",body:"A synthetic family note",importance:"normal" as const,authorName:"Synthetic sender",publishAt:"2026-10-28T11:00:00Z",expiresAt:"2026-10-29T00:00:00Z",revision:1};
 for(const messages of [[],[{...message,publishAt:"2026-10-29T11:00:00Z"}],[{...message,expiresAt:"2026-10-28T11:00:00Z"}]]){
  assert.doesNotMatch(homeMarkup([],{display:true,messages}),/class="hub-messages/);
 }
 const html=homeMarkup([],{display:true,messages:[message]});
 assert.match(html,/class="hub-messages/);
 assert.match(html,/A synthetic family note/);
});

test("day preview shortens groups of three or more while item details keep every visible person",async()=>{
 setViewport();
 const people=Array.from({length:3},(_,i)=>({id:`synthetic-${i}`,displayName:`Synthetic person ${i+1}`}));
 const item:Parameters<typeof FamilyHub>[0]["items"][number]={id:"synthetic-event",kind:"event",contentLocale:"en",title:"Synthetic group walk",body:"",targets:{household:false,personIds:people.map(person=>person.id)},entries:[],priority:"normal",publishAt:null,startsAt:"2026-10-28T14:00:00Z",endsAt:"2026-10-28T15:00:00Z",expiresAt:"2026-10-29T00:00:00Z",source:{label:"Synthetic source",observedAt:"2026-10-28T11:00:00Z",uncertainty:"low"},metadata:{},revision:1,updatedAt:"2026-10-28T11:00:00Z"};
 const html=homeMarkup(people,{items:[item]});
 assert.match(html,/<p>3 people<\/p>/);
 const {ItemCard}=await import("../src/family-hub");
 const details=renderToStaticMarkup(createElement(LocaleProvider,{locale:"en",children:createElement(ItemCard,{item,people,zone:"UTC"})}));
 assert.match(details,/Synthetic person 1 · Synthetic person 2 · Synthetic person 3/);
 const two=homeMarkup(people.slice(0,2),{items:[{...item,targets:{household:false,personIds:people.slice(0,2).map(person=>person.id)}}]});
 assert.match(two,/<p>Synthetic person 1 · Synthetic person 2<\/p>/);
 const norwegian=renderToStaticMarkup(createElement(LocaleProvider,{locale:"nb",children:createElement(FamilyHub,{people,items:[item],messages:[],zone:"UTC",householdName:"Synthetic household",now:Date.parse("2026-10-28T12:00:00Z"),displaySections:{week:false}})}));
 assert.match(norwegian,/<p>3 personer<\/p>/);
});
