import type { FastifyReply } from 'fastify';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

const BASE_BROWSER_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY
});

export function browserSecurityHeaders(secureCookies: boolean): Readonly<Record<string,string>> {
  return secureCookies
    ? { ...BASE_BROWSER_SECURITY_HEADERS, 'Strict-Transport-Security': 'max-age=86400' }
    : BASE_BROWSER_SECURITY_HEADERS;
}

export function applyBrowserSecurityHeaders(reply: FastifyReply, headers: Readonly<Record<string,string>>): void {
  for (const [name,value] of Object.entries(headers)) reply.header(name,value);
}
