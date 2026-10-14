export type MemberTab = 'home'|'messages'|'people'|'more'|'displays'|'integrations'|'monitors'|'ai';
export type PrimaryMemberTab = 'home'|'messages'|'people'|'more';
export function primaryMemberTab(tab:MemberTab):PrimaryMemberTab {
 return tab==='home'||tab==='messages'||tab==='people'?tab:'more';
}

export function initialMemberTab(url:string):MemberTab {
 const parsed=new URL(url,'https://samvev.invalid');
 if(parsed.pathname==='/integrations'||new URLSearchParams(parsed.hash.slice(1)).has('calendar-oauth'))return 'integrations';
 const value=parsed.searchParams.get('tab');
 return (['home','messages','people','more','displays','integrations','monitors','ai'] as const).includes(value as MemberTab)?value as MemberTab:'home';
}
