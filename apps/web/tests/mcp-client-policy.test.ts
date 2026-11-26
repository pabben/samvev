import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedMcpResourceCount, calendarResourcesForPolicy, calendarSourcePolicyLabel, calendarSourcesForPolicy, hasMcpDisplayPolicyScope, hasMcpMonitorContentScope, hasMcpPeoplePolicyScope, hasMcpSchoolScope, isValidMcpScopeNarrowing, mcpActivityTranslationKey, mcpScopeTranslationKey, saveMcpPolicy, schoolResourcesForPolicy, unlistedCalendarResources, unlistedSchoolResources, type McpAuthorization, type SchoolPlanSource } from '../src/mcp-client-policy';
import { en } from '../src/locales/en';
import { nb } from '../src/locales/nb';

const authorization: McpAuthorization = {
  id: 'synthetic-grant-id',
  client_name: 'Synthetic calendar assistant',
  scopes: ['mcp:context', 'mcp:monitors:read', 'mcp:school-plans:read', 'offline_access'],
  revision: 3,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-02T12:00:00Z',
  revoked_at: null,
  last_used_at: null,
  person_ids: [],
  display_ids: [],
  resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
};

test('authorization labels distinguish granted and previously granted access in both locales', () => {
  assert.equal(en.mcpGrantedAccess, 'Granted access');
  assert.equal(nb.mcpGrantedAccess, 'Innvilget tilgang');
  assert.equal(en.mcpPreviouslyGrantedAccess, 'Previously granted access');
  assert.equal(nb.mcpPreviouslyGrantedAccess, 'Tidligere innvilget tilgang');
});

test('backend MCP scope names are translated without exposing namespace prefixes', () => {
  assert.equal(mcpScopeTranslationKey('mcp:context'), 'mcpScopeContext');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:read'), 'mcpScopeMonitorsRead');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:content'), 'mcpScopeMonitorsContent');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:review'), 'mcpScopeMonitorsReview');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:draft:write'), 'mcpScopeMonitorsDraftWrite');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:draft:manage'), 'mcpScopeMonitorsDraftManage');
  assert.equal(mcpScopeTranslationKey('mcp:school-plans:read'), 'mcpScopeSchoolRead');
  assert.equal(mcpScopeTranslationKey('mcp:school-plans:write'), 'mcpScopeSchoolWrite');
  assert.equal(mcpScopeTranslationKey('offline_access'), 'mcpScopeOffline');
  assert.equal(mcpScopeTranslationKey('mcp:people:read'), 'mcpScopePeopleRead');
  assert.equal(mcpScopeTranslationKey('mcp:groceries:read'), 'mcpScopeGroceriesRead');
  assert.equal(mcpScopeTranslationKey('mcp:dinners:read'), 'mcpScopeDinnersRead');
  assert.equal(mcpScopeTranslationKey('mcp:calendar:read'), 'mcpScopeCalendarRead');
  assert.equal(mcpScopeTranslationKey('mcp:messages:write'), 'mcpScopeMessagesWrite');
  assert.equal(mcpScopeTranslationKey('mcp:people:write'), 'mcpScopePeopleWrite');
  assert.equal(mcpScopeTranslationKey('mcp:displays:read'), 'mcpScopeDisplaysRead');
  assert.equal(mcpScopeTranslationKey('mcp:displays:setup:read'), 'mcpScopeDisplaysSetupRead');
  assert.match(en.mcpScopeDisplaysSetupRead, /Also requires display read access\./);
  assert.match(nb.mcpScopeDisplaysSetupRead, /Krever også lesetilgang til skjermer\./);
  assert.equal(mcpScopeTranslationKey('mcp:displays:appearance:write'), 'mcpScopeDisplaysAppearanceWrite');
  assert.equal(mcpScopeTranslationKey('mcp:displays:layout:write'), 'mcpScopeDisplaysLayoutWrite');
  assert.match(en.mcpDisplayLayoutWriteDependency, /display and display setup read access/);
  assert.match(nb.mcpDisplayLayoutWriteDependency, /lesetilgang til skjermer og skjermoppsett/);
  assert.match(en.mcpDisplayLayoutWriteDependency, /its own setup for future edits, with the same content selections, access permissions, and appearance\. Other displays keep their setups\. Uncheck a display/);
  assert.match(nb.mcpDisplayLayoutWriteDependency, /sitt eget oppsett for videre redigering, med samme innholdsvalg, tilgangsrettigheter og utseende\. Andre skjermer beholder sine oppsett/);
  assert.equal(mcpScopeTranslationKey('mcp:future:scope'), undefined);
  assert.match(en.mcpScopeMonitorsDraftWrite, /without recipients/);
  assert.match(en.mcpScopeMonitorsDraftWrite, /do not fetch, use AI, run, schedule, or send anything/);
  assert.match(nb.mcpScopeMonitorsDraftWrite, /uten mottakere/);
  assert.match(nb.mcpScopeMonitorsDraftWrite, /henter ikke kilder, bruker ikke KI, kjøres ikke, planlegges ikke og sender ingenting/);
  assert.match(en.mcpScopeMonitorsDraftManage, /Edit or permanently delete inert recipient-free monitor drafts/);
  assert.match(en.mcpScopeMonitorsDraftManage, /deletion cannot be undone/i);
  assert.match(nb.mcpScopeMonitorsDraftManage, /Endre eller slette inaktive oppdragsutkast uten mottakere/);
  assert.match(nb.mcpScopeMonitorsDraftManage, /sletting er permanent og kan ikke angres/i);
  assert.equal(mcpActivityTranslationKey('mcp.school_plan_read'), 'mcpActivitySchoolPlanRead');
  assert.equal(mcpActivityTranslationKey('mcp.calendar_sources_listed'), 'mcpActivityCalendarSourcesListed');
  assert.equal(mcpActivityTranslationKey('mcp.displays_listed'), 'mcpActivityDisplaysListed');
  assert.equal(mcpActivityTranslationKey('mcp.display_appearance_updated'), 'mcpActivityDisplayAppearanceUpdated');
  assert.equal(mcpActivityTranslationKey('mcp.display_setup_read'), 'mcpActivityDisplaySetupRead');
  assert.equal(mcpActivityTranslationKey('mcp.display_layout_updated'), 'mcpActivityDisplayLayoutUpdated');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_result_read'), 'mcpActivityMonitorResultRead');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_result_reviewed'), 'mcpActivityMonitorResultReviewed');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_result_review_read'), 'mcpActivityMonitorResultReviewRead');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_draft_created'), 'mcpActivityMonitorDraftCreated');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_draft_updated'), 'mcpActivityMonitorDraftUpdated');
  assert.equal(mcpActivityTranslationKey('mcp.monitor_draft_deleted'), 'mcpActivityMonitorDraftDeleted');
  assert.equal(en.mcpActivityMonitorDraftCreated, 'Created an inactive monitor draft');
  assert.equal(nb.mcpActivityMonitorDraftCreated, 'Opprettet et inaktivt oppdragsutkast');
  assert.equal(mcpActivityTranslationKey('mcp.grocery_deleted'), 'mcpActivityGroceryDeleted');
  assert.equal(mcpActivityTranslationKey('mcp.future_action'), undefined);
});

test('message write policy copy discloses creating, editing, cancelling, and withdrawing for selected recipients', () => {
  const key = mcpScopeTranslationKey('mcp:messages:write');
  assert.ok(key);
  assert.match(en[key], /create, edit, cancel, or withdraw messages for selected recipients/i);
  assert.match(nb[key], /opprette, endre, avlyse eller trekke tilbake beskjeder for valgte mottakere/i);
});

test('message write activity uses readable action labels in both locales', () => {
  const expected = [
    ['mcp.message_created', 'Created a message', 'Opprettet en beskjed'],
    ['mcp.message_edited', 'Edited a message', 'Endret en beskjed'],
    ['message.edited_by_admin', 'Edited a message with administrator permissions', 'Endret en beskjed med administratortilgang'],
    ['mcp.message_withdrawn', 'Cancelled or withdrew a message', 'Avlyste eller trakk tilbake en beskjed'],
  ] as const;
  for (const [action, english, norwegian] of expected) {
    const key = mcpActivityTranslationKey(action);
    assert.ok(key, action);
    assert.equal(en[key], english);
    assert.equal(nb[key], norwegian);
  }
});

test('grocery write scope copy discloses deletion in consent and admin policy locales', () => {
  assert.match(en.mcpScopeGroceriesWrite, /delete/i);
  assert.match(nb.mcpScopeGroceriesWrite, /fjerne/i);
});

test('monitor result content is described precisely and its read-scope dependency is explicit in both locales', () => {
  assert.equal(en.mcpScopeMonitorsContent.includes('monitor result text'), true);
  assert.equal(en.mcpScopeMonitorsContent.includes('monitor text,'), false);
  assert.equal(nb.mcpScopeMonitorsContent.includes('resultattekst'), true);
  assert.equal(en.mcpMonitorContentDependency.includes('Read monitors'), true);
  assert.equal(en.mcpMonitorContentDependency.includes('will not enable it automatically'), true);
  assert.equal(nb.mcpMonitorContentDependency.includes('Lese oppdrag'), true);
  assert.equal(nb.mcpMonitorContentDependency.includes('slår ikke på tilgangen automatisk'), true);
  assert.equal(hasMcpMonitorContentScope(['mcp:monitors:content']), true);
  assert.equal(hasMcpMonitorContentScope(['mcp:monitors:read']), false);
});

test('school and display policy controls require a matching current consent scope', () => {
  assert.equal(hasMcpSchoolScope(['mcp:school-plans:read']), true);
  assert.equal(hasMcpSchoolScope(['mcp:school-plans:write']), true);
  assert.equal(hasMcpSchoolScope(['mcp:people:read']), false);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:monitors:read']), false);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:calendar:read']), false);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:messages:write']), true);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:displays:read']), true);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:groceries:read']), false);
  assert.equal(hasMcpPeoplePolicyScope(['mcp:people:write']), true);
  assert.equal(hasMcpPeoplePolicyScope(['mcp:monitors:read']), false);
});

test('scope policy permits only subsets and requires a non-offline permission', () => {
  const original = ['mcp:people:read', 'mcp:school-plans:read', 'offline_access'];
  assert.equal(isValidMcpScopeNarrowing(original, original), true);
  assert.equal(isValidMcpScopeNarrowing(original, ['mcp:people:read']), true);
  assert.equal(isValidMcpScopeNarrowing(original, ['offline_access']), false);
  assert.equal(isValidMcpScopeNarrowing(original, []), false);
  assert.equal(isValidMcpScopeNarrowing(original, ['mcp:people:read', 'mcp:people:write']), false);
});

test('explicit school-source selection adds approved resources and keeps existing resources untouched', () => {
  const existing = [{ kind: 'school_source' as const, id: 'synthetic-existing-source' }];
  const existingSource: SchoolPlanSource = { id: 'synthetic-existing-source', personId: 'synthetic-person-id', connectionId: 'synthetic-existing-connection-id', classKey: '1B', sourcePageUrl: 'https://school.test.invalid/existing', displayPdfLinksAllowed: true };
  const source: SchoolPlanSource = { id: 'synthetic-new-source', personId: 'synthetic-person-id', connectionId: 'synthetic-connection-id', classKey: '1A', sourcePageUrl: 'https://school.test.invalid/plan', displayPdfLinksAllowed: false };
  assert.deepEqual(schoolResourcesForPolicy(existing, ['synthetic-existing-source', 'synthetic-new-source'], [existingSource, source], ['synthetic-person-id']), [
    existing[0],
    { kind: 'school_source', id: 'synthetic-new-source' },
  ]);
});

test('unlisted existing source grants are surfaced and can be explicitly removed', () => {
  const legacyGrant = { kind: 'school_source' as const, id: 'synthetic-no-longer-listed-source', retained: 'backend-extension' };
  assert.deepEqual(unlistedSchoolResources([legacyGrant], []), [legacyGrant]);
  const result = schoolResourcesForPolicy([legacyGrant], [], [], ['synthetic-person-id']);
  assert.deepEqual(result, []);
});

test('school-source resource cannot be added unless its linked person is included in the authorization', () => {
  const source: SchoolPlanSource = { id: 'synthetic-source', personId: 'synthetic-person-id', connectionId: 'synthetic-connection-id', classKey: '1A', sourcePageUrl: 'https://school.test.invalid/plan', displayPdfLinksAllowed: false };
  assert.throws(()=>schoolResourcesForPolicy([], ['synthetic-source'], [source], []), /mcp_school_source_person_required/);
});

const calendarConnection = (overrides:Record<string,unknown>={})=>({
  id:'synthetic-calendar-connection',provider:'google',name:'Family calendar',accountLabel:'family@example.test',state:'connected',
  sources:[{id:'synthetic-calendar-source',purpose:'calendar',enabled:true,name:'Primary',displayName:'School dates'}],
  ...overrides,
} as any);

test('calendar policy catalog is connected, enabled, calendar-only, and distinguishes repeated source names without exposing URLs',()=>{
  const sources=calendarSourcesForPolicy([
    calendarConnection(),
    calendarConnection({id:'synthetic-second-connection',name:'Work calendar',accountLabel:'work@example.test',sources:[{id:'synthetic-second-source',purpose:'calendar',enabled:true,name:'Primary',displayName:'School dates'}]}),
    calendarConnection({id:'synthetic-disconnected',state:'disconnected',sources:[{id:'synthetic-disconnected-source',purpose:'calendar',enabled:true,name:'School dates'}]}),
    calendarConnection({id:'synthetic-disabled',sources:[{id:'synthetic-disabled-source',purpose:'calendar',enabled:false,name:'Disabled source',displayName:null}]}),
    calendarConnection({id:'synthetic-waste',sources:[{id:'synthetic-waste-source',purpose:'waste',enabled:true,name:'Waste calendar',displayName:null}]}),
  ]);
  assert.equal(sources.length,2);
  assert.deepEqual(sources.map(source=>source.id),['synthetic-calendar-source','synthetic-second-source']);
  assert.match(calendarSourcePolicyLabel(sources[0]!),/Family calendar.*family@example\.test.*School dates/);
  assert.match(calendarSourcePolicyLabel(sources[1]!),/Work calendar.*work@example\.test.*School dates/);
  assert.ok(sources.every(source=>!JSON.stringify(source).includes('https://')));
});

test('calendar resource selection preserves existing school grants byte-for-byte and surfaces stale calendar grants',()=>{
  const school={kind:'school_source' as const,id:'synthetic-school',extension:'keep-me'};
  const calendar={kind:'calendar_source' as const,id:'synthetic-old-calendar',extension:'also-keep-until-explicit-removal'};
  const next=calendarResourcesForPolicy([school,calendar],['synthetic-old-calendar','synthetic-calendar-source'],[{id:'synthetic-calendar-source',connectionId:'synthetic-connection',connectionName:'Family',accountLabel:'family@example.test',provider:'google',connectionState:'connected',enabled:true,purpose:'calendar',name:'Primary',displayName:'School dates'}],['synthetic-person']);
  assert.deepEqual(next,[school,calendar,{kind:'calendar_source',id:'synthetic-calendar-source'}]);
  assert.deepEqual(unlistedCalendarResources([school,calendar],[]),[calendar]);
  assert.deepEqual(calendarResourcesForPolicy([school,calendar],[],[],[]),[school]);
  assert.throws(()=>calendarResourcesForPolicy([],['synthetic-calendar-source'],[],[]),/mcp_calendar_source_requires_people/);
  assert.deepEqual(schoolResourcesForPolicy([school],['synthetic-school'],[],['synthetic-person-id']),[school]);
});

test('approval summary counts only persisted grants, not unsaved picker selections',()=>{
  const saved={...authorization,resources:[{kind:'school_source' as const,id:'saved-school'}]};
  const unsavedCalendarSelection=['pending-calendar'];
  assert.equal(approvedMcpResourceCount(saved,'school_source'),1);
  assert.equal(approvedMcpResourceCount(saved,'calendar_source'),0);
  assert.equal(unsavedCalendarSelection.length,1);
});

test('policy update uses backend snake_case authorization fields and preserves approved resources in the mocked API request', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, ['synthetic-person-id'], ['synthetic-display-id']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.url, '/api/v1/households/synthetic-household-id/mcp/authorizations/synthetic-grant-id/policy');
  assert.equal(request?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    expectedRevision: 3,
    personIds: ['synthetic-person-id'],
    displayIds: ['synthetic-display-id'],
    resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
  });
});

test('policy update keeps mixed school and calendar resource grants when another policy field changes',async()=>{
  const mixed={...authorization,resources:[{kind:'school_source' as const,id:'synthetic-approved-source-id'},{kind:'calendar_source' as const,id:'synthetic-calendar-source-id'}]};
  const originalFetch=globalThis.fetch;let request:RequestInit|undefined;
  globalThis.fetch=(async(_input:URL|RequestInfo,init?:RequestInit)=>{request=init;return new Response(null,{status:204})}) as typeof fetch;
  try{await saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations',mixed,['synthetic-person-id'],[])}finally{globalThis.fetch=originalFetch}
  assert.deepEqual(JSON.parse(String(request?.body)).resources,mixed.resources);
});

test('scope narrowing is sent as a subset to the CAS policy endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, ['synthetic-person-id'], [], authorization.resources, ['mcp:school-plans:read']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    expectedRevision: 3,
    personIds: ['synthetic-person-id'],
    displayIds: [],
    resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
    scopes: ['mcp:school-plans:read'],
  });
});

test('scope narrowing rejects empty, offline-only, or broadening updates before network request', async () => {
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, [], [], authorization.resources, ['offline_access']), /mcp_scope_selection_invalid/);
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, [], [], authorization.resources, ['mcp:people:write']), /mcp_scope_selection_invalid/);
});

test('policy cannot be edited before the source resource list is present in the authorization response', async () => {
  const { resources: _resources, ...incomplete } = authorization;
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', incomplete, [], []), /mcp_policy_unavailable/);
});

test('native calendar access and activity use localized keys', () => {
  assert.equal(mcpScopeTranslationKey('mcp:calendar:write'), 'mcpScopeCalendarWrite');
  assert.equal(mcpActivityTranslationKey('mcp.calendar_event_created'), 'mcpActivityCalendarEventCreated');
  assert.equal(mcpActivityTranslationKey('mcp.calendar_event_updated'), 'mcpActivityCalendarEventUpdated');
  assert.equal(mcpActivityTranslationKey('mcp.calendar_event_deleted'), 'mcpActivityCalendarEventDeleted');
});
