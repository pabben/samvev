import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { dateOffset, memberHouseholdBoardAdapter, sevenDayWindow, type DinnerAssignment } from "./household-board-adapters";
import type { HomeBirthday, HomeSchoolActivity, HouseholdTimelineActivity, HubPerson } from "./home-types";
import { collectActivitySourcePages, dedupeTimelineActivities, homeWeekStart, homeWeekTitleKey, isTimelineActivityOngoing, mergeTimelineEntries, personFutureWindow, type GroupedSchoolActivity, type TimelineEntry } from "./home-activity-presentation";
import { CalendarFreshness } from "./calendar-freshness";
import { calendarParticipationKey } from "./calendar-provider-config";
import { formatCalendarEventRange, formatDate, wallInput } from "./time";
import { Avatar, Icon, useI18n } from "./ui";

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
function timeLabel(row: TimelineEntry, locale: string, zone: string, allDay: string) {
  if (row.kind === "dinner") return "";
  if (row.kind === "school") return clockLabel(row.activity.time, allDay);
  if (row.activity.metadata.allDay) return allDay;
  return row.activity.startsAt ? formatDate(row.activity.startsAt, locale, zone, { hour: "2-digit", minute: "2-digit" }) : allDay;
}
function activityPeople(row: TimelineEntry, people: HubPerson[], family: string) {
  const ids = row.kind === "school" ? row.activity.personIds : row.kind === "calendar" ? row.activity.personIds : [];
  return ids.length ? people.filter(person => ids.includes(person.id)).map(person => person.displayName).join(" · ") : family;
}

export function SchoolActivityCard({ activity, people, compact = false, dateLabel, hideMeta = false, hideIcon = false }: { activity: GroupedSchoolActivity | HomeSchoolActivity; people: HubPerson[]; compact?: boolean; dateLabel?: string; hideMeta?: boolean; hideIcon?: boolean }) {
  const { t, locale } = useI18n();
  const names = "personIds" in activity ? people.filter(person => activity.personIds.includes(person.id)).map(person => person.displayName) : people.filter(person => person.id === activity.personId).map(person => person.displayName);
  return <article className={`hub-school-activity ${compact ? "is-compact" : ""}`} data-review-private="school-activity" data-school-event-id={activity.id}>
    <div className="hub-school-heading">{!compact&&!hideIcon&&<span className="hub-school-icon" aria-hidden="true">🎒</span>}<div><strong data-review-private="school-title">{activity.title}</strong>{!hideMeta&&<span className="hub-school-meta">{dateLabel && <>{dateLabel} · </>}{clockLabel(activity.time, t("hubAllDay"))}{!compact&&names.length?` · ${names.join(" · ")}`:""}</span>}</div></div>
    {!!activity.actions.length && <ul className={`hub-school-actions ${compact ? "is-compact" : ""}`}>{(compact ? activity.actions.slice(0, 1) : activity.actions).map((action, index) => <li key={`${activity.id}-${index}`} data-review-private="school-action">{action}</li>)}</ul>}
    {!compact && <details className="hub-school-provenance">
      <summary>{t("hubSchoolDetails")}</summary>
      {typeof activity.evidence.quote === "string" && activity.evidence.quote && <p className="hub-school-evidence" data-review-private="school-evidence"><strong>{t("hubSchoolEvidence")}:</strong> {activity.evidence.quote}</p>}
      {activity.confidence !== null && <p className="field-hint">{t("hubSchoolConfidence", { value: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(activity.confidence) })}</p>}
      {activity.uncertainty && <p className="field-hint">{t("hubSchoolUncertainty", { value: activity.uncertainty })}</p>}
      {activity.recordedAt && <p className="field-hint">{t("hubSchoolRecorded", { date: formatDate(activity.recordedAt, locale, "UTC", { dateStyle: "medium" }) })}</p>}
      {activity.sourceUrl && <a href={activity.sourceUrl} target="_blank" rel="noreferrer" data-review-private="school-source">{t("hubSchoolSource")} <Icon name="arrow" size={14}/></a>}
    </details>}
  </article>;
}

export function HouseholdActivityWeek({ householdId, localDate, zone, people, display = false, now = Date.now(), householdBoardsReadableDinners = true, onCurrentWeekDinners }: { householdId?: string; localDate: string; zone: string; people: HubPerson[]; display?: boolean; now?: number; householdBoardsReadableDinners?: boolean; onCurrentWeekDinners?: (dinners: DinnerAssignment[] | undefined, stale?: boolean) => void }) {
  const { t, locale } = useI18n();
  const adapter = useMemo(() => householdId ? memberHouseholdBoardAdapter(householdId) : null, [householdId]);
  const currentWeek = homeWeekStart(localDate);
  const [weekStart, setWeekStart] = useState(currentWeek);
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
  const minWeek = currentWeek;
  const to = dateOffset(weekStart, 6);

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
    setWeekStart(currentWeek); setPersonId(""); setSourceId(""); setNextActivity(null); setShowNext(false);
    setActivities([]); setDinners([]); setCursor(null); setLoaded(false); setLoadingMore(false); setError(false);
    generation.current++; nextGeneration.current++;
  }, [householdId, currentWeek]);
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
      : adapter ? adapter.listDinners(sevenDayWindow(weekStart)) : Promise.reject(new Error("Household scope is unavailable."));
    void Promise.allSettled([activityQuery(householdId, weekStart, to, personId || undefined, undefined, display, sourceId || undefined), dinnersRequest]).then(([activityResult, dinnerResult]) => {
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
  }, [householdId, adapter, weekStart, to, personId, sourceId, currentWeek, display, localDate, householdBoardsReadableDinners, onCurrentWeekDinners, refreshTick]);

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
    if (showNext) void loadNext();
    return () => { nextGeneration.current++; };
  }, [householdId, personId, sourceId, weekStart, localDate, display, showNext, refreshTick]);
  const entries = mergeTimelineEntries(activities, dinners, zone, weekStart, to);
  const currentWeekTitle = `${shortDate(weekStart, locale)} – ${shortDate(to, locale)}`;
  return <section className="hub-week hub-panel" aria-label={t("hubWeekTitle")} data-testid="home-activity-week">
    <header className="hub-week-heading"><div><h2><Icon name="calendar"/>{t(homeWeekTitleKey(weekStart,currentWeek))}</h2><p>{currentWeekTitle}</p></div><div className="hub-week-nav"><button className="hub-icon-button" type="button" aria-label={t("hubPreviousWeek")} disabled={weekStart <= minWeek || loading} onClick={() => setWeekStart(value => dateOffset(value, -7))}><Icon name="back" size={16}/></button><button className="hub-icon-button" type="button" aria-label={t("hubNextWeek")} disabled={loading} onClick={() => setWeekStart(value => dateOffset(value, 7))}><Icon name="arrow" size={16}/></button></div></header>
    <label className="hub-week-person-filter">{t("hubWeekPersonFilter")}<select data-review-private="week-person-filter" value={personId} onChange={event => setPersonId(event.target.value)}><option value="">{t("hubWeekEveryone")}</option>{people.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
    {!display && sources.length > 0 && <label className="hub-week-source-filter">{t("hubWeekSourceFilter")}<select data-review-private="week-source-filter" value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">{t("hubWeekEverySource")}</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>}
    {sourceCatalogError&&<p className="hub-week-error" role="status">{t("hubWeekLoadError")}</p>}
    {error && <p className="hub-week-error" role="status">{t("hubWeekLoadError")}</p>}
    {loading && !loaded ? <p className="field-hint">{t("loading")}</p> : entries.length ? <div className="hub-week-days">{groupTimelineEntries(entries).map(group => <section className="hub-week-day" key={group.date}><h3><time dateTime={group.date}>{dateHeading(group.date, locale)}</time></h3>{group.rows.map(row => <TimelineRow key={`${row.kind}:${row.id}`} row={row} people={people} family={t("hubFamily")} zone={zone} locale={locale}/>)}</section>)}</div> : loaded && !error && <p className="field-hint">{t("hubWeekEmpty")}</p>}
    {cursor && <button className="hub-week-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("loading") : t("hubWeekMore")}</button>}
    <div className="hub-next-activity"><button type="button" className="hub-next-toggle" aria-expanded={showNext} onClick={() => { setShowNext(value => !value); if (!showNext && nextActivity === null) void loadNext(); }}><Icon name="arrow" size={16}/>{t("hubShowNext")}</button>
      {showNext && (nextLoading ? <p className="field-hint">{t("loading")}</p> : nextError ? <p role="status" className="hub-week-error">{t("hubWeekLoadError")} <button type="button" onClick={() => void loadNext()}>{t("retry")}</button></p> : nextActivity ? <><p className="hub-next-date" data-review-private="next-activity-date">{isTimelineActivityOngoing(nextActivity, localDate, now) ? `${t("hubOngoing")} · ` : ""}{dateHeading(nextActivity.type === "school" ? nextActivity.date : nextActivity.metadata.allDay ? nextActivity.startsAt?.slice(0,10) ?? "" : nextActivity.startsAt ? wallInput(nextActivity.startsAt, zone).slice(0,10) : "", locale)}</p><TimelineRow row={mergeTimelineEntries([nextActivity], [], zone)[0]!} people={people} family={t("hubFamily")} zone={zone} locale={locale}/></> : <p className="field-hint">{t("hubNextEmpty")}</p>)}
    </div>
  </section>;
}

function groupTimelineEntries(entries: TimelineEntry[]) {
  const groups = new Map<string, TimelineEntry[]>();
  for (const row of entries) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  return [...groups].map(([date, rows]) => ({ date, rows }));
}

function TimelineRow({ row, people, family, zone, locale }: { row: TimelineEntry; people: HubPerson[]; family: string; zone: string; locale: string }) {
  const { t } = useI18n();
  if (row.kind === "school") return <div className="hub-week-entry"><time>{timeLabel(row, locale, zone, t("hubAllDay"))}</time><span className="hub-week-icon" aria-hidden="true">🎒</span><SchoolActivityCard activity={row.activity} people={people} hideIcon/></div>;
  if (row.kind === "dinner") return <article className="hub-week-entry hub-week-dinner" data-review-private="dinner-event" data-event-id={row.id}><time dateTime={row.date}>{t("hubDinnerLabel")}</time><span aria-hidden="true">{row.emoji || "🍽️"}</span><strong>{row.title}</strong></article>;
  const activity = row.activity;
  return <article className={`hub-week-entry hub-week-calendar ${activity.metadata.calendar?.purpose === "waste" ? "is-waste" : ""}`} data-review-private="week-activity" data-item-id={activity.id}>
    <time dateTime={activity.startsAt ?? row.date}>{timeLabel(row, locale, zone, t("hubAllDay"))}</time><span className="hub-week-icon" aria-hidden="true"><Icon name={activity.metadata.calendar?.purpose === "waste" ? "trash" : "calendar"} size={17}/></span><div><strong lang={activity.contentLocale ?? ""}>{activity.title}</strong><CalendarFreshness item={activity} zone={zone}/>{activity.startsAt&&<small className="hub-week-range" data-review-private="week-activity-range">{formatCalendarEventRange(activity.startsAt,activity.endsAt,locale,zone,activity.metadata.allDay)}</small>}<small>{activityPeople(row, people, family)}</small>{activity.metadata.calendar?.status && <small className="hub-week-status">{t(calendarParticipationKey(activity.metadata.calendar.status))}</small>}{activity.metadata.location && <small data-review-private="week-location">{activity.metadata.location}</small>}</div>
  </article>;
}

export function PersonFutureTimeline({ householdId, personId, localDate, zone, people, display = false }: { householdId?: string; personId: string; localDate: string; zone: string; people: HubPerson[]; display?: boolean }) {
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
    {loading && !activities.length ? <p className="field-hint">{t("loading")}</p> : entries.length ? <div className="hub-person-future-list">{entries.map(row => <TimelineRow key={`${row.kind}:${row.id}`} row={row} people={people} family={t("hubFamily")} zone={zone} locale={locale}/>)}</div> : !error && <p className="field-hint">{t("hubNoUpcomingActivities")}</p>}
    {cursor && <button className="hub-week-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("loading") : t("hubWeekMore")}</button>}
  </section>;
}

export function BirthdayDayRow({ birthdays, due, people, onOpen }: { birthdays: HomeBirthday[]; due: HomeBirthday["due"]; people: HubPerson[]; onOpen: (person: HubPerson, trigger: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  const matching = birthdays.filter(birthday => birthday.due === due);
  if (!matching.length) return null;
  return <div className="hub-birthday-row" data-review-private="birthday-row"><span className="hub-balloons" aria-hidden="true">🎈</span><strong>{t(due === "today" ? "hubBirthdayToday" : "hubBirthdayTomorrow")}</strong><div className="hub-birthday-people">{matching.map(birthday => { const person = people.find(item => item.id === birthday.personId); if (!person) return null; return <button key={birthday.personId} type="button" className="hub-birthday-person" data-review-private="birthday-person" onClick={event => onOpen(person, event.currentTarget)}><Avatar name={person.displayName} personId={person.id} avatarKey={person.avatarKey} photo={person.photo}/><span>{person.displayName}</span></button>; })}</div></div>;
}
