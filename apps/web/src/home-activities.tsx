import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { dateOffset, memberHouseholdBoardAdapter, type DinnerAssignment } from "./household-board-adapters";
import type { CSSProperties } from "react";
import type { HomeBirthday, HomeSchoolActivity, HouseholdTimelineActivity, HubPerson } from "./home-types";
import { calendarActivityEnded, collectActivitySourcePages, dedupeTimelineActivities, homeWeekEnd, homeWeekStart, isTimelineActivityOngoing, mergeTimelineEntries, personFutureWindow, timelineActivityVisible, type GroupedSchoolActivity, type TimelineEntry } from "./home-activity-presentation";
import { CalendarFreshness } from "./calendar-freshness";
import { calendarParticipationKey } from "./calendar-provider-config";
import { formatCalendarEventRange, formatDate, wallInput } from "./time";
import { Avatar, Icon, useI18n } from "./ui";
import { personColorToken } from "./person-identity";

type ActivityPage = { activities: HouseholdTimelineActivity[]; nextCursor: string | null };
type ActivityWindow = ActivityPage & { from: string; to: string };
function activityQuery(householdId: string | undefined, from: string, to: string, personId?: string, cursor?: string, display = false, sourceId?: string) {
  const query = new URLSearchParams({ from, to, limit: "50" });
  if (personId) query.set("personIds", personId);
  if (cursor) query.set("cursor", cursor);
  if (sourceId && !display) query.set("sourceIds", sourceId);
  const path = display ? "/display/activities" : `/households/${encodeURIComponent(householdId ?? "")}/activities`;
  return api<ActivityWindow>(`${path}?${query}`);
}

function dateHeading(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
}
function clockLabel(value: string | null, allDay: string) { return value ? value.slice(0, 5) : allDay; }
function shortDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
}
function timeLabel(row: TimelineEntry, locale: string, zone: string, allDay: string, dinnerLabel="") {
  if (row.kind === "dinner") return dinnerLabel;
  if (row.kind === "school") return clockLabel(row.activity.time, allDay);
  if (row.activity.metadata.allDay) return allDay;
  return row.activity.startsAt ? formatDate(row.activity.startsAt, locale, zone, { hour: "2-digit", minute: "2-digit" }) : allDay;
}
function freshnessTimestamp(value:string|null|undefined,locale:string,zone:string){
  return value&&Number.isFinite(Date.parse(value))?formatDate(value,locale,zone,{dateStyle:"medium",timeStyle:"short"}):null;
}
function activityPeople(row: TimelineEntry, people: HubPerson[], family: string) {
  const ids = row.kind === "school" ? row.activity.personIds : row.kind === "calendar" ? row.activity.personIds : [];
  return ids.length ? people.filter(person => ids.includes(person.id)).map(person => person.displayName).join(" · ") : family;
}

export function SchoolActivityCard({ activity, people, compact = false, dateLabel, hideMeta = false, hideIcon = false, now, zone }: { activity: GroupedSchoolActivity | HomeSchoolActivity; people: HubPerson[]; compact?: boolean; dateLabel?: string; hideMeta?: boolean; hideIcon?: boolean; now?:number; zone?:string }) {
  const { t, locale } = useI18n();
  const names = "personIds" in activity ? people.filter(person => activity.personIds.includes(person.id)).map(person => person.displayName) : people.filter(person => person.id === activity.personId).map(person => person.displayName);
  const freshness=activity.freshness;
  const attemptDateLabel=freshnessTimestamp(freshness?.latestAttempt.at,locale,zone??"UTC");
  const verifiedDateLabel=freshnessTimestamp(freshness?.verifiedAt,locale,zone??"UTC");
  const failed=freshness?.latestAttempt.outcome==='failed';
  let freshnessMessage:string|undefined;
  if(freshness?.state==='retained'){
    if(failed) freshnessMessage=verifiedDateLabel
      ?t("hubSchoolRetainedFailedVerified",{attemptDate:attemptDateLabel??t("hubSchoolDateUnknown"),verifiedDate:verifiedDateLabel})
      :t(attemptDateLabel?"hubSchoolRetainedFailedUnverified":"hubSchoolRetainedFailedNoDates",attemptDateLabel?{attemptDate:attemptDateLabel}:{});
    else freshnessMessage=verifiedDateLabel?t("hubSchoolRetainedVerified",{date:verifiedDateLabel}):t("hubSchoolRetainedUnverified");
  }else if(freshness?.state==='unknown'){
    freshnessMessage=failed
      ?t(attemptDateLabel?"hubSchoolUnknownFailed":"hubSchoolUnknownFailedNoDate",attemptDateLabel?{attemptDate:attemptDateLabel}:{})
      :t("hubSchoolFreshnessUnknown");
  }
  return <article className={`hub-school-activity ${compact ? "is-compact" : ""}`} data-review-private="school-activity" data-school-event-id={activity.id}>
    <div className="hub-school-heading">{!compact&&!hideIcon&&<span className="hub-school-icon" aria-hidden="true">🎒</span>}<div><strong data-review-private="school-title">{activity.title}</strong>{now!==undefined&&Date.parse(activity.expiresAt)<=now&&<span className="hub-ended-label">{t("hubEnded")}</span>}{!hideMeta&&<span className="hub-school-meta">{dateLabel && <>{dateLabel} · </>}{clockLabel(activity.time, t("hubAllDay"))}{!compact&&names.length?` · ${names.join(" · ")}`:""}</span>}{freshnessMessage&&<span className={`hub-school-freshness ${freshness?.state==='retained'?'is-retained':'is-unknown'}`} role="status">{freshnessMessage}</span>}</div></div>
    {!!activity.actions.length && <ul className={`hub-school-actions ${compact ? "is-compact" : ""}`}>{(compact ? activity.actions.slice(0, 1) : activity.actions).map((action, index) => <li key={`${activity.id}-${index}`} data-review-private="school-action">{action}</li>)}</ul>}
    {!compact && <details className="hub-school-provenance">
      <summary>{t("hubSchoolDetails")}</summary>
      {typeof activity.evidence.quote === "string" && activity.evidence.quote && <p className="hub-school-evidence" data-review-private="school-evidence"><strong>{t("hubSchoolEvidence")}:</strong> {activity.evidence.quote}</p>}
      {activity.confidence !== null && <p className="field-hint">{t("hubSchoolConfidence", { value: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(activity.confidence) })}</p>}
      {activity.uncertainty && <p className="field-hint">{t("hubSchoolUncertainty", { value: activity.uncertainty })}</p>}
      {activity.recordedAt && <p className="field-hint">{t("hubSchoolRecorded", { date: formatDate(activity.recordedAt, locale, "UTC", { dateStyle: "medium" }) })}</p>}
      {freshness?.state==='verified'&&verifiedDateLabel&&<p className="field-hint">{t("hubSchoolVerified",{date:verifiedDateLabel})}</p>}
      {activity.sourceUrl && <a href={activity.sourceUrl} target="_blank" rel="noreferrer" data-review-private="school-source">{t("hubSchoolSource")} <Icon name="arrow" size={14}/></a>}
    </details>}
  </article>;
}

export function HouseholdActivityWeek({ householdId, localDate, zone, people, display = false, now = Date.now(), householdBoardsReadableDinners = true, showWeekCard = true, showNextActivity = true, onCurrentWeekDinners }: { householdId?: string; localDate: string; zone: string; people: HubPerson[]; display?: boolean; now?: number; householdBoardsReadableDinners?: boolean; showWeekCard?: boolean; showNextActivity?: boolean; onCurrentWeekDinners?: (dinners: DinnerAssignment[] | undefined, stale?: boolean) => void }) {
  const { t, locale } = useI18n();
  const adapter = useMemo(() => householdId ? memberHouseholdBoardAdapter(householdId) : null, [householdId]);
  // The current selection is a rolling household-local window from today
  // through Sunday. Future selections remain full Monday–Sunday weeks.
  const currentWeekStart = homeWeekStart(localDate);
  const [selectedWeekStart, setSelectedWeekStart] = useState(localDate);
  // Clamp a stale selection synchronously at household midnight, before the
  // reset effect runs and before any request can include prior dates.
  const weekStart = selectedWeekStart < localDate ? localDate : selectedWeekStart;
  const [personId, setPersonId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<{id:string;label:string}[]>([]);
  const [sourceCatalogError,setSourceCatalogError]=useState(false);
  const sourceCatalogGeneration=useRef(0);
  const [activities, setActivities] = useState<HouseholdTimelineActivity[]>([]);
  const [dinners, setDinners] = useState<DinnerAssignment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [nextActivity, setNextActivity] = useState<HouseholdTimelineActivity | null>(null);
  const [nextLoading, setNextLoading] = useState(false);
  const [nextError, setNextError] = useState(false);
  const generation = useRef(0);
  const nextGeneration = useRef(0);
  const dailyDinnerGeneration = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const isCurrentWindow = weekStart === localDate;
  const to = isCurrentWindow ? homeWeekEnd(localDate) : dateOffset(weekStart, 6);

  useEffect(() => {
    const generation=++sourceCatalogGeneration.current;
    let active=true;
    if(display||!householdId){setSources([]);setSourceId("");setSourceCatalogError(false);return()=>{active=false;sourceCatalogGeneration.current++;};}
    void (async()=>{
      try {
        const all=await collectActivitySourcePages(async(cursor)=>{const query=new URLSearchParams({limit:"100"});if(cursor)query.set("cursor",cursor);return api<{sources:{id:string;name:string}[];nextCursor:string|null}>(`/households/${encodeURIComponent(householdId)}/activities/sources?${query}`);},locale);
        if(active&&generation===sourceCatalogGeneration.current){const sorted=all.map(source=>({id:source.id,label:source.name}));setSources(sorted);setSourceCatalogError(false);setSourceId(current=>current&&sorted.some(source=>source.id===current)?current:"");}
      }catch(error){if(active&&generation===sourceCatalogGeneration.current){setSourceCatalogError(true);if(error instanceof ApiError&&[401,403,404].includes(error.status)){setSources([]);setSourceId("");}}}
    })();
    return()=>{active=false;sourceCatalogGeneration.current++;};
  },[display,householdId,locale,refreshTick]);

  useEffect(() => { const timer = setInterval(() => setRefreshTick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setSelectedWeekStart(localDate); setPersonId(""); setSourceId(""); setNextActivity(null); setShowNext(false);
    setActivities([]); setDinners([]); setCursor(null); setLoaded(false); setLoadingMore(false); setError(false);
    generation.current++; nextGeneration.current++;
  }, [householdId, localDate]);
  useEffect(() => {
    setActivities([]); setDinners([]); setCursor(null); setLoaded(false); setLoadingMore(false); setError(false);
    generation.current++; nextGeneration.current++;
  }, [householdId, weekStart, personId, sourceId, display]);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setLoading(true); if (refreshTick) setLoadingMore(false);
    const canReadDinners = !display || householdBoardsReadableDinners;
    const dinnersRequest = !canReadDinners ? Promise.resolve({assignments: [] as DinnerAssignment[]}) : display
      ? api<{assignments:DinnerAssignment[]}>(`/display/dinners?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(to)}`)
      : adapter ? adapter.listDinners({ from: weekStart, to }) : Promise.reject(new Error("Household scope is unavailable."));
    const weekRequest=showWeekCard?activityQuery(householdId, weekStart, to, personId || undefined, undefined, display, sourceId || undefined):Promise.resolve({activities:[] as HouseholdTimelineActivity[],nextCursor:null});
    void Promise.allSettled([weekRequest, dinnersRequest]).then(([activityResult, dinnerResult]) => {
      if (!active || request !== generation.current) return;
      if (activityResult.status === "fulfilled") { setActivities(dedupeTimelineActivities(activityResult.value.activities)); setCursor(activityResult.value.nextCursor); }
      if (dinnerResult.status === "fulfilled") {
        setDinners(dinnerResult.value.assignments);
      }
      const denied = (result: PromiseSettledResult<unknown>) => result.status === "rejected" && result.reason instanceof ApiError && [401, 403, 404].includes(result.reason.status);
      if (activityResult.status === "rejected") { setError(true); if (denied(activityResult)) { setActivities([]); setCursor(null); } }
      if (dinnerResult.status === "rejected") { setError(true); if (denied(dinnerResult)) setDinners([]); }
      if (activityResult.status === "fulfilled" && dinnerResult.status === "fulfilled") setError(false);
      if (activityResult.status === "fulfilled" || dinnerResult.status === "fulfilled") setLoaded(true);
    }).finally(() => { if (active && request === generation.current) setLoading(false); });
    return () => { active = false; generation.current++; };
  }, [householdId, adapter, weekStart, to, personId, sourceId, display, localDate, householdBoardsReadableDinners, showWeekCard, onCurrentWeekDinners, refreshTick]);

  // The two-day Home agenda is independent of the selected week and filters.
  // Keep its last successful data through transient network errors.
  useEffect(() => {
    let active = true;
    const request = ++dailyDinnerGeneration.current;
    const result = !householdBoardsReadableDinners ? Promise.resolve({assignments: [] as DinnerAssignment[]}) : display
      ? api<{assignments:DinnerAssignment[]}>(`/display/dinners?from=${encodeURIComponent(localDate)}&to=${encodeURIComponent(dateOffset(localDate, 1))}`)
      : adapter ? adapter.listDinners({from: localDate, to: dateOffset(localDate, 1)}) : Promise.reject(new Error("Household scope is unavailable."));
    void result.then(value => { if (active && request === dailyDinnerGeneration.current) onCurrentWeekDinners?.(value.assignments, false); }).catch(error => {
      if (!active || request !== dailyDinnerGeneration.current) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) onCurrentWeekDinners?.([], false);
      else onCurrentWeekDinners?.(undefined, true);
    });
    return () => { active = false; dailyDinnerGeneration.current++; };
  }, [adapter, display, householdBoardsReadableDinners, localDate, onCurrentWeekDinners, refreshTick]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setError(false);
    const request = generation.current;
    try { const page = await activityQuery(householdId, weekStart, to, personId || undefined, cursor, display, sourceId || undefined); if (request === generation.current) { setActivities(previous => dedupeTimelineActivities([...previous, ...page.activities])); setCursor(page.nextCursor); } }
    catch (error) { if (request === generation.current) { setError(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { setActivities([]); setCursor(null); } } }
    finally { if (request === generation.current) setLoadingMore(false); }
  };
  const loadNext = async () => {
    const request = ++nextGeneration.current;
    setNextLoading(true); setNextError(false);
    try {
      const query = new URLSearchParams(); if (personId) query.set("personIds", personId); if (sourceId && !display) query.set("sourceIds", sourceId);
      const suffix = query.toString() ? `?${query}` : "";
      const path = display ? "/display/activities/next" : `/households/${encodeURIComponent(householdId ?? "")}/activities/next`;
      const result = await api<{ activity: HouseholdTimelineActivity | null }>(`${path}${suffix}`);
      if (request === nextGeneration.current) setNextActivity(result.activity);
    } catch (error) { if (request === nextGeneration.current) { setNextError(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setNextActivity(null); } }
    finally { if (request === nextGeneration.current) setNextLoading(false); }
  };
  useEffect(() => {
    nextGeneration.current++; setNextError(false); setNextLoading(false);
    if (!showNextActivity) { setShowNext(false); setNextActivity(null); return () => { nextGeneration.current++; }; }
    if (showNext) void loadNext();
    return () => { nextGeneration.current++; };
  }, [householdId, personId, sourceId, weekStart, localDate, display, showNext, showNextActivity, refreshTick]);
  const entries = mergeTimelineEntries(activities, dinners, zone, weekStart, to);
  const currentNextActivity=nextActivity&&timelineActivityVisible(nextActivity,now,zone,true)?nextActivity:null;
  const currentWeekTitle = `${shortDate(weekStart, locale)} – ${shortDate(to, locale)}`;
  if(!showWeekCard)return null;
  return <section className={`hub-week hub-panel ${display?"hub-display-week":"hub-member-week"}`} aria-label={t("hubWeekTitle")} data-testid="home-activity-week">
    <header className="hub-week-heading"><div><h2><Icon name="calendar"/>{t(isCurrentWindow ? "hubWeekTitle" : "hubFutureWeekTitle")}</h2><p>{currentWeekTitle}</p></div><div className="hub-week-nav"><button className="hub-icon-button" type="button" aria-label={t("hubPreviousWeek")} disabled={weekStart <= localDate || loading} onClick={() => setSelectedWeekStart(value => dateOffset(value, -7))}><Icon name="back" size={16}/></button><button className="hub-icon-button" type="button" aria-label={t("hubNextWeek")} disabled={loading} onClick={() => setSelectedWeekStart(value => dateOffset(isCurrentWindow ? currentWeekStart : value, 7))}><Icon name="arrow" size={16}/></button></div></header>
    <label className="hub-week-person-filter">{t("hubWeekPersonFilter")}<select data-review-private="week-person-filter" value={personId} onChange={event => setPersonId(event.target.value)}><option value="">{t("hubWeekEveryone")}</option>{people.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
    {!display && sources.length > 0 && <label className="hub-week-source-filter">{t("hubWeekSourceFilter")}<select data-review-private="week-source-filter" value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">{t("hubWeekEverySource")}</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>}
    {sourceCatalogError&&<p className="hub-week-error" role="status">{t("hubWeekLoadError")}</p>}
    {error && <p className="hub-week-error" role="status">{t("hubWeekLoadError")}</p>}
    <HouseholdActivityWeekRows entries={entries} from={weekStart} to={to} people={people} zone={zone} locale={locale} now={now} loading={loading} loaded={loaded} error={error} cursor={cursor} loadingMore={loadingMore} onLoadMore={()=>void loadMore()}/>
    {showNextActivity&&<div className="hub-next-activity"><button type="button" className="hub-next-toggle" aria-expanded={showNext} onClick={() => { setShowNext(value => !value); if (!showNext && nextActivity === null) void loadNext(); }}><Icon name="arrow" size={16}/>{t("hubShowNext")}</button>
      {showNext && (nextLoading ? <p className="field-hint">{t("loading")}</p> : nextError ? <p role="status" className="hub-week-error">{t("hubWeekLoadError")} <button type="button" onClick={() => void loadNext()}>{t("retry")}</button></p> : currentNextActivity ? <><p className="hub-next-date" data-review-private="next-activity-date">{isTimelineActivityOngoing(currentNextActivity, localDate, now) ? `${t("hubOngoing")} · ` : ""}{dateHeading(currentNextActivity.type === "school" ? currentNextActivity.date : currentNextActivity.metadata.allDay ? currentNextActivity.startsAt?.slice(0,10) ?? "" : currentNextActivity.startsAt ? wallInput(currentNextActivity.startsAt, zone).slice(0,10) : "", locale)}</p><TimelineRow row={mergeTimelineEntries([currentNextActivity], [], zone)[0]!} people={people} family={t("hubFamily")} zone={zone} locale={locale} now={now}/></> : <p className="field-hint">{t("hubNextEmpty")}</p>)}
    </div>}
  </section>;
}

/** Shared server-projected week rows for live displays and read-only admin preview. */
export function HouseholdActivityWeekRows({entries,from,to,people,zone,locale,now,loading=false,loaded=true,error=false,cursor=null,loadingMore=false,onLoadMore,readOnly=false}:{entries:TimelineEntry[];from?:string;to?:string;people:HubPerson[];zone:string;locale:string;now:number;loading?:boolean;loaded?:boolean;error?:boolean;cursor?:string|null;loadingMore?:boolean;onLoadMore?:()=>void;readOnly?:boolean}){
 const {t}=useI18n();
 const groups=new Map(groupTimelineEntries(entries).map(group=>[group.date,group.rows]));
 const dates:string[]=[];
 if(from&&to){for(let date=from;date<=to;date=dateOffset(date,1))dates.push(date);}
 else dates.push(...groups.keys());
 return <>{loading&&!loaded?<p className="field-hint">{t("loading")}</p>:loaded&&dates.length?<div className="hub-week-days">{dates.map(date=><section className={`hub-week-day${groups.has(date)?"":" is-empty"}`} key={date}><h3><time dateTime={date}>{dateHeading(date,locale)}</time></h3>{groups.get(date)?.map(row=><TimelineRow key={`${row.kind}:${row.id}`} row={row} people={people} family={t("hubFamily")} zone={zone} locale={locale} now={now} readOnly={readOnly}/>)??<p className="hub-week-day-empty">{t("hubNoEvents")}</p>}</section>)}</div>:loaded&&!error?<p className="field-hint">{t("hubWeekEmpty")}</p>:null}{cursor&&onLoadMore&&<button className="hub-week-more" type="button" disabled={loadingMore||readOnly} onClick={onLoadMore}>{loadingMore?t("loading"):t("hubWeekMore")}</button>}</>;
}

function groupTimelineEntries(entries: TimelineEntry[]) {
  const groups = new Map<string, TimelineEntry[]>();
  for (const row of entries) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  return [...groups].map(([date, rows]) => ({ date, rows }));
}

function TimelineRow({ row, people, family, zone, locale, now, readOnly=false }: { row: TimelineEntry; people: HubPerson[]; family: string; zone: string; locale: string; now:number; readOnly?:boolean }) {
  const { t } = useI18n();
  const [open,setOpen]=useState(false);
  const buttonId=useId(),detailsId=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  const ids=row.kind==='calendar'||row.kind==='school'?row.activity.personIds:[];
  const associated=people.filter(person=>ids.includes(person.id));
  const householdSubject=row.kind==='dinner'||row.kind==='calendar'&&row.activity.metadata.calendar?.subjectHousehold===true;
  const participants=associated.map(person=>person.displayName).join(' · ')||(householdSubject?family:t('calendarRowUnassigned'));
  const time=row.kind==='dinner'?t('hubDinnerLabel'):timeLabel(row,locale,zone,t('hubAllDay'),t('hubDinnerLabel'));
  const title=row.kind==='dinner'?row.title:row.activity.title;
  const rawStatus=row.kind==='calendar'?row.activity.metadata.calendar?.status:undefined;
  const status=row.kind==='school'?t('calendarRowSchool'):row.kind==='calendar'&&rawStatus&&rawStatus!=='confirmed'&&rawStatus!=='unknown'?t(calendarParticipationKey(rawStatus)):'';
  const ended=row.kind==='school'?Date.parse(row.activity.expiresAt)<=now:row.kind==='calendar'&&calendarActivityEnded(row.activity.startsAt,row.activity.endsAt,Boolean(row.activity.metadata.calendar&&row.activity.metadata.allDay),now,zone);
  const accessibleLabel=[time,status,ended?t('hubEnded'):'',title,participants].filter(Boolean).join(', ');
  const tokens=associated.map(person=>personColorToken(person.id,person.colorToken,person.avatarKey)).sort();
  const stripe=tokens.length>1?`linear-gradient(180deg,${tokens.map((token,index)=>`var(--person-${token}) ${index*100/tokens.length}% ${(index+1)*100/tokens.length}%`).join(',')})`:tokens.length?`var(--person-${tokens[0]})`:householdSubject?'var(--person-household)':'var(--person-unassigned)';
  const rowClass=`hub-week-entry hub-week-compact ${row.kind==='school'?'hub-week-school':row.kind==='dinner'?'hub-week-dinner':'hub-week-calendar'} ${row.kind==='calendar'&&row.activity.metadata.calendar?.purpose==='waste'?'is-waste':''}`;
  const date=row.kind==='school'?row.activity.date:row.kind==='dinner'?row.date:row.activity.startsAt?.slice(0,10)??row.date;
  return <div className={rowClass} data-review-private={row.kind==='dinner'?'dinner-event':'week-activity'} data-item-id={row.kind==='calendar'?row.activity.id:undefined} data-event-id={row.kind==='dinner'?row.id:undefined} style={{'--activity-stripe':stripe} as CSSProperties} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <button ref={trigger} id={buttonId} className={`hub-week-row-button ${status?'has-status':''}`} type="button" disabled={readOnly} aria-expanded={open} aria-controls={detailsId} aria-label={accessibleLabel} onClick={()=>setOpen(value=>!value)}>
      <time dateTime={row.kind==='calendar'?row.activity.startsAt??date:date}>{time}</time>
      {status&&<span className="hub-week-row-status" aria-hidden="true" title={status}>{rawStatus==='cancelled'?'×':rawStatus==='tentative'?'?':'!'}</span>}
      <strong lang={row.kind==='calendar'?row.activity.contentLocale??undefined:undefined}>{title}</strong>{ended&&<span className="hub-ended-label">{t('hubEnded')}</span>}
    </button>
    {open&&<div id={detailsId} className="hub-week-row-details" role="region" aria-labelledby={buttonId}>
      {row.kind==='school'?<SchoolActivityCard activity={row.activity} people={people} now={now} zone={zone}/>:row.kind==='dinner'?<dl><dt>{t('hubDinnerLabel')}</dt><dd>{dateHeading(row.date,locale)}</dd><dt>{t('hubFamily')}</dt><dd>{participants}</dd></dl>:<>
        <dl><dt>{t('calendarRowPeople')}</dt><dd>{participants}</dd>{row.activity.startsAt&&<><dt>{t('calendarRowWhen')}</dt><dd>{formatCalendarEventRange(row.activity.startsAt,row.activity.endsAt,locale,zone,row.activity.metadata.allDay)}</dd></>}{row.activity.metadata.calendar?.status&&<><dt>{t('calendarRowStatus')}</dt><dd>{t(calendarParticipationKey(row.activity.metadata.calendar.status))}</dd></>}{row.activity.metadata.calendar&&<><dt>{t('calendarRowSource')}</dt><dd>{row.activity.metadata.calendar.displayName||row.activity.source.label}</dd></>}{row.activity.metadata.location&&<><dt>{t('calendarRowLocation')}</dt><dd>{row.activity.metadata.location}</dd></>}</dl>
        <CalendarFreshness item={row.activity} zone={zone}/>
        {row.activity.body&&<p>{row.activity.body}</p>}
        {!!row.activity.source.links?.length&&<ul>{row.activity.source.links.map((link,index)=><li key={`${link.url}:${index}`}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul>}
      </>}
    </div>}
  </div>;
}

export function PersonFutureTimeline({ householdId, personId, localDate, zone, people, display = false, now = Date.now() }: { householdId?: string; personId: string; localDate: string; zone: string; people: HubPerson[]; display?: boolean; now?:number }) {
  const { t, locale } = useI18n();
  const [weekStart, setWeekStart] = useState(homeWeekStart(localDate));
  const [activities, setActivities] = useState<HouseholdTimelineActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const window = personFutureWindow(weekStart, localDate);
  useEffect(() => { const timer = setInterval(() => setRefreshTick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setWeekStart(homeWeekStart(localDate)); setActivities([]); setCursor(null); setLoadingMore(false); setError(false); request.current++; }, [householdId, personId, localDate, display]);
  useEffect(() => {
    const generation = ++request.current; let active = true;
    setLoading(true); if (refreshTick) setLoadingMore(false);
    const path = display ? `/display/people/${encodeURIComponent(personId)}/activities` : `/households/${encodeURIComponent(householdId ?? "")}/people/${encodeURIComponent(personId)}/activities`;
    const query = new URLSearchParams({ from: window.from, to: window.to, limit: "50" });
    void api<ActivityWindow>(`${path}?${query}`).then(page => { if (active && request.current === generation) { setActivities(dedupeTimelineActivities(page.activities)); setCursor(page.nextCursor); setError(false); } }).catch(error => { if (active && request.current === generation) { setError(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { setActivities([]); setCursor(null); } } }).finally(() => { if (active && request.current === generation) setLoading(false); });
    return () => { active = false; request.current++; };
  }, [householdId, personId, weekStart, localDate, display, refreshTick, window.from, window.to]);
  const entries = mergeTimelineEntries(activities, [], zone, window.from, window.to);
  const minimum = homeWeekStart(localDate);
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const generation = request.current; setLoadingMore(true); setError(false);
    try {
      const path = display ? `/display/people/${encodeURIComponent(personId)}/activities` : `/households/${encodeURIComponent(householdId ?? "")}/people/${encodeURIComponent(personId)}/activities`;
      const query = new URLSearchParams({ from: window.from, to: window.to, limit: "50", cursor });
      const page = await api<ActivityWindow>(`${path}?${query}`);
      if (request.current === generation) { setActivities(previous => dedupeTimelineActivities([...previous, ...page.activities])); setCursor(page.nextCursor); }
    } catch (error) { if (request.current === generation) { setError(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { setActivities([]); setCursor(null); } } }
    finally { if (request.current === generation) setLoadingMore(false); }
  };
  return <section className="hub-person-future" aria-label={t("hubUpcomingActivities")}>
    <header className="hub-person-future-heading"><h3>{t("hubUpcomingActivities")}</h3><div className="hub-week-nav"><button className="hub-icon-button" type="button" aria-label={t("hubPreviousWeek")} disabled={weekStart <= minimum || loading} onClick={() => setWeekStart(value => dateOffset(value, -7))}><Icon name="back" size={16}/></button><button className="hub-icon-button" type="button" aria-label={t("hubNextWeek")} disabled={loading} onClick={() => setWeekStart(value => dateOffset(value, 7))}><Icon name="arrow" size={16}/></button></div></header>
    <p className="field-hint">{`${shortDate(weekStart, locale)} – ${shortDate(dateOffset(weekStart, 6), locale)}`}</p>
    {error && <p className="hub-week-error" role="status">{t("hubWeekLoadError")}</p>}
    {loading && !activities.length ? <p className="field-hint">{t("loading")}</p> : entries.length ? <div className="hub-person-future-list">{entries.map(row => <TimelineRow key={`${row.kind}:${row.id}`} row={row} people={people} family={t("hubFamily")} zone={zone} locale={locale} now={now}/>)}</div> : !error && <p className="field-hint">{t("hubNoUpcomingActivities")}</p>}
    {cursor && <button className="hub-week-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("loading") : t("hubWeekMore")}</button>}
  </section>;
}

export function BirthdayDayRow({ birthdays, due, people, onOpen }: { birthdays: HomeBirthday[]; due: HomeBirthday["due"]; people: HubPerson[]; onOpen: (person: HubPerson, trigger: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  const matching = birthdays.filter(birthday => birthday.due === due);
  if (!matching.length) return null;
  return <div className="hub-birthday-row" data-review-private="birthday-row"><span className="hub-balloons" aria-hidden="true">🎈</span><strong>{t(due === "today" ? "hubBirthdayToday" : "hubBirthdayTomorrow")}</strong><div className="hub-birthday-people">{matching.map(birthday => { const person = people.find(item => item.id === birthday.personId); if (!person) return null; return <button key={birthday.personId} type="button" className="hub-birthday-person" data-review-private="birthday-person" onClick={event => onOpen(person, event.currentTarget)}><Avatar name={person.displayName} personId={person.id} colorToken={person.colorToken} avatarKey={person.avatarKey} photo={person.photo}/><span>{person.displayName}</span></button>; })}</div></div>;
}
