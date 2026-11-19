import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import type { HubItem } from '../src/home-types';

registerHooks({load(url,context,nextLoad){return url.endsWith('.webp')?{format:'module',source:`export default ${JSON.stringify('/avatars/'+url.split('/').at(-1))}`,shortCircuit:true}:nextLoad(url,context)}});
const [{FamilyHub},{LocaleProvider,Brand}]=await Promise.all([import('../src/family-hub'),import('../src/ui')]);
export const fixtureBrand=()=>renderToStaticMarkup(h(Brand));
export const closureTitle='Planleggingsdag – skolen og SFO er stengt hele dagen';
export function displayFixture({theme='dark',orientation='landscape',empty=false,birthday=false,photo='synthetic-photo.png'}:{theme?:'light'|'dark';orientation?:'portrait'|'landscape';empty?:boolean;birthday?:boolean;photo?:string}={}) {
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme}}}});
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:false})});
  const people=Array.from({length:6},(_,i)=>({id:`synthetic-person-${i}`,displayName:`Person ${i+1}`,avatarKey:`avatar-0${i+1}`}));
  const event=(day:number,index:number,allDay=false):HubItem=>({id:`synthetic-event-${day}-${index}`,kind:'event',contentLocale:'nb',title:allDay?closureTitle:`Syntetisk aktivitet ${index+1}`,body:'',targets:{household:allDay,personIds:allDay?[]:[people[index]!.id]},entries:[],priority:'normal',publishAt:null,startsAt:`2026-11-${19+day}T${allDay?'00':String(13+index).padStart(2,'0')}:00:00Z`,endsAt:`2026-11-${allDay?20+day:19+day}T${allDay?'00':String(14+index).padStart(2,'0')}:00:00Z`,expiresAt:'2026-11-22T00:00:00Z',source:{label:'Synthetic fixture',observedAt:'2026-11-19T08:00:00Z',uncertainty:'low'},metadata:{allDay},revision:1,updatedAt:'2026-11-19T08:00:00Z'});
  const items=empty?[]:[event(0,9,true),...Array.from({length:6},(_,i)=>event(0,i)),...Array.from({length:6},(_,i)=>event(1,i))];
  const dinners=[0,1].map(day=>({id:`synthetic-dinner-${day}`,localDate:`2026-11-${19+day}`,title:day?'Fiskesuppe':'Taco',emoji:day?'🍲':'🌮',revision:1,cleared:false}));
  const homePhoto=h('section',{className:'hub-panel media-display-playback'},h('div',{className:'media-slideshow'},h('figure',{className:'media-slide'},h('img',{src:photo,alt:'Synthetic landscape'}),h('figcaption',null,'Små øyeblikk. Store minner.'))));
  return renderToStaticMarkup(h(LocaleProvider,{locale:'nb',children:h(FamilyHub,{display:true,people,items,birthdays:birthday?[{personId:people[0]!.id,displayName:people[0]!.displayName,due:'today'}]:[],messages:[{id:'synthetic-message',body:'Husk matpakke og refleks i morgen! Dere er så flinke – gleder meg til en ny fin dag! Klem ♥',importance:'normal',authorName:'Syntetisk avsender',authorPersonId:people[4]!.id,authorAvatarKey:'avatar-05',publishAt:'2026-11-19T08:00:00Z',expiresAt:'2026-11-21T00:00:00Z',revision:1}],zone:'UTC',householdName:'Synthetic household',now:Date.parse('2026-11-19T12:00:00Z'),connection:'Direkteoppdateringer',displaySections:{week:false,environment:false,next:false},displaySnapshot:{dinners,composition:{theme,orientation}},homePhoto})}));
}
