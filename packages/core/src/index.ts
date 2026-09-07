import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import type { Capability } from '@samvev/contracts';

function scrypt(password:string,salt:Buffer,keylen:number,options:Parameters<typeof scryptCallback>[3]):Promise<Buffer>{
  return new Promise((resolve,reject)=>scryptCallback(password,salt,keylen,options,(error,derived)=>error?reject(error):resolve(derived)));
}

export class DomainError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly details?: Record<string, unknown>) {
    super(code);
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, n, r, p, saltText, digestText] = encoded.split('$');
  if (kind !== 'scrypt' || !n || !r || !p || !saltText || !digestText) return false;
  const expected = Buffer.from(digestText, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltText, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const DUMMY_LOGIN_PASSWORD_HASH = 'scrypt$32768$8$1$KXgHmQmU5NzH_ZJ8kOK45g$6KjENAhc1ryit8pQRQaBadq7umXFkqGQq5zsQXXSsmN11Au357D9qqrX7yOWNU_m1FaD9dOBnwm4wKJpd5vK4w';

export async function verifyLoginPassword(password: string, storedHash: string | undefined, enabled: boolean): Promise<boolean> {
  const verified = await verifyPassword(password, storedHash ?? DUMMY_LOGIN_PASSWORD_HASH);
  return Boolean(storedHash) && enabled && verified;
}

export function opaqueToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function numericCode(): string { return String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0'); }

export function requireCapability(grants: readonly string[], capability: Capability): void {
  if (!grants.includes(capability)) throw new DomainError('FORBIDDEN', 403);
}

export type MessageState = 'draft' | 'scheduled' | 'published' | 'cancelled' | 'withdrawn' | 'expired' | 'failed';
export function initialMessageState(publishAt: Date, expiresAt: Date, now: Date): MessageState {
  if (expiresAt <= publishAt || expiresAt <= now) throw new DomainError('SCHEDULE_INVALID', 422);
  return publishAt <= now ? 'published' : 'scheduled';
}

export function lifecycleAction(state: MessageState, publishAt: Date, expiresAt: Date, now: Date): 'publish' | 'expire' | null {
  if ((state === 'scheduled' || state === 'published') && expiresAt <= now) return 'expire';
  if (state === 'scheduled' && publishAt <= now) return 'publish';
  return null;
}

export function validateIanaTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}
