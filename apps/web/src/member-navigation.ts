export type MemberTab = 'home'|'calendar'|'messages'|'people'|'more'|'displays'|'integrations'|'monitors'|'ai';
export type PrimaryMemberTab = 'home'|'calendar'|'messages'|'people'|'more';
export function primaryMemberTab(tab:MemberTab):PrimaryMemberTab {
 return tab==='home'||tab==='calendar'||tab==='messages'||tab==='people'?tab:'more';
}

export function initialMemberTab(url:string):MemberTab {
 const parsed=new URL(url,'https://samvev.invalid');
 if(parsed.pathname==='/integrations'||new URLSearchParams(parsed.hash.slice(1)).has('calendar-oauth'))return 'integrations';
 const value=parsed.searchParams.get('tab');
 return (['home','calendar','messages','people','more','displays','integrations','monitors','ai'] as const).includes(value as MemberTab)?value as MemberTab:'home';
}

/** Member pages share the root route; Home has no redundant tab parameter. */
export function memberTabUrl(url:string,tab:MemberTab):string {
 const parsed=new URL(url,'https://samvev.invalid');
 if(tab==='home')parsed.searchParams.delete('tab');
 else parsed.searchParams.set('tab',tab);
 return `/${parsed.search}${parsed.hash}`;
}
