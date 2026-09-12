import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import { isWeatherSource, locationCandidates, placeLabel, taskErrorKey } from '../src/monitor-presentation.ts';
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
});
