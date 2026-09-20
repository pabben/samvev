import { monitorInterpretationSchema } from '@samvev/contracts';
import type { DbClient } from '../db.ts';

export interface MonitorScheduleInput {interpretedRule:unknown;checkIntervalMinutes:number;}

/** Calendar-based scheduling keeps a reviewed local wall-clock time stable over DST. */
export async function nextMonitorCheckAt(client:DbClient,input:MonitorScheduleInput,from?:Date):Promise<Date>{
  const rule=monitorInterpretationSchema.safeParse(input.interpretedRule);
  const schedule=rule.success?rule.data.schedule:undefined;
  if(!schedule)return new Date((from?.getTime()??Date.now())+input.checkIntervalMinutes*60_000);
  const row=(await client.query<{next_check_at:Date}>(`SELECT (((($1::timestamptz AT TIME ZONE $3)::date + CASE WHEN ($1::timestamptz AT TIME ZONE $3)::time < $2::time THEN 0 ELSE 1 END) + $2::time) AT TIME ZONE $3) AS next_check_at`,[from??new Date(),schedule.localTime,schedule.timezone])).rows[0];
  if(!row)throw new Error('next_monitor_check_missing');
  return row.next_check_at;
}
