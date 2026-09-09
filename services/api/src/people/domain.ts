export type AgeGroup = 'adult'|'teen'|'child'|'unspecified';

interface CalendarDate { year:number; month:number; day:number }
export interface BirthdayPerson { id:string; displayName:string; birthDate:string }
export interface UpcomingBirthday {
  personId:string;
  displayName:string;
  date:string;
  daysUntil:number;
  ageTurning:number;
}

function parts(value:string):CalendarDate {
  const [year,month,day]=value.split('-').map(Number);
  return {year:year!,month:month!,day:day!};
}

function iso(value:CalendarDate):string {
  return `${String(value.year).padStart(4,'0')}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`;
}

function leap(year:number):boolean { return year%4===0 && (year%100!==0 || year%400===0); }

/** Samvev observes a 29 February birthday on 28 February in non-leap years. */
function birthdayInYear(birth:CalendarDate,year:number):CalendarDate {
  return birth.month===2 && birth.day===29 && !leap(year) ? {year,month:2,day:28} : {year,month:birth.month,day:birth.day};
}

function ordinal(value:CalendarDate):number { return Date.UTC(value.year,value.month-1,value.day)/86_400_000; }

export function localDateInTimezone(now:Date,timeZone:string):string {
  const values=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const find=(type:Intl.DateTimeFormatPartTypes)=>values.find((value)=>value.type===type)?.value;
  return `${find('year')}-${find('month')}-${find('day')}`;
}

export function ageOnDate(birthDate:string,onDate:string):number {
  const birth=parts(birthDate);const on=parts(onDate);
  return on.year-birth.year-(on.month<birth.month || (on.month===birth.month && on.day<birth.day)?1:0);
}

export function deriveAgeGroup(birthDate:string|undefined|null,onDate:string):AgeGroup {
  if(!birthDate)return 'unspecified';
  const age=ageOnDate(birthDate,onDate);
  return age>=18?'adult':age>=13?'teen':'child';
}

export function nextBirthday(people:readonly BirthdayPerson[],today:string):UpcomingBirthday|null {
  const current=parts(today);
  const candidates=people.map((person)=>{
    const birth=parts(person.birthDate);
    let date=birthdayInYear(birth,current.year);
    if(iso(date)<today)date=birthdayInYear(birth,current.year+1);
    return {personId:person.id,displayName:person.displayName,date:iso(date),daysUntil:ordinal(date)-ordinal(current),ageTurning:date.year-birth.year};
  }).sort((left,right)=>left.daysUntil-right.daysUntil || left.displayName.localeCompare(right.displayName) || left.personId.localeCompare(right.personId));
  return candidates[0]??null;
}
