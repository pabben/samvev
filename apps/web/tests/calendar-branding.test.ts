import assert from 'node:assert/strict';
import test from 'node:test';
import {googleBrandingUrls} from '../src/calendar-branding';

test('Google Branding URLs use the configured callback origin and known install domain',()=>{
  assert.deepEqual(googleBrandingUrls('https://samvev.pabben.org/api/v1/calendar/oauth/google/callback'),{
    publicOrigin:'https://samvev.pabben.org',homePage:'https://samvev.pabben.org/om',privacyPolicy:'https://samvev.pabben.org/personvern',termsOfService:'https://samvev.pabben.org/vilkar',authorizedDomain:'pabben.org',
  });
});

test('Google Branding never guesses a registrable domain for unknown deployments',()=>{
  const urls=googleBrandingUrls('https://calendar.example.co.uk/api/v1/calendar/oauth/google/callback');
  assert.equal(urls.publicOrigin,'https://calendar.example.co.uk');assert.equal(urls.homePage,'https://calendar.example.co.uk/om');assert.equal(urls.authorizedDomain,null);
});
