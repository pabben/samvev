export type MemberTab = 'home'|'messages'|'people'|'more'|'displays'|'integrations'|'monitors'|'ai';
export type PrimaryMemberTab = 'home'|'messages'|'people'|'more';
export function primaryMemberTab(tab:MemberTab):PrimaryMemberTab {
 return tab==='home'||tab==='messages'||tab==='people'?tab:'more';
}
