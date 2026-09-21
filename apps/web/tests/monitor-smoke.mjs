// All API traffic is synthetic and intercepted: no database, source or AI calls.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
const baseURL = process.env.BASE_URL ?? "http://samvev-m1-app-1:4173";
const householdId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const accountId = "40000000-0000-4000-8000-000000000001";
const capabilities = ["installation.manage", "household.view", "household.manage", "people.manage", "account.manage", "capability.manage", "message.create.household", "message.publish.display", "message.schedule", "message.manage.household", "display.manage"];
const me = {
  account: { id: accountId, email: "owner@task-test.invalid", locale: "nb", theme: "light" },
  csrfToken: "synthetic-browser-only",
  memberships: [{ id: membershipId, household_id: householdId, person_id: personId,
    role_preset: "installation_admin", capabilities, revision: 1, household_name: "Testhjem",
    timezone: "Europe/Oslo", household_locale: "nb", display_name: "Testeier", display_ids: [] }],
};
const householdBase = `/api/v1/households/${householdId}`;
const responses = {
  "/api/v1/setup/status": { claimed: true, demo: false, demoAvailable: false, locale: "nb" },
  "/api/v1/setup/progress": { setupStep: "complete" },
  "/api/v1/me": me,
  [`${householdBase}/people`]: { people: [
    { id: personId, display_name: "Testeier", age_group: "adult", birth_date: "1990-01-15", calculated_age: 36,
      person_revision: 1, membership_id: membershipId, role_preset: "installation_admin", capabilities,
      revision: 1, has_login: true, has_active_login: true, account_status: "active",
      email: "owner@task-test.invalid", account_id: accountId, account_revision: 1, display_ids: [] },
    { id: "20000000-0000-4000-8000-000000000002", display_name: "Testprofil", age_group: "unspecified",
      birth_date: null, person_revision: 1, membership_id: "30000000-0000-4000-8000-000000000002",
      role_preset: "limited", capabilities: ["household.view"], revision: 1, has_login: false,
      has_active_login: false, account_status: "profile", email: null, account_id: null, account_revision: null, display_ids: [] },
  ] },
  [`${householdBase}/displays`]: { displays: [{ id: "50000000-0000-4000-8000-000000000001", name: "Testskjerm", revision: 1 }] },
  [`${householdBase}/messages`]: { messages: [] },
  [`${householdBase}/dashboard`]: { upcomingBirthday: null },
  [`${householdBase}/settings`]: { show_upcoming_birthday: false, revision: 1 },
  [`${householdBase}/monitors`]: { tasks: [] },
  [`${householdBase}/ai/settings`]: {
    enabled: false, provider: "openai_compatible", hasApiKey: false, baseUrl: null,
    defaultModel: "", strongModel: "", revision: 1,
    availability: { status: "not_configured", available: false, errorCode: null, checkedAt: null },
    providers: [{ id: "openai_compatible", runtimeAvailable: true, reasonCode: null }, { id: "openai", runtimeAvailable: true, reasonCode: null }],
    chatGptSubscription: { feasibility: "partial", status: "unavailable", reasonCode: "AI_PROVIDER_UNAVAILABLE" },
  },
  [`${householdBase}/ai/usage`]: { summary: { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0 }, recent: [] },
};

const base = `${householdBase}/monitors`;
const sourceUrl = "https://example.com/news";
const evidenceUrl = "https://example.com/news/library-reading-garden";
const sources = [{ sourceUrl, fetchedAt: "2030-09-18T09:59:55.000Z" }, { sourceUrl: evidenceUrl, fetchedAt: "2030-09-18T09:59:58.000Z" }];
const scheduledAt = "2030-09-19T10:00:00.000Z";
const checkedAt = "2030-09-18T10:00:00.000Z";
const taskId = "60000000-0000-4000-8000-000000000001";
const answer = { version: 1, answer: "Biblioteket åpner en ny lesehage.", evidence: { quote: "Biblioteket åpner en ny lesehage.", sourceUrl: evidenceUrl }, confidence: 0.99, uncertainty: "Åpningsdatoen er ikke oppgitt." };
const rule = { resultKind: "answer", summary: "Finn den nyeste overskriften og vis svaret.", eventTypes: [], keywords: [], people: [], checkIntervalMinutes: 60, noticeDaysBefore: 1, noticeLocalTime: "18:00" };
let tasks = [];
let failNext;
let failDetails;
let weatherScenario = false;
let unchangedNext = false;
let gate;
let gateAction;
let saveGate;
let releaseSave;
let createdIdSequence = 10;
let afterFailure;
let release;
// Synthetic server lifecycle contract. The UI must not infer readiness from rule truthiness.
function presented(task) {
  const status = task.lifecycleStatus ?? (task.state === 'draft' ? task.interpretedRule ? 'ready_for_approval' : task.errorCode ? 'setup_failed' : 'incomplete' : task.state);
  const setupComplete = !['incomplete', 'setup_failed'].includes(status) && Boolean(task.interpretedRule);
  const allowed = status === 'running' ? ['refresh'] : ['edit', 'delete',
    ...(status === 'incomplete' || status === 'setup_failed' ? ['interpret'] : []),
    ...(status === 'ready_for_approval' ? ['test', 'approve', 'smarter', 'interpret'] : []),
    ...(status === 'active' ? ['run', 'pause', 'smarter', 'quality'] : []),
    ...(status === 'paused' ? ['test', 'resume', 'smarter', 'quality'] : []),
  ];
  const actions = Object.fromEntries(['interpret', 'test', 'approve', 'edit', 'delete', 'run', 'pause', 'resume', 'smarter', 'quality', 'refresh'].map((name) => [name, { enabled: allowed.includes(name), reason: allowed.includes(name) ? null : status === 'running' ? 'running' : 'setup_required' }]));
  if (task.approveDenied) actions.approve = { enabled: false, reason: 'permission_denied' };
  const { _usesSmarterAi, ...publicTask } = task;
  return { ...publicTask, usesSmarterAi: Boolean(_usesSmarterAi), lifecycle: { status, setupComplete, actions } };
}
const weatherUrl = "https://api.met.no/weatherapi/locationforecast/2.0/documentation";
const weatherRule = { ...rule, summary: "Sjekk temperaturen i Testvik i morgen tidlig.", location: { query: "Testvik, Eksempelkommune", canonicalName: "Testvik", municipality: "Eksempelkommune", region: "Eksempelfylke", country: "Norge" } };
const weatherAnswer = { version: 1, answer: "I Testvik er det meldt 6 °C i morgen tidlig.", evidence: { quote: "2030-09-19 07:00: 6 °C, 1 mm regn, 3 m/s vind.", sourceUrl: weatherUrl }, confidence: .98, uncertainty: "Et værvarsel kan endre seg." };
const weatherSources = [{ sourceUrl: weatherUrl, fetchedAt: checkedAt, kind: 'weather', attribution: 'MET Norway Locationforecast', canonicalLocation: 'Testvik, Eksempelkommune, Eksempelfylke', validFrom: '2030-09-19T05:00:00.000Z', validTo: '2030-09-19T10:00:00.000Z', forecastUpdatedAt: '2030-09-18T09:00:00.000Z' }];
const combinedEvent = { date: '2030-09-19', time: null, type: 'Utedag', description: 'Utedag med regn', actions: ['Ta med regntøy'], who: ['Testperson'], evidence: { quote: 'Utedag 19.09.2030', sourceUrl, claims: ['Utedag'], sources: [{ quote: '2030-09-19 07:00: 6 °C, 1 mm regn, 3 m/s vind.', sourceUrl: weatherUrl, claims: ['1 mm regn'] }] }, confidence: .96, uncertainty: null };
const calls = [];
const unexpected = [];
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  const original = AbortSignal.timeout;
  window.taskTimeouts = [];
  AbortSignal.timeout = function (ms) { window.taskTimeouts.push(ms); return original.call(this, ms); };
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
async function mock(currentPage, restricted = false) {
  await currentPage.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === base) return route.fulfill({ json: { tasks: tasks.map(presented) } });
    if (path.startsWith(base) && request.method() !== "GET") {
      const body = request.postDataJSON();
      calls.push({ path, method: request.method(), body });
      if (gate && (!gateAction || path.endsWith(`/${gateAction}`))) await gate;
      if (saveGate && (request.method() === 'PATCH' || (request.method() === 'POST' && path === base))) await saveGate;
      if (failNext) { const code = failNext; failNext = undefined; afterFailure?.(); afterFailure = undefined; return route.fulfill({ status: 422, json: { error: { code, details: failDetails } } }); }
      if (path === base && request.method() === "POST") {
        const task = { id: tasks.some((entry) => entry.id === taskId) ? `60000000-0000-4000-8000-${String(++createdIdSequence).padStart(12, '0')}` : taskId, name: body.name ?? (weatherScenario ? "Vær i Testvik" : "Nyheter fra biblioteket"), instruction: body.instruction, sourceUrl: weatherScenario ? null : body.sourceUrl ?? sourceUrl, sourceKinds: weatherScenario ? ['weather'] : ['web'], state: "draft", checkIntervalMinutes: 1440, noticeDaysBefore: 1, noticeLocalTime: "18:00", targets: body.targets, interpretedRule: null, events: [], revision: 1, approvedRevision: null, lastCheckedAt: null, nextCheckAt: null, lastResult: null, lastChangedAt: null, errorCode: null, stats: { checks: 0, aiCalls: 0, unchanged: 0 } };
        tasks = [task, ...tasks]; return route.fulfill({ json: presented(task) });
      }
      let task = tasks.find((entry) => path.includes(entry.id));
      expect(body.expectedRevision).toBe(task.revision);
      if (request.method() === "DELETE") { tasks = tasks.filter((entry) => entry.id !== task.id); return route.fulfill({ status: 204 }); }
      if (request.method() === "PATCH") {
        task = { ...task, ...body, ...(weatherScenario && body.sourceUrl === "" ? { sourceUrl: null } : {}), revision: task.revision + 1, state: "draft", interpretedRule: null, nextCheckAt: null, latestResult: null, events: [], lastResult: null };
      } else {
        const action = path.split("/").at(-1);
        if (["test", "run", "smarter"].includes(action)) {
          if (action === "run" && unchangedNext) {
            unchangedNext = false; task.lastCheckedAt = "2030-09-18T11:00:00.000Z"; task.lastResult = "unchanged";
            return route.fulfill({ json: { outcome: "unchanged", resultKind: null, result: null, sourceUrl, checkedAt: task.lastCheckedAt } });
          }
          if (action === "run") { task.lastCheckedAt = checkedAt; task.lastResult = answer.answer; task.stats = { checks: 14, aiCalls: 1, unchanged: 13 }; }
          const eventResult = task.interpretedRule.resultKind === "events";
          task.latestResult = { resultKind: eventResult ? "events" : "answer", result: eventResult ? { version: 1, events: task.events } : weatherScenario ? weatherAnswer : answer, sourceUrl: weatherScenario ? weatherUrl : sourceUrl, checkedAt, sources: eventResult ? [] : weatherScenario ? weatherSources : sources };
          return route.fulfill({ json: { outcome: "changed", ...task.latestResult } });
        }
        task = { ...task, revision: task.revision + 1 };
        if (action === "interpret") task = { ...task, interpretedRule: weatherScenario ? weatherRule : rule, lifecycleStatus: undefined, errorCode: null, checkIntervalMinutes: 60 };
        else if (action === "approve" || action === "resume") task = { ...task, state: "active", approvedRevision: task.revision, nextCheckAt: scheduledAt };
        if (action === "approve") task = { ...task, latestResult: null, events: [], lastResult: null };
        else if (action === "pause") task = { ...task, state: "paused", nextCheckAt: null };
        else if (action === "quality") task._usesSmarterAi = body.quality === "smarter";
        else if (!["interpret", "resume"].includes(action)) unexpected.push(path);
      }
      tasks = tasks.map((entry) => entry.id === task.id ? task : entry);
      return route.fulfill({ json: presented(task) });
    }
    if (request.method() === "GET" && responses[path] !== undefined) {
      const value = path === "/api/v1/me" && restricted ? { ...me, memberships: [{ ...me.memberships[0], role_preset: "limited", capabilities: ["household.view"] }] } : responses[path];
      return route.fulfill({ json: value });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_TEST_REQUEST" } } });
  });
}
const panel = () => page.locator(".monitor-page");
const card = () => panel().getByRole("article").first();
const button = (name) => card().getByRole("button", { name, exact: true });
const navigate = async () => { await page.getByRole("button", { name: "Oppdrag", exact: true }).click(); await expect(panel().getByRole("heading", { name: "Oppdrag", exact: true })).toBeVisible(); };
const noTechnicalTerms = async () => { await expect(panel()).not.toContainText(/OpenAI|Ollama|provider|leverandør|modell|model|policy|reasoning|resonnering|API|KI-|web[._]open|tool|verktøy|mangler nettilgang|lack web access/i); };
const axe = async () => { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(result.violations.map(({ id }) => id)).toEqual([]); };
const layout = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
try {
  await mock(page);
  await page.goto("/"); await navigate();
  await panel().getByRole("button", { name: "Nytt oppdrag" }).click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeFocused();
  await noTechnicalTerms();
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Finn den nyeste overskriften.");
  failNext = "MONITOR_SOURCE_REQUIRED";
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(panel().getByRole("alert")).toContainText("Samvev trenger en kilde");
  await expect(panel().getByRole("alert")).toBeFocused();
  failNext = "MONITOR_SOURCE_AMBIGUOUS";
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Sammenlign https://example.com og https://example.org.");
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(panel().getByRole("alert")).toContainText("Forespørselen inneholder flere kilder");
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Finn den nyeste overskriften fra https://example.com/news hver time.");
  gate = new Promise((resolve) => { release = resolve; });
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeDisabled();
  release(); gate = undefined;
  await expect(card()).toContainText("Venter på din godkjenning");
  await expect(card().locator(".preview-panel")).toBeFocused();
  expect(calls.filter((call) => call.path === base).at(-1).body).not.toHaveProperty("sourceUrl");
  expect(calls.filter((call) => call.path === base).at(-1).body).not.toHaveProperty("name");
  for (const call of calls) { expect(call.body).not.toHaveProperty("providerPolicy"); expect(call.body).not.toHaveProperty("modelTier"); }
  await expect(card()).toContainText("Intervall: 60 minutter");
  await expect(card()).toContainText("Svar fra kilden");
  await expect(card()).toContainText("Testskjerm");
  await expect(button("Test nå")).toBeEnabled();
  await expect(button("Godkjenn og aktiver")).toBeEnabled();
  await button("Test nå").focus(); await page.keyboard.press("Enter");
  await expect(card().locator(".monitor-result")).toBeFocused();
  await expect(card()).toContainText(answer.answer);
  await expect(card()).toContainText("Dette er en prøve. Oppdragets plan og varsler er uendret.");
  await expect(card().locator(".monitor-result-source")).toHaveAttribute("href", evidenceUrl);
  const sourcesDisclosure = card().locator(".monitor-sources");
  await expect(sourcesDisclosure.locator("summary")).toHaveText("Kilder brukt");
  await sourcesDisclosure.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(sourcesDisclosure).toHaveAttribute("open", "");
  await expect(sourcesDisclosure.getByRole("link")).toHaveCount(2);
  await expect(sourcesDisclosure.getByRole("link").last()).toHaveAttribute("href", evidenceUrl);
  await expect(sourcesDisclosure.locator("time").last()).toHaveAttribute("datetime", sources[1].fetchedAt);
  await expect(card().locator(".monitor-observed-at time")).toHaveAttribute("datetime", sources[1].fetchedAt);
  await noTechnicalTerms(); await layout(); await axe();
  const sourceHeights = await sourcesDisclosure.locator("summary, a").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(sourceHeights.every((height) => height >= 44)).toBe(true);
  expect(tasks[0].state).toBe("draft"); expect(tasks[0].nextCheckAt).toBeNull();
  await button("Godkjenn og aktiver").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await button("Kjør nå").click();
  await expect(card()).toContainText("Neste planlagte kontroll er uendret");
  await expect(card()).toContainText("Kontroller: 14 · Nye tolkninger: 1");
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await page.reload(); await navigate();
  await expect(card().locator(".monitor-result").getByRole("heading")).toHaveText("Siste resultat");
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await expect(card().locator(".monitor-result blockquote")).toHaveText(answer.evidence.quote);
  await expect(card().locator(".monitor-result")).toContainText(answer.uncertainty);
  await expect(card().locator(".monitor-result-source")).toHaveAttribute("href", evidenceUrl);
  await expect(card().locator(".monitor-observed-at")).toContainText("2030");
  await expect(card().locator(".monitor-result")).not.toContainText("Dette er en prøve");
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  unchangedNext = true;
  await button("Kjør nå").click();
  await expect(card().locator(".monitor-result")).toContainText("Kilden er uendret");
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await expect(card().locator(".monitor-result blockquote")).toHaveText(answer.evidence.quote);
  await expect(card().locator(".monitor-result")).toContainText(answer.uncertainty);
  await expect(card().locator(".monitor-result-source")).toHaveAttribute("href", evidenceUrl);
  await expect(card().locator(".monitor-observed-at time")).toHaveAttribute("datetime", sources[1].fetchedAt);
  await button("Prøv med smartere KI").click();
  await expect(card()).toContainText("Et smartere forslag");
  expect(tasks[0]).not.toHaveProperty("modelTier"); expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await expect(card()).not.toContainText('Bruker smartere KI fremover');
  await button("Bruk smartere KI for dette oppdraget fremover").click();
  expect(calls.filter((call) => call.path.endsWith('/quality')).at(-1).body.quality).toBe('smarter');
  await expect(card()).toContainText('Bruker smartere KI fremover');
  await expect(card().locator(".monitor-meta")).not.toContainText(/Smartere|Standard|Utførelse/);
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await button("Bruk standard fremover").click();
  expect(calls.filter((call) => call.path.endsWith('/quality')).at(-1).body.quality).toBe('standard');
  await expect(card()).not.toContainText('Bruker smartere KI fremover');
  await expect(card().locator(".monitor-meta")).not.toContainText(/Smartere|Standard|Utførelse/);
  failNext = "AI_TIMEOUT";
  await button("Kjør nå").click();
  await expect(card().getByRole("alert")).toContainText("Dette tok for lang tid");
  await expect(card().getByRole("alert")).toBeFocused();
  for (const [code, message] of [
    ["MONITOR_SOURCE_TIMEOUT", "Kilden svarte ikke i tide"],
    ["AI_RESPONSE_INVALID", "Samvev kunne ikke bekrefte svaret mot kilden. Prøv igjen."],
    ["MONITOR_TOOL_INVALID", "Samvev kunne ikke undersøke kilden videre"],
    ["MONITOR_TOOL_LIMIT", "Samvev rakk ikke å finne et bekreftet svar"],
    ["AI_ENDPOINT_BLOCKED", "Denne kilden kan ikke brukes"],
    ["MONITOR_SOURCE_UNSUPPORTED", "Samvev kunne ikke lese kilden"],
  ]) {
    failNext = code; await button("Kjør nå").click();
    await expect(card().getByRole("alert")).toContainText(message);
    await expect(card().getByRole("alert")).toBeFocused();
    await noTechnicalTerms();
  }
  await button("Pause").click();
  await expect(card().locator(".monitor-state")).toHaveText("Pauset");
  await button("Test nå").click();
  await expect(card()).toContainText("Testresultat"); expect(tasks[0].state).toBe("paused");
  await button("Aktiver igjen").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await axe(); await layout();
  await page.setViewportSize({ width: 1280, height: 752 }); await layout(); await noTechnicalTerms(); await axe();
  if (process.env.MONITOR_SCREENSHOT_DIR) { await mkdir(process.env.MONITOR_SCREENSHOT_DIR, { recursive: true }); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await panel().screenshot({ path: `${process.env.MONITOR_SCREENSHOT_DIR}/tasks-answer-nb-synthetic.png` }); }
  await button("Endre").click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeFocused();
  await expect(panel()).toContainText("Oppdraget må godkjennes igjen");
  await page.getByLabel("Kilde (valgfritt)", { exact: true }).fill("https://example.org/override");
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(card().locator(".preview-panel")).toBeFocused();
  await expect(card()).toContainText("Venter på din godkjenning");
  expect(calls.findLast((call) => call.method === "PATCH").body.sourceUrl).toBe("https://example.org/override");
  expect(tasks[0].latestResult).toBeNull();
  expect(tasks[0].events).toEqual([]);
  await expect(card().locator(".monitor-result")).toHaveCount(0);
  await expect(card()).not.toContainText(answer.answer);
  await button("Godkjenn og aktiver").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await expect(card().locator(".monitor-result")).toHaveCount(0);
  await expect(card()).not.toContainText(answer.answer);
  await button("Kjør nå").click();
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await button("Slett").click();
  await expect(card().locator(".monitor-delete")).toBeFocused();
  await button("Ja, slett oppdraget").click();
  await expect(panel().getByRole("heading", { name: "Oppdrag", exact: true })).toBeFocused();
  await expect(panel()).toContainText("Ingen oppdrag ennå");
  // Approval is independent of Test now, and errors/deletion never strand a draft.
  const template = { id: taskId, name: 'Tilstandstest', instruction: 'Finn overskriften fra https://example.com/news.', sourceUrl, state: 'draft', checkIntervalMinutes: 60, noticeDaysBefore: 1, noticeLocalTime: '18:00', providerPolicy: 'local', modelTier: 'routine', targets: { personIds: [], displayIds: ['50000000-0000-4000-8000-000000000001'] }, interpretedRule: rule, events: [], revision: 1, approvedRevision: null, lastCheckedAt: null, nextCheckAt: null, lastResult: null, lastChangedAt: null, errorCode: null, stats: { checks: 0, aiCalls: 0, unchanged: 0 } };
  const showTasks = async (values) => { tasks = values; await page.reload(); await navigate(); };
  await showTasks([{ ...template }]);
  await expect(button('Test nå')).toBeEnabled(); await expect(button('Godkjenn og aktiver')).toBeEnabled();
  const beforeApproval = calls.length;
  await button('Godkjenn og aktiver').click(); await expect(card().locator('.monitor-state')).toHaveText('Aktiv');
  expect(calls.slice(beforeApproval).some((call) => call.path.endsWith('/test'))).toBe(false);
  for (const errorCode of [null, 'AI_DISABLED', 'MONITOR_SOURCE_UNAVAILABLE']) {
    // A truthy but invalid compiled rule must follow server incomplete status.
    await showTasks([{ ...template, interpretedRule: {}, lifecycleStatus: errorCode ? 'setup_failed' : 'incomplete', errorCode }]);
    await expect(card()).not.toContainText('Venter på din godkjenning');
    await expect(card().locator('.monitor-state')).toHaveText(errorCode ? 'Oppsettet kunne ikke lages' : 'Oppsett mangler');
    await expect(button(errorCode ? 'Prøv å lage oppsett igjen' : 'Lag oppsett fra forespørselen')).toBeEnabled();
    await expect(button('Test nå')).toHaveCount(0); await expect(button('Godkjenn og aktiver')).toHaveCount(0);
    await button('Slett').focus(); await page.keyboard.press('Enter');
    await expect(card().locator('.monitor-delete')).toBeFocused();
    await button('Ja, slett oppdraget').click(); await expect(panel().getByRole('article')).toHaveCount(0);
  }
  await showTasks([{ ...template, interpretedRule: null }, { ...template, id: '60000000-0000-4000-8000-000000000002', name: 'Annet oppdrag' }]);
  gateAction = 'interpret'; gate = new Promise((resolve) => { release = resolve; });
  await button('Lag oppsett fra forespørselen').click();
  await expect(card().locator('.monitor-state')).toHaveText('Arbeider nå');
  await expect(card()).toContainText('resten av handlingene blir tilgjengelige');
  await expect(button('Oppdater status')).toBeEnabled();
  const other = panel().getByRole('article').nth(1);
  await expect(other.getByRole('button', { name: 'Test nå', exact: true })).toBeEnabled();
  await expect(other.getByRole('button', { name: 'Godkjenn og aktiver', exact: true })).toBeEnabled();
  await expect(panel().getByRole('button', { name: 'Nytt oppdrag' })).toBeEnabled();
  release(); gate = undefined; gateAction = undefined;
  await expect(button('Test nå')).toBeEnabled(); await expect(button('Godkjenn og aktiver')).toBeEnabled();
  // An already saved draft is displayed immediately while its setup request runs.
  tasks = []; await page.reload(); await navigate();
  await panel().getByRole('button', { name: 'Nytt oppdrag' }).click();
  await page.getByLabel('Din forespørsel', { exact: true }).fill('Finn første overskrift fra example.com.');
  gateAction = 'interpret'; gate = new Promise((resolve) => { release = resolve; });
  await panel().getByRole('button', { name: 'Lag oppsett fra forespørselen', exact: true }).click();
  await expect(card().locator('.monitor-state')).toHaveText('Arbeider nå');
  await expect(page.getByLabel('Din forespørsel', { exact: true })).toHaveCount(0);
  await expect(panel().getByRole('button', { name: 'Nytt oppdrag' })).toBeEnabled();
  release(); gate = undefined; gateAction = undefined;
  await expect(button('Test nå')).toBeEnabled();
  // A failed setup is refreshed immediately and can be retried without reload.
  await showTasks([{ ...template, interpretedRule: null }]);
  failNext = 'AI_DISABLED'; afterFailure = () => { tasks[0].errorCode = 'AI_DISABLED'; };
  await button('Lag oppsett fra forespørselen').click();
  await expect(card().locator('.monitor-state')).toHaveText('Oppsettet kunne ikke lages');
  await expect(card().getByRole('alert')).toContainText('smarte oppdrag er deaktivert');
  await expect(button('Slett')).toBeEnabled();
  await button('Prøv å lage oppsett igjen').click();
  await expect(button('Test nå')).toBeEnabled(); await expect(button('Godkjenn og aktiver')).toBeEnabled();
  // A finishing interpretation must never unlock a newer, still pending save.
  for (const saveMethod of ['POST', 'PATCH']) {
    const otherId = '60000000-0000-4000-8000-000000000002';
    await showTasks([{ ...template, id: otherId, name: 'Oppdrag B' }]);
    await panel().getByRole('button', { name: 'Nytt oppdrag' }).click();
    await page.getByLabel('Din forespørsel', { exact: true }).fill('Oppdrag A: Finn overskriften fra example.com.');
    gateAction = `${taskId}/interpret`; gate = new Promise((resolve) => { release = resolve; });
    await panel().getByRole('button', { name: 'Lag oppsett fra forespørselen', exact: true }).click();
    const taskA = page.locator(`#monitor-card-${taskId}`);
    await expect(taskA.locator('.monitor-state')).toHaveText('Arbeider nå');
    if (saveMethod === 'POST') await panel().getByRole('button', { name: 'Nytt oppdrag' }).click();
    else await page.locator(`#monitor-card-${otherId}`).getByRole('button', { name: 'Endre', exact: true }).click();
    await page.getByLabel('Din forespørsel', { exact: true }).fill('Oppdrag B: Finn toppsaken fra example.com.');
    saveGate = new Promise((resolve) => { releaseSave = resolve; });
    const saveCalls = () => calls.filter((call) => call.method === saveMethod && (saveMethod === 'PATCH' || call.path === base)).length;
    const beforeSave = saveCalls();
    await panel().getByRole('button', { name: 'Lag oppsett fra forespørselen', exact: true }).click();
    await expect.poll(saveCalls).toBe(beforeSave + 1);
    await expect(page.getByLabel('Din forespørsel', { exact: true })).toBeDisabled();
    release(); gate = undefined; gateAction = undefined;
    await expect(taskA.locator('.monitor-state')).toHaveText('Venter på din godkjenning');
    // A's finally has now run; B still owns the form lock.
    await expect(page.getByLabel('Din forespørsel', { exact: true })).toBeDisabled();
    await expect(panel().getByRole('button', { name: 'Nytt oppdrag' })).toBeDisabled();
    await panel().locator('form.monitor-form').evaluate((form) => form.requestSubmit());
    expect(saveCalls()).toBe(beforeSave + 1);
    releaseSave(); saveGate = undefined;
    await expect(page.getByLabel('Din forespørsel', { exact: true })).toHaveCount(0);
    await expect(panel().getByRole('button', { name: 'Nytt oppdrag' })).toBeEnabled();
    await expect(panel().locator('.monitor-state').filter({ hasText: 'Arbeider nå' })).toHaveCount(0);
    expect(saveCalls()).toBe(beforeSave + 1);
  }
  await showTasks([{ ...template, approveDenied: true }]);
  await expect(button('Test nå')).toBeEnabled(); await expect(button('Godkjenn og aktiver')).toBeDisabled();
  await expect(button('Godkjenn og aktiver')).toHaveAttribute('aria-describedby', `monitor-approve-reason-${taskId}`);
  await expect(page.locator(`#monitor-approve-reason-${taskId}`)).toBeVisible();
  await expect(page.locator(`#monitor-approve-reason-${taskId}`)).toContainText('Du har ikke tilgang til å gjøre dette');
  await expect(panel()).toContainText('Test nå er valgfritt før godkjenning.');
  await axe();
  // Reloaded server leases recover by polling, with refresh available immediately.
  await showTasks([{ ...template, lifecycleStatus: 'running' }]);
  await expect(card().locator('.monitor-state')).toHaveText('Arbeider nå');
  await expect(button('Oppdater status')).toBeEnabled();
  await expect(button('Slett')).toHaveCount(0);
  tasks[0].lifecycleStatus = 'ready_for_approval';
  await expect(button('Test nå')).toBeEnabled({ timeout: 7000 });
  await expect(button('Godkjenn og aktiver')).toBeEnabled();
  failNext = 'REVISION_CONFLICT'; afterFailure = () => { tasks[0].revision += 1; };
  await button('Test nå').click();
  await expect(card().getByRole('alert')).toContainText('Oppdraget ble endret et annet sted');
  await expect(card().getByRole('alert')).toBeFocused();
  await button('Test nå').click(); await expect(card().locator('.monitor-result')).toBeVisible();
  for (const [code, message] of [['MONITOR_RUNNING', 'Oppdraget arbeider allerede'], ['MONITOR_SETUP_REQUIRED', 'Oppsettet er ikke komplett'], ['MONITOR_TARGET_INVALID', 'En mottaker eller skjerm kan ikke brukes'], ['AI_DISABLED', 'smarte oppdrag er deaktivert']]) {
    failNext = code; await button('Test nå').click(); await expect(card().getByRole('alert')).toContainText(message);
  }
  failNext = 'NOT_FOUND'; afterFailure = () => { tasks = []; };
  await button('Slett').click(); await button('Ja, slett oppdraget').click();
  await expect(panel().getByRole('alert')).toContainText('Oppdraget finnes ikke lenger. Listen er oppdatert.');
  await expect(panel().getByRole('alert')).toBeFocused(); await expect(panel().getByRole('article')).toHaveCount(0);
  const timeoutValues = await page.evaluate(() => window.taskTimeouts);
  expect(timeoutValues).toContain(210000); expect(timeoutValues).toContain(12000);
  // Setup-format/source-context failures retain localized recovery, including after reload.
  for (const copy of [
    { locale: 'nb', nav: 'Oppdrag', create: 'Lag oppsett fra forespørselen', retry: 'Prøv å lage oppsett igjen', edit: 'Endre', delete: 'Slett', confirm: 'Ja, slett oppdraget', failed: 'Oppsettet kunne ikke lages', ready: 'Venter på din godkjenning', test: 'Test nå', approve: 'Godkjenn og aktiver', messages: ['Samvev kunne ikke lage et gyldig oppsett fra forespørselen. Prøv å lage oppsettet igjen.', 'Samvev fikk ikke laget oppsettet fra kilden. Prøv å lage oppsettet igjen.'] },
    { locale: 'en', nav: 'Tasks', create: 'Create setup from request', retry: 'Retry setup', edit: 'Edit', delete: 'Delete', confirm: 'Yes, delete task', failed: 'Setup could not be created', ready: 'Waiting for your approval', test: 'Test now', approve: 'Approve and activate', messages: ['Samvev could not create valid setup from the request. Try creating setup again.', 'Samvev could not create setup from the source. Try creating setup again.'] },
  ]) {
    me.account.locale = copy.locale;
    for (const [index, code] of ['MONITOR_INTERPRETATION_SCHEMA_INVALID', 'MONITOR_INTERPRETATION_SOURCE_REFUSAL'].entries()) {
      tasks = [{ ...template, interpretedRule: null }];
      await page.setViewportSize({ width: index === 0 ? 390 : 1280, height: index === 0 ? 844 : 752 });
      await page.reload(); await page.getByRole('button', { name: copy.nav, exact: true }).click();
      failNext = code; afterFailure = () => { tasks[0].errorCode = code; };
      await button(copy.create).focus(); await page.keyboard.press('Enter');
      await expect(card().locator('.monitor-state')).toHaveText(copy.failed);
      await expect(card().getByRole('alert')).toHaveText(copy.messages[index]);
      await expect(card().getByRole('alert')).toBeFocused();
      for (const action of [copy.retry, copy.edit, copy.delete]) await expect(button(action)).toBeEnabled();
      await expect(button(copy.test)).toHaveCount(0); await expect(button(copy.approve)).toHaveCount(0);
      await noTechnicalTerms(); await layout(); await axe();
      await page.reload(); await page.getByRole('button', { name: copy.nav, exact: true }).click();
      await expect(card().locator('.monitor-state')).toHaveText(copy.failed);
      await expect(card()).toContainText(copy.messages[index]);
      if (index === 0) {
        await button(copy.retry).focus(); await page.keyboard.press('Enter');
        await expect(card().locator('.preview-panel')).toBeFocused();
        await expect(card().locator('.monitor-state')).toHaveText(copy.ready);
        await expect(button(copy.test)).toBeEnabled(); await expect(button(copy.approve)).toBeEnabled();
      }
      // Both a recovered draft and a persisted setup failure remain deletable by keyboard.
      await button(copy.delete).focus(); await page.keyboard.press('Enter');
      await expect(card().locator('.monitor-delete')).toBeFocused();
      await button(copy.confirm).focus(); await page.keyboard.press('Enter');
      await expect(panel().getByRole('article')).toHaveCount(0);
      await expect(panel().getByRole('heading', { name: copy.nav, exact: true })).toBeFocused();
    }
  }
  // Persisted events and incomplete setup get distinct representations.
  tasks = [{ id: taskId, name: "Testtur", instruction: "Finn fremtidige turer fra https://example.com/news.", sourceUrl, state: "active", checkIntervalMinutes: 60, noticeDaysBefore: 1, noticeLocalTime: "18:00", providerPolicy: "local", modelTier: "routine", targets: { personIds: [], displayIds: ["50000000-0000-4000-8000-000000000001"] }, interpretedRule: { ...rule, resultKind: "events", summary: "Finn fremtidige turer.", eventTypes: ["tur"] }, events: [{ date: "2030-09-20", time: "10:00", type: "tur", description: "Tur til testparken", actions: ["Ta med vann"], who: ["Testprofil"], evidence: { quote: "2030-09-20 klokken 10:00: Tur til testparken. Ta med vann.", sourceUrl }, confidence: .99, uncertainty: null }], revision: 1, approvedRevision: 1, lastCheckedAt: checkedAt, nextCheckAt: scheduledAt, lastResult: "1 event(s)", lastChangedAt: checkedAt, errorCode: null, stats: { checks: 1, aiCalls: 1, unchanged: 0 } }];
  tasks.push({ ...tasks[0], id: "60000000-0000-4000-8000-000000000002", name: "Uferdig oppdrag", state: "draft", interpretedRule: null, events: [], nextCheckAt: null });
  tasks.push({ ...template, id: '60000000-0000-4000-8000-000000000003', approveDenied: true });
  me.account.locale = "en";
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(panel()).toContainText("Setup needed");
  const deniedEn = page.locator('#monitor-card-60000000-0000-4000-8000-000000000003');
  await expect(deniedEn.getByRole('button', { name: 'Test now', exact: true })).toBeEnabled();
  await expect(deniedEn.getByRole('button', { name: 'Approve and activate', exact: true })).toBeDisabled();
  await expect(deniedEn.getByRole('button', { name: 'Approve and activate', exact: true })).toHaveAttribute('aria-describedby', 'monitor-approve-reason-60000000-0000-4000-8000-000000000003');
  await expect(deniedEn.locator('#monitor-approve-reason-60000000-0000-4000-8000-000000000003')).toContainText('You do not have permission to do this');
  await expect(panel()).toContainText('Test now is optional before approval.');
  await expect(panel()).toContainText("Days before: 1 · Time: 18:00 · Europe/Oslo");
  await card().getByRole("button", { name: "Run now", exact: true }).click();
  await expect(card()).toContainText("Tur til testparken");
  await expect(card()).toContainText("Ta med vann");
  await expect(card().locator(".monitor-result a").last()).toHaveAttribute("href", sourceUrl);
  unchangedNext = true;
  await card().getByRole("button", { name: "Run now", exact: true }).click();
  await expect(card().locator(".monitor-result")).toContainText("Source unchanged");
  await expect(card().locator(".monitor-result")).toContainText("Tur til testparken");
  await expect(card().locator(".monitor-result blockquote")).toContainText("2030-09-20");
  await expect(card().locator(".monitor-sources")).toHaveCount(0);
  for (const [code, message] of [
    ["MONITOR_SOURCE_TIMEOUT", "The source did not respond in time"],
    ["AI_RESPONSE_INVALID", "Samvev could not verify the answer against the source. Try again."],
    ["REVISION_CONFLICT", "The task was changed elsewhere"],
    ["MONITOR_RUNNING", "The task is already working"],
    ["MONITOR_SETUP_REQUIRED", "Setup is incomplete"],
    ["MONITOR_TARGET_INVALID", "A recipient or display is unavailable"],
    ["AI_DISABLED", "Smart tasks are disabled"],
    ["MONITOR_TOOL_INVALID", "Samvev could not explore the source further"],
    ["MONITOR_TOOL_LIMIT", "Samvev could not find a confirmed answer in time"],
  ]) {
    failNext = code; await button("Run now").click();
    await expect(card().getByRole("alert")).toContainText(message);
    await expect(card().getByRole("alert")).toBeFocused();
  }
  // The same source disclosure is localized without exposing internal provenance fields.
  tasks[0].latestResult = { resultKind: "answer", result: answer, sourceUrl, checkedAt, sources };
  await page.reload(); await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(card().locator(".monitor-sources summary")).toHaveText("Sources used");
  await card().locator(".monitor-sources summary").click();
  await noTechnicalTerms(); await layout(); await axe();
  const actionHeights = await panel().locator(".card-actions button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(actionHeights.every((height) => height >= 44)).toBe(true);
  me.account.theme = "dark";
  await page.setViewportSize({ width: 1280, height: 752 }); await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await card().locator(".monitor-sources summary").click();
  await noTechnicalTerms(); await layout(); await axe();
  await page.setViewportSize({ width: 390, height: 844 }); await layout(); await axe();
  if (process.env.MONITOR_STATE_SCREENSHOT_DIR) {
    me.account.locale = "nb"; me.account.theme = "light";
    tasks = [
      { ...template, name: "Klart eksempel" },
      { ...template, id: "60000000-0000-4000-8000-000000000004", name: "Ufullstendig eksempel", interpretedRule: null },
      { ...template, id: "60000000-0000-4000-8000-000000000005", name: "Pågående eksempel", lifecycleStatus: "running" },
    ];
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.reload(); await navigate();
    await mkdir(process.env.MONITOR_STATE_SCREENSHOT_DIR, { recursive: true });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.locator(".monitor-grid").screenshot({ path: `${process.env.MONITOR_STATE_SCREENSHOT_DIR}/task-states-nb-synthetic.png` });
  }
  // Structured weather needs no URL, and only reviewed canonical place/source details appear.
  weatherScenario = true; tasks = []; me.account.locale = 'nb'; me.account.theme = 'light';
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await navigate();
  await panel().getByRole('button', { name: 'Nytt oppdrag' }).click();
  await page.getByLabel('Din forespørsel', { exact: true }).fill('Sjekk været i Testvik i morgen tidlig.');
  await panel().getByRole('button', { name: 'Lag oppsett fra forespørselen', exact: true }).click();
  await expect(card().locator('.monitor-state')).toHaveText('Venter på din godkjenning');
  expect(calls.filter((call) => call.path === base && call.method === 'POST').at(-1).body.sourceUrl).toBeUndefined();
  expect(tasks[0].sourceUrl).toBeNull();
  await expect(card().locator('.monitor-rule')).toContainText('Testvik, Eksempelkommune, Eksempelfylke, Norge');
  await expect(card().locator('.monitor-rule')).toContainText('Stedsnavn © Kartverket');
  await expect(card().locator('.monitor-source')).toHaveText('Værvarsel fra Meteorologisk institutt');
  await expect(card().locator('a[href=""], a:not([href])')).toHaveCount(0);
  await expect(button('Test nå')).toBeEnabled(); await expect(button('Godkjenn og aktiver')).toBeEnabled();
  await button('Test nå').focus(); await page.keyboard.press('Enter');
  await expect(card().locator('.monitor-result')).toBeFocused();
  await expect(card().locator('.monitor-result')).toContainText('6 °C');
  await expect(card().locator('.monitor-result')).toContainText('Prognosen gjelder');
  await expect(card().locator('.monitor-result')).toContainText('Prognosen oppdatert');
  await expect(card().locator('.monitor-result-source')).toHaveText('Værvarsel fra Meteorologisk institutt');
  expect(tasks[0].state).toBe('draft'); expect(tasks[0].nextCheckAt).toBeNull();
  await expect(panel()).not.toContainText(/60\.1234|10\.4321|weather[._]forecast|routine|strong|Utførelse/);
  await noTechnicalTerms(); await layout(); await axe();
  if (process.env.WEATHER_SCREENSHOT_DIR) {
    await mkdir(process.env.WEATHER_SCREENSHOT_DIR, { recursive: true });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: `${process.env.WEATHER_SCREENSHOT_DIR}/weather-nb-mobile-synthetic.png` });
  }
  // Both sources survive reload; the source list uses human labels and attribution.
  tasks[0] = { ...tasks[0], sourceUrl, sourceKinds: ['web', 'weather'], state: 'active', interpretedRule: { ...weatherRule, resultKind: 'events' }, events: [combinedEvent], latestResult: { resultKind: 'events', result: { version: 1, events: [combinedEvent] }, sourceUrl, checkedAt, sources: [sources[0], ...weatherSources] } };
  me.account.locale = 'en'; me.account.theme = 'dark';
  await page.setViewportSize({ width: 1280, height: 752 }); await page.reload(); await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(card().locator('.monitor-source-list')).toContainText('Web page / document');
  await expect(card().locator('.monitor-source-list')).toContainText('Forecast from MET Norway');
  await card().locator('.monitor-sources summary').focus(); await page.keyboard.press('Enter');
  await expect(card().locator('.monitor-sources')).toContainText('Forecast valid');
  await expect(card().locator('.monitor-sources')).toContainText('Forecast from MET Norway');
  await expect(card().locator('.monitor-supporting-evidence')).toContainText('Supporting source evidence');
  await expect(card().locator(`.monitor-supporting-evidence a[href="${weatherUrl}"]`)).toHaveCount(1);
  await expect(panel()).not.toContainText(/60\.1234|10\.4321|weather[._]forecast|routine|strong|Quality/);
  await noTechnicalTerms(); await layout(); await axe();
  if (process.env.WEATHER_SCREENSHOT_DIR) await panel().screenshot({ path: `${process.env.WEATHER_SCREENSHOT_DIR}/weather-en-desktop-synthetic.png` });
  // An explicit cleared override is sent on edit, so old web sources cannot stick to weather-only setup.
  await button('Edit').click();
  await page.getByLabel('Source (optional)', { exact: true }).fill('');
  await panel().getByRole('button', { name: 'Create setup from request', exact: true }).click();
  await expect(card().locator('.monitor-state')).toHaveText('Waiting for your approval');
  expect(calls.filter((call) => call.method === 'PATCH').at(-1).body.sourceUrl).toBe('');
  expect(tasks[0].sourceUrl).toBeNull();
  await expect(card().locator('.monitor-source')).toHaveCount(1);
  for (const [locale, nav, create, retry, edit, errorMessages] of [
    ['nb', 'Oppdrag', 'Lag oppsett fra forespørselen', 'Prøv å lage oppsett igjen', 'Endre', ['Hvilket sted gjelder værvarselet?', 'Hvilket sted mener du?', 'Samvev fant ikke stedet.', 'Værvarselet kunne ikke hentes nå.', 'Værtjenesten ber oss vente litt.', 'Samvev fikk ikke et gyldig værvarsel']],
    ['en', 'Tasks', 'Create setup from request', 'Retry setup', 'Edit', ['Which place is the forecast for?', 'Which place do you mean?', 'Samvev could not find the place.', 'The forecast could not be fetched now.', 'The weather service has asked us to wait.', 'Samvev did not receive a valid forecast']],
  ]) {
    me.account.locale = locale;
    const codes = ['MONITOR_LOCATION_REQUIRED', 'MONITOR_LOCATION_AMBIGUOUS', 'MONITOR_LOCATION_NOT_FOUND', 'MONITOR_WEATHER_UNAVAILABLE', 'MONITOR_WEATHER_RATE_LIMITED', 'MONITOR_WEATHER_INVALID'];
    for (let index = 0; index < codes.length; index++) {
      tasks = [{ ...template, sourceUrl: null, interpretedRule: null, errorCode: null }];
      await page.reload(); await page.getByRole('button', { name: nav, exact: true }).click();
      failNext = codes[index]; failDetails = codes[index] === 'MONITOR_LOCATION_AMBIGUOUS' ? { candidates: [{ name: 'Testvik', municipality: 'Eksempelkommune', region: 'Eksempelfylke', latitude: 60.1234, longitude: 10.4321 }, { name: 'Testvik', municipality: 'Prøvekommune', region: 'Prøvefylke' }] } : undefined;
      afterFailure = () => { tasks[0].errorCode = codes[index]; };
      await button(create).click(); await expect(card().getByRole('alert')).toContainText(errorMessages[index]);
      await expect(card().getByRole('alert')).toBeFocused(); await expect(button(retry)).toBeEnabled(); await expect(button(edit)).toBeEnabled();
      await expect(panel()).not.toContainText(/60\.1234|10\.4321/);
      if (codes[index] === 'MONITOR_LOCATION_AMBIGUOUS') {
        await expect(card().locator('.monitor-location-options button')).toHaveCount(2);
        await card().locator('.monitor-location-options button').first().focus(); await page.keyboard.press('Enter');
        await expect(page.locator('#monitor-instruction')).toBeFocused();
        await expect(page.locator('#monitor-instruction')).toHaveValue(/Testvik, Eksempelkommune, Eksempelfylke/);
        await panel().getByRole('button', { name: create, exact: true }).click();
        await expect(card().locator('.monitor-state')).toHaveText(locale === 'nb' ? 'Venter på din godkjenning' : 'Waiting for your approval');
        await page.reload(); await page.getByRole('button', { name: nav, exact: true }).click();
        await expect(card().locator('.monitor-rule')).toContainText('Testvik, Eksempelkommune, Eksempelfylke');
        await layout(); await axe();
      }
    }
  }
  failDetails = undefined;
  const limitedContext = await browser.newContext({ baseURL }); const limited = await limitedContext.newPage(); await mock(limited, true); await limited.goto("/");
  await expect(limited.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0); await limitedContext.close();
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  console.log("PASS lifecycle actions/recovery, optional testing before approval, per-card busy, immediate draft display, running refresh/poll, stale revision and deleted-task refresh, draft/failed/AI-disabled/source-failed UI deletion; synthetic prompt-first create/interpret; optional/ambiguous source errors; approval/test/manual/quality/pause/resume/edit/delete; answer/event evidence+time including persisted answer evidence/uncertainty after reload; unchanged retains answer/events; edited/reapproved setup clears stale results; preserved schedule representation; no technical controls; 210s actions; source-specific nb/en errors; keyboard source disclosure with actual evidence URL/fetch time; restricted navigation; keyboard/focus; 44px actions; nb/en mobile/XL/desktop and dark-theme layout/Axe; zero real requests");
} finally { if (gate) release(); if (saveGate) releaseSave(); await browser.close(); }
