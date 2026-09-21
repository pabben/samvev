import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import { isWeatherSource, locationCandidates, placeLabel, shouldShowAnswerEvidence, taskErrorKey } from '../src/monitor-presentation.ts';
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
  assert.equal(taskErrorKey('MONITOR_WORKER_INTERRUPTED'), 'monitorErrorInterrupted');
  for (const messages of [nb,en]) {
    assert.notEqual(messages.monitorConnectionLost,messages.monitorErrorTimeout);
    assert.ok(messages.monitorLeavePage);
    assert.ok(messages.monitorStillWorking);
  }
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
