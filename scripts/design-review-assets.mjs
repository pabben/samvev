import { createHash } from 'node:crypto';

const photoPath = /^\/api\/v1\/households\/([0-9a-f]{8}-[0-9a-f-]{27})\/people\/([0-9a-f]{8}-[0-9a-f-]{27})\/photo\/(96|256|512)$/i;
const revision = /^[1-9][0-9]*$/;

export function classifyVisibleImage(value, baseURL) {
  const base = new URL(baseURL);
  const url = new URL(value, base);
  if (url.origin !== base.origin) throw new Error(`Visible image has an unexpected origin: ${url.origin}`);
  if (url.pathname.startsWith('/assets/')) {
    if (url.search || url.hash) throw new Error(`Static asset URL has an unexpected query or fragment: ${url.pathname}`);
    return { kind: 'static', path: url.pathname };
  }
  const match = photoPath.exec(url.pathname);
  if (!match) throw new Error(`Visible image is neither a verified static asset nor a protected person photo: ${url.pathname}`);
  if ([...url.searchParams.keys()].length !== 1 || !revision.test(url.searchParams.get('v') ?? '')) throw new Error('Protected photo URL must have exactly one positive integer v query parameter.');
  if (url.hash) throw new Error('Protected photo URL must not have a fragment.');
  return { kind: 'protected-photo', path: url.pathname, version: Number(url.searchParams.get('v')), key: `${url.pathname}?v=${url.searchParams.get('v')}` };
}

export function protectedPhotoEvidence({ image, status, contentType, bytes }) {
  if (image?.kind !== 'protected-photo') throw new Error('Protected-photo evidence requires a classified protected photo.');
  if (status !== 200) throw new Error(`Protected photo returned HTTP ${status}.`);
  const mime = String(contentType ?? '').split(';', 1)[0].toLowerCase();
  if (mime !== 'image/webp') throw new Error(`Protected photo has unexpected content type: ${mime || 'missing'}.`);
  const payload = Buffer.from(bytes ?? []);
  if (!payload.length) throw new Error('Protected photo response is empty.');
  const route = image.path.replace(photoPath, '/api/v1/households/:householdId/people/:personId/photo/$3');
  return { route, pathSha256: createHash('sha256').update(image.path).digest('hex'), version: image.version, status, contentType: mime, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
}
