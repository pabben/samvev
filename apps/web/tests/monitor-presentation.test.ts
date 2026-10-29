import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import { isWeatherSource, locationCandidates, monitorPresentationUpdateBody, monitorResultNotice, monitorResultNoticeKey, monitorValidationIssues, placeLabel, shouldShowAnswerEvidence, taskErrorKey } from '../src/monitor-presentation.ts';
import { en } from '../src/locales/en.ts';
import { nb } from '../src/locales/nb.ts';

test('weather and location failures have dedicated NB/EN recovery copy', () => {
  const codes = ['MONITOR_LOCATION_REQUIRED','MONITOR_LOCATION_AMBIGUOUS','MONITOR_LOCATION_NOT_FOUND','MONITOR_WEATHER_UNAVAILABLE','MONITOR_WEATHER_RATE_LIMITED','MONITOR_WEATHER_INVALID'];
  for (const code of codes) {
    const key = taskErrorKey(new ApiError(code));
    assert.notEqual(key, 'monitorErrorGeneric');
    assert.equal(typeof en[key], 'string'); assert.equal(typeof nb[key], 'string');
    assert.notEqual(en[key], nb[key]);
  }
  assert.equal(taskErrorKey('MONITOR_SOURCE_TIMEOUT'), 'monitorErrorSourceTimeout');
  assert.equal(taskErrorKey(new ApiError('CALENDAR_SOURCE_USE_ICS',422)), 'calendarSourceUseIcs', 'the persisted calendar-specific code retains ICS guidance without unsafe URL details');
  assert.match(en.calendarSourceUseIcs,/Integrations.*ICS/);assert.match(nb.calendarSourceUseIcs,/Integrasjoner.*ICS/);
  assert.equal(taskErrorKey('REVISION_CONFLICT'), 'monitorErrorConflict');
});

test('ambiguity projects only bounded, human-readable place fields', () => {
  const candidate = { name: 'Testvik', municipality: 'Eksempelkommune', region: 'Eksempelfylke', latitude: 60.1234, longitude: 10.4321, internalId: 'hidden' };
  assert.deepEqual(locationCandidates(new ApiError('MONITOR_LOCATION_AMBIGUOUS', 422, { candidates: [candidate, candidate, null, {name: 123}, {name: 'x'.repeat(201)}] })), ['Testvik, Eksempelkommune, Eksempelfylke']);
  assert.deepEqual(locationCandidates(new ApiError('MONITOR_WEATHER_INVALID', 422, {candidates:[candidate]})), []);
  assert.equal(locationCandidates(new ApiError('MONITOR_LOCATION_AMBIGUOUS', 422, {candidates:Array.from({length:20}, (_,i)=>({name:`Teststed ${i}`}))})).length,5);
});

test('canonical place and weather source labels never need raw coordinates', () => {
  assert.equal(placeLabel({canonicalName:'Testvik',municipality:'Testvik',region:'Eksempelfylke',country:'Norge'}),'Testvik, Eksempelfylke, Norge');
  assert.equal(placeLabel(), '');
  assert.equal(isWeatherSource({sourceUrl:'https://example.com',fetchedAt:'2030-01-01T00:00:00Z',kind:'weather'}),true);
  assert.equal(isWeatherSource({sourceUrl:'https://example.com',fetchedAt:'2030-01-01T00:00:00Z',attribution:'MET Norway Locationforecast'}),true);
  assert.equal(isWeatherSource({sourceUrl:'https://example.com',fetchedAt:'2030-01-01T00:00:00Z'}),false);
  assert.equal(shouldShowAnswerEvidence([{sourceUrl:'https://example.com/weather',fetchedAt:'2030-01-01T00:00:00Z',kind:'weather'}]),false);
  assert.equal(shouldShowAnswerEvidence([{sourceUrl:'https://example.com/news',fetchedAt:'2030-01-01T00:00:00Z',kind:'web'}]),true);
  assert.equal(shouldShowAnswerEvidence([]),true);
});


test('transport errors remain distinct from bounded server timeout in both locales', () => {
  assert.equal(taskErrorKey(new ApiError('OFFLINE')), 'monitorConnectionLost');
  assert.equal(taskErrorKey('AI_TIMEOUT'), 'monitorErrorTimeout');
  assert.equal(taskErrorKey('AI_PLAN_USAGE_LIMITED'), 'aiPlanLimited');
  assert.equal(taskErrorKey('AI_PLAN_NOT_ELIGIBLE'), 'AI_PLAN_NOT_ELIGIBLE');
  assert.equal(taskErrorKey('AI_PLAN_PERMISSION_REQUIRED'), 'aiPlanReauth');
  assert.equal(taskErrorKey('AI_REAUTHORIZATION_REQUIRED'), 'aiPlanReauth');
  assert.equal(taskErrorKey('MONITOR_WORKER_INTERRUPTED'), 'monitorErrorInterrupted');
  for (const messages of [nb,en]) {
    assert.notEqual(messages.monitorConnectionLost,messages.monitorErrorTimeout);
    assert.ok(messages.monitorLeavePage);
    assert.ok(messages.monitorStillWorking);
  }
});

test('sanitized AI diagnostics distinguish response formatting from source evidence', () => {
  for (const reason of ['invalid_json', 'schema_mismatch', 'response_too_large', 'invalid_json_or_schema']) {
    const key = taskErrorKey(new ApiError('AI_RESPONSE_INVALID', 502, { validationStage: 'final_schema', validationReason: reason, raw: 'private' }));
    assert.equal(key, 'monitorErrorResponseFormat');
    assert.ok(en[key]); assert.ok(nb[key]);
  }
  assert.equal(taskErrorKey(new ApiError('MONITOR_INTERPRETATION_SCHEMA_INVALID', 502, { validationStage: 'final_schema', validationReason: 'invalid_json_or_schema' })), 'monitorErrorResponseFormat');
  assert.equal(taskErrorKey(new ApiError('AI_RESPONSE_INVALID', 502, { validationStage: 'evidence_anchor', validationReason: 'claim' })), 'monitorErrorVerification');
  assert.equal(taskErrorKey(new ApiError('AI_UPSTREAM_ERROR', 502, { validationStage: 'provider_response' })), 'monitorErrorProviderResponse');
  assert.equal(taskErrorKey(new ApiError('MONITOR_EXECUTION_FAILED')), 'monitorErrorGeneric');
  assert.match(en.monitorErrorResponseFormat, /required format/i);
  assert.match(nb.monitorErrorResponseFormat, /forventet format/i);
});

test('provider connection failures and safe schema issue summaries are distinct and private', () => {
  assert.equal(taskErrorKey(new ApiError('AI_UPSTREAM_ERROR', 502, { validationStage: 'provider_response', validationReason: 'network_error', message: 'private endpoint' })), 'monitorErrorProviderNetwork');
  assert.equal(taskErrorKey(new ApiError('AI_UPSTREAM_ERROR', 502, { validationStage: 'provider_response', validationReason: 'upstream_http_5xx' })), 'monitorErrorProviderResponse');
  assert.equal(taskErrorKey(new ApiError('AI_UPSTREAM_ERROR', 502, { message: 'private endpoint' })), 'monitorErrorGeneric', 'unknown failures stay generic');
  const details = { validationIssues: [
    { path: 'events[].date', code: 'invalid_type', value: 'private model text' },
    { path: 'events[].evidence.quote', code: 'too_small', value: 'private quote' },
    { path: 'private.child.name', code: 'invalid_type' },
    { path: 'events[].date', code: 'invalid_type' },
    { path: 'summary', code: 'private_code' },
  ], rawOutput: 'do not show this' };
  const issues = monitorValidationIssues(details);
  assert.deepEqual(issues, [
    { field: 'monitorIssueFieldDate', issue: 'monitorIssueCodeType' },
    { field: 'monitorIssueFieldQuote', issue: 'monitorIssueCodeRequired' },
  ]);
  for (const messages of [en, nb]) {
    assert.ok(messages.monitorErrorProviderNetwork);
    assert.ok(messages.monitorErrorProviderResponse);
    assert.ok(messages.monitorValidationIssue);
    assert.ok(messages.monitorIssueFieldDate);
    assert.ok(messages.monitorIssueCodeType);
  }
  assert.doesNotMatch(JSON.stringify(issues), /private/);
  const additionalSchemaPaths = monitorValidationIssues({ validationIssues: [
    { path: 'version', code: 'invalid_value' },
    { path: 'resultKind', code: 'invalid_value' },
    { path: 'events[].who', code: 'invalid_type' },
    { path: 'events[].actions', code: 'invalid_type' },
    { path: 'events[].privateKey', code: 'invalid_type' },
    { path: 'unknown.events[].who', code: 'invalid_type' },
  ] });
  assert.deepEqual(additionalSchemaPaths, [
    { field: 'monitorIssueFieldVersion', issue: 'monitorIssueCodeValue' },
    { field: 'monitorIssueFieldResultType', issue: 'monitorIssueCodeValue' },
    { field: 'monitorIssueFieldPeople', issue: 'monitorIssueCodeType' },
    { field: 'monitorIssueFieldActions', issue: 'monitorIssueCodeType' },
  ], 'recognized schema fields get localized labels; arbitrary paths are discarded');
  for (const messages of [en, nb]) {
    assert.ok(messages.monitorIssueFieldVersion);
    assert.ok(messages.monitorIssueFieldResultType);
    assert.ok(messages.monitorIssueFieldPeople);
    assert.ok(messages.monitorIssueFieldActions);
    assert.ok(messages.monitorIssueFieldOther);
  }
});

test('monitor result notices distinguish an empty successful check from a stale result', () => {
  assert.equal(monitorResultNotice({ status: 'succeeded', resultSummary: { outcome: 'changed', resultKind: 'events', result: { events: [] } } }, false), 'success_no_findings');
  assert.equal(monitorResultNotice({ status: 'succeeded', resultSummary: { outcome: 'changed', resultKind: 'events', result: { events: [{ date: '2030-01-01' }] } } }, false), null);
  assert.equal(monitorResultNotice({ status: 'failed', resultSummary: null }, true), 'stale_previous_success');
  assert.equal(monitorResultNotice({ status: 'failed', resultSummary: null }, false), null);
  assert.equal(monitorResultNoticeKey('success_no_findings'), 'monitorNoFindingsSuccess');
  assert.equal(monitorResultNoticeKey('stale_previous_success'), 'monitorPreviousResultStale');
  assert.equal(monitorResultNoticeKey(null), null);
  assert.match(en.monitorNoFindingsSuccess, /completed successfully/i);
  assert.match(nb.monitorNoFindingsSuccess, /fullført/);
  assert.match(en.monitorPreviousResultStale, /earlier successful check/);
  assert.match(nb.monitorPreviousResultStale, /tidligere vellykket kontroll/);
});


test('sanitized weather stage distinguishes place lookup from forecast failures in NB/EN', () => {
  for (const [code, locationKey, forecastKey] of [
    ['MONITOR_WEATHER_UNAVAILABLE', 'monitorErrorLocationUnavailable', 'monitorErrorWeatherUnavailable'],
    ['MONITOR_WEATHER_RATE_LIMITED', 'monitorErrorLocationRateLimited', 'monitorErrorWeatherRateLimited'],
    ['MONITOR_WEATHER_INVALID', 'monitorErrorLocationInvalid', 'monitorErrorWeatherInvalid'],
    ['MONITOR_SOURCE_TIMEOUT', 'monitorErrorLocationTimeout', 'monitorErrorWeatherTimeout'],
    ['MONITOR_SOURCE_UNSUPPORTED', 'monitorErrorLocationInvalid', 'monitorErrorWeatherInvalid'],
    ['MONITOR_SOURCE_TOO_LARGE', 'monitorErrorLocationInvalid', 'monitorErrorWeatherInvalid'],
  ] as const) {
    assert.equal(taskErrorKey(new ApiError(code, 502, { weatherStage: 'location' })), locationKey);
    assert.equal(taskErrorKey(new ApiError(code, 502, { weatherStage: 'forecast' })), forecastKey);
    for (const messages of [nb, en]) {
      assert.notEqual(messages[locationKey], messages[forecastKey]);
      assert.doesNotMatch(messages[locationKey], /prøver igjen|retrying/i, 'there is no automatic retry');
    }
  }
  assert.equal(taskErrorKey(new ApiError('MONITOR_WEATHER_UNAVAILABLE', 502, {weatherStage: 'untrusted detail'})), 'monitorErrorWeatherUnavailable');
  assert.equal(taskErrorKey(new ApiError('MONITOR_INTERPRETATION_SCHEMA_INVALID', 422, {weatherStage:'location'})), 'monitorErrorInterpretation');
});

test('daily conditional preview describes strict forecast mean wind and the no-alert case', () => {
  assert.match(nb.monitorDailyScheduleValue, /Hver dag/);
  assert.match(en.monitorDailyScheduleValue, /Every day/);
  assert.match(nb.monitorWeatherWindCondition, /over \{threshold\}/);
  assert.match(en.monitorWeatherWindCondition, /over \{threshold\}/);
  assert.match(nb.monitorWeatherWindHint, /Nøyaktig \{threshold\} m\/s utløser ikke/);
  assert.match(en.monitorWeatherWindHint, /Exactly \{threshold\} m\/s does not trigger/);
  assert.equal(nb.monitorConditionOr,'ELLER'); assert.equal(en.monitorConditionOr,'OR');
  assert.match(nb.monitorWeatherNoAlert,/Ingen beskjed/);
  assert.match(en.monitorWeatherNoAlert,/No notification/);
});

test('school presentation editor sends only metadata with revision and strict local time', () => {
  assert.deepEqual(monitorPresentationUpdateBody('school', '13:45', 4), {
    expectedPresentationRevision: 4, presentationKind: 'school', schoolEndLocalTime: '13:45',
  });
  assert.deepEqual(monitorPresentationUpdateBody(null, 'not used', 2), {
    expectedPresentationRevision: 2, presentationKind: null, schoolEndLocalTime: null,
  });
  for (const time of ['24:00', '13:60', '9:30', 'noon']) assert.throws(() => monitorPresentationUpdateBody('school', time, 1));
  assert.throws(() => monitorPresentationUpdateBody('school', '13:00', 0));
  for (const messages of [en, nb]) {
    assert.match(messages.monitorPresentationHint, /instructions|instruksjoner/i);
    assert.match(messages.monitorPresentationExpiryHint, /expiry|utløpstidene/i);
    assert.ok(messages.monitorPresentationConflict && messages.monitorPresentationReload);
    assert.ok(messages.monitorPresentationSession && messages.monitorPresentationSaved);
  }
});
