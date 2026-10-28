const DB_NAME = "samvev-display-client-locks";
const STORE_NAME = "leases";
const LOCK_NAME = "display-pairing-redeem";
const LEASE_MS = 45_000;
const WAIT_MS = 120_000;
const RENEW_MS = 10_000;
let localQueue: Promise<void> = Promise.resolve();

export interface DisplayRedeemLeaseStore {
  acquire(name: string, token: string, now: number, expiresAt: number): Promise<boolean>;
  renew(name: string, token: string, expiresAt: number): Promise<boolean>;
  release(name: string, token: string): Promise<void>;
  close?(): void;
}

function openLeaseDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("display_redeem_lock_unavailable"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let failed = false;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch { reject(new Error("display_redeem_lock_unavailable")); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "name" });
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => { failed = true; reject(new Error("display_redeem_lock_unavailable")); };
    request.onblocked = () => { failed = true; reject(new Error("display_redeem_lock_unavailable")); };
  });
}

function createIndexedDbLeaseStore(db: IDBDatabase): DisplayRedeemLeaseStore {
  return {
    acquire(name, token, now, expiresAt) {
      return new Promise((resolve, reject) => {
        let acquired = false;
        let tx: IDBTransaction;
        try { tx = db.transaction(STORE_NAME, "readwrite"); }
        catch { reject(new Error("display_redeem_lock_unavailable")); return; }
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        request.onsuccess = () => {
          const current = request.result as { token?: string; expiresAt?: number }|undefined;
          if (!current || typeof current.expiresAt !== "number" || current.expiresAt <= now) {
            store.put({ name, token, expiresAt });
            acquired = true;
          }
        };
        tx.oncomplete = () => resolve(acquired);
        tx.onerror = () => reject(new Error("display_redeem_lock_unavailable"));
        tx.onabort = () => reject(new Error("display_redeem_lock_unavailable"));
      });
    },
    renew(name, token, expiresAt) {
      return new Promise((resolve, reject) => {
        let renewed = false;
        let tx: IDBTransaction;
        try { tx = db.transaction(STORE_NAME, "readwrite"); }
        catch { reject(new Error("display_redeem_lock_lost")); return; }
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        request.onsuccess = () => {
          const current = request.result as { token?: string }|undefined;
          if (current?.token === token) {
            store.put({ name, token, expiresAt });
            renewed = true;
          }
        };
        tx.oncomplete = () => resolve(renewed);
        tx.onerror = () => reject(new Error("display_redeem_lock_lost"));
        tx.onabort = () => reject(new Error("display_redeem_lock_lost"));
      });
    },
    release(name, token) {
      return new Promise((resolve, reject) => {
        let tx: IDBTransaction;
        try { tx = db.transaction(STORE_NAME, "readwrite"); }
        catch { reject(new Error("display_redeem_lock_unavailable")); return; }
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        request.onsuccess = () => {
          const current = request.result as { token?: string }|undefined;
          if (current?.token === token) store.delete(name);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("display_redeem_lock_unavailable"));
        tx.onabort = () => reject(new Error("display_redeem_lock_unavailable"));
      });
    },
    close: () => db.close(),
  };
}

export function createDisplayRedeemLeaseRunner(store: DisplayRedeemLeaseStore, settings: { leaseMs?:number; waitMs?:number; renewMs?:number; pollMs?:number } = {}) {
  const leaseMs=settings.leaseMs??LEASE_MS, waitMs=settings.waitMs??WAIT_MS, renewMs=settings.renewMs??RENEW_MS, pollMs=settings.pollMs??125;
  let queue: Promise<void> = Promise.resolve();
  return async function withLease<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let releaseLocal!: () => void;
    const previous = queue;
    queue = new Promise<void>(resolve => { releaseLocal = resolve; });
    await previous;
    const token = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const waitUntil = Date.now() + waitMs;
    let acquired = false;
    let heartbeat: ReturnType<typeof setInterval>|undefined;
    let renewal = Promise.resolve(true);
    const controller = new AbortController();
    try {
      while (!acquired && Date.now() < waitUntil) {
        acquired = await store.acquire(LOCK_NAME, token, Date.now(), Date.now() + leaseMs);
        if (!acquired) await new Promise(resolve => setTimeout(resolve, pollMs));
      }
      if (!acquired) throw new Error("display_redeem_lock_timeout");
      let lost = false;
      heartbeat = setInterval(() => {
        if (lost) return;
        renewal = renewal.then(async () => {
          if (lost) return false;
          const valid = await store.renew(LOCK_NAME, token, Date.now() + leaseMs).catch(() => false);
          if (!valid) { lost = true; controller.abort(new Error("display_redeem_lock_lost")); }
          return valid;
        });
      }, renewMs);
      const value = await work(controller.signal);
      await renewal;
      if (lost || controller.signal.aborted) throw new Error("display_redeem_lock_lost");
      return value;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await renewal.catch(() => false);
      if (acquired) await store.release(LOCK_NAME, token).catch(() => {});
      releaseLocal();
    }
  };
}

/** Web Locks is preferred; HTTP-LAN clients use IndexedDB's atomic read/write lease. */
export async function withDisplayRedeemLock<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = localQueue;
  localQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks) return await locks.request(LOCK_NAME, { mode: "exclusive" }, () => work(new AbortController().signal));
    const db = await openLeaseDatabase();
    try { return await createDisplayRedeemLeaseRunner(createIndexedDbLeaseStore(db))(work); }
    finally { db.close(); }
  } finally {
    release();
  }
}
