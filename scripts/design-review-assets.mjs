import { createHash } from 'node:crypto';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const photoPath = new RegExp(`^/api/v1/households/(${uuid})/people/(${uuid})/photo/(96|256|512)$`, 'i');
const mediaAssetPath = new RegExp(`^/api/v1/households/(${uuid})/media/assets/(${uuid})/(preview|master)$`, 'i');
const revision = /^[1-9][0-9]*$/;

function versionedQuery(url, kind) {
  if ([...url.searchParams.keys()].length !== 1 || !revision.test(url.searchParams.get('v') ?? '')) throw new Error(`${kind} URL must have exactly one positive integer v query parameter.`);
  if (url.hash) throw new Error(`${kind} URL must not have a fragment.`);
  const version = Number(url.searchParams.get('v'));
  if (!Number.isSafeInteger(version) || version < 1) throw new Error(`${kind} URL revision must be a safe positive integer.`);
  return version;
}

export function classifyVisibleImage(value, baseURL) {
  const base = new URL(baseURL);
  const url = new URL(value, base);
  if (url.origin !== base.origin) throw new Error(`Visible image has an unexpected origin: ${url.origin}`);
  if (url.pathname.startsWith('/assets/')) {
    if (url.search || url.hash) throw new Error(`Static asset URL has an unexpected query or fragment: ${url.pathname}`);
    return { kind: 'static', path: url.pathname };
  }
  const match = photoPath.exec(url.pathname);
  if (match) {
    const version = versionedQuery(url, 'Protected photo');
    return { kind: 'protected-photo', path: url.pathname, version, key: `${url.pathname}?v=${version}` };
  }
  const media = mediaAssetPath.exec(url.pathname);
  if (!media) throw new Error(`Visible image is neither a verified static asset, protected person photo nor protected household media asset: ${url.pathname}`);
  const version = versionedQuery(url, 'Protected media asset');
  return { kind: 'protected-media-asset', path: url.pathname, variant: media[3].toLowerCase(), version, key: `${url.pathname}?v=${version}` };
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

export function protectedMediaAssetEvidence({ image, status, contentType, bytes }) {
  if (image?.kind !== 'protected-media-asset') throw new Error('Protected-media evidence requires a classified household media asset.');
  if (status !== 200) throw new Error(`Protected media asset returned HTTP ${status}.`);
  const mime = String(contentType ?? '').split(';', 1)[0].toLowerCase();
  if (mime !== 'image/webp') throw new Error(`Protected media asset has unexpected content type: ${mime || 'missing'}.`);
  const payload = Buffer.from(bytes ?? []);
  if (!payload.length) throw new Error('Protected media asset response is empty.');
  const route = '/api/v1/households/:householdId/media/assets/:assetId/:variant';
  return { route, variant: image.variant, pathSha256: createHash('sha256').update(image.path).digest('hex'), version: image.version, status, contentType: mime, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
}

// Publish only coarse proof of authorized image loading. Pixel/path hashes and
// byte lengths stay in ignored local validation evidence, never GitHub.
export function publicProtectedPhotoEvidence(evidence) {
  if (!/^\/api\/v1\/households\/:householdId\/people\/:personId\/photo\/(96|256|512)$/.test(evidence?.route ?? '') || !Number.isSafeInteger(evidence.version) || evidence.version < 1 || evidence.status !== 200 || evidence.contentType !== 'image/webp') throw new Error('Invalid protected-photo public evidence.');
  return { route:evidence.route, version:evidence.version, status:evidence.status, contentType:evidence.contentType };
}

export function publicProtectedMediaAssetEvidence(evidence) {
  if (evidence?.route !== '/api/v1/households/:householdId/media/assets/:assetId/:variant' || !['preview', 'master'].includes(evidence.variant) || !Number.isSafeInteger(evidence.version) || evidence.version < 1 || evidence.status !== 200 || evidence.contentType !== 'image/webp') throw new Error('Invalid protected-media public evidence.');
  return { route:evidence.route, variant:evidence.variant, version:evidence.version, status:evidence.status, contentType:evidence.contentType };
}

export function publicAuthorizedDynamicImageEvidence(evidence) {
  if (evidence?.route?.startsWith('/api/v1/households/:householdId/people/:personId/photo/')) return publicProtectedPhotoEvidence(evidence);
  if (evidence?.route === '/api/v1/households/:householdId/media/assets/:assetId/:variant') return publicProtectedMediaAssetEvidence(evidence);
  throw new Error('Invalid authorized dynamic image evidence.');
}

export function validatePublicAuthorizedDynamicImageEvidence(images) {
  if (!Array.isArray(images)) throw new Error('Missing public authorized dynamic image evidence.');
  for (const evidence of images) {
    const allowed=publicAuthorizedDynamicImageEvidence(evidence);
    if (Object.keys(evidence).some(key=>!Object.hasOwn(allowed,key))) throw new Error('Public authorized image evidence contains private or unsupported fields.');
  }
}

export function validatePublicPhotoEvidence(images) {
  return validatePublicAuthorizedDynamicImageEvidence(images);
}
