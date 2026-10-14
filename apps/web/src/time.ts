/** Convert a household wall-clock time to an instant. Reject DST gaps AND folds. */
export function wallToInstant(local: string, zone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("SCHEDULE_INVALID");
  const nominal = Date.parse(`${local}:00Z`);
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== local
  )
    throw new Error("SCHEDULE_INVALID");
  const offsets = new Set<number>();
  // Sample both sides of any transition; offsets include quarter-hour zones.
  for (let hour = -36; hour <= 36; hour += 3) {
    const instant = nominal + hour * 3600000;
    offsets.add(Date.parse(`${wallInput(instant, zone)}:00Z`) - instant);
  }
  const matches = [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => wallInput(instant, zone) === local);
  if (matches.length !== 1)
    throw new Error(matches.length ? "TIME_AMBIGUOUS" : "TIME_NONEXISTENT");
  return new Date(matches[0]!).toISOString();
}
export function wallInput(instant: string | number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const p = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
export function tomorrowMorning(zone: string): string {
  const today = wallInput(Date.now(), zone).slice(0, 10);
  return `${new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)}T07:00`;
}
export const formatDate = (
  value: string | number,
  locale: string,
  zone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
) =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }).format(
    new Date(value),
  );

/** Full localized range, in the household zone; date changes are never hidden. */
export function formatEventRange(start:string,end:string|null,locale:string,zone:string,allDay=false):string {
 const options:Intl.DateTimeFormatOptions=allDay
  ? {weekday:'short',day:'numeric',month:'short',year:'numeric'}
  : {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'};
 if(!end||Date.parse(end)<=Date.parse(start))return formatDate(start,locale,zone,options);
 return new Intl.DateTimeFormat(locale,{timeZone:zone,...options}).formatRange(new Date(start),new Date(end));
}

/** Calendar all-day bounds are civil dates with an exclusive end, not local clock instants. */
export function formatCalendarEventRange(start:string,end:string|null,locale:string,zone:string,allDay=false):string {
 if(!allDay)return formatEventRange(start,end,locale,zone);
 const startDay=start.slice(0,10),endDay=end?.slice(0,10);
 const inclusiveEnd=endDay&&endDay>startDay?new Date(Date.parse(`${endDay}T12:00:00Z`)-86400000).toISOString().slice(0,10):startDay;
 return formatEventRange(`${startDay}T12:00:00Z`,`${inclusiveEnd}T12:00:00Z`,locale,'UTC',true);
}
