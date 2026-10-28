import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FamilyHub } from "./family-hub";
import { HouseholdActivityWeek, SchoolActivityCard } from "./home-activities";
import { HouseholdBoardCards } from "./household-boards";
import { dateOffset, displayHouseholdBoardAdapter } from "./household-board-adapters";
import { calendarActivityEnded, mergeTimelineEntries, timelineActivityVisible, timelineDayHistoryVisible } from "./home-activity-presentation";
import type { HouseholdTimelineActivity, HubPerson } from "./home-types";
import { DisplayMediaPlayback } from "./media-library";
import { DeviceHomeAssistantControls } from "./home-assistant-controls";
import { secureUuid } from "./secure-uuid";
import { sha256 } from "@noble/hashes/sha2.js";
import { api, ApiError } from "./api";
import type { Card, Projection } from "./types";
import {
  Avatar,
  Brand,
  Check,
  Dialog,
  Empty,
  ErrorNotice,
  Icon,
  LocaleProvider,
  PrefControls,
  useAction,
  useI18n,
  usePreferences,
  type Preferences,
} from "./ui";
import { formatCalendarEventRange, formatDate } from "./time";
import { currentDisplayActivity, displayActivityAfterFailure, displayActivityVisible, displayMessageAudienceAllowed, permittedDisplayMessageAudience, pendingDisplayMessage, snapshotDisplayActivity, type DisplayActivityScope, type DisplayActivitySnapshot, type PendingDisplayMessage, type DisplayMessageRecipients } from "./display-lifecycle";
import {
  disconnected,
  streamSignal,
  projectionRecovered,
  type StreamSignal,
} from "./stream-health";
import {
  currentCards,
  currentHub,
  restoreCache,
  serverTime,
  type CacheClock,
  type CachedProjection,
} from "./display-cache";
const CACHE = "samvev.display.projection.v1";
function readCache(): {
  projection: Projection;
  clock: CacheClock;
  lastUpdated: string;
} | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedProjection;
    const clock = restoreCache(value, Date.now(), performance.now());
    if (!clock) {
      localStorage.removeItem(CACHE);
      return null;
    }
    return {
      projection: value.projection,
      clock,
      lastUpdated: value.lastUpdated,
    };
  } catch {
    return null;
  }
}
function clearSaved() {
  try {
    localStorage.removeItem(CACHE);
  } catch {
    /* In-memory state is still cleared. */
  }
}
export function DisplayApp() {
  const [prefs, setPrefs] = usePreferences("samvev.display.preferences");
  return (
    <LocaleProvider locale={prefs.locale}>
      <DisplayRuntime prefs={prefs} setPrefs={setPrefs} />
    </LocaleProvider>
  );
}
function DisplayRuntime({
  prefs,
  setPrefs,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
}) {
  const { t, locale } = useI18n();
  const [initialCache] = useState(readCache);
  const initial = useRef(initialCache);
  const [projection, setProjection] = useState<Projection | null>(
    initial.current?.projection ?? null,
  );
  const clock = useRef<CacheClock | null>(initial.current?.clock ?? null);
  const [online, setOnline] = useState(false);
  const onlineRef = useRef(false);
  const [streamLive, setStreamLive] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [cacheExpired, setCacheExpired] = useState(false);
  const [streamDegraded, setStreamDegraded] = useState(false);
  const streamHealth = useRef(disconnected());
  const refreshAgain = useRef(false);
  const [needsPair, setNeedsPair] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(
    initial.current?.lastUpdated ?? "",
  );
  const [options, setOptions] = useState(false);
  const [layout, setLayout] = useState<"board" | "timeline">(() => {
    try {
      return localStorage.getItem("samvev.display.layout") === "timeline"
        ? "timeline"
        : "board";
    } catch {
      return "board";
    }
  });
  const acknowledged = useRef(new Set<string>());
  const requestActive = useRef(false);
  const eventSource = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const hasPaired = useRef(Boolean(initial.current));
  const loseConnection = useCallback(() => {
    streamHealth.current = streamSignal(streamHealth.current, "error");
    setStreamLive(false);
    setStreamDegraded(false);
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    setProjection(null);
    clock.current = null;
    clearSaved();
    setNeedsPair(true);
    setRevoked(true);
    onlineRef.current = false;
    setOnline(false);
    setStreamLive(false);
    loseConnection();
    acknowledged.current.clear();
    eventSource.current?.close();
  }, [loseConnection]);
  const refresh: () => Promise<void> = useCallback(async () => {
    if (requestActive.current) {
      refreshAgain.current = true;
      return;
    }
    requestActive.current = true;
    const current = generation.current;
    const requestEpoch = streamHealth.current.epoch;
    try {
      const p = await api<Projection>("/display/projection");
      if (!mounted.current || current !== generation.current) return;
      const serverAt = Date.parse(p.serverNow);
      clock.current = {
        serverAt,
        monotonicAt: performance.now(),
        deadline: Math.min(Date.parse(p.cacheUntil), serverAt + 900000),
      };
      hasPaired.current = true;
      setProjection(p);
      setCacheExpired(false);
      streamHealth.current = projectionRecovered(
        streamHealth.current,
        requestEpoch,
      );
      setStreamLive(streamHealth.current.phase === "live");
      setPrefs({ locale: p.display.locale, theme: p.display.theme });
      setLastUpdated(p.generatedAt);
      setOnline(true);
      onlineRef.current = true;
      setNeedsPair(false);
      setRevoked(false);
      try {
        localStorage.setItem(
          CACHE,
          JSON.stringify({
            projection: p,
            savedAt: Date.now(),
            lastUpdated: p.generatedAt,
          }),
        );
      } catch {
        /* Storage may be disabled; runtime cache remains bounded. */
      }
    } catch (e) {
      if (!mounted.current || current !== generation.current) return;
      setOnline(false);
      onlineRef.current = false;
      if ([401, 403].includes((e as ApiError).status)) {
        if (hasPaired.current) clear();
        else {
          setProjection(null);
          clock.current = null;
          clearSaved();
          setNeedsPair(true);
        }
      }
    } finally {
      requestActive.current = false;
      if (mounted.current) {
        setLoading(false);
        if (refreshAgain.current) {
          refreshAgain.current = false;
          queueMicrotask(() => void refresh());
        }
      }
    }
  }, [clear, setPrefs]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 5000);
    const ticker = setInterval(() => {
      setTick((v) => v + 1);
      if (
        clock.current &&
        serverTime(clock.current, performance.now()) >= clock.current.deadline
      ) {
        setProjection(null);
        clock.current = null;
        clearSaved();
        setCacheExpired(true);
        setOnline(false);
        onlineRef.current = false;
        loseConnection();
      }
    }, 1000);
    const offline = () => {
      onlineRef.current = false;
      setOnline(false);
      loseConnection();
      eventSource.current?.close();
    };
    const online = () => {
      loseConnection();
      setStreamEpoch((value) => value + 1);
      void refresh();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearInterval(ticker);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [refresh, loseConnection]);
  useEffect(() => {
    if (!projection || needsPair) return;
    const source = new EventSource("/api/v1/display/events");
    eventSource.current = source;
    const signal = (
      kind: "ready" | "heartbeat" | "listener-degraded" | "listener-restored",
      event: Event,
    ) => {
      if (eventSource.current !== source) return;
      let payload: StreamSignal = {};
      try {
        payload = JSON.parse((event as MessageEvent).data);
      } catch {}
      streamHealth.current = streamSignal(streamHealth.current, kind, payload);
      setStreamLive(streamHealth.current.phase === "live");
      setStreamDegraded(streamHealth.current.phase === "degraded");
      if (kind === "ready" || kind === "listener-restored") void refresh();
    };
    source.addEventListener("ready", (event) => signal("ready", event));
    source.addEventListener("heartbeat", (event) => signal("heartbeat", event));
    source.addEventListener("listener-degraded", (event) =>
      signal("listener-degraded", event),
    );
    source.addEventListener("listener-restored", (event) =>
      signal("listener-restored", event),
    );
    source.addEventListener("projection-invalidated", () => void refresh());
    source.addEventListener("authorization-revoked", clear);
    source.onerror = () => {
      streamHealth.current = streamSignal(streamHealth.current, "error");
      setStreamLive(false);
      void refresh();
    };
    return () => {
      source.close();
      loseConnection();
      eventSource.current = null;
    };
  }, [
    projection?.display.id,
    needsPair,
    clear,
    refresh,
    loseConnection,
    streamEpoch,
  ]);
  const cards =
    projection && clock.current
      ? currentCards(projection, clock.current, performance.now()).sort(
          (a, b) =>
            Number(b.importance === "attention") -
              Number(a.importance === "attention") ||
            Date.parse(a.publishAt) - Date.parse(b.publishAt),
        )
      : [];
  useEffect(() => {
    if (!online || !projection || !clock.current) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          cancelled ||
          !onlineRef.current ||
          document.visibilityState !== "visible"
        )
          return;
        for (const card of cards) {
          const key = `${projection.display.id}:${card.id}:${card.revision}`;
          if (acknowledged.current.has(key)) continue;
          const element = document.querySelector(
            `[data-card-id="${CSS.escape(card.id)}"] .display-card-body`,
          );
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.bottom <= 0 ||
            rect.top >= innerHeight - Math.min(24, rect.height) ||
            rect.right <= 0 ||
            rect.left >= innerWidth
          )
            continue;
          acknowledged.current.add(key);
          void api("/display/render-ack", "POST", {
            cardId: card.id,
            revision: card.revision,
            renderedAt: new Date(
              serverTime(clock.current!, performance.now()),
            ).toISOString(),
          }).catch((e) => {
            acknowledged.current.delete(key);
            if ((e as ApiError).status === 401) clear();
          });
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    cards.map((c) => `${c.id}:${c.revision}`).join(","),
    online,
    projection?.display.id,
    tick,
  ]);
  const hub = projection && clock.current ? currentHub(projection, clock.current, performance.now()) : undefined;
  const selectedCards=projection?.setup?.cardOrder??[];
  const activityScope:DisplayActivityScope|null=projection&&clock.current?{generation:JSON.stringify([projection.display.id,projection.setup?.id,projection.display.privacyMode,projection.generatedAt]),clock:clock.current,maxAgeMs:projection.maxStaleSeconds*1000}:null;
  const displayNow=clock.current?serverTime(clock.current,performance.now()):Number.NaN;
  const zone = projection?.display.timezone ?? "UTC";
  const displayLocalDate=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number.isFinite(displayNow)?displayNow:Date.now()));
  const familyPeople = [...new Map([...(projection?.familyLayout?.people ?? []), ...(hub?.people ?? [])].map(person => [person.id, person])).values()];
  const duplicateFamilyPeople = selectedCards.includes("people");
  const showFamily=Boolean(projection?.setup?.cards.includes("family_layout")&&projection.setup.familyLayoutEnabled&&!projection.display.privacyMode);
  const familyDisplay=showFamily||Boolean(selectedCards.includes("people")&&!projection?.display.privacyMode);
  const displayBoardAdapter=useMemo(()=>projection?displayHouseholdBoardAdapter(projection.display.id,
    {groceries:projection.householdBoards?.readable?.groceries===true,dinners:projection.householdBoards?.readable?.dinners===true},
    {groceries:online&&!projection.display.privacyMode&&projection.householdBoards?.writable?.groceries===true,dinners:online&&!projection.display.privacyMode&&projection.householdBoards?.writable?.dinners===true}
  ):null,[projection?.display.id,projection?.display.privacyMode,projection?.householdBoards?.readable?.groceries,projection?.householdBoards?.readable?.dinners,projection?.householdBoards?.writable?.groceries,projection?.householdBoards?.writable?.dinners,online]);
  const paired = useCallback(async () => {
    generation.current++;
    await refresh();
  }, [refresh, loseConnection]);
  if (needsPair)
    return (
      <Pairing
        prefs={prefs}
        setPrefs={setPrefs}
        revoked={revoked}
        onPaired={paired}
      />
    );
  if (loading && !projection)
    return (
      <div className="display-loading">
        <Brand />
        <p role="status">{t("loading")}</p>
      </div>
    );
  return (
    <div
      className={`display-page layout-${layout} ${familyDisplay ? "family-display-page" : ""}`}
      data-timezone={projection?.display.timezone ?? "UTC"}
      data-cache-state={
        projection ? "current" : cacheExpired ? "expired" : "unavailable"
      }
    >
      <header className="display-header">
        <div>
          <Brand />
          <div className="display-identity">
            <span>
              {projection?.display.householdName ?? t("displayGreeting")}
            </span>
            <strong>{projection?.display.name ?? t("unknownDisplay")}</strong>
          </div>
        </div>
        <div className="display-date">
          <strong>
            {formatDate(Number.isFinite(displayNow)?displayNow:Date.now(), locale, zone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </strong>
          <span>
            {formatDate(Number.isFinite(displayNow)?displayNow:Date.now(), locale, zone, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={t("displayOptions")}
          onClick={() => setOptions(true)}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main className="display-main">
        {!familyDisplay && !hub && <div className="display-section-title">
          <div>
            <p className="eyebrow">{t("displayNow")}</p>
            <h1>{t("displayGreeting")}</h1>
          </div>
          <span
            className={`connection-pill ${online ? "" : "stale"}`}
            role="status"
          >
            <span className="live-dot" />
            {t(
              !projection
                ? "reconnecting"
                : online
                  ? streamLive
                    ? "live"
                    : streamDegraded
                      ? "polling"
                      : "reconnecting"
                  : "offline",
            )}
          </span>
        </div>}
        {!online && (
          <div className="notice offline" role="status">
            <Icon name="offline" />
            <div>
              <strong>{t(projection ? "offline" : "cacheCleared")}</strong>
              <p>
                {lastUpdated
                  ? t("offlineSince", {
                      time: formatDate(lastUpdated, locale, zone),
                    })
                  : t("cacheCleared")}
              </p>
            </div>
          </div>
        )}
        {projection && !projection.display.timezone && (
          <p className="field-hint">{t("timezoneFallback")}</p>
        )}
        {showFamily&&<div className="display-ordered-card" style={{order:selectedCards.indexOf("family_layout")+3}}><FamilyHub key={`family:${projection!.display.id}:${projection!.setup?.id}:${projection!.display.privacyMode}`} display displayCompactPeople displaySections={{people:!duplicateFamilyPeople,today:!selectedCards.includes("today"),tomorrow:!selectedCards.includes("tomorrow"),important:!selectedCards.includes("worth_remembering"),support:!selectedCards.includes("worth_remembering"),week:false,next:false}} displayDinnersReadable={!selectedCards.includes("dinners")&&projection!.householdBoards?.readable?.dinners===true} birthdays={duplicateFamilyPeople?[]:projection!.familyLayout?.upcomingBirthdays??[]} people={duplicateFamilyPeople?[]:familyPeople} items={hub?.items??[]} messages={projection!.setup?.cards.includes("household_messages")?cards.map(card => ({id:card.id,body:card.body,importance:card.importance,authorName:card.author,authorPersonId:card.authorPersonId,authorAvatarKey:card.authorAvatarKey,authorPhoto:card.authorPhoto,publishAt:card.publishAt,expiresAt:card.expiresAt,revision:card.revision})):[]} zone={zone} householdName={projection!.display.householdName} now={displayNow} connection={t(online ? streamLive ? "live" : "polling" : "offline")}/></div>}
        {!showFamily&&projection?.setup?.cards.includes("household_messages")&&cards.length ? (
          <div className="display-cards display-ordered-card" style={{order:selectedCards.indexOf("household_messages")+3}}>
            {layout === "board"
              ? cards.map((card, i) => (
                  <DisplayCard
                    key={card.id}
                    card={card}
                    zone={zone}
                    primary={i === 0}
                  />
                ))
              : Array.from(
                  cards.reduce((groups, card) => {
                    groups.set(card.author, [
                      ...(groups.get(card.author) ?? []),
                      card,
                    ]);
                    return groups;
                  }, new Map<string, Card[]>()),
                ).map(([author, group]) => (
                  <section className="person-column" key={author}>
                    <h2>
                      <Avatar name={author} personId={group?.[0]?.authorPersonId} colorToken={group?.[0]?.authorColorToken} avatarKey={group?.[0]?.authorAvatarKey} photo={group?.[0]?.authorPhoto}/>
                      {author}
                    </h2>
                    {group!
                      .sort(
                        (a, b) =>
                          Date.parse(a.publishAt) - Date.parse(b.publishAt),
                      )
                      .map((card) => (
                        <DisplayCard key={card.id} card={card} zone={zone} />
                      ))}
                  </section>
                ))}
          </div>
        ) : !showFamily&&!projection?.setup?.cards.length ? <Empty title={t("displayEmpty")} body={t("displayEmptyBody")}/> : null}
        {projection&&selectedCards.map(card=>{
          const order=selectedCards.indexOf(card)+3;
          if(projection.display.privacyMode&&["external_items","photos","home_assistant","today","tomorrow","week","next","people","worth_remembering","groceries","dinners"].includes(card))return null;
          if(card==="new_message")return !projection.display.privacyMode&&projection.actionAvailability?.newMessage?<div className="display-ordered-card" key={card} style={{order}}><DisplayMessageComposer key={projection.display.id} recipientGeneration={JSON.stringify([projection.display.id,projection.setup?.id,projection.display.privacyMode,projection.generatedAt])} online={online} now={displayNow}/></div>:null;
          if(card==="groceries"||card==="dinners")return displayBoardAdapter?<div className="display-ordered-card" key={card} style={{order}}><HouseholdBoardCards adapter={displayBoardAdapter} localDate={displayLocalDate} visibleCards={[card]} display/></div>:null;
          if(card==="photos")return online?<div className="display-ordered-card" key={card} style={{order}}><DisplayMediaPlayback displayId={projection.display.id} enabled/></div>:null;
          if(card==="home_assistant")return online?<div className="display-ordered-card" key={card} style={{order}}><DeviceHomeAssistantControls timezone={zone} canAct={projection.actionAvailability?.homeAssistantControl===true&&online&&!projection.display.privacyMode} compact/></div>:null;
          if(["household_messages","family_layout","new_message"].includes(card))return null;
          if(card==="today"||card==="tomorrow"){
            const localToday=displayLocalDate;const date=card==="today"?localToday:dateOffset(localToday,1);
            return <div className="display-ordered-card" style={{order}} key={card}>{activityScope&&<DisplayDayCard scope={activityScope} date={date} zone={zone} people={familyPeople} birthdays={projection.familyLayout?.upcomingBirthdays} dinnersReadable={projection.householdBoards?.readable?.dinners===true} labelKey={card}/>}</div>
          }
          if(card==="week")return <div className="display-ordered-card" key={card} style={{order}}><HouseholdActivityWeek localDate={displayLocalDate} zone={zone} people={familyPeople} display now={displayNow} householdBoardsReadableDinners={projection.householdBoards?.readable?.dinners===true} showNextActivity={false}/></div>;
          if(card==="next")return <div className="display-ordered-card" key={card} style={{order}}>{activityScope&&<DisplayNextActivity scope={activityScope} zone={zone} people={familyPeople}/>}</div>;
          if(card==="people")return <div className="display-ordered-card" style={{order}} key={card}><FamilyHub display displayCompactPeople displaySections={{people:true,today:false,tomorrow:false,important:false,messages:false,support:false,week:false,environment:false,next:false}} people={familyPeople} items={[]} messages={[]} birthdays={projection.familyLayout?.upcomingBirthdays??[]} zone={zone} householdName={projection.display.householdName} now={displayNow}/></div>;
          if(!hub)return null;
          if(card==="worth_remembering")return <section className="hub-panel display-selected-card display-ordered-card" style={{order}} key={card}><h2>{t("worthRemembering")}</h2>{hub.items.filter(item=>item.kind==="summary"||item.kind==="list").slice(0,8).map(item=><article key={item.id}><strong>{item.title}</strong>{item.body&&<p>{item.body}</p>}</article>)}</section>;
          if(card==="external_items"){
            const calendarItems=hub.items.filter(item=>item.metadata.calendar).slice(0,8);
            if(!calendarItems.length)return null;
            return <section className="hub-panel display-selected-card display-ordered-card" style={{order}} key={card}><h2>{t("externalItems")}</h2>{calendarItems.map(item=><article key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>)}</section>;
          }
          return null;
        })}
      </main>
      <footer className="display-footer">
        <span>
          <Icon name="shield" />
          {t(familyDisplay ? "hubAllowedContent" : "allowedContent")}
        </span>
        <span>
          {lastUpdated
            ? t("updated", {
                time: formatDate(lastUpdated, locale, zone, {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : t("reconnecting")}
        </span>
      </footer>
      {options && (
        <Dialog title={t("displayOptions")} onClose={() => setOptions(false)}>
          <p className="field-hint">
            {t("displayTheme")} · {t("displayLocale")}
          </p>
          <p>{t("restrictedNotice")}</p>
          {!familyDisplay && !hub && <label className="field">
            <span>{t("displayLayout")}</span>
            <select
              value={layout}
              onChange={(e) => {
                const v = e.target.value as "board" | "timeline";
                setLayout(v);
                try {
                  localStorage.setItem("samvev.display.layout", v);
                } catch {}
              }}
            >
              <option value="board">{t("board")}</option>
              <option value="timeline">{t("timeline")}</option>
            </select>
          </label>}
          <button
            className="button"
            onClick={() => {
              void document.documentElement
                .requestFullscreen?.()
                .catch(() => undefined);
              setOptions(false);
            }}
          >
            {t("fullScreen")}
          </button>
        </Dialog>
      )}
    </div>
  );
}
function DisplayMessageComposer({online,now,recipientGeneration}:{online:boolean;now:number;recipientGeneration:string}){
 const {t}=useI18n();const {run,busy,error}=useAction();const [recipientState,setRecipientState]=useState<{generation:string;value:DisplayMessageRecipients|null;error:unknown}|null>(null);const [retry,setRetry]=useState(0);const [body,setBody]=useState("");const [personIds,setPersonIds]=useState<string[]>([]);const [displayIds,setDisplayIds]=useState<string[]>([]);const pending=useRef<PendingDisplayMessage|null>(null);const inFlight=useRef(false);const currentGeneration=useRef(recipientGeneration);currentGeneration.current=recipientGeneration;
 // The projection omits recipient policy revisions. Hide earlier labels in the
 // render itself; keep the body mounted while the current allowlist is read.
 const currentRecipients=recipientState?.generation===recipientGeneration?recipientState:null;
 const targets=currentRecipients?.value??null;const targetsError=currentRecipients?.error;
 const audience=targets?permittedDisplayMessageAudience({personIds,displayIds},targets):{personIds:[],displayIds:[]};
 useEffect(()=>{
  let active=true;const generation=recipientGeneration;
  if(online)void api<DisplayMessageRecipients>("/display/message-recipients").then(value=>{
   if(!active||currentGeneration.current!==generation)return;
   if(pending.current&&!displayMessageAudienceAllowed(pending.current.payload.audience,value))pending.current=null;
   setPersonIds(previous=>permittedDisplayMessageAudience({personIds:previous,displayIds:[]},value).personIds);
   setDisplayIds(previous=>permittedDisplayMessageAudience({personIds:[],displayIds:previous},value).displayIds);
   setRecipientState({generation,value,error:null});
  }).catch(cause=>{
   if(!active||currentGeneration.current!==generation)return;
   if([401,403,404].includes((cause as ApiError).status)){pending.current=null;setPersonIds([]);setDisplayIds([])}
   setRecipientState({generation,value:null,error:cause});
  });
  return()=>{active=false};
 },[online,retry,recipientGeneration]);
 const send=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!online||!targets||inFlight.current||!Number.isFinite(now)||!body.trim()||(!audience.personIds.length&&!audience.displayIds.length))return;
  inFlight.current=true;let succeeded=false;
  try{const previous=pending.current&&displayMessageAudienceAllowed(pending.current.payload.audience,targets)?pending.current:null;pending.current=pendingDisplayMessage(previous,{body,...audience},now,secureUuid);const request=pending.current;await run(async()=>{await api("/display/messages","POST",request.payload);succeeded=true});}
  finally{inFlight.current=false;}
  if(succeeded){pending.current=null;setBody("");setPersonIds([]);setDisplayIds([])}
 };
 return <form className="hub-panel display-message-compose" onSubmit={event=>void send(event)}><h2>{t("newMessage")}</h2><fieldset className="form-stack" style={{border:0,padding:0,margin:0,minWidth:0}} disabled={!online||busy}><label className="field"><span>{t("messageBody")}</span><textarea maxLength={1000} value={body} onChange={e=>setBody(e.target.value)} required/></label><fieldset aria-busy={!targets&&!targetsError}><legend>{t("displayMessagePeopleRecipients")}</legend>{targets?.people.map(person=><Check key={person.id} label={person.displayName} checked={audience.personIds.includes(person.id)} onChange={checked=>setPersonIds(previous=>checked?[...new Set([...previous,person.id])]:previous.filter(id=>id!==person.id))}/>)}</fieldset><fieldset aria-busy={!targets&&!targetsError}><legend>{t("displayMessageDisplayRecipients")}</legend>{targets?.displays.map(display=><Check key={display.id} label={display.name} checked={audience.displayIds.includes(display.id)} onChange={checked=>setDisplayIds(previous=>checked?[...new Set([...previous,display.id])]:previous.filter(id=>id!==display.id))}/>)}</fieldset>{!targets&&!targetsError&&<p className="field-hint" role="status">{t("loading")}</p>}<button className="button primary" disabled={!targets||!body.trim()||(!audience.personIds.length&&!audience.displayIds.length)}>{t("send")}</button></fieldset><ErrorNotice error={error??targetsError}/>{Boolean(targetsError)&&<button type="button" className="text-button" disabled={!online||busy} onClick={()=>setRetry(value=>value+1)}>{t("retry")}</button>}</form>
}

type ActivityLoad<T>={value:T;serverNow:string};
type ActivityState<T>={generation:string;snapshot:DisplayActivitySnapshot<T>|null;error:unknown;loaded:boolean};
function useDisplayActivity<T>(scope:DisplayActivityScope,read:(isCurrent:()=>boolean)=>Promise<ActivityLoad<T>|null>,dependencies:unknown[]){
 const [state,setState]=useState<ActivityState<T>|null>(null),[retry,setRetry]=useState(0),[refreshTick,setRefreshTick]=useState(0);
 useEffect(()=>{const timer=window.setInterval(()=>setRefreshTick(value=>value+1),30_000);return()=>window.clearInterval(timer)},[]);
 useEffect(()=>{
  let active=true;const generation=scope.generation;
  // A new projection must never paint data fetched under older grants. Keep
  // same-generation errors visible during retry; success alone clears them.
  setState(previous=>previous?.generation===generation?previous:{generation,snapshot:null,error:null,loaded:false});
  void read(()=>active).then(result=>{
   if(!active||!result)return;
   const snapshot=snapshotDisplayActivity(scope,result.value,result.serverNow,performance.now());
   setState({generation,snapshot,error:null,loaded:true});
  }).catch(cause=>{if(active)setState(previous=>({generation,snapshot:displayActivityAfterFailure(previous?.generation===generation?previous.snapshot:null,(cause as ApiError).status),error:cause,loaded:true}))});
  return()=>{active=false};
 },[scope.generation,refreshTick,retry,...dependencies]);
 const current=state?.generation===scope.generation?state:null;
 const snapshot=currentDisplayActivity(current?.snapshot??null,scope,performance.now());
 const now=Math.max(serverTime(scope.clock,performance.now()),snapshot?serverTime(snapshot.clock,performance.now()):Number.NEGATIVE_INFINITY);
 return{value:snapshot?.value,now,loaded:current?.loaded??false,error:current?.error,expired:Boolean(current?.snapshot&&!snapshot),retry:()=>setRetry(value=>value+1)};
}

function DisplayDayCard({scope,date,zone,people,birthdays,dinnersReadable,labelKey}:{scope:DisplayActivityScope;date:string;zone:string;people:HubPerson[];birthdays:NonNullable<Projection["familyLayout"]>["upcomingBirthdays"];dinnersReadable:boolean;labelKey:"today"|"tomorrow"}){
 const {t,locale}=useI18n();
 type DayValue={activities:HouseholdTimelineActivity[];dinners:Array<{id:string;localDate:string;title:string|null;emoji:string|null;revision:number;cleared:boolean}>};
 const state=useDisplayActivity<DayValue>(scope,async isCurrent=>{
  const rows:HouseholdTimelineActivity[]=[];let cursor:string|null=null,serverNow="";
  for(let page=0;page<10;page++){
   if(!isCurrent())return null;
   const query=new URLSearchParams({from:date,to:date,limit:"50"});if(cursor)query.set("cursor",cursor);
   const result=await api<{activities:HouseholdTimelineActivity[];nextCursor:string|null;serverNow:string}>(`/display/activities?${query}`);
   rows.push(...result.activities);serverNow=result.serverNow;cursor=result.nextCursor;if(!cursor)break;
  }
  if(!isCurrent())return null;
  if(cursor)throw new Error("display_activity_page_limit");
  const dinnerResult=dinnersReadable?await api<{assignments:DayValue["dinners"]}>(`/display/dinners?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`):{assignments:[]};
  return{value:{activities:rows,dinners:dinnerResult.assignments},serverNow};
 },[date,dinnersReadable]);
 const activities=(state.value?.activities??[]).filter(activity=>timelineDayHistoryVisible(activity,state.now));
 const entries=mergeTimelineEntries(activities,state.value?.dinners??[],zone,date,date);
 const birthdaysToday=birthdays?.filter(birthday=>birthday.due===labelKey)??[];
 const heading=t(labelKey==="today"?"hubToday":"hubTomorrow");
 return <section className="hub-panel display-selected-card" aria-label={heading} aria-busy={!state.loaded}><h2>{heading}</h2>{birthdaysToday.map(person=><p className="hub-person-birthday" key={person.personId}>🎂 {person.displayName}</p>)}{entries.map(entry=>entry.kind==="school"?<SchoolActivityCard key={entry.id} activity={entry.activity} people={people} compact now={state.now}/>:entry.kind==="dinner"?<article className="display-preview-item" key={entry.id}>{entry.emoji} {entry.title}</article>:<article className="display-preview-item" key={entry.id}><strong>{entry.activity.title}</strong>{calendarActivityEnded(entry.activity.startsAt,entry.activity.endsAt,Boolean(entry.activity.metadata.calendar&&entry.activity.metadata.allDay),state.now,zone)&&<small className="hub-ended-label">{t("hubEnded")}</small>}{typeof entry.activity.body==="string"&&<p>{entry.activity.body}</p>}</article>)}{Boolean(state.error||state.expired)&&<><ErrorNotice error={state.error}/>{state.expired&&<p className="field-hint" role="status">{t("cacheCleared")}</p>}<button type="button" className="text-button" onClick={state.retry}>{t("retry")}</button></>}{state.loaded&&!state.error&&!state.expired&&!entries.length&&!birthdaysToday.length&&<p className="field-hint">{t("displayDayEmpty")}</p>}{!state.loaded&&<p className="field-hint">{t("loading")}</p>}<span className="sr-only">{formatDate(`${date}T12:00:00Z`,locale,"UTC",{dateStyle:"full"})}</span></section>;
}

function DisplayNextActivity({scope,zone,people}:{scope:DisplayActivityScope;zone:string;people:HubPerson[]}){
 const {t,locale}=useI18n();
 const state=useDisplayActivity<HouseholdTimelineActivity|null>(scope,async()=>{
  const result=await api<{activity:HouseholdTimelineActivity|null;serverNow:string}>("/display/activities/next");return{value:result.activity,serverNow:result.serverNow};
 },[]);
 const activity=state.value&&displayActivityVisible(state.value,state.now,zone,true)&&timelineActivityVisible(state.value,state.now,zone,true)?state.value:null;
 const expired=state.expired||Boolean(state.value&&!activity);
 const activityPeople=activity?.personIds?.map(id=>people.find(person=>person.id===id)).filter((person):person is HubPerson=>Boolean(person))??[];
 const targetNames=activityPeople.map(person=>person.displayName).join(" · ")||(activity?.type==="calendar"&&activity.metadata.calendar?.subjectHousehold?t("hubFamily"):"");
 return <section className="hub-panel display-selected-card" aria-label={t("next")} aria-busy={!state.loaded}><h2>{t("next")}</h2>{activity?.type==="school"?<SchoolActivityCard activity={activity} people={people} compact/>:activity?.type==="calendar"?<article><strong>{activity.title}</strong>{targetNames&&<p>{targetNames}</p>}{activity.startsAt&&<p>{activity.metadata.allDay&&<>{t("hubAllDay")} · </>}{formatCalendarEventRange(activity.startsAt,activity.endsAt,locale,zone,Boolean(activity.metadata.calendar&&activity.metadata.allDay))}</p>}</article>:null}{Boolean(state.error||expired)&&<><ErrorNotice error={state.error}/>{expired&&<p className="field-hint" role="status">{t("cacheCleared")}</p>}<button type="button" className="text-button" onClick={state.retry}>{t("retry")}</button></>}{!activity&&!state.error&&!expired&&(state.loaded?<p className="field-hint">{t("displayNextEmpty")}</p>:<p className="field-hint">{t("loading")}</p>)}</section>;
}

export function DisplayCard({
  card,
  zone,
  primary = false,
}: {
  card: Card;
  zone: string;
  primary?: boolean;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const bodyElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = bodyElement.current;
    if (!element || expanded) return;
    const measure = () =>
      setOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card.body, expanded]);
  return (
    <article
      data-card-id={card.id}
      className={`display-card ${card.importance} ${primary ? "primary-card" : ""}`}
    >
      <div className="display-card-top">
        <span className={`message-type ${card.importance}`}>
          <Icon name={card.importance === "attention" ? "sun" : "message"} />
          {t(card.importance)}
        </span>
        <span>
          {formatDate(card.publishAt, locale, zone, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <p
        ref={bodyElement}
        className={`display-card-body ${expanded ? "expanded" : ""}`}
      >
        {card.body}
      </p>
      {(overflow || expanded) && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "readLess" : "readMore")}
        </button>
      )}
      <div className="display-card-meta">
        <Avatar name={card.author} personId={card.authorPersonId} colorToken={card.authorColorToken} avatarKey={card.authorAvatarKey} photo={card.authorPhoto}/>
        <strong>{t("from", { name: card.author })}</strong>
        <span className="display-until">
          <Icon name="clock" />
          {t("until", {
            time: formatDate(card.expiresAt, locale, zone, {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </span>
      </div>
    </article>
  );
}
function Pairing({
  prefs,
  setPrefs,
  revoked,
  onPaired,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  revoked: boolean;
  onPaired: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { error, busy, run, setError } = useAction();
  const [pair, setPair] = useState<{
    pairingId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const verifier = useRef("");
  const [expired, setExpired] = useState(false);
  const redeemActive = useRef(false);
  const generate = () =>
    void run(async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      verifier.current = btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const hash = sha256(new TextEncoder().encode(verifier.current));
      const verifierHash = Array.from(hash, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const next = await api<{
        pairingId: string;
        code: string;
        expiresAt: string;
      }>("/display/pairing/start", "POST", { verifierHash });
      setPair(next);
      setExpired(false);
    });
  useEffect(() => {
    if (!pair || expired) return;
    const timer = setInterval(async () => {
      if (Date.now() >= Date.parse(pair.expiresAt)) {
        setExpired(true);
        verifier.current = "";
        return;
      }
      if (redeemActive.current || !navigator.onLine) return;
      try {
        const status = await api<{ approved: boolean; expired: boolean }>(
          `/display/pairing/${pair.pairingId}/status`,
        );
        if (status.expired) {
          setExpired(true);
          verifier.current = "";
        } else if (status.approved) {
          redeemActive.current = true;
          await api("/display/pairing/redeem", "POST", {
            pairingId: pair.pairingId,
            verifier: verifier.current,
          });
          verifier.current = "";
          await onPaired();
        }
      } catch (error) {
        setError(error);
        redeemActive.current = false;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pair, expired, onPaired, setError]);
  return (
    <div className="public-page pairing-page">
      <header className="public-header">
        <Brand />
        <PrefControls prefs={prefs} onChange={setPrefs} />
      </header>
      <main className="pairing-main">
        <div className="pairing-symbol">
          <Icon name="display" size={60} />
        </div>
        <p className="eyebrow">{t("pairingEyebrow")}</p>
        <h1>{t("pairingTitle")}</h1>
        <p className="lead">{t("pairingBody")}</p>
        {revoked && <p className="notice">{t("revokedNotice")}</p>}
        {pair && !expired ? (
          <>
            <div
              className="pairing-code"
              aria-label={t("pairingCode")}
              data-testid="pairing-code"
            >
              {pair.code}
            </div>
            <p className="waiting">
              <span className="live-dot" />
              {t("waitingApproval")}
            </p>
            <p>
              {t("codeExpires", {
                time: formatDate(
                  pair.expiresAt,
                  locale,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  { hour: "2-digit", minute: "2-digit" },
                ),
              })}
            </p>
          </>
        ) : (
          <>
            <p>{expired ? t("codeExpired") : ""}</p>
            <button
              className="button primary"
              disabled={busy}
              onClick={generate}
            >
              {t(expired ? "regenerate" : "generateCode")}
              <Icon name="arrow" />
            </button>
          </>
        )}
        <ErrorNotice error={error} />
        <p className="restricted-note">
          <Icon name="shield" />
          {t("restrictedNotice")}
        </p>
      </main>
    </div>
  );
}
