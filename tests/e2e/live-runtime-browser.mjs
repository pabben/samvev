// Real UI actions shared by deployed-runtime tests and the synthetic browser regression.
import AxeBuilder from '@axe-core/playwright';
import { check } from './live-runtime-support.mjs';
const text = {
  nb: { new: 'Nytt oppdrag', instruction: 'Din forespørsel', options: 'Kilde og andre valg (valgfritt)', name: 'Navn på oppdrag (valgfritt)', source: 'Kilde (valgfritt)', setup: 'Lag oppsett fra forespørselen', test: 'Test nå', approve: 'Godkjenn og aktiver', delete: 'Slett', confirm: 'Ja, slett oppdraget', leave: 'Du kan forlate siden. Samvev fortsetter i bakgrunnen.', ready: 'Venter på din godkjenning' },
  en: { test: 'Test now', approve: 'Approve and activate', delete: 'Delete', confirm: 'Yes, delete task', leave: 'You can leave this page. Samvev continues in the background.', ready: 'Waiting for your approval' },
};
export async function keyboardActivate(page, target) {
  await target.waitFor({ state: 'visible' });
  check(await target.isEnabled(), 'UI_ACTION_DISABLED');
  await target.focus(); check(await target.evaluate((node) => node === document.activeElement), 'UI_FOCUS_FAILED');
  await page.keyboard.press('Enter');
}
export async function navigateTasks(page, locale = 'nb', reload = false) {
  if (reload) await page.reload(); else await page.goto('/');
  const name = locale === 'nb' ? 'Oppdrag' : 'Tasks';
  await keyboardActivate(page, page.getByRole('button', { name, exact: true }));
  const heading = page.getByRole('heading', { name, exact: true });
  // Panel data loads after navigation. Bound the UI observation without tying
  // it to the independent, durable execution deadline.
  try { await heading.waitFor({ state: 'visible', timeout: 15000 }); }
  catch { throw new Error('MONITOR_NAVIGATION'); }
  check(await heading.isVisible(), 'MONITOR_NAVIGATION');
}
function responseFor(page, path, method) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method, { timeout: 30000 }).catch(() => null);
}
export async function createSetupThroughUi(page, base, name, instruction, remember) {
  const t = text.nb;
  await keyboardActivate(page, page.getByRole('button', { name: t.new, exact: true }));
  const form = page.locator('.monitor-form');
  await form.getByLabel(t.instruction, { exact: true }).fill(instruction);
  await keyboardActivate(page, form.locator('summary'));
  await form.getByLabel(t.name, { exact: true }).fill(name);
  check(await form.getByLabel(t.source, { exact: true }).inputValue() === '', 'UI_SOURCE_NOT_EMPTY');
  const targets = form.locator('.monitor-targets input[type=checkbox]');
  check(await targets.count() === 1, 'UI_TARGET_ISOLATION'); await targets.check();
  const created = responseFor(page, base, 'POST');
  const enqueued = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith(`/api/v1${base}/`) && new URL(response.url()).pathname.endsWith('/interpret'), { timeout: 30000 }).catch(() => null);
  await keyboardActivate(page, form.getByRole('button', { name: t.setup, exact: true }));
  const response = await created; check(response?.status() === 201, 'UI_CREATE_FAILED');
  const task = await response.json(); await remember(task);
  const enqueueResponse = await enqueued; check(enqueueResponse?.status() === 202, 'UI_SETUP_NOT_DURABLE');
  const { run } = await enqueueResponse.json(); check(run.taskId === task.id, 'UI_SETUP_WRONG_TASK');
  return { task, run };
}
export async function testThroughUi(page, base, task, locale = 'nb') {
  const response = responseFor(page, `${base}/${task.id}/test`, 'POST');
  await keyboardActivate(page, page.locator(`#monitor-card-${task.id}`).getByRole('button', { name: text[locale].test, exact: true }));
  const accepted = await response; check(accepted?.status() === 202, 'UI_TEST_NOT_DURABLE');
  return (await accepted.json()).run;
}
export async function assertPopulatedUi(page, taskId, locale, theme, phase) {
  const card = page.locator(`#monitor-card-${taskId}`);
  await card.waitFor({ state: 'visible' });
  check(await page.evaluate(({ locale, theme }) => document.documentElement.lang === locale && document.documentElement.dataset.theme === theme, { locale, theme }), 'UI_PREFERENCES_NOT_APPLIED');
  if (phase === 'running') {
    const progress = card.locator('.monitor-progress'); await progress.waitFor({ state: 'visible' });
    check(await progress.getByText(text[locale].leave, { exact: true }).isVisible(), 'UI_DURABLE_HINT_MISSING');
    check((await progress.locator('.monitor-progress-stage strong').textContent()).trim().length > 0, 'UI_STAGE_MISSING');
    const spinner = progress.locator('.monitor-progress-spinner'); check(await spinner.isVisible(), 'UI_SPINNER_MISSING');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    check(await spinner.evaluate((node) => getComputedStyle(node).animationName !== 'none'), 'UI_RUNNING_ANIMATION_MISSING');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check(await spinner.evaluate((node) => getComputedStyle(node).animationName === 'none'), 'UI_REDUCED_MOTION_FAILED');
    check(!await card.locator('[role=progressbar]').count(), 'UI_FALSE_PROGRESS');
  } else {
    await card.locator('.monitor-progress').waitFor({ state: 'hidden' });
    check(await card.locator('.monitor-state').textContent() === text[locale].ready, 'UI_APPROVAL_STATE');
    for (const action of ['test', 'approve', 'delete']) check(await card.getByRole('button', { name: text[locale][action], exact: true }).isEnabled(), 'UI_NEXT_ACTION_MISSING');
    if (phase === 'result') {
      const result = card.locator('.monitor-result'); await result.waitFor({ state: 'visible' });
      check(await result.locator('.monitor-answer, .monitor-finding').count() > 0, 'UI_RESULT_MISSING');
      check(await result.locator('.monitor-result-source').isVisible(), 'UI_SOURCE_MISSING');
      const at = result.locator('.monitor-observed-at time');
      check(await at.isVisible() && Number.isFinite(Date.parse(await at.getAttribute('datetime'))), 'UI_RESULT_TIME_MISSING');
    }
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  check(axe.violations.length === 0, 'UI_POPULATED_AXE_FAILED');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'UI_POPULATED_OVERFLOW');
}
export async function deleteThroughUi(page, base, task, reload, locale = 'nb') {
  const card = page.locator(`#monitor-card-${task.id}`);
  await keyboardActivate(page, card.getByRole('button', { name: text[locale].delete, exact: true }));
  const confirm = card.locator('.monitor-delete'); await confirm.waitFor();
  check(await confirm.evaluate((node) => node === document.activeElement), 'UI_DELETE_CONFIRM_FOCUS');
  const response = responseFor(page, `${base}/${task.id}`, 'DELETE');
  await keyboardActivate(page, confirm.getByRole('button', { name: text[locale].confirm, exact: true }));
  check((await response)?.status() === 204, 'UI_DELETE_FAILED');
  await card.waitFor({ state: 'detached' });
  await reload();
  check(await card.count() === 0, 'UI_DELETE_REAPPEARED');
}
