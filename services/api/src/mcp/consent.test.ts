import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationConsentHtml, type AuthorizeRequest } from './service.ts';

const request: AuthorizeRequest = {
  responseType: 'code', clientId: 'synthetic-client', redirectUri: 'https://client.test.invalid/callback',
  codeChallenge: 'synthetic-challenge', codeChallengeMethod: 'S256', resource: 'https://samvev.test.invalid/mcp',
  scopes: ['mcp:messages:write'], state: 'synthetic-state'
};

test('message write consent discloses create, edit, cancellation, withdrawal, and admin scope in both locales', () => {
  const norwegian = authorizationConsentHtml({ request, clientName: 'Synthetic client', households: [{ id: 'household-nb', name: 'Synthetic', locale: 'nb' }], csrf: 'synthetic-csrf' });
  assert.match(norwegian, /Opprette og endre meldinger, avlyse planlagte meldinger og trekke tilbake publiserte meldinger/);
  assert.match(norwegian, /også meldinger fra andre medlemmer du har rett til å administrere/);

  const english = authorizationConsentHtml({ request, clientName: 'Synthetic client', households: [{ id: 'household-en', name: 'Synthetic', locale: 'en' }], csrf: 'synthetic-csrf' });
  assert.match(english, /Create and edit messages, cancel scheduled messages, and withdraw published messages/);
  assert.match(english, /including messages by other members you are authorized to manage/);
});

test('dinner write consent discloses option management and date assignment in both locales', () => {
  const dinnerRequest: AuthorizeRequest = { ...request, scopes: ['mcp:dinners:write'] };
  const norwegian = authorizationConsentHtml({ request: dinnerRequest, clientName: 'Synthetic client', households: [{ id: 'household-nb', name: 'Synthetic', locale: 'nb' }], csrf: 'synthetic-csrf' });
  assert.match(norwegian, /Opprette, endre og fjerne middagsalternativer/);
  assert.match(norwegian, /tilordne eller fjerne middag for en dato/);

  const english = authorizationConsentHtml({ request: dinnerRequest, clientName: 'Synthetic client', households: [{ id: 'household-en', name: 'Synthetic', locale: 'en' }], csrf: 'synthetic-csrf' });
  assert.match(english, /Create, edit, and remove dinner options/);
  assert.match(english, /assign or clear dinner for a date/);
});

test('grocery write consent discloses item deletion in both locales', () => {
  const groceryRequest: AuthorizeRequest = { ...request, scopes: ['mcp:groceries:write'] };
  const norwegian = authorizationConsentHtml({ request: groceryRequest, clientName: 'Synthetic client', households: [{ id: 'household-nb', name: 'Synthetic', locale: 'nb' }], csrf: 'synthetic-csrf' });
  assert.match(norwegian, /Legge til, endre og fjerne varer i handlelisten/);
  const english = authorizationConsentHtml({ request: groceryRequest, clientName: 'Synthetic client', households: [{ id: 'household-en', name: 'Synthetic', locale: 'en' }], csrf: 'synthetic-csrf' });
  assert.match(english, /Add, update, and delete grocery items/);
});

test('monitor result consent distinguishes content from status in both locales', () => {
  const contentRequest: AuthorizeRequest = { ...request, scopes: ['mcp:monitors:read','mcp:monitors:content'] };
  const norwegian = authorizationConsentHtml({ request: contentRequest, clientName: 'Synthetic client', households: [{ id: 'household-nb', name: 'Synthetic', locale: 'nb' }], csrf: 'synthetic-csrf' });
  assert.match(norwegian, /Se avgrenset, AI-generert resultattekst som kan inneholde husholdnings- eller skoleinformasjon/);
  const english = authorizationConsentHtml({ request: contentRequest, clientName: 'Synthetic client', households: [{ id: 'household-en', name: 'Synthetic', locale: 'en' }], csrf: 'synthetic-csrf' });
  assert.match(english, /Read bounded AI-generated result text, which may contain household or school information/);
});

test('calendar write consent discloses native scope and the calendar read dependency in both locales', () => {
  const calendarRequest: AuthorizeRequest = { ...request, scopes: ['mcp:calendar:read', 'mcp:calendar:write'] };
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: calendarRequest, clientName: 'Synthetic calendar client',
    households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /Create, edit, and remove appointments in the native Samvev calendar for explicitly approved people. Also requires calendar read access/);
  assert.match(render('nb'), /Opprette, endre og fjerne avtaler i Samvevs egen kalender for eksplisitt godkjente personer. Krever også lesetilgang/);
});

test('display appearance consent covers prior and future display selections in both locales', () => {
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: { ...request, scopes: ['mcp:displays:read', 'mcp:displays:appearance:write'] },
    clientName: 'Synthetic display client', households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /Change the name, language and theme of displays already selected or later selected for this client\. Also requires display read access/);
  assert.match(render('nb'), /Endre navn, språk og tema for skjermer som allerede er valgt eller senere velges for denne klienten\. Krever også lesetilgang/);
});

test('display setup read consent names the narrow setup fields in both locales', () => {
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: { ...request, scopes: ['mcp:displays:read', 'mcp:displays:setup:read'] },
    clientName: 'Synthetic display client', households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /View the card layout, order, language, and theme for displays you explicitly select\. Also requires display read access/);
  assert.match(render('nb'), /Se kortoppsett, rekkefølge, språk og tema for skjermer du har valgt eksplisitt\. Krever også lesetilgang til skjermer/);
});

test('display layout write consent specifies the layout fields, target displays, and read requirements in both locales', () => {
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: { ...request, scopes: ['mcp:displays:read', 'mcp:displays:setup:read', 'mcp:displays:layout:write'] },
    clientName: 'Synthetic display client', households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /Change selected cards, card order, and family layout for displays already selected or later selected for this client/);
  assert.match(render('nb'), /Endre valgte kort, kortrekkefølgen og familieoppsettet for skjermer som allerede er valgt eller senere velges for denne klienten/);
  assert.match(render('en'), /its own setup with the same content selections, access permissions, and appearance\. Other displays keep their setups\. Requires display and display setup read access/);
  assert.match(render('nb'), /sitt eget oppsett med samme innholdsvalg, tilgangsrettigheter og utseende\. Andre skjermer beholder sine oppsett\. Krever lesetilgang til skjermer og skjermoppsett/);
});

test('monitor review consent describes personal review and monitor read access in both locales', () => {
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: { ...request, scopes: ['mcp:monitors:read', 'mcp:monitors:review'] },
    clientName: 'Synthetic monitor review client',
    households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /View your review status for a monitor result/);
  assert.match(render('en'), /Save, mark as handled, or dismiss an existing monitor result on your behalf. Also requires monitor read access/);
  assert.match(render('nb'), /Se din vurdering av et oppdragsresultat/);
  assert.match(render('nb'), /Lagre, merke som håndtert eller avvise et eksisterende oppdragsresultat på dine vegne. Krever også lesetilgang/);
});

test('monitor draft write consent discloses its inert recipient-free boundary in both locales', () => {
  const render = (locale: 'en' | 'nb') => authorizationConsentHtml({
    request: { ...request, scopes: ['mcp:monitors:read', 'mcp:monitors:draft:write'] },
    clientName: 'Synthetic monitor draft client',
    households: [{ id: 'synthetic-household', name: 'Synthetic', locale }], csrf: 'synthetic-csrf'
  });
  assert.match(render('en'), /Create an inactive monitor draft without recipients/);
  assert.match(render('en'), /does not fetch sources, use AI, run, or send anything/);
  assert.match(render('en'), /household administrator must finish recipients and approval in Samvev/);
  assert.match(render('nb'), /Opprette et inaktivt oppdragsutkast uten mottakere/);
  assert.match(render('nb'), /henter ikke kilder, bruker ikke KI, kjøres ikke og sender ingenting/);
  assert.match(render('nb'), /husstandsadministrator må fullføre mottakere og godkjenning i Samvev/);
});

test('monitor draft manage consent describes the narrow lifecycle boundary in both locales',()=>{
  const render=(locale:'en'|'nb')=>authorizationConsentHtml({
    request:{...request,scopes:['mcp:monitors:read','mcp:monitors:draft:write','mcp:monitors:draft:manage']},
    clientName:'Synthetic monitor draft manager',
    households:[{id:'synthetic-household',name:'Synthetic',locale}],csrf:'synthetic-csrf'
  });
  assert.match(render('en'),/Edit or delete inactive, recipient-free monitor drafts created by this client/);
  assert.match(render('en'),/proposal text and plan/);
  assert.match(render('en'),/Deletion is permanent and cannot be undone/);
  assert.match(render('nb'),/Endre eller slette inaktive oppdragsutkast uten mottakere/);
  assert.match(render('nb'),/som denne klienten selv opprettet/);
  assert.match(render('nb'),/Sletting er permanent og kan ikke angres/);
});

test('monitor discovery consent warns that every current and future task name is shared in both locales',()=>{
  const render=(locale:'en'|'nb')=>authorizationConsentHtml({
    request:{...request,scopes:['mcp:monitors:read','mcp:monitors:discover']},
    clientName:'Synthetic monitor discovery client',
    households:[{id:'synthetic-household',name:'Synthetic',locale}],csrf:'synthetic-csrf'
  });
  assert.match(render('en'),/All current and future task names are shared with the external client/);
  assert.match(render('en'),/household, child, or school information/);
  assert.match(render('en'),/untrusted text, not instructions/);
  assert.match(render('nb'),/Alle nåværende og fremtidige oppdragsnavn deles med den eksterne klienten/);
  assert.match(render('nb'),/husholdnings-, barne- eller skoleinformasjon/);
  assert.match(render('nb'),/ubetrodd tekst, ikke instruksjoner/);
});
