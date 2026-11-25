import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { DomainError } from '@samvev/core';
import { isBlockedMonitorAddress, normalizeMonitorUrl } from '../monitor/source-fetcher.ts';
import { createPinnedLookup } from '../pinned-lookup.ts';
import type { PinnedAddress } from '../pinned-lookup.ts';

export const MAX_SCHOOL_PDF_BYTES = 5 * 1024 * 1024;
const MAX_CLASS_PAGE_BYTES = 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 4;
const DEADLINE_MS = 12_000;

type PdfFailure = 'url_blocked' | 'redirect_blocked' | 'unavailable' | 'missing_class_link' |
  'wrong_media_type' | 'invalid_pdf' | 'too_large' | 'timed_out' | 'busy';
function failure(reason: PdfFailure, status: number): DomainError {
  return new DomainError('SCHOOL_PDF_VERIFICATION_FAILED', status, { reason });
}

type Resolver = (hostname: string) => Promise<PinnedAddress[]>;
type Response = { contentType?: string; encoding?: string; status: number; bytes: Buffer };
type Transport = (
  url: URL, address: PinnedAddress, signal: AbortSignal, maxBytes: number, acceptedType: string,
) => Promise<Response>;

const resolveAddresses: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true }))
  .map(({ address, family }) => ({ address, family: family as 4 | 6 }));

const download: Transport = (url, address, signal, maxBytes, acceptedType) => new Promise((resolve, reject) => {
  const req = request(url, {
    method: 'GET',
    agent: false,
    signal,
    lookup: createPinnedLookup(address),
    headers: { accept: acceptedType, 'accept-encoding': 'identity', 'user-agent': 'Samvev-SchoolPlan/1.0' },
  }, (res) => {
    const status = res.statusCode ?? 502;
    const contentType = res.headers['content-type'];
    const encoding = res.headers['content-encoding'];
    if (status !== 200) {
      res.destroy();
      resolve({ status, contentType, encoding, bytes: Buffer.alloc(0) });
      return;
    }
    res.on('error', reject);
    const declared = res.headers['content-length'];
    if (declared && Number(declared) > maxBytes) {
      res.destroy(failure('too_large', 413));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) res.destroy(failure('too_large', 413));
      else chunks.push(chunk);
    });
    res.on('end', () => resolve({ status, contentType, encoding, bytes: Buffer.concat(chunks, size) }));
  });
  req.on('error', reject);
  req.end();
});

function approvedHttps(value: string): URL {
  const url = new URL(normalizeMonitorUrl(value));
  // The service also validates approved URLs before persisting them.
  if (url.protocol !== 'https:' || url.port) throw failure('url_blocked', 422);
  return url;
}

function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity) => {
    const raw = entity.slice(1, -1).toLowerCase();
    switch (raw) {
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'lt': return '<';
      case 'gt': return '>';
      default: {
        const hex = raw.startsWith('#x');
        const number = Number.parseInt(raw.slice(hex ? 2 : 1), hex ? 16 : 10);
        return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\uFFFD';
      }
    }
  });
}

function containsDirectLink(html: string, pageUrl: URL, pdfUrl: URL): boolean {
  const rawTextElements = new Set(['script', 'style', 'textarea', 'noscript', 'xmp', 'iframe', 'title']);
  let rawText: string | undefined;
  let templateDepth = 0;
  let found = false;
  for (const [, closing, name, rawAttributes] of html.matchAll(/<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^"'<>])*)>/gi)) {
    const tag = name?.toLowerCase();
    if (!tag) continue;
    if (rawText) {
      if (closing && rawText === tag) rawText = undefined;
      continue;
    }
    if (!closing && rawTextElements.has(tag)) rawText = tag;
    if (tag === 'template') templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1));
    if (templateDepth || closing) continue;
    // A base element can alter the destination of every relative anchor.
    if (tag === 'base') return false;
    if (tag !== 'a' || !rawAttributes) continue;
    const attributes = rawAttributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g);
    for (const [, name, quoted, singleQuoted, unquoted] of attributes) {
      const encoded = quoted ?? singleQuoted ?? unquoted;
      if (name?.toLowerCase() !== 'href' || encoded === undefined) continue;
      try {
        if (new URL(decodeAttribute(encoded), pageUrl).href === pdfUrl.href) found = true;
      } catch { /* Malformed link. */ }
      break;
    }
  }
  return found;
}

export function validatePdfBytes(bytes: Buffer): void {
  const header = bytes.subarray(0, 16).toString('latin1');
  const trailer = bytes.subarray(-1024).toString('latin1');
  if (bytes.length < 16 || !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) ||
      !/%%EOF[\r\n\t\f ]*$/.test(trailer)) throw failure('invalid_pdf', 422);
}

let activeDownloads = 0;

export class SchoolPdfFetcher {
  constructor(private readonly resolver: Resolver = resolveAddresses, private readonly transport: Transport = download,
    private readonly deadlineMs = DEADLINE_MS) {}

  async fetch(classPage: string, exactPdf: string): Promise<Buffer> {
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) throw failure('busy', 503);
    activeDownloads++;
    const signal = AbortSignal.timeout(this.deadlineMs);
    let onAbort: (() => void) | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        onAbort = () => reject(failure('timed_out', 504));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      return await Promise.race([this.fetchWithinDeadline(classPage, exactPdf, signal), deadline]);
    } catch (error) {
      if (signal.aborted) throw failure('timed_out', 504);
      if (error instanceof DomainError && error.code === 'SCHOOL_PDF_VERIFICATION_FAILED') throw error;
      if (error instanceof DomainError) throw failure('url_blocked', 422);
      throw failure('unavailable', 502);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      activeDownloads--;
    }
  }

  private async fetchWithinDeadline(classPage: string, exactPdf: string, signal: AbortSignal): Promise<Buffer> {
    const page = approvedHttps(classPage);
    const pdf = approvedHttps(exactPdf);
    if (page.origin !== pdf.origin || page.href === pdf.href) throw failure('url_blocked', 422);
    const markup = await this.fetchExact(page, signal, MAX_CLASS_PAGE_BYTES, 'text/html');
    if (!containsDirectLink(markup.toString('utf8'), page, pdf)) throw failure('missing_class_link', 422);
    const bytes = await this.fetchExact(pdf, signal, MAX_SCHOOL_PDF_BYTES, 'application/pdf');
    validatePdfBytes(bytes);
    return bytes;
  }

  private async fetchExact(url: URL, signal: AbortSignal, maxBytes: number, type: string): Promise<Buffer> {
    const addresses = await this.resolver(url.hostname);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => isBlockedMonitorAddress(address))) {
      throw failure('url_blocked', 422);
    }
    const response = await this.transport(url, addresses[0]!, signal, maxBytes, type);
    if (response.status >= 300 && response.status < 400) throw failure('redirect_blocked', 422);
    if (response.status !== 200) throw failure('unavailable', 502);
    if (response.bytes.length > maxBytes) throw failure('too_large', 413);
    const contentType = response.contentType?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== type || (response.encoding && response.encoding.toLowerCase() !== 'identity')) {
      throw failure('wrong_media_type', 422);
    }
    return response.bytes;
  }
}

export const schoolPdfFetcher = new SchoolPdfFetcher();
