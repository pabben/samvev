import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Display, MonitorRunResult, MonitorTask, Person } from "./types";
import type { TranslationKey } from "./locales/en";
import { Field, Icon, Loading, useI18n } from "./ui";
import { formatDate } from "./time";

interface Draft {
  name: string; instruction: string; sourceUrl: string;
  checkIntervalMinutes: number; noticeDaysBefore: number; noticeLocalTime: string;
  personIds: string[]; displayIds: string[];
}
type Action = 'interpret' | 'approve' | 'pause' | 'resume' | 'test' | 'run' | 'smarter' | 'quality';
const actionOptions = { timeoutMs: 210000 };
const empty = (displays: Display[]): Draft => ({ name: '', instruction: '', sourceUrl: '', checkIntervalMinutes: 1440, noticeDaysBefore: 1, noticeLocalTime: '18:00', personIds: [], displayIds: displays[0] ? [displays[0].id] : [] });
const fromTask = (task: MonitorTask): Draft => ({ name: task.name, instruction: task.instruction, sourceUrl: task.sourceUrl, checkIntervalMinutes: task.checkIntervalMinutes, noticeDaysBefore: task.noticeDaysBefore, noticeLocalTime: task.noticeLocalTime, ...task.targets });
const taskErrorKey = (error: unknown): TranslationKey => {
  const code = error instanceof ApiError ? error.code : typeof error === 'string' ? error : '';
  if (code === 'MONITOR_SOURCE_REQUIRED') return 'monitorErrorSourceRequired';
  if (code === 'MONITOR_SOURCE_AMBIGUOUS') return 'monitorErrorSourceAmbiguous';
  if (code === 'AI_ENDPOINT_BLOCKED' || code === 'AI_ENDPOINT_INVALID') return 'monitorErrorSourceBlocked';
  if (code === 'MONITOR_SOURCE_UNSUPPORTED' || code === 'MONITOR_SOURCE_TOO_LARGE') return 'monitorErrorSourceFormat';
  if (code === 'MONITOR_SOURCE_UNAVAILABLE') return 'monitorErrorSourceUnavailable';
  if (code === 'MONITOR_SOURCE_TIMEOUT') return 'monitorErrorSourceTimeout';
  if (code === 'MONITOR_TOOL_INVALID') return 'monitorErrorSourceExplore';
  if (code === 'MONITOR_TOOL_LIMIT') return 'monitorErrorSourceLimit';
  if (code.includes('TIMEOUT') || code === 'OFFLINE') return 'monitorErrorTimeout';
  if (['AI_DISABLED', 'AI_CONFIGURATION_INVALID', 'AI_NOT_CONFIGURED', 'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_MISMATCH', 'AI_CREDENTIAL_INVALID'].includes(code)) return 'monitorErrorSetup';
  if (code === 'AI_RESPONSE_INVALID' || code === 'MONITOR_INTERPRETATION_INVALID') return 'monitorErrorInterpretation';
  if (code === 'REVISION_CONFLICT' || code === 'CONFLICT') return 'monitorErrorConflict';
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED' || code === 'MONITOR_OWNER_UNAUTHORIZED') return 'monitorErrorPermission';
  return 'monitorErrorGeneric';
};

export function MonitorsPanel({ householdId, timezone, people, displays }: { householdId: string; timezone: string; people: Person[]; displays: Display[] }) {
  const { t, locale } = useI18n();
  const base = `/households/${householdId}/monitors`;
  const [tasks, setTasks] = useState<MonitorTask[]>();
  const [editing, setEditing] = useState<MonitorTask | null | undefined>();
  const [draft, setDraft] = useState<Draft>(() => empty(displays));
  const [error, setError] = useState<{ taskId?: string; value: unknown }>();
  const [busy, setBusy] = useState<string>();
  const [focus, setFocus] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [results, setResults] = useState<Record<string, { action: Action; value: MonitorRunResult }>>({});
  const [deleting, setDeleting] = useState<string>();
  const load = useCallback(async () => setTasks((await api<{ tasks: MonitorTask[] }>(base)).tasks), [base]);
  useEffect(() => { void load().catch((value) => setError({ value })); }, [load]);
  useEffect(() => {
    if (!focus || busy) return;
    const target = document.getElementById(focus);
    if (target) { target.focus(); setFocus(undefined); }
  }, [focus, busy, tasks, editing, error, results, deleting]);
  const beginEdit = (task: MonitorTask | null) => { setEditing(task); setDraft(task ? fromTask(task) : empty(displays)); setError(undefined); setFocus('monitor-instruction'); };
  const fail = (value: unknown, taskId?: string) => { setError({ value, taskId }); setFocus(taskId ? `monitor-error-${taskId}` : 'monitor-error'); };
  const submit = async () => {
    if (busy) return;
    setBusy('form'); setError(undefined);
    let saved: MonitorTask | undefined;
    try {
      const body = { instruction: draft.instruction, ...(draft.name.trim() ? { name: draft.name.trim() } : {}), ...(draft.sourceUrl.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}), checkIntervalMinutes: draft.checkIntervalMinutes, noticeDaysBefore: draft.noticeDaysBefore, noticeLocalTime: draft.noticeLocalTime, targets: { personIds: draft.personIds, displayIds: draft.displayIds } };
      saved = editing ? await api<MonitorTask>(`${base}/${editing.id}`, 'PATCH', { ...body, expectedRevision: editing.revision }, actionOptions) : await api<MonitorTask>(base, 'POST', body, actionOptions);
      setResults((current) => { const next = { ...current }; delete next[saved!.id]; return next; });
      setEditing(undefined);
      // Keep the saved draft accessible if interpretation fails; never create it twice.
      await api(`${base}/${saved.id}/interpret`, 'POST', { expectedRevision: saved.revision }, actionOptions);
      setFocus(`monitor-preview-${saved.id}`); setAnnouncement(t('monitorReady'));
    } catch (value) { fail(value, saved?.id); }
    finally { await load().catch((value) => fail(value)); setBusy(undefined); }
  };
  const action = async (task: MonitorTask, name: Action, quality?: 'standard' | 'smarter') => {
    if (busy) return;
    setBusy(task.id); setError(undefined); setAnnouncement(t('monitorWorking'));
    try {
      const result = await api<MonitorRunResult>(`${base}/${task.id}/${name}`, 'POST', { expectedRevision: task.revision, ...(quality ? { quality } : {}) }, actionOptions);
      if (name === 'interpret') setResults((current) => { const next = { ...current }; delete next[task.id]; return next; });
      if (name === 'test' || name === 'run' || name === 'smarter') {
        setResults((current) => ({ ...current, [task.id]: { action: name, value: result } })); setFocus(`monitor-result-${task.id}`);
      } else { setFocus(name === 'interpret' ? `monitor-preview-${task.id}` : `monitor-card-${task.id}`); }
      await load(); setAnnouncement(t('monitorActionDone'));
    } catch (value) { fail(value, task.id); }
    finally { setBusy(undefined); }
  };
  const remove = async (task: MonitorTask) => {
    setBusy(task.id); setError(undefined);
    try { await api(`${base}/${task.id}`, 'DELETE', { expectedRevision: task.revision }, actionOptions); await load(); setDeleting(undefined); setFocus('monitor-title'); setAnnouncement(t('monitorDeleted')); }
    catch (value) { fail(value, task.id); }
    finally { setBusy(undefined); }
  };
  const toggle = (key: 'personIds' | 'displayIds', id: string) => setDraft((value) => ({ ...value, [key]: value[key].includes(id) ? value[key].filter((item) => item !== id) : [...value[key], id] }));
  const names = (task: MonitorTask) => [...people.filter((p) => task.targets.personIds.includes(p.id)).map((p) => p.display_name), ...displays.filter((d) => task.targets.displayIds.includes(d.id)).map((d) => d.name)].join(', ') || t('monitorRuleNone');
  const list = (values: string[]) => values.join(', ') || t('monitorRuleNone');
  const errorNotice = (taskId?: string) => error && error.taskId === taskId ? <div className="notice error monitor-error" id={taskId ? `monitor-error-${taskId}` : 'monitor-error'} tabIndex={-1} role="alert">{t(taskErrorKey(error.value))}</div> : null;
  const findings = (events: MonitorTask['events']) => events.length ? events.map((event, index) => <div className="monitor-finding" key={`${event.date}:${index}`}><strong>{event.date}{event.time ? ` ${event.time.slice(0, 5)}` : ''} · {event.description}</strong>{event.actions.length > 0 && <p>{event.actions.join(' · ')}</p>}{event.who.length > 0 && <p>{event.who.join(', ')}</p>}<blockquote>{event.evidence.quote}</blockquote><a href={event.evidence.sourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a>{event.uncertainty && <p>{t('monitorUncertainty')}: {event.uncertainty}</p>}</div>) : <p>{t('monitorNoEvents')}</p>;
  if (!tasks) return <section className="monitor-page">{errorNotice()}{error ? <button className="button" onClick={() => void load().then(() => setError(undefined)).catch((value) => fail(value))}>{t('retry')}</button> : <Loading />}</section>;
  return <section className="monitor-page" aria-labelledby="monitor-title">
    <header className="section-heading"><div><p className="eyebrow">{t('monitorEyebrow')}</p><h1 id="monitor-title" tabIndex={-1}>{t('monitors')}</h1><p>{t('monitorBody')}</p></div><button className="button primary" disabled={Boolean(busy)} onClick={() => beginEdit(null)}><Icon name="plus" />{t('monitorNew')}</button></header>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {errorNotice()}
    {editing !== undefined && <form className="surface-card form-stack monitor-form" aria-busy={busy === 'form'} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2>{editing ? t('monitorEdit') : t('monitorQuestion')}</h2>
      {editing && <p>{t('monitorEditHint')}</p>}
      <fieldset disabled={Boolean(busy)} className="form-stack">
        <div className="field"><label htmlFor="monitor-instruction">{t('monitorInstruction')}</label><textarea id="monitor-instruction" aria-describedby="monitor-instruction-hint" required minLength={10} maxLength={2000} rows={4} value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} /><small id="monitor-instruction-hint">{t('monitorInstructionHint')}</small></div>
        <details open={Boolean(editing)} className="monitor-options"><summary>{t('monitorOptionalDetails')}</summary><div className="form-stack">
          <Field label={t('monitorSource')} hint={t('monitorSourceHint')}><input type="url" maxLength={2048} value={draft.sourceUrl} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} /></Field>
          <Field label={t('monitorName')}><input maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <div className="form-grid"><Field label={t('monitorFrequency')}><select value={draft.checkIntervalMinutes} onChange={(e) => setDraft({ ...draft, checkIntervalMinutes: Number(e.target.value) })}>{![60, 360, 1440, 10080].includes(draft.checkIntervalMinutes) && <option value={draft.checkIntervalMinutes}>{t('monitorRuleScheduleValue', { minutes: draft.checkIntervalMinutes })}</option>}<option value={60}>{t('monitorHourly')}</option><option value={360}>{t('monitorSixHours')}</option><option value={1440}>{t('monitorDaily')}</option><option value={10080}>{t('monitorWeekly')}</option></select></Field><Field label={t('monitorDaysBefore')}><input type="number" min={0} max={30} required value={draft.noticeDaysBefore} onChange={(e) => setDraft({ ...draft, noticeDaysBefore: Number(e.target.value) })} /></Field><Field label={t('monitorNotice')}><input type="time" required value={draft.noticeLocalTime} onChange={(e) => setDraft({ ...draft, noticeLocalTime: e.target.value })} /></Field></div>
        </div></details>
        <fieldset><legend>{t('monitorRecipients')}</legend><div className="monitor-targets">{people.map((p) => <label key={p.id}><input type="checkbox" checked={draft.personIds.includes(p.id)} onChange={() => toggle('personIds', p.id)} />{p.display_name}</label>)}{displays.map((d) => <label key={d.id}><input type="checkbox" checked={draft.displayIds.includes(d.id)} onChange={() => toggle('displayIds', d.id)} />{d.name}</label>)}</div><p className="field-hint">{t('monitorRecipientsHint')}</p></fieldset>
        <div className="card-actions"><button className="button primary" disabled={!draft.personIds.length && !draft.displayIds.length}>{busy === 'form' ? t('monitorWorking') : t('monitorCreateSetup')}</button><button type="button" className="button" onClick={() => { setEditing(undefined); setFocus('monitor-title'); }}>{t('cancel')}</button></div>
      </fieldset>
    </form>}
    <div className="monitor-grid">{tasks.map((task) => {
      const preview = results[task.id] ?? (task.state !== 'draft' && task.latestResult ? { action: 'saved' as const, value: { ...task.latestResult, outcome: 'changed' as const } } : undefined);
      const visibleResult = preview?.value.outcome === 'unchanged' ? (task.state !== 'draft' ? task.latestResult : null) : preview?.value;
      const rule = task.interpretedRule;
      const resultSourceUrl = visibleResult?.result?.evidence?.sourceUrl ?? visibleResult?.sourceUrl ?? preview?.value.sourceUrl;
      const resultSources = [...new Map((visibleResult?.sources ?? []).map((source) => [source.sourceUrl, source])).values()];
      const observedAt = resultSources.find((source) => source.sourceUrl === resultSourceUrl)?.fetchedAt ?? visibleResult?.checkedAt ?? preview?.value.checkedAt;
      return <article className="surface-card monitor-card" key={task.id} id={`monitor-card-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-name-${task.id}`} aria-busy={busy === task.id}>
        <div className="card-top"><h2 id={`monitor-name-${task.id}`}>{task.name}</h2><span className={`monitor-state ${task.state}`}>{t(task.state === 'draft' ? rule ? 'monitorStateDraft' : 'monitorStateIncomplete' : task.state === 'active' ? 'monitorStateActive' : 'monitorStatePaused')}</span></div>
        <p>{task.instruction}</p><a className="monitor-source" href={task.sourceUrl} target="_blank" rel="noreferrer">{task.sourceUrl}</a>
        {rule && <div className="preview-panel" id={`monitor-preview-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-preview-title-${task.id}`}><p className="eyebrow" id={`monitor-preview-title-${task.id}`}>{t('monitorInterpretation')}</p><strong>{rule.summary}</strong><dl className="monitor-rule"><div><dt>{t('monitorResultType')}</dt><dd>{t(rule.resultKind === 'answer' ? 'monitorAnswer' : 'monitorEvents')}</dd></div>{rule.resultKind !== 'answer' && <div><dt>{t('monitorRuleEventTypes')}</dt><dd>{list(rule.eventTypes)}</dd></div>}<div><dt>{t('monitorRuleSchedule')}</dt><dd>{t('monitorRuleScheduleValue', { minutes: task.checkIntervalMinutes })}</dd></div>{rule.resultKind !== 'answer' && <div><dt>{t('monitorRuleNotice')}</dt><dd>{t('monitorRuleNoticeValue', { days: task.noticeDaysBefore, time: task.noticeLocalTime, timezone })}</dd></div>}<div><dt>{t('monitorRuleTargets')}</dt><dd>{names(task)}</dd></div></dl>{task.state === 'draft' && <p>{t('monitorApprovalHint')}</p>}</div>}
        {preview && <section className="monitor-result" id={`monitor-result-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-result-title-${task.id}`}><h3 id={`monitor-result-title-${task.id}`}>{t(preview.action === 'smarter' ? 'monitorSmarterResult' : preview.action === 'test' ? 'monitorTestResult' : 'monitorLastResult')}</h3><>{preview.action !== 'saved' && <p className="field-hint">{t(preview.action === 'run' ? 'monitorRunPreservesSchedule' : 'monitorPreviewHint')}</p>}</>{preview.value.outcome === 'unchanged' && <p>{t('monitorResultUnchanged')}</p>}{visibleResult?.resultKind === 'answer' ? <><p className="monitor-answer">{visibleResult.result?.answer}</p>{visibleResult.result?.evidence && <blockquote>{visibleResult.result.evidence.quote}</blockquote>}{visibleResult.result?.uncertainty && <p>{t('monitorUncertainty')}: {visibleResult.result.uncertainty}</p>}</> : visibleResult?.resultKind === 'events' ? findings(visibleResult.result?.events ?? []) : null}<a className="monitor-result-source" href={resultSourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a><small className="monitor-observed-at">{t('monitorSourceChecked')} <time dateTime={observedAt}>{formatDate(observedAt!, locale, timezone)}</time></small>{resultSources.length > 1 && <details className="monitor-sources"><summary>{t('monitorSourcesUsed')}</summary><ul>{resultSources.map((source) => <li key={source.sourceUrl}><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a><small>{t('monitorSourceChecked')} <time dateTime={source.fetchedAt}>{formatDate(source.fetchedAt, locale, timezone)}</time></small></li>)}</ul></details>}{preview.action === 'smarter' && task.state !== 'draft' && <><p>{t('monitorSmarterChoice')}</p><div className="card-actions"><button disabled={Boolean(busy)} onClick={() => void action(task, 'quality', 'smarter')}>{t('monitorKeepSmarter')}</button><button disabled={Boolean(busy)} onClick={() => void action(task, 'quality', 'standard')}>{t('monitorKeepStandard')}</button></div></>}</section>}
        {!preview && task.state !== 'draft' && task.events.length > 0 && <details className="monitor-findings"><summary>{t('monitorFindings', { count: task.events.length })}</summary>{findings(task.events)}</details>}
        {!preview && task.state !== 'draft' && task.lastResult && !/^(\d+) event\(s\)$|^unchanged$|^failed$/.test(task.lastResult) && <section className="monitor-result"><h3>{t('monitorLastResult')}</h3><p className="monitor-answer">{task.lastResult}</p><a href={task.source?.finalUrl || task.sourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a></section>}
        <dl className="monitor-meta"><div><dt>{t('monitorNext')}</dt><dd>{task.nextCheckAt ? formatDate(task.nextCheckAt, locale, timezone) : '—'}</dd></div><div><dt>{t('monitorLastCheck')}</dt><dd>{task.lastCheckedAt ? formatDate(task.lastCheckedAt, locale, timezone) : '—'}</dd></div><div><dt>{t('monitorQuality')}</dt><dd>{t(task.modelTier === 'strong' ? 'monitorSmarter' : 'monitorStandard')}</dd></div></dl>
        <p className="monitor-stats">{t('monitorStats', { checks: task.stats.checks, ai: task.stats.aiCalls })}</p>
        {errorNotice(task.id)}{task.errorCode && error?.taskId !== task.id && <p className="notice error">{t(taskErrorKey(task.errorCode))}</p>}
        <div className="card-actions">
          {task.state === 'draft' && !rule && <button disabled={Boolean(busy)} onClick={() => void action(task, 'interpret')}>{t('monitorCreateSetup')}</button>}
          {rule && <button className="button primary" disabled={Boolean(busy)} onClick={() => void action(task, task.state === 'active' ? 'run' : 'test')}>{busy === task.id ? t('monitorWorking') : t(task.state === 'active' ? 'monitorRunNow' : 'monitorTestNow')}</button>}
          {task.state === 'draft' && rule && <button disabled={Boolean(busy)} onClick={() => void action(task, 'approve')}>{t('monitorApprove')}</button>}
          {rule && <button disabled={Boolean(busy)} onClick={() => void action(task, 'smarter')}>{t('monitorTrySmarter')}</button>}
          <button disabled={Boolean(busy)} onClick={() => beginEdit(task)}>{t('edit')}</button>
          {task.state === 'active' && <button disabled={Boolean(busy)} onClick={() => void action(task, 'pause')}>{t('monitorPause')}</button>}
          {task.state === 'paused' && <button disabled={Boolean(busy)} onClick={() => void action(task, 'resume')}>{t('monitorResume')}</button>}
          <button disabled={Boolean(busy)} onClick={() => { setDeleting(task.id); setFocus(`monitor-delete-${task.id}`); }}>{t('delete')}</button>
        </div>
        {deleting === task.id && <div className="notice monitor-delete" id={`monitor-delete-${task.id}`} tabIndex={-1}><p>{t('monitorDeleteConfirm')}</p><div className="card-actions"><button disabled={Boolean(busy)} onClick={() => void remove(task)}>{t('monitorDeleteYes')}</button><button disabled={Boolean(busy)} onClick={() => { setDeleting(undefined); setFocus(`monitor-card-${task.id}`); }}>{t('cancel')}</button></div></div>}
      </article>;
    })}</div>
    {!tasks.length && editing === undefined && <p className="surface-card">{t('monitorEmpty')}</p>}
  </section>;
}
