import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

registerHooks({load(url,context,nextLoad){return url.endsWith(".webp")?{format:"module",source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const [{FamilyHub},{LocaleProvider}]=await Promise.all([import("../src/family-hub"),import("../src/ui")]);

const css=readFileSync(new URL("../src/home.css",import.meta.url),"utf8");
function setViewport(mobile=false){
 Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{dataset:{theme:"light"}}}});
 Object.defineProperty(globalThis,"matchMedia",{configurable:true,value:(query:string)=>({matches:mobile&&query.includes("max-width: 640px")})});
}
function homeMarkup(people:Parameters<typeof FamilyHub>[0]["people"],extras:Partial<Parameters<typeof FamilyHub>[0]>={}){
 const props:Parameters<typeof FamilyHub>[0]={people,items:[],messages:[],zone:"Europe/Oslo",householdName:"Synthetic household",localDate:"2026-10-28",now:Date.parse("2026-10-28T12:00:00Z"),displaySections:{week:false},...extras};
 return renderToStaticMarkup(createElement(LocaleProvider,{locale:"en",children:createElement(FamilyHub,props)}));
}

test("member Home uses non-overlapping four-column board slots and explicit tablet reflow",()=>{
 assert.match(css,/\.hub-home-board>\.hub-today\{grid-column:1;grid-row:1\}/);
 assert.match(css,/\.hub-home-board>\.hub-tomorrow\{grid-column:2;grid-row:1\}/);
 assert.match(css,/\.family-hub\.hub-member \.hub-home-board>\.hub-person-section\{grid-column:3;grid-row:1/);
 assert.match(css,/\.hub-home-board>\.hub-home-smart\{grid-column:4;grid-row:1/);
 assert.match(css,/\.hub-home-board>\.hub-messages\{grid-column:1\/span 2;grid-row:2\}/);
 assert.match(css,/\.hub-home-board>\.hub-home-photos\{grid-column:4;grid-row:2\}/);
 assert.match(css,/\.hub-home-board:has\(>\.hub-messages\)>\.hub-person-section\{grid-row:1\/span 2\}/);
 assert.match(css,/max-width:1100px/);
 assert.match(css,/max-width:640px/);
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
 assert.ok(html.indexOf("hub-person-section")<html.indexOf("synthetic-smart"));
 assert.ok(html.indexOf("synthetic-smart")<html.indexOf("hub-messages"));
 assert.ok(html.indexOf("hub-messages")<html.indexOf("hub-home-photos"));
 assert.match(html,/Synthetic sender/);
});

test("mobile Home retains birthday identities and uses the single-column mobile composition",()=>{
 setViewport(true);
 const html=homeMarkup([{id:"synthetic-person",displayName:"Synthetic child"}],{birthdays:[{personId:"synthetic-person",displayName:"Synthetic child",due:"today"}]});
 assert.match(html,/class="hub-home-primary-grid hub-home-mobile"/);
 assert.match(html,/data-review-private="birthday-badge"/);
 assert.match(css,/\.hub-home-primary-grid\{grid-template-columns:minmax\(0,1fr\);/);
});
