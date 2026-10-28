import { personColorTokens } from "@samvev/contracts";
import type { PersonColorToken } from "./types";

// Persisted semantic colors are shared by profiles and every household surface.
// Legacy/malformed projections fall back to a stable ID, never to a name/index.
export function personColorToken(personId?:string|null,colorToken?:string|null,avatarKey?:string|null):PersonColorToken {
 if(personColorTokens.includes(colorToken as PersonColorToken))return colorToken as PersonColorToken;
 return personColorTokens[personAccent(personId,avatarKey)%personColorTokens.length]!;
}

// Initials use stable IDs, never a name or current roster position.
export function personAccent(personId?:string|null,avatarKey?:string|null):number {
 const selected=/^avatar-0([1-6])$/.exec(avatarKey??'');
 if(selected)return Number(selected[1])-1;
 let hash=0;for(const character of personId??'')hash=(Math.imul(hash,31)+character.charCodeAt(0))>>>0;
 return hash%6;
}
