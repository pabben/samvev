import type {HubItem} from './home-types';
import {useI18n} from './ui';
import {formatDate} from './time';
/** Only the server's sanitized freshness flag determines this warning. */
export function CalendarFreshness({item,zone,detail=false}:{item:HubItem;zone?:string;detail?:boolean}){
 const {t,locale}=useI18n();const calendar=item.metadata.calendar;
 if(calendar?.freshness!=='stale')return null;
 return <span className={`calendar-stale ${detail?'calendar-stale-detail':''}`} data-calendar-freshness="stale" lang={locale}><span aria-hidden="true">◷</span> {t(detail?'calendarStaleReaderDetail':'calendarStaleReader')}{detail&&zone&&calendar.lastSuccessfulSyncAt&&<span className="calendar-stale-time">{t('calendarLastSync')}: {formatDate(calendar.lastSuccessfulSyncAt,locale,zone)}</span>}</span>;
}
