import type { RequestOptions } from 'node:http';

export interface PinnedAddress {address:string;family:4|6;}

/** Node 24 may request all lookup results even for a pinned single address. */
export function createPinnedLookup(target:PinnedAddress):NonNullable<RequestOptions['lookup']>{
  return ((_hostname:string,options:unknown,callback:(...args:unknown[])=>void)=>{
    const all=Boolean(options&&typeof options==='object'&&'all' in options&&(options as {all?:unknown}).all);
    if(all)callback(null,[{address:target.address,family:target.family}]);
    else callback(null,target.address,target.family);
  }) as NonNullable<RequestOptions['lookup']>;
}
