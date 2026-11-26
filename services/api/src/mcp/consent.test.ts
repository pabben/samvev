import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationConsentHtml, type AuthorizeRequest } from './service.ts';

const request: AuthorizeRequest = {
  responseType: 'code', clientId: 'synthetic-client', redirectUri: 'https://client.test.invalid/callback',
  codeChallenge: 'synthetic-challenge', codeChallengeMethod: 'S256', resource: 'https://samvev.test.invalid/mcp',
  scopes: ['mcp:messages:write'], state: 'synthetic-state'
};

test('message write consent discloses create, cancellation, withdrawal, and admin scope in both locales', () => {
  const norwegian = authorizationConsentHtml({ request, clientName: 'Synthetic client', households: [{ id: 'household-nb', name: 'Synthetic', locale: 'nb' }], csrf: 'synthetic-csrf' });
  assert.match(norwegian, /Opprette meldinger, avlyse planlagte meldinger og trekke tilbake publiserte meldinger/);
  assert.match(norwegian, /også meldinger fra andre medlemmer du har rett til å administrere/);

  const english = authorizationConsentHtml({ request, clientName: 'Synthetic client', households: [{ id: 'household-en', name: 'Synthetic', locale: 'en' }], csrf: 'synthetic-csrf' });
  assert.match(english, /Create messages, cancel scheduled messages, and withdraw published messages/);
  assert.match(english, /including messages by other members you are authorized to manage/);
});
