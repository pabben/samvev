import { useCallback, useEffect, useRef, useState } from "react";
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
  if (code === 'MONITOR_RUNNING') return 'monitorErrorRunning';
  if (code === 'MONITOR_SETUP_REQUIRED') return 'monitorErrorSetupRequired';
  if (code === 'MONITOR_TARGET_INVALID') return 'monitorErrorTargets';
  if (code === 'NOT_FOUND') return 'monitorErrorNotFound';
  if (code === 'AI_DISABLED') return 'monitorErrorAiDisabled';
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
  const [formBusy, setFormBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState<Record<string, boolean>>({});
  const pending = useRef(new Set<string>());
  const formOwner = useRef<symbol | null>(null);
  const loadVersion = useRef(0);
  const [focus, setFocus] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [results, setResults] = useState<Record<string, { action: Action; value: MonitorRunResult }>>({});
  const [deleting, setDeleting] = useState<string>();
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const response = await api<{ tasks: MonitorTask[] }>(base);
    if (version === loadVersion.current) setTasks(response.tasks);
  }, [base]);
  const markBusy = (id: string, value: boolean) => {
    if (value) pending.current.add(id); else pending.current.delete(id);
    setTaskBusy((current) => ({ ...current, [id]: value }));
  };
  const upsert = (task: MonitorTask) => {
    ++loadVersion.current;
    setTasks((current) => current?.some((item) => item.id === task.id) ? current.map((item) => item.id === task.id ? task : item) : [task, ...(current ?? [])]);
  };
  const hasRunning = tasks?.some((task) => task.lifecycle.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void load().catch((value) => setError({ value })).finally(() => { polling = false; });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasRunning, load]);
  useEffect(() => { void load().catch((value) => setError({ value })); }, [load]);
  useEffect(() => {
    if (!focus || formBusy) return;
    const target = document.getElementById(focus);
    if (target) { target.focus(); setFocus(undefined); }
  }, [focus, formBusy, tasks, editing, error, results, deleting]);
  const beginEdit = (task: MonitorTask | null) => { setEditing(task); setDraft(task ? fromTask(task) : empty(displays)); setError(undefined); setFocus('monitor-instruction'); };
  const fail = (value: unknown, taskId?: string) => { setError({ value, taskId }); setFocus(taskId ? `monitor-error-${taskId}` : 'monitor-error'); };
  const submit = async () => {
    if (formOwner.current || (editing && pending.current.has(editing.id))) return;
    const owner = Symbol('monitor-submit');
    formOwner.current = owner; setFormBusy(true); setError(undefined);
    // Interpretation outlives the form. Its cleanup must not unlock a later save.
    const releaseForm = () => {
      if (formOwner.current !== owner) return;
      formOwner.current = null; setFormBusy(false);
    };
    let saved: MonitorTask | undefined;
    const editingId = editing?.id;
    if (editingId) markBusy(editingId, true);
    try {
      const body = { instruction: draft.instruction, ...(draft.name.trim() ? { name: draft.name.trim() } : {}), ...(draft.sourceUrl.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}), checkIntervalMinutes: draft.checkIntervalMinutes, noticeDaysBefore: draft.noticeDaysBefore, noticeLocalTime: draft.noticeLocalTime, targets: { personIds: draft.personIds, displayIds: draft.displayIds } };
      saved = editing ? await api<MonitorTask>(`${base}/${editing.id}`, 'PATCH', { ...body, expectedRevision: editing.revision }, actionOptions) : await api<MonitorTask>(base, 'POST', body, actionOptions);
      upsert(saved); markBusy(saved.id, true);
      setResults((current) => { const next = { ...current }; delete next[saved!.id]; return next; });
      setEditing(undefined); releaseForm();
      setFocus(`monitor-card-${saved.id}`); setAnnouncement(t('monitorWorking'));
      // The durable draft stays visible and recoverable while setup is running.
      await api(`${base}/${saved.id}/interpret`, 'POST', { expectedRevision: saved.revision }, actionOptions);
      await load(); setFocus(`monitor-preview-${saved.id}`); setAnnouncement(t('monitorReady'));
    } catch (value) { await load().catch(() => undefined); fail(value, saved?.id); }
    finally { if (saved) markBusy(saved.id, false); if (editingId) markBusy(editingId, false); releaseForm(); }
  };
  const action = async (task: MonitorTask, name: Action, quality?: 'standard' | 'smarter') => {
    if (pending.current.has(task.id) || !task.lifecycle.actions[name].enabled) return;
    markBusy(task.id, true); setError(undefined); setFocus(`monitor-card-${task.id}`); setAnnouncement(t('monitorWorking'));
    try {
      const result = await api<MonitorRunResult>(`${base}/${task.id}/${name}`, 'POST', { expectedRevision: task.revision, ...(quality ? { quality } : {}) }, actionOptions);
      if (name === 'interpret') setResults((current) => { const next = { ...current }; delete next[task.id]; return next; });
      if (name === 'test' || name === 'run' || name === 'smarter') {
        setResults((current) => ({ ...current, [task.id]: { action: name, value: result } })); setFocus(`monitor-result-${task.id}`);
      } else { setFocus(name === 'interpret' ? `monitor-preview-${task.id}` : `monitor-card-${task.id}`); }
      await load(); setAnnouncement(t('monitorActionDone'));
    } catch (value) { await load().catch(() => undefined); fail(value, value instanceof ApiError && value.code === 'NOT_FOUND' ? undefined : task.id); }
    finally { markBusy(task.id, false); }
  };
  const remove = async (task: MonitorTask) => {
    if (pending.current.has(task.id) || !task.lifecycle.actions.delete.enabled) return;
    markBusy(task.id, true); setError(undefined); setFocus(`monitor-card-${task.id}`);
    try {
      await api(`${base}/${task.id}`, 'DELETE', { expectedRevision: task.revision }, actionOptions);
      ++loadVersion.current; setTasks((current) => current?.filter((item) => item.id !== task.id));
      setDeleting(undefined); setFocus('monitor-title'); setAnnouncement(t('monitorDeleted'));
    } catch (value) {
      await load().catch(() => undefined);
      const missing = value instanceof ApiError && value.code === 'NOT_FOUND';
      if (missing) setDeleting(undefined);
      fail(value, missing ? undefined : task.id);
    } finally { markBusy(task.id, false); }
  };
  const toggle = (key: 'personIds' | 'displayIds', id: string) => setDraft((value) => ({ ...value, [key]: value[key].includes(id) ? value[key].filter((item) => item !== id) : [...value[key], id] }));
  const names = (task: MonitorTask) => [...people.filter((p) => task.targets.personIds.includes(p.id)).map((p) => p.display_name), ...displays.filter((d) => task.targets.displayIds.includes(d.id)).map((d) => d.name)].join(', ') || t('monitorRuleNone');
  const list = (values: string[]) => values.join(', ') || t('monitorRuleNone');
  const errorNotice = (taskId?: string) => error && error.taskId === taskId ? <div className="notice error monitor-error" id={taskId ? `monitor-error-${taskId}` : 'monitor-error'} tabIndex={-1} role="alert">{t(taskErrorKey(error.value))}</div> : null;
  const findings = (events: MonitorTask['events']) => events.length ? events.map((event, index) => <div className="monitor-finding" key={`${event.date}:${index}`}><strong>{event.date}{event.time ? ` ${event.time.slice(0, 5)}` : ''} · {event.description}</strong>{event.actions.length > 0 && <p>{event.actions.join(' · ')}</p>}{event.who.length > 0 && <p>{event.who.join(', ')}</p>}<blockquote>{event.evidence.quote}</blockquote><a href={event.evidence.sourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a>{event.uncertainty && <p>{t('monitorUncertainty')}: {event.uncertainty}</p>}</div>) : <p>{t('monitorNoEvents')}</p>;
  if (!tasks) return <section className="monitor-page">{errorNotice()}{error ? <button className="button" onClick={() => void load().then(() => setError(undefined)).catch((value) => fail(value))}>{t('retry')}</button> : <Loading />}</section>;
  return <section className="monitor-page" aria-labelledby="monitor-title">
    <header className="section-heading"><div><p className="eyebrow">{t('monitorEyebrow')}</p><h1 id="monitor-title" tabIndex={-1}>{t('monitors')}</h1><p>{t('monitorBody')}</p></div><button className="button primary" disabled={formBusy} onClick={() => beginEdit(null)}><Icon name="plus" />{t('monitorNew')}</button></header>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {errorNotice()}
    {editing !== undefined && <form className="surface-card form-stack monitor-form" aria-busy={formBusy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2>{editing ? t('monitorEdit') : t('monitorQuestion')}</h2>
      {editing && <p>{t('monitorEditHint')}</p>}
      <fieldset disabled={formBusy} className="form-stack">
        <div className="field"><label htmlFor="monitor-instruction">{t('monitorInstruction')}</label><textarea id="monitor-instruction" aria-describedby="monitor-instruction-hint" required minLength={10} maxLength={2000} rows={4} value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} /><small id="monitor-instruction-hint">{t('monitorInstructionHint')}</small></div>
        <details open={Boolean(editing)} className="monitor-options"><summary>{t('monitorOptionalDetails')}</summary><div className="form-stack">
          <Field label={t('monitorSource')} hint={t('monitorSourceHint')}><input type="url" maxLength={2048} value={draft.sourceUrl} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} /></Field>
          <Field label={t('monitorName')}><input maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <div className="form-grid"><Field label={t('monitorFrequency')}><select value={draft.checkIntervalMinutes} onChange={(e) => setDraft({ ...draft, checkIntervalMinutes: Number(e.target.value) })}>{![60, 360, 1440, 10080].includes(draft.checkIntervalMinutes) && <option value={draft.checkIntervalMinutes}>{t('monitorRuleScheduleValue', { minutes: draft.checkIntervalMinutes })}</option>}<option value={60}>{t('monitorHourly')}</option><option value={360}>{t('monitorSixHours')}</option><option value={1440}>{t('monitorDaily')}</option><option value={10080}>{t('monitorWeekly')}</option></select></Field><Field label={t('monitorDaysBefore')}><input type="number" min={0} max={30} required value={draft.noticeDaysBefore} onChange={(e) => setDraft({ ...draft, noticeDaysBefore: Number(e.target.value) })} /></Field><Field label={t('monitorNotice')}><input type="time" required value={draft.noticeLocalTime} onChange={(e) => setDraft({ ...draft, noticeLocalTime: e.target.value })} /></Field></div>
        </div></details>
        <fieldset><legend>{t('monitorRecipients')}</legend><div className="monitor-targets">{people.map((p) => <label key={p.id}><input type="checkbox" checked={draft.personIds.includes(p.id)} onChange={() => toggle('personIds', p.id)} />{p.display_name}</label>)}{displays.map((d) => <label key={d.id}><input type="checkbox" checked={draft.displayIds.includes(d.id)} onChange={() => toggle('displayIds', d.id)} />{d.name}</label>)}</div><p className="field-hint">{t('monitorRecipientsHint')}</p></fieldset>
        <div className="card-actions"><button className="button primary" disabled={!draft.personIds.length && !draft.displayIds.length}>{formBusy ? t('monitorWorking') : t('monitorCreateSetup')}</button><button type="button" className="button" onClick={() => { setEditing(undefined); setFocus('monitor-title'); }}>{t('cancel')}</button></div>
      </fieldset>
    </form>}
    <div className="monitor-grid">{tasks.map((task) => {
      const preview = results[task.id] ?? (task.state !== 'draft' && task.latestResult ? { action: 'saved' as const, value: { ...task.latestResult, outcome: 'changed' as const } } : undefined);
      const visibleResult = preview?.value.outcome === 'unchanged' ? (task.state !== 'draft' ? task.latestResult : null) : preview?.value;
      const lifecycle = task.lifecycle;
      const working = Boolean(taskBusy[task.id]) || lifecycle.status === 'running';
      const can = (name: keyof typeof lifecycle.actions) => !working && lifecycle.actions[name].enabled;
      const rule = lifecycle.setupComplete ? task.interpretedRule : null;
      const statusKey: TranslationKey = working ? 'monitorStateRunning' : ({ incomplete: 'monitorStateIncomplete', setup_failed: 'monitorStateSetupFailed', ready_for_approval: 'monitorStateDraft', active: 'monitorStateActive', paused: 'monitorStatePaused', running: 'monitorStateRunning' } as const)[lifecycle.status];
      const blockedReason = (reason: string | null): TranslationKey => reason === 'permission_denied' ? 'monitorErrorPermission' : reason === 'targets_invalid' ? 'monitorErrorTargets' : reason === 'running' ? 'monitorErrorRunning' : 'monitorErrorSetupRequired';
      const resultSourceUrl = visibleResult?.result?.evidence?.sourceUrl ?? visibleResult?.sourceUrl ?? preview?.value.sourceUrl;
      const resultSources = [...new Map((visibleResult?.sources ?? []).map((source) => [source.sourceUrl, source])).values()];
      const observedAt = resultSources.find((source) => source.sourceUrl === resultSourceUrl)?.fetchedAt ?? visibleResult?.checkedAt ?? preview?.value.checkedAt;
      return <article className="surface-card monitor-card" key={task.id} id={`monitor-card-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-name-${task.id}`} aria-busy={working}>
        <div className="card-top"><h2 id={`monitor-name-${task.id}`}>{task.name}</h2><span className={`monitor-state ${task.state}`}>{t(statusKey)}</span></div>
        <p>{task.instruction}</p><a className="monitor-source" href={task.sourceUrl} target="_blank" rel="noreferrer">{task.sourceUrl}</a>
        {rule && <div className="preview-panel" id={`monitor-preview-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-preview-title-${task.id}`}><p className="eyebrow" id={`monitor-preview-title-${task.id}`}>{t('monitorInterpretation')}</p><strong>{rule.summary}</strong><dl className="monitor-rule"><div><dt>{t('monitorResultType')}</dt><dd>{t(rule.resultKind === 'answer' ? 'monitorAnswer' : 'monitorEvents')}</dd></div>{rule.resultKind !== 'answer' && <div><dt>{t('monitorRuleEventTypes')}</dt><dd>{list(rule.eventTypes)}</dd></div>}<div><dt>{t('monitorRuleSchedule')}</dt><dd>{t('monitorRuleScheduleValue', { minutes: task.checkIntervalMinutes })}</dd></div>{rule.resultKind !== 'answer' && <div><dt>{t('monitorRuleNotice')}</dt><dd>{t('monitorRuleNoticeValue', { days: task.noticeDaysBefore, time: task.noticeLocalTime, timezone })}</dd></div>}<div><dt>{t('monitorRuleTargets')}</dt><dd>{names(task)}</dd></div></dl>{task.state === 'draft' && <p>{t('monitorApprovalHint')}</p>}</div>}
        {preview && <section className="monitor-result" id={`monitor-result-${task.id}`} tabIndex={-1} aria-labelledby={`monitor-result-title-${task.id}`}><h3 id={`monitor-result-title-${task.id}`}>{t(preview.action === 'smarter' ? 'monitorSmarterResult' : preview.action === 'test' ? 'monitorTestResult' : 'monitorLastResult')}</h3><>{preview.action !== 'saved' && <p className="field-hint">{t(preview.action === 'run' ? 'monitorRunPreservesSchedule' : 'monitorPreviewHint')}</p>}</>{preview.value.outcome === 'unchanged' && <p>{t('monitorResultUnchanged')}</p>}{visibleResult?.resultKind === 'answer' ? <><p className="monitor-answer">{visibleResult.result?.answer}</p>{visibleResult.result?.evidence && <blockquote>{visibleResult.result.evidence.quote}</blockquote>}{visibleResult.result?.uncertainty && <p>{t('monitorUncertainty')}: {visibleResult.result.uncertainty}</p>}</> : visibleResult?.resultKind === 'events' ? findings(visibleResult.result?.events ?? []) : null}<a className="monitor-result-source" href={resultSourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a><small className="monitor-observed-at">{t('monitorSourceChecked')} <time dateTime={observedAt}>{formatDate(observedAt!, locale, timezone)}</time></small>{resultSources.length > 1 && <details className="monitor-sources"><summary>{t('monitorSourcesUsed')}</summary><ul>{resultSources.map((source) => <li key={source.sourceUrl}><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a><small>{t('monitorSourceChecked')} <time dateTime={source.fetchedAt}>{formatDate(source.fetchedAt, locale, timezone)}</time></small></li>)}</ul></details>}{preview.action === 'smarter' && task.state !== 'draft' && <><p>{t('monitorSmarterChoice')}</p><div className="card-actions"><button disabled={!can('quality')} onClick={() => void action(task, 'quality', 'smarter')}>{t('monitorKeepSmarter')}</button><button disabled={!can('quality')} onClick={() => void action(task, 'quality', 'standard')}>{t('monitorKeepStandard')}</button></div></>}</section>}
        {!preview && task.state !== 'draft' && task.events.length > 0 && <details className="monitor-findings"><summary>{t('monitorFindings', { count: task.events.length })}</summary>{findings(task.events)}</details>}
        {!preview && task.state !== 'draft' && task.lastResult && !/^(\d+) event\(s\)$|^unchanged$|^failed$/.test(task.lastResult) && <section className="monitor-result"><h3>{t('monitorLastResult')}</h3><p className="monitor-answer">{task.lastResult}</p><a href={task.source?.finalUrl || task.sourceUrl} target="_blank" rel="noreferrer">{t('monitorOpenSource')}</a></section>}
        <dl className="monitor-meta"><div><dt>{t('monitorNext')}</dt><dd>{task.nextCheckAt ? formatDate(task.nextCheckAt, locale, timezone) : '—'}</dd></div><div><dt>{t('monitorLastCheck')}</dt><dd>{task.lastCheckedAt ? formatDate(task.lastCheckedAt, locale, timezone) : '—'}</dd></div><div><dt>{t('monitorQuality')}</dt><dd>{t(task.modelTier === 'strong' ? 'monitorSmarter' : 'monitorStandard')}</dd></div></dl>
        <p className="monitor-stats">{t('monitorStats', { checks: task.stats.checks, ai: task.stats.aiCalls })}</p>
        {errorNotice(task.id)}{task.errorCode && error?.taskId !== task.id && <p className="notice error">{t(taskErrorKey(task.errorCode))}</p>}
        {working && <p className="notice" id={`monitor-working-${task.id}`} role="status">{t('monitorRunningHint')}</p>}
        {!working && lifecycle.status === 'incomplete' && <p className="field-hint">{t(lifecycle.actions.test.reason === 'targets_invalid' ? 'monitorErrorTargets' : 'monitorIncompleteHint')}</p>}
        {!working && lifecycle.status === 'setup_failed' && <p className="field-hint">{t('monitorSetupFailedHint')}</p>}
        {!working && lifecycle.status === 'ready_for_approval' && !can('approve') && <p className="notice" id={`monitor-approve-reason-${task.id}`}>{t(blockedReason(lifecycle.actions.approve.reason))}</p>}
        <div className="card-actions">
          {working ? <button onClick={() => void load().catch((value) => fail(value, task.id))}>{t('monitorRefresh')}</button> : <>
            {can('interpret') && !lifecycle.setupComplete && <button onClick={() => void action(task, 'interpret')}>{t(lifecycle.status === 'setup_failed' ? 'monitorRetrySetup' : 'monitorCreateSetup')}</button>}
            {can('run') && <button className="button primary" onClick={() => void action(task, 'run')}>{t('monitorRunNow')}</button>}
            {can('test') && <button className="button primary" onClick={() => void action(task, 'test')}>{t('monitorTestNow')}</button>}
            {lifecycle.status === 'ready_for_approval' && <button disabled={!can('approve')} aria-describedby={!can('approve') ? `monitor-approve-reason-${task.id}` : undefined} onClick={() => void action(task, 'approve')}>{t('monitorApprove')}</button>}
            {can('smarter') && <button onClick={() => void action(task, 'smarter')}>{t('monitorTrySmarter')}</button>}
            {can('edit') && <button disabled={formBusy} onClick={() => beginEdit(task)}>{t('edit')}</button>}
            {can('pause') && <button onClick={() => void action(task, 'pause')}>{t('monitorPause')}</button>}
            {can('resume') && <button onClick={() => void action(task, 'resume')}>{t('monitorResume')}</button>}
            {can('delete') && <button onClick={() => { setDeleting(task.id); setFocus(`monitor-delete-${task.id}`); }}>{t('delete')}</button>}
          </>}
        </div>
        {deleting === task.id && !working && <div className="notice monitor-delete" id={`monitor-delete-${task.id}`} tabIndex={-1}><p>{t('monitorDeleteConfirm')}</p><div className="card-actions"><button disabled={!can('delete')} onClick={() => void remove(task)}>{t('monitorDeleteYes')}</button><button onClick={() => { setDeleting(undefined); setFocus(`monitor-card-${task.id}`); }}>{t('cancel')}</button></div></div>}

      </article>;
    })}</div>
    {!tasks.length && editing === undefined && <p className="surface-card">{t('monitorEmpty')}</p>}
  </section>;
}
