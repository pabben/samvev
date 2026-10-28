import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectActivitySourcePages, currentCalendarActivityRelevant, dedupeTimelineActivities, groupHomeSchoolActivities, homeWeekStart, homeWeekTitleKey, isTimelineActivityOngoing, mergeTimelineEntries, personFutureWindow, shiftHomeDate, timedActivityUnended, timelineActivityVisible } from "../src/home-activity-presentation";
import type { HouseholdTimelineActivity } from "../src/home-types";
import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".webp") ? { format: "module", source: 'export default "synthetic-avatar.webp"', shortCircuit: true } : nextLoad(url, context); } });
const [{ FamilyHub }, { LocaleProvider }, { SchoolActivityCard }] = await Promise.all([import("../src/family-hub"), import("../src/ui"), import("../src/home-activities")]);

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
  const invalid=calendar("invalid-end","2026-10-16T09:00:00Z");invalid.endsAt=invalid.startsAt;
  assert.equal(mergeTimelineEntries([invalid],[],"Europe/Oslo").length,0,"an explicit invalid end is not replaced with a one-day span");
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
