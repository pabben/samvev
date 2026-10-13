// Explicit illustrations retain their established accent across every permitted
// projection. Initials use stable IDs, never a name or current roster position.
export function personAccent(personId?:string|null,avatarKey?:string|null):number {
 const selected=/^avatar-0([1-6])$/.exec(avatarKey??'');
 if(selected)return Number(selected[1])-1;
 let hash=0;for(const character of personId??'')hash=(Math.imul(hash,31)+character.charCodeAt(0))>>>0;
 return hash%6;
}
