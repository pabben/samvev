// Opt-in, normal-auth tests. Never trace, save browser storage, or print API payloads.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createSetupThroughUi, testThroughUi, assertPopulatedUi, deleteThroughUi, navigateTasks } from './live-runtime-browser.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check, safeCode, shortId, confirmedOrigin, readSecret, validateCredentials, validateBinding, validateEvidence, sanitizedTiming, cleanupTasks, startObservedExecution, approvedPublicSource, selectedScenarios, successfulRunLabel, sanitizedValidationDiagnostic } from './live-runtime-support.mjs';

async function main() {
  check(!process.env.DEBUG && !process.env.PWDEBUG, 'DEBUG_LOGGING_FORBIDDEN');
  const origin = confirmedOrigin(process.env.SAMVEV_E2E_ORIGIN, process.env.SAMVEV_E2E_CONFIRM_ORIGIN);
  const selection = selectedScenarios(process.env.SAMVEV_E2E_SCENARIOS);
  const source = approvedPublicSource(origin, process.env.SAMVEV_E2E_PUBLIC_SOURCE_URL);
  const credentials = await readSecret(process.env.SAMVEV_E2E_CREDENTIALS_FILE);
  validateCredentials(credentials);
  const settings = await readSecret(process.env.SAMVEV_E2E_AI_FILE);
  check(settings.provider === 'openai_compatible' && settings.enabled === true && typeof settings.baseUrl === 'string' && typeof settings.defaultModel === 'string', 'LOCAL_AI_SETTINGS_REQUIRED');
  const allowed = ['enabled', 'provider', 'baseUrl', 'defaultModel', 'strongModel', 'defaultReasoningEffort', 'strongReasoningEffort', 'apiKey'];
  check(Object.keys(settings).every((key) => allowed.includes(key)), 'AI_SETTINGS_FIELDS');
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const invocation = randomUUID(), directory = resolve('.local/live-e2e', invocation);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  console.log(`LIVE E2E invocation=${invocation} sourceMode=${source.mode} completeMatrix=${selection.completeMatrix} scenarios=${selection.names.join(',')}`);
  const report = { invocation, sourceMode: source.mode, completeMatrix: selection.completeMatrix, scenarios: selection.names, checks: [], residue: [] }, ids = new Set();
  const record = async (name, status, metadata = {}) => {
    report.checks.push({ name, status, ...metadata });
    await writeFile(`${directory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`${name} ${status}${metadata.execution ? ` execution=${metadata.execution}` : ''}${metadata.code ? ` ${metadata.code}` : ''}${metadata.validationStage ? ` validationStage=${metadata.validationStage} validationReason=${metadata.validationReason}` : ''}${metadata.timing ? ` ${JSON.stringify(metadata.timing)}` : ''}`);
  };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: 'nb-NO', reducedMotion: 'reduce' });
  let csrf, authenticated = false, attested = false, page, fatal;
  const headers = () => ({ Origin: origin, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) });
  async function request(path, method = 'GET', data, expected = 200) {
    let response;
    try { response = await context.request.fetch(`/api/v1${path}`, { method, data, headers: headers(), timeout: 30000, maxRedirects: 0 }); }
    catch { throw new Error('TRANSPORT_FAILURE'); }
    if (response.status() !== expected) {
      let code; try { code = (await response.json()).error?.code; } catch { /* no raw body */ }
      throw new Error(typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : `HTTP_${response.status()}`);
    }
    return expected === 204 ? null : response.json();
  }
  async function attest() {
    const me = await request('/me'), { attestation } = await request('/e2e/attestation');
    validateBinding(credentials, me, attestation); return me;
  }
  const base = `/households/${credentials.householdId}/monitors`;
  async function taskById(id) { return (await request(base)).tasks.find((task) => task.id === id); }
  async function poll(id, run) {
    const deadline = Date.now() + 750000; // Observer only; never changes/cancels the server deadline.
    while (['queued', 'running'].includes(run.status)) {
      check(Date.now() < deadline, 'OBSERVER_LIMIT_SERVER_UNCHANGED');
      await new Promise((done) => setTimeout(done, 2000));
      ({ run } = await request(`${base}/${id}/runs/${run.id}`));
    }
    return run;
  }
  const navigate = (locale, reload = false) => navigateTasks(page, locale, reload);
  async function execute(task, action, label, required, prior, mode, initialRun = null) {
    check(!stopping, 'OPERATOR_INTERRUPTED');
    await attest();
    const start = Date.now(), body = { expectedRevision: task.revision };
    const run = await startObservedExecution(
      () => request(`${base}/${task.id}/${action}`, 'POST', body, 202),
      async (id) => (await request(`${base}/${task.id}/runs/${id}`)).run,
      initialRun,
    );
    check(!prior.has(run.id), 'SEQUENTIAL_EXECUTION_REUSED'); prior.add(run.id);
    const acceptedMs = Date.now() - start;
    if (initialRun) {
      await assertPopulatedUi(page, task.id, 'nb', 'light', 'running');
      await page.setViewportSize({ width: 390, height: 900 });
    }
    let reloadMutations = 0;
    const observeReload = (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith(`/api/v1${base}/`)) reloadMutations++; };
    page.on('request', observeReload);
    await navigate('nb', true);
    if (initialRun) await assertPopulatedUi(page, task.id, 'nb', 'light', 'running');
    page.off('request', observeReload); check(reloadMutations === 0, 'UI_RELOAD_ENQUEUED');
    const fresh = await taskById(task.id);
    check((fresh.activeExecution ?? fresh.latestExecution)?.id === run.id, 'RECONNECT_EXECUTION_CHANGED');
    const terminal = await poll(task.id, run);
    let terminalFailure;
    if (terminal.status !== 'succeeded') {
      terminalFailure = new Error(/^[A-Z][A-Z0-9_]{1,63}$/.test(terminal.errorCode ?? '') ? terminal.errorCode : 'RUN_FAILED');
      terminalFailure.execution = shortId(run.id);
      terminalFailure.timing = sanitizedTiming(terminal.timing);
      terminalFailure.diagnostic = sanitizedValidationDiagnostic(terminal.errorDetails);
    }
    let evidence;
    try { ({ evidence } = await request(`/e2e/households/${credentials.householdId}/monitors/${task.id}/executions/${run.id}/evidence`)); }
    catch (error) { throw terminalFailure ?? error; }
    if (terminalFailure) { terminalFailure.timing = sanitizedTiming(evidence.execution?.timing ?? terminal.timing); throw terminalFailure; }
    const updated = await taskById(task.id);
    const timing = validateEvidence(evidence, credentials, updated, terminal, required);
    if (action === 'test') {
      check(terminal.resultSummary?.result, 'RESULT_MISSING');
      if (mode === 'negative') check(terminal.resultSummary.result.events?.length === 0, 'NEGATIVE_RESULT_FAILED');
      if (mode === 'positive') check(terminal.resultSummary.result.events?.length > 0, 'POSITIVE_RESULT_FAILED');
    }
    if (initialRun) {
      await assertPopulatedUi(page, task.id, 'nb', 'light', action === 'test' ? 'result' : 'ready');
      await request('/me/preferences', 'PATCH', { locale: 'en', theme: 'dark' });
      await navigate('en', true);
      await assertPopulatedUi(page, task.id, 'en', 'dark', action === 'test' ? 'result' : 'ready');
      await request('/me/preferences', 'PATCH', { locale: 'nb', theme: 'light' });
      await page.setViewportSize({ width: 1440, height: 1000 }); await navigate('nb', true);
      await assertPopulatedUi(page, task.id, 'nb', 'light', action === 'test' ? 'result' : 'ready');
    }
    await record(label, 'PASS', { execution: shortId(run.id), acceptedMs, timing });
    return updated;
  }
  try {
    const login = await request('/auth/login', 'POST', { email: credentials.email, password: credentials.password });
    authenticated = true; csrf = login.csrfToken;
    await attest(); attested = true; await record('login + attestation', 'PASS');
    const aiPath = `/households/${credentials.householdId}/ai/settings`;
    const currentSettings = await request(aiPath);
    await request(aiPath, 'PATCH', { ...settings, expectedRevision: currentSettings.revision });
    await context.route('**/api/v1/households/**', async (route) => {
      const household = new URL(route.request().url()).pathname.split('/')[4];
      if (household !== credentials.householdId) return route.abort('blockedbyclient');
      return route.continue();
    });
    page = await context.newPage();
    let pageErrors = 0; page.on('pageerror', () => { pageErrors++; });
    await navigate('nb');
    for (const [locale, width, theme] of [['nb', 1440, 'light'], ['en', 390, 'dark']]) {
      await request('/me/preferences', 'PATCH', { locale, theme });
      await page.setViewportSize({ width, height: 900 }); await navigate(locale);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      check(axe.violations.length === 0, 'AXE_FAILED');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'HORIZONTAL_OVERFLOW');
    }
    await request('/me/preferences', 'PATCH', { locale: 'nb', theme: 'light' }); await page.setViewportSize({ width: 1440, height: 1000 }); await navigate('nb');
    await record('browser nb/en desktop/mobile Axe focus reload', 'PASS');
    const fixture = source.url;
    const combined = source.mode === 'synthetic_weekly_plan'
      ? `Sjekk den syntetiske ukeplanen på ${fixture} og været i Birkeland, Birkenes i morgen. `
      : `Les den offentlige referansekilden på ${fixture} og sjekk været i Birkeland, Birkenes i morgen. Bruk referansekilden som kildekontekst, men ikke finn på aktiviteter som ikke står der. `;
    const cases = [
      { name: 'weather', count: 3, tools: ['weather.forecast'], prompt: 'Sjekk været på Birkeland, Birkenes i morgen.' },
      { name: 'via-yr', count: 3, tools: ['weather.forecast'], prompt: 'Sjekk været på Birkeland, Birkenes i morgen via yr.' },
      { name: 'web+weather', count: 3, tools: ['web.open', 'weather.forecast'], mode: 'positive', prompt: `${combined}Gi en beskjed om passende klær hvis temperaturen er under 100 grader Celsius. Dette er en eksplisitt syntetisk testterskel.` },
      { name: 'negative', count: 2, tools: ['web.open', 'weather.forecast'], mode: 'negative', prompt: `${combined}Gi bare beskjed hvis temperaturen er over 100 grader Celsius. Ellers skal resultatet være ingen relevant beskjed og ingen hendelser. Dette er en eksplisitt syntetisk testterskel.` },
      { name: 'lillesand', count: 3, tools: ['weather.forecast'], prompt: 'Sjekk været i Lillesand i morgen.' },
      { name: 'lillesand-daily', count: 3, tools: ['weather.forecast'], prompt: 'Sjekk været i Lillesand og gi beskjed hver dag 08:00 dersom det er meldt regn eller vind over 10m/s i løpet av dagen.', expectedDailyRule: true },
    ];
    for (const scenario of cases.filter((scenario) => selection.names.includes(scenario.name))) {
      let task;
      try {
        check(!stopping, 'OPERATOR_INTERRUPTED');
        await attest();
        const remember = async (created) => { ids.add(created.id); report.residue = [...ids]; await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); };
        let uiSetup;
        if (scenario.name === 'weather') {
          const created = await createSetupThroughUi(page, base, `Synthetic E2E ${invocation} ${scenario.name}`, scenario.prompt, remember);
          task = created.task; uiSetup = created.run;
        } else {
          task = await request(base, 'POST', { name: `Synthetic E2E ${invocation} ${scenario.name}`, instruction: scenario.prompt, checkIntervalMinutes: 1440, noticeDaysBefore: 1, noticeLocalTime: '18:00', targets: { personIds: [credentials.personId], displayIds: [] } }, 201);
          await remember(task);
        }
        const prior = new Set();
        task = await execute(task, 'interpret', `${scenario.name} setup`, scenario.tools, prior, undefined, uiSetup);
        if (scenario.expectedDailyRule) {
          const rule = task.interpretedRule;
          check(rule?.schedule?.kind === 'daily' && rule.schedule.localTime === '08:00' && rule.schedule.timezone === 'Europe/Oslo', 'DAILY_SCHEDULE_MISSING');
          check(task.checkIntervalMinutes === 1440 && task.noticeLocalTime === '08:00' && task.noticeDaysBefore === 0, 'DAILY_SCHEDULE_NOT_ANCHORED');
          check(rule?.forecastPeriod?.period === 'today' && rule.forecastPeriod.timeWindow === 'all', 'WHOLE_DAY_SCOPE_MISSING');
          check(rule?.weatherCondition?.operator === 'or' && rule.weatherCondition.conditions?.some((item) => item.kind === 'rain') && rule.weatherCondition.conditions?.some((item) => item.kind === 'max_wind_speed' && item.comparison === 'gt' && item.thresholdMps === 10), 'WEATHER_OR_RULE_MISSING');
          check(rule?.location?.canonicalName === 'Lillesand' && rule.location?.municipality === 'Lillesand', 'LILLESAND_RESOLUTION_MISMATCH');
        }
        for (let index = 1; index <= scenario.count; index++) {
          try {
            const uiRun = scenario.name === 'weather' && index === 1 ? await testThroughUi(page, base, await taskById(task.id)) : null;
            task = await execute(await taskById(task.id), 'test', `${scenario.name} ${index}/${scenario.count}`, scenario.tools, prior, scenario.mode, uiRun);
          }
          catch (error) { await record(`${scenario.name} ${index}/${scenario.count}`, 'FAIL', { code: safeCode(error), ...sanitizedValidationDiagnostic(error.diagnostic), ...(error.execution ? { execution: error.execution, timing: error.timing } : {}) }); }
        }
        if (scenario.name === 'weather') {
          await attest(); await navigate('nb', true);
          await deleteThroughUi(page, base, await taskById(task.id), () => navigate('nb', true));
          check(!await taskById(task.id), 'UI_DELETE_NOT_PERSISTED');
          ids.delete(task.id); await record('browser create/setup/test/reconnect/result/delete', 'PASS');
        }
      } catch (error) { await record(`${scenario.name} setup`, 'FAIL', { code: safeCode(error), ...sanitizedValidationDiagnostic(error.diagnostic), ...(error.execution ? { execution: error.execution, timing: error.timing } : {}) }); }
    }
    check(pageErrors === 0, 'BROWSER_RUNTIME_ERROR');
  } catch (error) { fatal = error; await record('harness', 'FAIL', { code: safeCode(error), ...sanitizedValidationDiagnostic(error.diagnostic), ...(error.execution ? { execution: error.execution, timing: error.timing } : {}) }); }
  finally {
    if (attested) {
      // Reconcile an accepted create whose HTTP response was lost. Never collect another invocation.
      try { await attest(); for (const task of (await request(base)).tasks) if (task.name.startsWith(`Synthetic E2E ${invocation} `)) ids.add(task.id); }
      catch { await record('cleanup discovery', 'FAIL'); }
      report.residue = await cleanupTasks(ids, async (id) => {
        await attest(); const task = await taskById(id); if (!task) return;
        if (task.activeExecution) await poll(id, task.activeExecution);
        const fresh = await taskById(id);
        await request(`${base}/${id}`, 'DELETE', { expectedRevision: fresh.revision }, 204);
        check(!await taskById(id), 'DELETE_NOT_PERSISTED');
      });
      await record('delete + cleanup', report.residue.length ? 'FAIL' : 'PASS');
      try { await request('/me/preferences', 'PATCH', { locale: 'nb', theme: 'light' }); } catch { /* isolated test account only */ }
    }
    if (authenticated) { try { await request('/auth/logout', 'POST', {}, 204); await record('logout', 'PASS'); } catch { await record('logout', 'FAIL'); } }
    await context.close(); await browser.close();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  check(!fatal && report.checks.every((item) => item.status === 'PASS') && report.residue.length === 0, 'LIVE_E2E_FAILED');
  console.log(successfulRunLabel(report.completeMatrix, report.sourceMode));
}
main().catch((error) => { console.error(`LIVE E2E FAIL ${safeCode(error)}`); process.exitCode = 1; });
