import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isIP } from 'node:net';

export const liveE2eCapabilities = ['household.view', 'household.manage', 'message.create.household', 'message.schedule'];

export function check(condition, code) { if (!condition) throw new Error(code); }
export function safeCode(error) { return typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'HARNESS_CHECK_FAILED'; }
export function shortId(id) { return createHash('sha256').update(String(id)).digest('hex').slice(0, 12); }
export function confirmedOrigin(value, confirmation) {
  let url; try { url = new URL(value); } catch { throw new Error('ORIGIN_REQUIRED'); }
  check(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href === `${url.origin}/`, 'INVALID_ORIGIN');
  check(confirmation === url.origin, 'ORIGIN_CONFIRMATION_REQUIRED');
  check(url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'HTTPS_REQUIRED');
  return url.origin;
}
export function approvedPublicSource(origin, override) {
  if (override === undefined || override === '') return { url: `${origin}/api/v1/e2e/fixtures/weekly-plan`, mode: 'synthetic_weekly_plan' };
  check(typeof override === 'string' && override.length <= 2048 && !/[\s\\]/.test(override), 'PUBLIC_SOURCE_INVALID');
  let url; try { url = new URL(override); } catch { throw new Error('PUBLIC_SOURCE_INVALID'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !/^https:\/\/[^/]*@/i.test(override) && !override.includes('#'), 'PUBLIC_SOURCE_INVALID');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // No IP literals or single-label/infrastructure hosts. DNS/redirect validation
  // still belongs to the authoritative server-side source fetcher.
  check(!isIP(host.replace(/^\[|\]$/g, '')) && host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home|invalid|test)$/.test(host) && !/^metadata\./.test(host), 'PUBLIC_SOURCE_BLOCKED');
  return { url: url.href, mode: 'public_supplement' };
}
export async function readSecret(path, root = process.cwd()) {
  check(typeof path === 'string' && path.length > 0, 'SECRET_FILE_REQUIRED');
  const filename = resolve(path), local = await realpath(resolve(root, '.local'));
  const actual = await realpath(filename);
  check(actual.startsWith(`${local}/`), 'SECRET_MUST_BE_LOCAL_IGNORED');
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), 'SECRET_PERMISSIONS');
  const ignore = await readFile(resolve(root, '.gitignore'), 'utf8');
  check(ignore.split(/\r?\n/).includes('.local/'), 'SECRET_NOT_IGNORED');
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch { throw new Error('SECRET_JSON_INVALID'); }
}
export function validateCredentials(value) {
  check(value?.version === 1 && /^live-e2e-[a-z0-9]+@test\.invalid$/.test(value.email ?? '') && typeof value.password === 'string' && value.password.length >= 12 && typeof value.marker === 'string' && value.marker.length >= 32, 'CREDENTIAL_FORMAT');
  for (const key of ['registrationId', 'householdId', 'accountId', 'membershipId', 'personId']) check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value[key] ?? ''), 'CREDENTIAL_ID_FORMAT');
}
export function validateBinding(credentials, me, attestation) {
  check(credentials.version === 1 && typeof credentials.marker === 'string' && credentials.marker.length >= 32, 'CREDENTIAL_FORMAT');
  check(me.account?.id === credentials.accountId && me.memberships?.length === 1, 'IDENTITY_MISMATCH');
  const membership = me.memberships[0];
  check(membership.id === credentials.membershipId && membership.household_id === credentials.householdId && membership.person_id === credentials.personId && membership.role_preset === 'household_admin', 'HOUSEHOLD_MISMATCH');
  check(Array.isArray(membership.capabilities) && membership.capabilities.length === liveE2eCapabilities.length && [...membership.capabilities].sort().join('\n') === [...liveE2eCapabilities].sort().join('\n'), 'CAPABILITY_MISMATCH');
  for (const key of ['registrationId', 'householdId', 'accountId', 'membershipId', 'personId']) check(attestation?.[key] === credentials[key], 'ATTESTATION_MISMATCH');
  check(attestation.dataKind === 'synthetic' && attestation.purpose === 'synthetic_live_e2e_v1' && attestation.markerProof === `sha256:${createHash('sha256').update(credentials.marker).digest('hex')}`, 'SYNTHETIC_MARKER_MISMATCH');
}
export function sanitizedTiming(value = {}) {
  const result = {};
  for (const key of ['queueWaitMs', 'providerTurns', 'toolCalls', 'webOpenMs', 'locationMs', 'weatherMs', 'providerMs', 'totalMs']) if (Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  if (typeof value.qualityEscalated === 'boolean') result.qualityEscalated = value.qualityEscalated;
  return result;
}
export function validateEvidence(evidence, credentials, task, run, required) {
  check(evidence.synthetic === true && evidence.registrationId === credentials.registrationId && evidence.householdId === credentials.householdId && evidence.taskId === task.id, 'EVIDENCE_SCOPE');
  check(evidence.execution?.id === run.id && evidence.execution.taskRevision === run.taskRevision && evidence.execution.status === 'succeeded' && !evidence.execution.errorCode, 'EXECUTION_EVIDENCE');
  check(evidence.messageCount === 0 && evidence.notificationEligible === false, 'NOTIFICATION_ISOLATION');
  const expectedTools=[...new Set(required)].sort();
  check(JSON.stringify([...(evidence.requiredTools??[])].sort())===JSON.stringify(expectedTools), 'REQUIRED_TOOL_SET_MISMATCH');
  check(JSON.stringify([...(evidence.actualTools??[])].sort())===JSON.stringify(expectedTools), 'ACTUAL_TOOL_SET_MISMATCH');
  for (const tool of required) {
    check(evidence.requiredTools?.includes(tool) && evidence.actualTools?.includes(tool), 'REQUIRED_TOOL_MISSING');
    check(evidence.attempts?.some((item) => item.tool === tool && item.outcome === 'success'), 'TOOL_AUDIT_MISSING');
    check(evidence.provenance?.some((item) => item.tool === tool && item.fingerprint && Number.isFinite(Date.parse(item.fetchedAt))), 'PROVENANCE_MISSING');
  }
  for (const source of evidence.provenance ?? []) {
    const url = new URL(source.sourceUrl);
    check(!/(^|\.)yr\.no$/i.test(url.hostname), 'YR_SCRAPING');
    check(Date.parse(source.fetchedAt) <= Date.parse(evidence.execution.completedAt) + 1000, 'PROVENANCE_FUTURE');
    // A cache hit may retain its original fetch time. It must be explicitly attested.
    check(Date.parse(source.fetchedAt) >= Date.parse(evidence.execution.queuedAt) - 1000 || ['hit', 'revalidated'].includes(source.cacheStatus), 'STALE_PROVENANCE');
    if (source.tool === 'weather.forecast') check(['hit', 'miss', 'revalidated'].includes(source.cacheStatus), 'CACHE_EVIDENCE_MISSING');
  }
  check(task.state === 'draft' && task.approvedRevision === null && !task.errorCode && !task.nextCheckAt, 'DRAFT_CHANGED');
  return sanitizedTiming(evidence.execution.timing);
}
export async function cleanupTasks(ids, cleanup) {
  const residue = [];
  for (const id of ids) { try { await cleanup(id); } catch { residue.push(id); } }
  return residue;
}

// Normal runs enqueue exactly once. A representative browser-originated run
// may probe deduplication only after its persisted active state was observed.
export async function startObservedExecution(enqueue, readRun, initialRun = null) {
  if (!initialRun) return (await enqueue()).run;
  const observed = await readRun(initialRun.id);
  check(observed.id === initialRun.id && ['queued', 'running'].includes(observed.status), 'DUPLICATE_PROBE_NOT_ACTIVE');
  const duplicate = (await enqueue()).run;
  check(duplicate.id === initialRun.id, 'DUPLICATE_EXECUTION');
  return initialRun;
}

const scenarioNames = ['weather', 'via-yr', 'web+weather', 'negative', 'lillesand', 'lillesand-daily'];
export function selectedScenarios(value) {
  if (value === undefined || value === '') return { names: [...scenarioNames], completeMatrix: true };
  check(typeof value === 'string' && value.length <= 64, 'SCENARIOS_INVALID');
  const names = value.split(',');
  check(names.length > 0 && new Set(names).size === names.length && names.every((name) => scenarioNames.includes(name)), 'SCENARIOS_INVALID');
  return { names: scenarioNames.filter((name) => names.includes(name)), completeMatrix: names.length === scenarioNames.length };
}
export function successfulRunLabel(completeMatrix, sourceMode) {
  return completeMatrix === true && sourceMode === 'synthetic_weekly_plan'
    ? 'LIVE E2E PASS'
    : 'LIVE E2E DIAGNOSTIC COMPLETE (not full release evidence)';
}
export function sanitizedValidationDiagnostic(details) {
  const stages = ['provider_response', 'final_schema', 'locale', 'required_tools', 'evidence_anchor', 'composition'];
  const reasons = ['invalid_response', 'invalid_provider_response', 'invalid_json_body', 'missing_choices', 'missing_message', 'invalid_tool_calls', 'empty_content', 'invalid_turn_shape', 'response_too_large', 'upstream_http_4xx', 'upstream_http_5xx', 'upstream_http_other', 'upstream_invalid_json', 'upstream_response_too_large', 'upstream_context_limit', 'upstream_rate_limited', 'upstream_format_unsupported', 'upstream_tool_unsupported', 'network_error', 'invalid_json_or_schema', 'locale_mismatch', 'missing_required_tool', 'source', 'quote', 'claim', 'date', 'time', 'source_binding', 'incomplete_evidence'];
  return stages.includes(details?.validationStage) && reasons.includes(details?.validationReason)
    ? { validationStage: details.validationStage, validationReason: details.validationReason }
    : {};
}
