export type DisplaySourceEvent = {
  kind: 'revoked' | 'authorized';
  epoch: number;
  displayId: string | null;
};
export type DisplaySourceToken={displayId:string|null;epoch:number;generation:number;canonical:DisplaySourceEvent|null};

const SOURCE_STATE_KEY = 'samvev.display.source.v1';
const SOURCE_CHANNEL = 'samvev.display.source';

export function parseDisplaySourceEvent(value: unknown): DisplaySourceEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if ((event.kind !== 'revoked' && event.kind !== 'authorized') || !Number.isSafeInteger(event.epoch) || Number(event.epoch) < 1) return null;
  if (event.displayId !== null && (typeof event.displayId !== 'string' || event.displayId.length > 80)) return null;
  if (event.kind === 'authorized' && typeof event.displayId !== 'string') return null;
  return { kind: event.kind, epoch: Number(event.epoch), displayId: event.displayId as string | null };
}

export function isNewerDisplaySourceEvent(currentEpoch: number, event: DisplaySourceEvent): boolean {
  return Number.isSafeInteger(currentEpoch) && event.epoch > currentEpoch;
}

export function isCurrentDisplaySource(current: { displayId: string|null; epoch: number; generation: number }, callback: { displayId: string|null; epoch: number; generation: number }): boolean {
  return current.displayId === callback.displayId && current.epoch === callback.epoch && current.generation === callback.generation;
}
export function sameDisplaySourceEvent(left:DisplaySourceEvent|null,right:DisplaySourceEvent|null):boolean{
  return left===right||Boolean(left&&right&&left.kind===right.kind&&left.displayId===right.displayId&&left.epoch===right.epoch);
}
export function isCurrentDisplayCallback(current:DisplaySourceToken,callback:DisplaySourceToken,canonical:DisplaySourceEvent|null):boolean{
  return isCurrentDisplaySource(current,callback)&&sameDisplaySourceEvent(current.canonical,callback.canonical)&&sameDisplaySourceEvent(canonical,callback.canonical);
}
export function displayCredentialLossKnown(event:DisplaySourceEvent|null,previouslyPaired:boolean):boolean{
  return Boolean(event?.displayId)||previouslyPaired;
}
export function canCompleteDisplayPairing(event:DisplaySourceEvent|null,canonical:DisplaySourceEvent|null,active:boolean):boolean{
  return active&&event?.kind==='authorized'&&sameDisplaySourceEvent(event,canonical);
}

export function isDisplayCacheForCurrentSource(cache: { displayId: string; epoch: number }, event: DisplaySourceEvent|null): boolean {
  return Boolean(event && event.kind === 'authorized' && event.displayId === cache.displayId && event.epoch === cache.epoch);
}

export function readDisplaySourceEvent(): DisplaySourceEvent | null {
  if (typeof window === 'undefined') return null;
  try { return parseDisplaySourceEvent(JSON.parse(window.localStorage.getItem(SOURCE_STATE_KEY) ?? 'null')); }
  catch { return null; }
}

export function readDisplaySourceEpoch(): number {
  return readDisplaySourceEvent()?.epoch ?? 0;
}

export function subscribeDisplaySourceEvents(listener: (event: DisplaySourceEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(SOURCE_CHANNEL);
    channel.addEventListener('message', message => {
      const event = parseDisplaySourceEvent(message.data);
      if (event) listener(event);
    });
  } catch { /* Storage events are the fallback. */ }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SOURCE_STATE_KEY || !event.newValue) return;
    try {
      const parsed = parseDisplaySourceEvent(JSON.parse(event.newValue));
      if (parsed) listener(parsed);
    } catch { /* Ignore malformed cross-tab state. */ }
  };
  window.addEventListener('storage', onStorage);
  return () => { channel?.close(); window.removeEventListener('storage', onStorage); };
}
