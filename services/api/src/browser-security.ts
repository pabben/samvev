import type { FastifyReply } from 'fastify';

const CSP_WITHOUT_FRAME_ANCESTORS = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
];

export const CONTENT_SECURITY_POLICY = [...CSP_WITHOUT_FRAME_ANCESTORS, "frame-ancestors 'self'"].join('; ');

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

/**
 * Headers for the paired-display document (/display) when the operator has allowed
 * extra frame ancestors, e.g. a Home Assistant dashboard on a Shelly wall panel.
 * X-Frame-Options is omitted because it cannot express an origin list; CSP
 * frame-ancestors is the authoritative control. Returns the default headers when
 * no extra ancestors are configured.
 */
export function displayDocumentSecurityHeaders(secureCookies: boolean, frameAncestors: readonly string[] = []): Readonly<Record<string,string>> {
  const base = browserSecurityHeaders(secureCookies);
  if (!frameAncestors.length) return base;
  const { 'X-Frame-Options': _omitted, ...rest } = base;
  return Object.freeze({
    ...rest,
    'Content-Security-Policy': [...CSP_WITHOUT_FRAME_ANCESTORS, `frame-ancestors 'self' ${frameAncestors.join(' ')}`].join('; ')
  });
}

/** True for the single-page-app document routes that render the paired display. */
export function isDisplayDocumentPath(pathname: string): boolean {
  return pathname === '/display';
}

/**
 * Options for the display credential cookie (scoped to /api/v1/display). By default it
 * is SameSite=Strict. When the operator allows the display page to be framed by
 * another origin (e.g. Home Assistant on a wall panel), the frame is cross-site, so
 * the cookie must be SameSite=None to be sent there, and Partitioned so browsers
 * that block unpartitioned third-party cookies can still keep it. Unsafe requests
 * remain protected by the server-side Origin check, not by SameSite.
 */
export function displayCookieOptions(maxAge: number, secure: boolean, embeddable: boolean): Record<string, unknown> {
  const base = { httpOnly: true, sameSite: 'strict', secure, path: '/api/v1/display', maxAge };
  return embeddable && secure ? { ...base, sameSite: 'none', partitioned: true } : base;
}

export function applyBrowserSecurityHeaders(reply: FastifyReply, headers: Readonly<Record<string,string>>): void {
  for (const [name,value] of Object.entries(headers)) reply.header(name,value);
}
