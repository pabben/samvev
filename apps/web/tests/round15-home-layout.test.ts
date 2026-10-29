import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

registerHooks({load(url,context,nextLoad){return url.endsWith(".webp")?{format:"module",source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const [{FamilyHub},{LocaleProvider}]=await Promise.all([import("../src/family-hub"),import("../src/ui")]);
const homeStyles=readFileSync(new URL("../src/home.css",import.meta.url),"utf8");

function setViewport(mobile=false,theme:"light"|"dark"="light",compact=mobile){
 Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{dataset:{theme}}}});
 Object.defineProperty(globalThis,"matchMedia",{configurable:true,value:(query:string)=>({matches:query.includes("max-width: 640px")?mobile:query.includes("max-width: 1000px")?compact:false})});
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

test("desktop Home places one activity week below the two agenda cards beside the People column",()=>{
 setViewport(false,"light",false);
 const html=homeMarkup(Array.from({length:6},(_,i)=>({id:`synthetic-${i}`,displayName:`Synthetic person ${i+1}`})),{householdId:"synthetic-household",displaySections:{week:true}});
 assert.equal((html.match(/data-testid="home-activity-week"/g)??[]).length,1);
 assert.match(html,/<div class="hub-home-left-column"><div class="hub-home-agenda">[\s\S]*?hub-today[\s\S]*?hub-tomorrow[\s\S]*?<\/div><div class="hub-home-week" data-testid="home-week-column"><section class="hub-week[\s\S]*?<\/div><\/div><div class="hub-home-column hub-home-people">/);
 assert.doesNotMatch(html,/class="hub-member-week-outside"/);
});

test("tablet Home keeps People beside the agenda and puts the week beneath the agenda",()=>{
 setViewport(false,"dark",true);
 const html=homeMarkup([{id:"synthetic-person",displayName:"Synthetic person"}],{householdId:"synthetic-household",displaySections:{week:true}});
 assert.equal((html.match(/data-testid="home-activity-week"/g)??[]).length,1);
 assert.match(html,/<div class="hub-home-left-column"><div class="hub-home-agenda">[\s\S]*?hub-today[\s\S]*?hub-tomorrow[\s\S]*?<\/div><div class="hub-home-week" data-testid="home-week-column">[\s\S]*?<\/div><\/div><div class="hub-home-column hub-home-people">/);
});

test("Home week layout fills the agenda column on desktop and tablet without changing mobile",()=>{
 assert.match(homeStyles,/\.hub-home-left-column\{grid-column:span 2;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(homeStyles,/\.hub-home-agenda\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(homeStyles,/\.hub-home-week\{grid-column:1\/-1;min-width:0\}/);
 assert.match(homeStyles,/@media\(min-width:641px\) and \(max-width:1100px\)[\s\S]*?\.family-hub\.hub-member \.hub-home-left-column\{display:contents\}[\s\S]*?\.family-hub\.hub-member \.hub-home-agenda\{grid-column:1;grid-row:1;grid-template-columns:minmax\(0,1fr\)\}[\s\S]*?\.family-hub\.hub-member \.hub-home-week\{grid-column:1\/-1;grid-row:2\}[\s\S]*?\.family-hub\.hub-member \.hub-home-people\{grid-column:2;grid-row:1\}/);
 assert.match(homeStyles,/@media\(min-width:900px\) and \(max-width:1100px\)[\s\S]*?\.family-hub\.hub-member \.hub-home-board\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}[\s\S]*?\.family-hub\.hub-member \.hub-home-left-column\{display:grid;grid-column:span 2/);
 setViewport(true,"light",true);
 const mobile=homeMarkup([{id:"synthetic-person",displayName:"Synthetic person"}],{householdId:"synthetic-household",displaySections:{week:true}});
 assert.equal((mobile.match(/data-testid="home-activity-week"/g)??[]).length,1);
 assert.match(mobile,/class="hub-member-week-outside"><section class="hub-week/);
 assert.doesNotMatch(mobile,/data-testid="home-week-column"/);
});

test("portrait tablet override beats the empty-services three-track selector",()=>{
 assert.match(homeStyles,/@media\(min-width:641px\) and \(max-width:899px\)[\s\S]*?\.family-hub\.hub-member \.hub-home-board:not\(:has\(>\.hub-home-services>\.hub-home-smart:not\(:empty\)\)\):not\(:has\(>\.hub-home-services>\.hub-home-photos\)\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test("mobile light and dark both expose exactly one compose action with empty or populated messages",()=>{
 const message={id:"synthetic-message",body:"A synthetic mobile note",importance:"normal" as const,authorName:"Synthetic sender",publishAt:"2026-10-28T11:00:00Z",expiresAt:"2026-10-29T00:00:00Z",revision:1};
 for(const theme of ["light","dark"] as const){
  for(const messages of [[],[message]]){
   setViewport(true,theme,true);
   const html=homeMarkup([{id:"synthetic-person",displayName:"Synthetic person"}],{onCompose:()=>{},messages});
   assert.equal((html.match(/New message/g)??[]).length,1,`${theme} theme should render one compose action`);
   assert.match(html,/class="hub-quick-actions"[^]*?New message[^]*?<\/section>/);
   assert.doesNotMatch(html,/class="button hub-compose"/,"mobile should not retain the hidden hero compose button in the DOM");
   if(messages.length)assert.match(html,/hub-messages/);
  }
 }
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


test("mobile themes show the same single relevant Today event and single Tomorrow preview",()=>{
 const event=(id:string,startsAt:string,endsAt:string,allDay=false):Parameters<typeof FamilyHub>[0]["items"][number]=>({id,kind:"event",contentLocale:"en",title:`Synthetic ${id}`,body:"",targets:{household:true,personIds:[]},entries:[],priority:"normal",publishAt:null,startsAt,endsAt,expiresAt:"2026-10-31T00:00:00Z",source:{label:"Synthetic source",observedAt:"2026-10-28T08:00:00Z",uncertainty:"low"},metadata:{allDay},revision:1,updatedAt:"2026-10-28T08:00:00Z"});
 const ended=event("ended","2026-10-28T09:00:00Z","2026-10-28T10:00:00Z");
 const ongoing=event("ongoing","2026-10-28T11:00:00Z","2026-10-28T13:00:00Z");
 const future=event("future","2026-10-28T14:00:00Z","2026-10-28T15:00:00Z");
 const tomorrow=event("tomorrow-first","2026-10-29T09:00:00Z","2026-10-29T10:00:00Z");
 const tomorrowLater=event("tomorrow-later","2026-10-29T11:00:00Z","2026-10-29T12:00:00Z");
 const allDay=event("all-day","2026-10-28T00:00:00Z","2026-10-29T00:00:00Z",true);
 const section=(html:string,day:"today"|"tomorrow")=>html.match(new RegExp(`<section[^>]*data-hub-scope="${day}"[\\s\\S]*?<\\/section>`))?.[0]??"";
 const ids=(html:string)=>[...html.matchAll(/data-item-id="([^"]+)"/g)].map(match=>match[1]);
 for(const theme of ["light","dark"] as const){
  setViewport(true,theme);
  const html=homeMarkup([],{items:[ended,ongoing,future,tomorrow,tomorrowLater]});
  assert.deepEqual(ids(section(html,"today")),["ongoing"],`${theme}: skip ended event and keep ongoing first`);
  assert.deepEqual(ids(section(html,"tomorrow")),["tomorrow-first"],`${theme}: one Tomorrow preview`);
  assert.match(section(html,"today"),/data-hub-detail="today"/,"all Today entries remain reachable through the collection");
  assert.match(section(html,"tomorrow"),/data-hub-detail="tomorrow"/,"all Tomorrow entries remain reachable through the collection");
  assert.deepEqual(ids(section(homeMarkup([],{items:[ended,future]}),"today")),["future"],`${theme}: keep next future event when none is ongoing`);
  assert.deepEqual(ids(section(homeMarkup([],{items:[allDay,ended,future]}),"today")),["all-day"],`${theme}: retain relevant all-day event`);
 }
});

test("mobile density parity preserves desktop and compact tablet event counts",()=>{
 const items=Array.from({length:6},(_,index):Parameters<typeof FamilyHub>[0]["items"][number]=>({id:`synthetic-density-${index}`,kind:"event",contentLocale:"en",title:`Synthetic event ${index}`,body:"",targets:{household:true,personIds:[]},entries:[],priority:"normal",publishAt:null,startsAt:`2026-10-28T${13+index}:00:00Z`,endsAt:`2026-10-28T${14+index}:00:00Z`,expiresAt:"2026-10-29T00:00:00Z",source:{label:"Synthetic source",observedAt:"2026-10-28T08:00:00Z",uncertainty:"low"},metadata:{},revision:1,updatedAt:"2026-10-28T08:00:00Z"}));
 for(const theme of ["light","dark"] as const)for(const compact of [false,true]){
  setViewport(false,theme,compact);
  const html=homeMarkup([],{items});
  const today=html.match(/<section[^>]*data-hub-scope="today"[\s\S]*?<\/section>/)?.[0]??"";
  assert.equal([...today.matchAll(/data-item-id="/g)].length,compact?3:5,`${theme}/${compact?"tablet":"desktop"}: existing density remains`);
 }
});
