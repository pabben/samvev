import { useState } from 'react';
import { Dialog, Icon, useI18n } from './ui';
import { requestSchoolWeekPdf, schoolWeekDateAtNoon, schoolWeekDay, schoolWeekHomework, schoolWeekPdfAvailable, schoolWeekRequirementKey, schoolWeekTimeLabel, schoolWeekTomorrow, schoolWeekUncertaintyKey, type SchoolWeekDay, type SchoolWeekPlan, type SchoolWeekRequirement } from './school-week-presentation';

function dateHeading(date: string, locale: string, zone: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(schoolWeekDateAtNoon(date, zone));
}
function shortDate(date: string, locale: string, zone: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, day: 'numeric', month: 'short' }).format(schoolWeekDateAtNoon(date, zone));
}

export function SchoolWeekCard({ plan, personName, today, zone, compact = false, onOpenPdf }: { plan: SchoolWeekPlan; personName: string; today: string; zone: string; compact?: boolean; onOpenPdf?: (planId: string) => void }) {
  const { t, locale } = useI18n();
  const [showWeek, setShowWeek] = useState(false);
  const tomorrowDate = schoolWeekTomorrow(today);
  const todayPlan = schoolWeekDay(plan, today);
  const tomorrowPlan = schoolWeekDay(plan, tomorrowDate);
  const homework = schoolWeekHomework(plan);
  const pdfReady = schoolWeekPdfAvailable(plan.pdfLinkAvailable, plan.pdfStatus);
  const contentLocale = plan.contentLocale ?? locale;
  const dateRange = `${shortDate(plan.startsOn, locale, zone)} – ${shortDate(plan.endsOn, locale, zone)}`;
  return <section className={`school-week-card hub-panel${compact ? ' is-compact' : ''}`} aria-labelledby={`school-week-${plan.id}`} data-school-plan-id={plan.id} lang={contentLocale}>
    <header className="school-week-header">
      <div><p className="eyebrow">{t('schoolWeekEyebrow')}</p><h2 id={`school-week-${plan.id}`}><Icon name="calendar"/>{t('schoolWeekTitle', { name: personName })}</h2><p className="school-week-range">{dateRange}</p></div>
      <span className={`school-week-source-state${plan.sourceStatus === 'stale' ? ' is-stale' : ''}`} role="status">{t(plan.sourceStatus === 'stale' ? 'schoolWeekStale' : 'schoolWeekCurrent')}</span>
    </header>
    {plan.sourceStatus === 'stale' && <p className="school-week-stale-note" role="note">{t('schoolWeekStaleHelp')}</p>}
    {plan.uncertainty && <p className="school-week-uncertainty"><strong>{t('schoolWeekUncertainty')}</strong> {t(schoolWeekUncertaintyKey(plan.uncertainty))}</p>}
    <div className="school-week-highlights">
      <SchoolWeekDayCard day={todayPlan} label={t('hubToday')} empty={t('schoolWeekNoToday')} locale={locale} compact={compact}/>
      <SchoolWeekDayCard day={tomorrowPlan} label={t('hubTomorrow')} empty={t('schoolWeekNoTomorrow')} locale={locale} compact={compact}/>
    </div>
    <section className="school-week-homework" aria-labelledby={`school-homework-${plan.id}`}>
      <h3 id={`school-homework-${plan.id}`}><span aria-hidden="true">✏️</span>{t('schoolWeekHomework')}</h3>
      {homework.length ? <ul>{homework.slice(0, compact ? 3 : 6).map((item, index) => <li key={`${item.dueOn}:${index}`}><span>{item.text}</span>{item.dueOn && <time dateTime={item.dueOn}>{dateHeading(item.dueOn, locale, zone)}</time>}</li>)}</ul> : <p className="school-week-empty">{t('schoolWeekNoHomework')}</p>}
    </section>
    <div className="school-week-actions">
      <button className="button" type="button" onClick={() => setShowWeek(true)}>{t('schoolWeekFullWeek')}<Icon name="arrow" size={16}/></button>
      {onOpenPdf && <button className="button subtle" type="button" disabled={!pdfReady} onClick={()=>requestSchoolWeekPdf(plan.id,onOpenPdf)}>{t(pdfReady ? 'schoolWeekOpenPdf' : 'schoolWeekPdfUnavailable')}</button>}
    </div>
    {showWeek && <Dialog title={t('schoolWeekFullWeek')} wide className="school-week-dialog" onClose={() => setShowWeek(false)}>
      <div className="school-week-dialog-heading"><div><p className="eyebrow">{personName}</p><p>{dateRange}</p></div>{onOpenPdf && <button className="button" type="button" disabled={!pdfReady} onClick={()=>requestSchoolWeekPdf(plan.id,onOpenPdf)}>{t(pdfReady ? 'schoolWeekOpenPdf' : 'schoolWeekPdfUnavailable')}</button>}</div>
      {plan.sourceStatus === 'stale' && <p className="school-week-stale-note" role="status">{t('schoolWeekStaleHelp')}</p>}
      {plan.uncertainty && <p className="school-week-uncertainty"><strong>{t('schoolWeekUncertainty')}</strong> {t(schoolWeekUncertaintyKey(plan.uncertainty))}</p>}
      <div className="school-week-full-days">{plan.days.map(day => <SchoolWeekDayCard key={day.date} day={day} label={dateHeading(day.date, locale, zone)} empty={t('schoolWeekNoItems')} locale={locale} full/>)}</div>
    </Dialog>}
  </section>;
}

function SchoolWeekDayCard({ day, label, empty, locale, compact = false, full = false }: { day?: SchoolWeekDay; label: string; empty: string; locale: string; compact?: boolean; full?: boolean }) {
  const { t } = useI18n();
  if (!day) return <section className="school-week-day is-empty"><h3>{label}</h3><p>{empty}</p></section>;
  const hasContent = day.activities.length || day.practicalRequirements.length || day.homework.length || day.deadlines.length || day.reminders.length || day.weatherAdvice;
  return <section className={`school-week-day${full ? ' is-full' : ''}${hasContent ? '' : ' is-empty'}`}>
    <h3><time dateTime={day.date}>{label}</time></h3>
    {day.activities.map((activity, index) => <article className="school-week-activity" key={`${day.date}:activity:${index}`}>
      <strong>{schoolWeekTimeLabel(activity.startsAt) && <time dateTime={activity.startsAt!}>{schoolWeekTimeLabel(activity.startsAt)} </time>}{activity.title}</strong>
      {activity.description && <p>{activity.description}</p>}
      {activity.practicalRequirements.length > 0 && <LabeledItems label={t('schoolWeekRemember')} items={activity.practicalRequirements} compact={compact&&!full}/>}
    </article>)}
    {day.practicalRequirements.length > 0 && <LabeledItems label={t('schoolWeekRemember')} items={day.practicalRequirements} compact={compact&&!full}/>}
    {day.homework.length > 0 && <LabeledItems label={t('schoolWeekHomework')} items={day.homework.map(item=>item.text)} compact={compact&&!full}/>}
    {day.deadlines.length > 0 && <LabeledItems label={t('schoolWeekDeadlines')} items={day.deadlines.map(item=>item.time?`${item.time} · ${item.text}`:item.text)} compact={compact&&!full}/>}
    {day.reminders.length > 0 && <LabeledItems label={t('schoolWeekReminders')} items={day.reminders.map(item=>item.time?`${item.time} · ${item.text}`:item.text)} compact={compact&&!full}/>}
    {day.weatherAdvice && <p className="school-week-weather"><strong>{t('schoolWeekWeather')}</strong> {day.weatherAdvice}</p>}
    {!hasContent && <p className="school-week-empty">{empty}</p>}
  </section>;
}

function LabeledItems({ label, items, compact = false }: { label: string; items: (string | SchoolWeekRequirement)[]; compact?: boolean }) {
  const { t } = useI18n();
  return <div className="school-week-labeled-items"><h4>{label}</h4><ul>{(compact ? items.slice(0, 2) : items).map((item,index)=><li key={`${label}:${index}`}>{typeof item==='string'?item:<><span className="school-week-requirement-kind">{t(schoolWeekRequirementKey(item.kind))}:</span> {item.text}</>}</li>)}</ul></div>;
}

