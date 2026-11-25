import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { advanceHomeBirthdays, dayKey } from "../src/home-presentation";
import { collectActivitySourcePages, calendarActivityEnded, currentCalendarActivityRelevant, dedupeTimelineActivities, groupHomeSchoolActivities, homeWeekEnd, homeWeekStart, homeWeekTitleKey, isTimelineActivityOngoing, mergeTimelineEntries, personFutureWindow, shiftHomeDate, timedActivityUnended, timelineActivityVisible } from "../src/home-activity-presentation";
import type { HomeSchoolActivity, HouseholdTimelineActivity } from "../src/home-types";
import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".webp") ? { format: "module", source: 'export default "synthetic-avatar.webp"', shortCircuit: true } : nextLoad(url, context); } });
const [{ FamilyHub }, { LocaleProvider }, { HouseholdActivityWeekRows, SchoolActivityCard }] = await Promise.all([import("../src/family-hub"), import("../src/ui"), import("../src/home-activities")]);

function calendar(id: string, startsAt: string, title = "Shared title", personIds: string[] = []): Extract<HouseholdTimelineActivity,{type:"calendar"}> {
  return {
    type: "calendar", id, kind: "event", title, startsAt, endsAt: null, expiresAt: null,
    contentLocale: null, body: "", entries: [], priority: "normal", publishAt: null, updatedAt: startsAt, revision: 1,
    source: { label: "Fixture", observedAt: startsAt, uncertainty: "unknown" },
    targets: { household: false, personIds }, subjects: { personIds }, personIds,
    metadata: { allDay: false },
  };
}

test("week dates are local ISO dates and navigation starts on Monday across year boundaries", () => {
  assert.equal(homeWeekStart("2026-10-16"), "2026-10-12");
  assert.equal(homeWeekStart("2027-01-01"), "2026-12-28");
  assert.equal(shiftHomeDate("2026-12-31", 1), "2027-01-01");
  assert.equal(homeWeekTitleKey("2026-10-12","2026-10-12"),"hubWeekTitle");
  assert.equal(homeWeekTitleKey("2026-10-19","2026-10-12"),"hubFutureWeekTitle");
});

test("current household week bounds run from local today through Sunday", () => {
  assert.equal(homeWeekEnd("2026-10-16"), "2026-10-18", "Friday shows three days");
  assert.equal(homeWeekEnd("2026-10-18"), "2026-10-18", "Sunday shows one day");
  assert.equal(homeWeekEnd("2026-10-19"), "2026-10-25", "Monday shows seven days");
  const justAfterUtcMidnight = Date.parse("2026-10-16T00:30:00Z");
  assert.equal(dayKey(justAfterUtcMidnight, "America/Los_Angeles"), "2026-10-15");
  assert.equal(homeWeekEnd(dayKey(justAfterUtcMidnight, "America/Los_Angeles")), "2026-10-18", "bounds follow household local date across UTC midnight");
});

test("weekly rows render each date in range, compact empty days and exclude dates outside the range", () => {
  const rows = mergeTimelineEntries([
    calendar("past", "2026-10-15T12:00:00Z"),
    calendar("friday", "2026-10-16T12:00:00Z"),
    calendar("sunday", "2026-10-18T12:00:00Z"),
    calendar("next-week", "2026-10-19T12:00:00Z"),
  ], [], "UTC", "2026-10-16", "2026-10-18");
  const renderRange=(from:string,to:string,entries=rows,loaded=true,error=false)=>renderToStaticMarkup(createElement(LocaleProvider, { locale: "en", children: createElement(HouseholdActivityWeekRows, { entries, from, to, loaded, error, people: [], zone: "UTC", locale: "en", now: Date.parse("2026-10-16T08:00:00Z") }) }));
  const html = renderRange("2026-10-16","2026-10-18");
  assert.equal((html.match(/class="hub-week-day(?: is-empty)?"/g) ?? []).length, 3, "Friday through Sunday always has three date columns");
  assert.match(html, /Friday, October 16/);
  assert.match(html, /Saturday, October 17/);
  assert.match(html, /hub-week-day is-empty/);
  assert.match(html, /No recorded activities/);
  assert.match(html, /Sunday, October 18/);
  assert.doesNotMatch(html, /October 15|October 19|past|next-week/);
  assert.equal((renderRange("2026-10-18","2026-10-18",[]).match(/class="hub-week-day(?: is-empty)?"/g) ?? []).length,1,"Sunday has one date column");
  assert.equal((renderRange("2026-10-19","2026-10-25",[]).match(/class="hub-week-day(?: is-empty)?"/g) ?? []).length,7,"Monday through Sunday has seven future-week columns");
  const failedInitialLoad=renderRange("2026-10-16","2026-10-18",[],false,true);
  assert.doesNotMatch(failedInitialLoad,/hub-week-day/,"a failed initial load must not claim that unknown dates are empty");
  const staleRefresh=renderRange("2026-10-16","2026-10-18",rows,true,true);
  assert.match(staleRefresh,/Friday, October 16/,"previously loaded rows remain visible during a refresh error");
});

test("person chronology starts today within the current week and at Monday in a future week", () => {
  assert.deepEqual(personFutureWindow("2026-10-12", "2026-10-16"), { from: "2026-10-16", to: "2026-10-18" });
  assert.deepEqual(personFutureWindow("2026-10-19", "2026-10-16"), { from: "2026-10-19", to: "2026-10-25" });
});

test("ongoing all-day events use household civil-date bounds, not UTC-midnight instants", () => {
  const ongoing = calendar("all-day", "2026-10-15T00:00:00Z");
  ongoing.metadata.allDay = true;
  ongoing.endsAt = "2026-10-17T00:00:00Z";
  assert.equal(isTimelineActivityOngoing(ongoing, "2026-10-16", Date.parse("2026-10-15T22:30:00Z")), true);
  assert.equal(isTimelineActivityOngoing(ongoing, "2026-10-17", Date.parse("2026-10-17T08:00:00Z")), false, "all-day end dates are exclusive");
  const timed = calendar("timed", "2026-10-16T07:00:00Z");
  timed.endsAt = "2026-10-16T09:00:00Z";
  assert.equal(isTimelineActivityOngoing(timed, "2026-10-16", Date.parse("2026-10-16T08:00:00Z")), true);
  assert.equal(isTimelineActivityOngoing(timed, "2026-10-16", Date.parse("2026-10-16T10:00:00Z")), false);
});

test("today and tomorrow calendar eligibility uses the household zone, exclusive ends and point events",()=>{
  const now=Date.parse("2026-10-25T22:30:00Z"); // 23:30 Sunday in Oslo, after its DST fallback
  assert.equal(currentCalendarActivityRelevant("2026-10-25T21:00:00Z","2026-10-25T23:30:00Z",false,now,"Europe/Oslo"),true,"overnight event remains until its exclusive end");
  assert.equal(currentCalendarActivityRelevant("2026-10-25T21:00:00Z","2026-10-25T22:30:00Z",false,now,"Europe/Oslo"),false,"end boundary is exclusive");
  assert.equal(currentCalendarActivityRelevant("2026-10-25T22:31:00Z",null,false,now,"Europe/Oslo"),true,"future event without end is a point, not an infinite interval");
  assert.equal(currentCalendarActivityRelevant("2026-10-25T22:29:00Z",null,false,now,"Europe/Oslo"),false,"past point event has ended");
  assert.equal(currentCalendarActivityRelevant("2026-10-26T12:00:00Z","2026-10-27T00:00:00Z",true,now,"Europe/Oslo"),true,"all-day civil end date is exclusive");
  assert.equal(currentCalendarActivityRelevant("2026-10-26T12:00:00Z",null,true,now,"Europe/Oslo"),true,"missing all-day end uses one civil day");
  assert.equal(currentCalendarActivityRelevant("2026-10-26T12:00:00Z","2026-10-26T12:00:00Z",true,now,"Europe/Oslo"),false,"an explicitly invalid end does not become a positive span");
  assert.equal(timedActivityUnended("2026-10-25T23:00:00Z",null,Date.parse("2026-10-25T23:00:00Z")),true,"a point is eligible at its start boundary");
  assert.equal(timedActivityUnended("2026-10-25T23:00:00Z",null,Date.parse("2026-10-25T23:00:00.001Z")),false);
});

test("Next uses the same exclusive-end and expiry rules while history can remain in week rows",()=>{
  const ended=calendar("ended-next","2026-10-16T09:00:00Z");ended.endsAt="2026-10-16T10:00:00Z";
  assert.equal(timelineActivityVisible(ended,Date.parse("2026-10-16T10:00:00Z"),"Europe/Oslo",true),false);
  const point=calendar("point-next","2026-10-16T10:01:00Z");
  assert.equal(timelineActivityVisible(point,Date.parse("2026-10-16T10:00:00Z"),"Europe/Oslo",true),true);
  const school={type:"school" as const,id:"school",taskId:"task",personId:"p1",personIds:["p1"],startsAt:"2026-10-16T00:00:00Z",date:"2026-10-16",time:null,kind:"bring",title:"Synthetic task",actions:[],evidence:{},confidence:null,uncertainty:null,sourceUrl:null,recordedAt:null,expiresAt:"2026-10-16T10:00:00Z"};
  assert.equal(timelineActivityVisible(school,Date.parse(school.expiresAt),"Europe/Oslo",true),false,"offline school projection expires at the saved deadline");
  assert.equal(mergeTimelineEntries([ended],[],"Europe/Oslo","2026-10-16","2026-10-16").length,1,"week/history remains intact");
  const pointAtMidnight=calendar("equal-end-point","2026-10-15T22:00:00Z");pointAtMidnight.endsAt=pointAtMidnight.startsAt;
  const at=Date.parse(pointAtMidnight.startsAt!);
  assert.equal(timelineActivityVisible(pointAtMidnight,at-1,"Europe/Oslo",true),true);
  assert.equal(timelineActivityVisible(pointAtMidnight,at,"Europe/Oslo",true),true,"a timed equal endpoint is a valid point until its start boundary");
  assert.equal(timelineActivityVisible(pointAtMidnight,at+1,"Europe/Oslo",true),false);
  assert.equal(calendarActivityEnded(pointAtMidnight.startsAt,pointAtMidnight.endsAt,false,at,"Europe/Oslo"),false);
  assert.equal(calendarActivityEnded(pointAtMidnight.startsAt,pointAtMidnight.endsAt,false,at+1,"Europe/Oslo"),true);
  assert.equal(isTimelineActivityOngoing(pointAtMidnight,"2026-10-16",at),false,"a point never becomes ongoing");
  assert.equal(isTimelineActivityOngoing(point,"2026-10-16",Date.parse(point.startsAt!)),false,"a missing end is also a point, without an invented duration");
  assert.deepEqual(mergeTimelineEntries([pointAtMidnight],[],"Europe/Oslo","2026-10-16","2026-10-16").map(row=>[row.id,row.date]),[[pointAtMidnight.id,"2026-10-16"]],"a midnight point belongs to its start day and survives in history");
  const reversed=calendar("reversed-end","2026-10-16T09:00:00Z");reversed.endsAt="2026-10-16T08:00:00Z";
  assert.equal(mergeTimelineEntries([reversed],[],"Europe/Oslo").length,0,"a reversed end remains invalid");
  const invalidAllDay={...pointAtMidnight,metadata:{allDay:true,calendar:{provider:"google" as const,sourceId:"synthetic",bridgeKind:"direct",subjectHousehold:true}}};
  assert.equal(mergeTimelineEntries([invalidAllDay],[],"Europe/Oslo").length,0,"equal all-day civil endpoints remain invalid");
});

test("member source catalog exhausts UUID cursors, includes empty sources and sorts labels", async () => {
  const cursors:(string|undefined)[]=[];
  const sources=await collectActivitySourcePages(async cursor=>{
    cursors.push(cursor);
    return cursor===undefined
      ? {sources:[{id:"2",name:"Zulu source"},{id:"1",name:"Empty calendar"}],nextCursor:"cursor-2"}
      : {sources:[{id:"3",name:"Alpha source"}],nextCursor:null};
  },"en");
  assert.deepEqual(cursors,[undefined,"cursor-2"]);
  assert.deepEqual(sources.map(source=>source.name),["Alpha source","Empty calendar","Zulu source"]);
});

test("calendar and dinner rows remain distinct even when names and dates match", () => {
  const merged = mergeTimelineEntries(
    [calendar("calendar-1", "2026-10-16T17:00:00Z", "Pasta")],
    [{ id: "dinner-1", localDate: "2026-10-16", title: "Pasta", emoji: "🍝", revision: 1, cleared: false }],
    "Europe/Oslo",
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(row => row.kind), ["calendar", "dinner"]);
  assert.deepEqual(merged.map(row => row.id), ["calendar-1", "dinner-1"]);
});

test("week rows retain timed and all-day activities that began before Monday, with exclusive ends", () => {
  const timed = calendar("ongoing-timed", "2026-10-11T23:30:00Z", "Synthetic overnight activity", ["p1"]);
  timed.endsAt = "2026-10-12T01:00:00Z";
  const allDay = calendar("ongoing-all-day", "2026-10-11T00:00:00Z", "Synthetic all-day activity", ["p1"]);
  allDay.metadata.allDay = true;
  allDay.endsAt = "2026-10-14T00:00:00Z";
  const endedAtBoundary = calendar("ended-at-boundary", "2026-10-11T22:00:00Z", "Synthetic ended activity", ["p1"]);
  endedAtBoundary.metadata.allDay = true;
  endedAtBoundary.endsAt = "2026-10-12T00:00:00Z";
  const rows = mergeTimelineEntries([timed, allDay, endedAtBoundary], [], "UTC", "2026-10-12", "2026-10-18");
  assert.deepEqual(rows.map(row => [row.id, row.date]), [["ongoing-all-day", "2026-10-12"], ["ongoing-timed", "2026-10-12"]]);
});

test("person week history retains an overlap begun yesterday and labels an item that ended today", () => {
  const stillRunning = calendar("still-running", "2026-10-15T18:00:00Z");
  stillRunning.endsAt = "2026-10-16T10:00:00Z";
  const ended = calendar("ended", "2026-10-15T00:00:00Z");
  ended.metadata.allDay = true;
  ended.endsAt = "2026-10-16T00:00:00Z";
  const range = personFutureWindow("2026-10-12", "2026-10-16");
  const rows = mergeTimelineEntries([stillRunning, ended], [], "Europe/Oslo", range.from, range.to);
  assert.deepEqual(rows.map(row => [row.id, row.date]), [["ended", "2026-10-16"], ["still-running", "2026-10-16"]]);
});

test("shared school items coalesce every subject while identical-title calendar events do not", () => {
  const rows = [
    { type: "school" as const, id: "school-1", taskId: "task", personId: "p2", date: "2026-10-16", time: "13:00", kind: "bring", title: "Remember lunch", actions: ["Pack lunch"], evidence: {}, confidence: 0.8, uncertainty: "medium", sourceUrl: null, recordedAt: null, expiresAt: "2026-10-16T11:00:00Z" },
    { type: "school" as const, id: "school-1", taskId: "task", personId: "p1", date: "2026-10-16", time: "13:00", kind: "bring", title: "Remember lunch", actions: ["Pack lunch"], evidence: {}, confidence: 0.8, uncertainty: "medium", sourceUrl: null, recordedAt: null, expiresAt: "2026-10-16T11:00:00Z" },
  ];
  assert.deepEqual(groupHomeSchoolActivities(rows)[0]?.personIds, ["p1", "p2"]);
  const calendarRows = [calendar("cal-1", "2026-10-16T10:00:00Z", "Remember lunch", ["p1"]), calendar("cal-2", "2026-10-16T10:00:00Z", "Remember lunch", ["p2"])];
  assert.deepEqual(dedupeTimelineActivities(calendarRows).map(row => row.id), ["cal-1", "cal-2"]);
});

test("duplicate school rows from multi-subject paging merge subject IDs instead of dropping the event", () => {
  const first = { type: "school" as const, id: "s1", taskId: "t1", personId: "p1", personIds: ["p1"], date: "2026-10-16", startsAt: "2026-10-16T11:00:00Z", time: "13:00", kind: "task", title: "Bring item", actions: ["Bring item"], evidence: {}, confidence: null, uncertainty: null, sourceUrl: null, recordedAt: null, expiresAt: "2026-10-16T11:00:00Z" };
  const second = { ...first, personId: "p2", personIds: ["p2"] };
  const merged = dedupeTimelineActivities([first, second]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.type === "school" ? merged[0].personIds : [], ["p1", "p2"]);
});

test("Home renders each same-day birthday and saved school item without birth dates or age guesses", () => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { theme: "light" } } } });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  const people = ["Synthetic Person One", "Synthetic Person Two", "Synthetic Person Three"].map((displayName, index) => ({ id: `person-${index}`, displayName }));
  const birthdays = [
    { personId: "person-0", displayName: people[0]!.displayName, due: "today" as const },
    { personId: "person-1", displayName: people[1]!.displayName, due: "today" as const },
    { personId: "person-2", displayName: people[2]!.displayName, due: "tomorrow" as const },
  ];
  const school = [{ type: "school" as const, id: "school-1", taskId: "task-1", personId: "person-0", date: "2026-10-16", time: "13:00", kind: "bring", title: "Synthetic library book", actions: ["Pack synthetic book"], evidence: { quote: "Synthetic source evidence" }, confidence: 0.9, uncertainty: null, sourceUrl: "https://school.test.invalid/source", recordedAt: "2026-10-15T12:00:00Z", expiresAt: "2026-10-16T11:00:00Z" }];
  for (const locale of ["en", "nb"] as const) {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(FamilyHub, { people, items: [], messages: [], zone: "Europe/Oslo", householdName: "Synthetic household", localDate: "2026-10-16", birthdays, schoolActivities: school, now: Date.parse("2026-10-16T08:00:00Z") }) }));
    assert.equal((html.match(/data-review-private="birthday-person"/g) ?? []).length, 3);
    assert.ok(html.includes(locale === "en" ? "Birthday today" : "Bursdag i dag"));
    assert.ok(html.includes(locale === "en" ? "Birthday tomorrow" : "Bursdag i morgen"));
    assert.ok(html.includes("Synthetic library book"));
    assert.ok(!html.includes("ageTurning") && !html.includes("birthDate"));
    const schoolHtml = renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(SchoolActivityCard, { activity: school[0]!, people }) }));
    assert.ok(schoolHtml.includes("Pack synthetic book"));
    assert.ok(schoolHtml.includes(`<summary>${locale === "en" ? "Source details" : "Kildedetaljer"}</summary>`));
    assert.ok(schoolHtml.indexOf("Pack synthetic book") < schoolHtml.indexOf("<details class=\"hub-school-provenance\">"), "actions stay visible before collapsed provenance");
    assert.ok(schoolHtml.includes("Synthetic source evidence"));
    assert.ok(schoolHtml.includes("https://school.test.invalid/source"));
    const compactSchoolHtml = renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(SchoolActivityCard, { activity: school[0]!, people, compact: true }) }));
    assert.ok(compactSchoolHtml.includes("Pack synthetic book"), "compact person previews keep the actionable school instruction");
    assert.ok(!compactSchoolHtml.includes("Synthetic Child 3"), "compact school preview does not repeat the entire subject roster");
  }
});

test("school freshness distinguishes confirmed, retained success, failed checks, unknown data and legacy projections",()=>{
 const people=[{id:"freshness-person",displayName:"Synthetic freshness person"}];
 const base={type:"school" as const,id:"freshness-school",taskId:"synthetic-task",personId:people[0]!.id,date:"2026-10-28",time:"14:00",kind:"notice",title:"Synthetic school notice",actions:[],evidence:{},confidence:null,uncertainty:null,sourceUrl:null,recordedAt:"2026-10-28T11:00:00Z",expiresAt:"2026-10-28T15:00:00Z"};
 const render=(activity:HomeSchoolActivity,locale:"en"|"nb"="en",now?:number)=>renderToStaticMarkup(createElement(LocaleProvider,{locale,children:createElement(SchoolActivityCard,{activity,people,zone:"Europe/Oslo",now})}));
 const retained=render({...base,freshness:{state:"retained",recordedAt:"2026-10-28T11:00:00Z",verifiedAt:"2026-10-28T12:15:00Z",latestAttempt:{outcome:"failed",at:"2026-10-28T12:20:00Z",errorCode:"synthetic-private-provider-code"}}});
 assert.match(retained,/class="hub-school-freshness is-retained"/);
 assert.match(retained,/1:15 PM|13:15/,"the freshness timestamp uses household time and includes time of day");
 assert.match(retained,/Latest check failed|Siste kontroll feilet/);
 assert.match(retained,/earlier result last verified|tidligere resultat sist bekreftet/);
 assert.doesNotMatch(retained,/synthetic-private-provider-code|provider-code/);
 const retainedSuccess=render({...base,freshness:{state:"retained",recordedAt:"2026-10-28T11:00:00Z",verifiedAt:"2026-10-28T12:15:00Z",latestAttempt:{outcome:"unchanged",at:"2026-10-28T12:20:00Z",errorCode:null}}},"en",Date.parse("2026-10-28T15:00:00Z"));
 assert.match(retainedSuccess,/Earlier result; last verified/);
 assert.doesNotMatch(retainedSuccess,/check failed|could not be confirmed/i);
 assert.match(retainedSuccess,/hub-ended-label/,"expired successful history is marked ended without implying a failed refresh");
 const unknown=render({...base,recordedAt:null,freshness:{state:"unknown",recordedAt:null,verifiedAt:null,latestAttempt:{outcome:"failed",at:"2026-10-28T12:20:00Z",errorCode:null}}});
 assert.match(unknown,/class="hub-school-freshness is-unknown"/);
 assert.match(unknown,/Latest check failed|Siste kontroll feilet/);
 assert.match(unknown,/verification remains unknown|bekreftelse av skoledata er fortsatt ukjent/);
 assert.doesNotMatch(unknown,/11:00|Last verified|Sist bekreftet/,"unknown provenance does not borrow a recorded timestamp as verification");
 const unknownNoAttempt=render({...base,recordedAt:null,freshness:{state:"unknown",recordedAt:null,verifiedAt:null,latestAttempt:{outcome:"running",at:null,errorCode:null}}});
 assert.match(unknownNoAttempt,/School data verification is unknown|Bekreftelse av skoledata er ukjent/);
 assert.doesNotMatch(unknownNoAttempt,/Latest check failed|Siste kontroll feilet|date unavailable|dato ukjent/);
 const verified=render({...base,freshness:{state:"verified",recordedAt:"2026-10-28T12:30:00Z",verifiedAt:"2026-10-28T12:25:00Z",latestAttempt:{outcome:"succeeded_no_findings",at:"2026-10-28T12:25:00Z",errorCode:null}}});
 assert.doesNotMatch(verified,/hub-school-freshness/,"a verified run with no findings is not mislabeled stale");
 assert.match(verified,/Last verified|Sist bekreftet/);
 assert.doesNotMatch(render(base),/hub-school-freshness|Last verified|Sist bekreftet/,"older projections remain compatible without claiming freshness");
});

test("offline birthday labels advance once from the source civil date without inferring birthdays",()=>{
 const birthdays=[{personId:"today",displayName:"Today person",due:"today" as const},{personId:"tomorrow",displayName:"Tomorrow person",due:"tomorrow" as const}];
 assert.deepEqual(advanceHomeBirthdays(birthdays,"2026-10-28","2026-10-28"),birthdays);
 assert.deepEqual(advanceHomeBirthdays(birthdays,"2026-10-28","2026-10-29"),[{personId:"tomorrow",displayName:"Tomorrow person",due:"today"}]);
 assert.deepEqual(advanceHomeBirthdays(birthdays,"2026-10-28","2026-10-30"),[]);
 assert.deepEqual(advanceHomeBirthdays(birthdays,"2026-10-28","2026-10-27"),birthdays);
 assert.deepEqual(advanceHomeBirthdays(birthdays,undefined,"2026-10-29"),birthdays,"generic callers keep the snapshot labels unless they pass the source day");
 const people=birthdays.map(person=>({id:person.personId,displayName:person.displayName}));
 const html=renderToStaticMarkup(createElement(LocaleProvider,{locale:"en",children:createElement(FamilyHub,{people,items:[],messages:[],zone:"Europe/Oslo",householdName:"Synthetic household",localDate:"2026-10-29",birthdaySourceLocalDate:"2026-10-28",birthdays,now:Date.parse("2026-10-28T23:30:00Z")})}));
 assert.match(html,/Birthday today/);
 assert.doesNotMatch(html,/Birthday tomorrow/);
});

test("school person summaries expire from the server deadline while day history keeps an ended row",()=>{
  Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{dataset:{theme:"light"}}}});
  Object.defineProperty(globalThis,"matchMedia",{configurable:true,value:()=>({matches:false})});
  const person={id:"school-person",displayName:"Synthetic school person"};
  const school=[{type:"school" as const,id:"expiring-school",taskId:"synthetic-task",personId:person.id,date:"2026-10-16",time:"13:00",kind:"bring",title:"Synthetic school activity",actions:["Bring synthetic item"],evidence:{},confidence:null,uncertainty:null,sourceUrl:null,recordedAt:null,expiresAt:"2026-10-16T10:00:00Z"}];
  const render=(now:number)=>renderToStaticMarkup(createElement(LocaleProvider,{locale:"en",children:createElement(FamilyHub,{people:[person],items:[],messages:[],zone:"Europe/Oslo",householdName:"Synthetic household",localDate:"2026-10-16",schoolActivities:school,now})}));
  const before=render(Date.parse("2026-10-16T09:59:59Z"));
  const after=render(Date.parse("2026-10-16T10:00:00Z"));
  assert.match(before,/Synthetic school activity/);
  assert.match(after,/Synthetic school activity/,"the ended day-history row stays understandable without a reload");
  assert.match(after,/hub-ended-label/);
  const personCard=after.match(/<article class="hub-person[^"]*"[^>]*data-person-id="school-person"[^>]*data-review-private="person-card">([\s\S]*?)<\/article>/)?.[1]??"";
  assert.ok(personCard,"the current-person card must be present for the expiry assertion");
  assert.doesNotMatch(personCard,/Synthetic school activity/,"expired school work leaves the current-person summary");
});

test("mobile identity strip retains birthday badges", () => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { theme: "light" } } } });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  const people = [{ id: "person-mobile", displayName: "Synthetic Mobile Person" }];
  const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en", children: createElement(FamilyHub, { people, items: [], messages: [], zone: "Europe/Oslo", householdName: "Synthetic household", localDate: "2026-10-16", birthdays: [{ personId: "person-mobile", displayName: people[0]!.displayName, due: "today" }] }) }));
  assert.match(html, /data-review-private="birthday-badge"/);
});
