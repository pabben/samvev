import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Card, Display, Membership, Person, Projection } from "./types";
import type { CalendarConnection } from "./calendar-connection-types";
import { DisplayMediaPlayback } from "./media-library";
import { DisplayBoardPreviewCard } from "./household-boards";
import type { DisplayMediaProjection } from "./media-adapters";
import { Check, Dialog, ErrorNotice, Field, Icon, LocaleProvider, useAction, useI18n } from "./ui";
import type { ReactNode } from "react";
import { advanceHomeBirthdays } from "./home-presentation";
import { dateOffset } from "./household-board-adapters";
import { FamilyHub } from "./family-hub";
import { DisplayCard, DisplayDayCardContent, DisplayNextActivitySnapshot } from "./display";
import { HouseholdActivityWeekRows } from "./home-activities";
import type { HouseholdTimelineActivity } from "./home-types";
import { homeWeekStart, mergeTimelineEntries, timelineDayHistoryVisible } from "./home-activity-presentation";
import { displayActionHasMessageRecipients, displayCalendarSourceUpdate, displayFamilyCardPlan, displayFamilyContentVisible, displayPreviewContentVisible, displayReadinessCard, displayReviewAccessPlan, displayReviewCanApply, displayReviewCardChange, displaySetupNeedsPrivateCopy, displaySetupPeopleSelection } from "./display-admin-presentation";

const CARD_IDS = ["household_messages", "new_message", "family_layout", "external_items", "worth_remembering", "today", "tomorrow", "people", "week", "next", "groceries", "dinners", "photos", "home_assistant"] as const;
type CardId = typeof CARD_IDS[number];
type Setup = {
  id: string; name: string; revision: number; cards: CardId[]; cardOrder: CardId[];
  familyLayoutEnabled: boolean; allSources: boolean; allSensors: boolean;
  personIds: string[]; sourceIds: string[]; calendarSourceIds: string[]; sensorIds: string[];
  albumIds: string[]; backgroundId: string | null; locale: "en" | "nb";
  theme: "light" | "dark" | "system"; isDefault: boolean;
};
type Draft = Omit<Setup, "id" | "revision" | "isDefault">;
type MediaPolicy = { albumId: string; name: string; albumRevision: number; grantRevision: number | null; canRead: boolean; canUpload: boolean };
type DisplayReview = { display: Display; setup: Setup | null; draft: Draft; policy: any; originalPolicy: any; board: any; originalBoard: any; media: MediaPolicy[]; originalMedia: MediaPolicy[]; calendarIds: string[]; sensorIds: string[]; profileIds: string[]; externalItems: boolean };
export type Preview = Projection & {
  preview: true;
  setup: NonNullable<Projection["setup"]>;
  media?: DisplayMediaProjection;
  dayActivities?: { activities: HouseholdTimelineActivity[]; nextCursor?: string | null };
  weekActivities?: { activities: HouseholdTimelineActivity[]; nextCursor?: string | null };
  nextActivity?: HouseholdTimelineActivity | null;
};

const emptyDraft = (locale: "en" | "nb"): Draft => ({ name: "", cards: ["household_messages", "family_layout"], cardOrder: ["household_messages", "family_layout"], familyLayoutEnabled: true, allSources: false, allSensors: false, personIds: [], sourceIds: [], calendarSourceIds: [], sensorIds: [], albumIds: [], backgroundId: null, locale, theme: "system" });
function asDraft(setup: Setup): Draft { return { name: setup.name, cards: [...setup.cards], cardOrder: [...setup.cardOrder], familyLayoutEnabled: setup.familyLayoutEnabled, allSources: setup.allSources, allSensors: setup.allSensors, personIds: [...setup.personIds], sourceIds: [...setup.sourceIds], calendarSourceIds: [...setup.calendarSourceIds], sensorIds: [...setup.sensorIds], albumIds: [...setup.albumIds], backgroundId: setup.backgroundId, locale: setup.locale, theme: setup.theme }; }
function toggle<T extends string>(items: T[], id: T, checked: boolean): T[] { return checked ? [...new Set([...items, id])] : items.filter(item => item !== id); }

export function ReadonlyPreview(props: { result: Preview; displayName: string; cardLabel: (id: CardId) => string; orientation: "portrait" | "landscape" }) {
  return <LocaleProvider locale={props.result.display.locale}><ReadonlyPreviewBody {...props}/></LocaleProvider>;
}

function ReadonlyPreviewBody({ result, displayName, cardLabel, orientation }: { result: Preview; displayName: string; cardLabel: (id: CardId) => string; orientation: "portrait" | "landscape" }) {
  const { t } = useI18n();
  const people = [...new Map([...(result.familyLayout?.people ?? []), ...(result.hub?.people ?? [])].map(person => [person.id, person])).values()];
  const items = result.hub?.items ?? [];
  const board = result.householdBoards;
  const background = result.media?.background ?? result.media?.householdBackground ?? null;
  const zone = result.display.timezone ?? "UTC";
  const today = result.householdBoards?.from ?? new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.parse(result.serverNow));
  const birthdays = advanceHomeBirthdays(result.birthdays?.entries ?? result.familyLayout?.upcomingBirthdays ?? [], result.birthdays?.localDate ?? today, today);
  const familyCardPlan = displayFamilyCardPlan(result.setup.cards,result.setup.familyLayoutEnabled,result.display.privacyMode);
  const messages = result.setup.cards.includes("household_messages") ? result.cards.map(card => ({id:card.id,body:card.body,importance:card.importance,authorName:card.author,authorPersonId:card.authorPersonId,authorAvatarKey:card.authorAvatarKey,authorPhoto:card.authorPhoto,publishAt:card.publishAt,expiresAt:card.expiresAt,revision:card.revision})) : [];
  const familySelected = displayFamilyContentVisible(familyCardPlan.familyLayout,people.length,messages.length,items.length,birthdays.length);
  const snapshotDinners=board?.readable?.dinners===true&&!result.setup.cards.includes("dinners")?(board.dinners??[]).map(dinner=>({...dinner,emoji:dinner.emoji??null,revision:dinner.revision??0,cleared:dinner.cleared??false})):[];
  const familyView = (roster: boolean, withMessages = false) => <fieldset className="display-preview-family-readonly" disabled><legend className="sr-only">{t("displayPreviewReadonly")}</legend><FamilyHub display displayCompactPeople displaySnapshot={{dinners:snapshotDinners}} displaySections={{people:roster,today:!result.setup.cards.includes("today"),tomorrow:!result.setup.cards.includes("tomorrow"),important:!result.setup.cards.includes("worth_remembering"),messages:withMessages,support:!result.setup.cards.includes("worth_remembering"),week:false,environment:false,next:false}} people={people} items={items} messages={withMessages ? messages : []} birthdays={birthdays} birthdaySourceLocalDate={today} localDate={today} zone={zone} householdName={result.display.householdName} now={Date.parse(result.serverNow)} /></fieldset>;
  return <section className={`display-preview display-preview-${orientation}`} data-theme={result.display.theme} aria-label={t("displayPreviewTitle")}>
    <header><h3>{t("displayPreviewFor", { name: displayName })}</h3><p>{t("displaySetup")}: {result.display.setupName ?? t("defaultDisplaySetup")} · {t("displayPreviewTitle")} · {t("displayPreviewReadonly")}</p></header>
    {background && <img className="display-preview-background" src={background.previewUrl} alt={background.title} referrerPolicy="no-referrer"/>}
    <div className="display-preview-layout">
      {result.setup.cardOrder.map((cardValue, index) => {
        const card = cardValue as CardId;
        if (!CARD_IDS.includes(card)) return null;
        if (!result.setup.cards.includes(card)) return null;
        let content: ReactNode = null;
        if (card === "household_messages") { if (familySelected) return null; content = result.cards.map((message, messageIndex) => <DisplayCard key={message.id} card={message as Card} zone={zone} primary={messageIndex===0}/>); }
        else if (card === "family_layout") { if (!familySelected) return null; content = familyView(true, result.setup.cards.includes("household_messages")); }
        else if (card === "people") { if (!familyCardPlan.peopleCard) return null; content = familyView(true); }
        else if (card === "new_message") content = <button type="button" className="button" disabled>{t("newMessage")}</button>;
        else if (card === "external_items") { const externalItems = items.filter(item => item.metadata.calendar); content = externalItems.length ? externalItems.map(item => <article className="display-preview-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>) : <p className="field-hint" role="status">{result.contentReadiness?.calendar && result.contentReadiness.calendar!=="ready" ? t(({privacy:"displayReadinessPrivacy",none_selected:"displayReadinessNoPeople",external_disabled:"displayReadinessDisabled",not_shared:"displayReadinessNotShared"} as const)[result.contentReadiness.calendar]) : t("displayCalendarEmpty")}</p>; }
        else if (card === "worth_remembering") content = items.filter(item => item.kind === "summary" || item.kind === "list").map(item => <article className="display-preview-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>);
        else if (card === "today" || card === "tomorrow") {
          const targetDate = card === "today" ? today : new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0,10);
          const dayActivities = (result.dayActivities?.activities ?? []).filter(activity => timelineDayHistoryVisible(activity, Date.parse(result.serverNow)));
          const dayDinners = (board?.dinners ?? []).filter(dinner => dinner.localDate === targetDate).map(dinner => ({...dinner,emoji:dinner.emoji??null,revision:dinner.revision??0,cleared:dinner.cleared??false}));
          const entries = mergeTimelineEntries(dayActivities,dayDinners,zone,targetDate,targetDate);
          const birthdayDue = card === "today" ? "today" : "tomorrow";
          const due = birthdays.filter(birthday => birthday.due === birthdayDue);
          const readinessCard = displayReadinessCard(result.setup.cards);
          content = <DisplayDayCardContent date={targetDate} zone={zone} people={people} birthdays={birthdays} labelKey={card} now={Date.parse(result.serverNow)} activities={dayActivities} dinners={dayDinners} readiness={card===readinessCard?result.contentReadiness?.calendar:undefined} empty={!entries.length&&!due.length}/>;
        }
        else if (card === "week") { const weekStart=homeWeekStart(today),weekEnd=dateOffset(weekStart,6),weekDinners=(board?.dinners??[]).filter(dinner=>dinner.localDate>=weekStart&&dinner.localDate<=weekEnd).map(dinner=>({...dinner,emoji:dinner.emoji??null,revision:dinner.revision??0,cleared:dinner.cleared??false}));const weekEntries=mergeTimelineEntries(result.weekActivities?.activities??[],weekDinners,zone,weekStart,weekEnd);content=<section className="hub-week hub-panel hub-display-week" aria-label={t("hubWeekTitle")} data-testid="home-activity-week"><header className="hub-week-heading"><div><h2>{t("hubWeekTitle")}</h2><p>{weekStart} – {weekEnd}</p></div></header><HouseholdActivityWeekRows entries={weekEntries} people={people} zone={zone} locale={result.display.locale} now={Date.parse(result.serverNow)} readOnly/></section>; }
        else if (card === "next") content = <DisplayNextActivitySnapshot activity={result.nextActivity ?? null} zone={zone} people={people} now={Date.parse(result.serverNow)}/>;
        else if (card === "groceries") content = <DisplayBoardPreviewCard kind="groceries" readable={board?.readable?.groceries===true} groceries={(board?.groceries??[]).map(item=>({...item,revision:item.revision??0}))} localDate={today} weekStart={homeWeekStart(today)}/>;
        else if (card === "dinners") { if (!board?.readable?.dinners && result.setup.cards.includes("groceries")) return null; content = <DisplayBoardPreviewCard kind="dinners" readable={board?.readable?.dinners===true} dinners={(board?.dinners??[]).map(item=>({...item,emoji:item.emoji??null,revision:item.revision??0,cleared:item.cleared??false}))} localDate={today} weekStart={homeWeekStart(today)}/>; }
        else if (card === "photos") content = <DisplayMediaPlayback displayId={result.display.id} snapshot={result.media} readOnly/>;
        else if (card === "home_assistant") content = <p className="field-hint">{t("displayPreviewHaReadonly")}</p>;
        if (!displayPreviewContentVisible(content)) return null;
        return <article className={`display-preview-card display-preview-${card}`} key={card} style={{ order: index + 1 }}><h4>{cardLabel(card)}</h4>{content}</article>;
      })}
    </div>
  </section>;
}

export function DisplaySetupsAdmin({ householdId, member, people, displays, onChanged, openSetupId, onOpenSetupHandled, openPolicyDisplayId, onOpenPolicyHandled, previewDisplayId, onPreviewHandled }: { householdId: string; member: Membership; people: Person[]; displays: Display[]; onChanged: () => Promise<void>; openSetupId?: string | null; onOpenSetupHandled?: () => void; openPolicyDisplayId?: string | null; onOpenPolicyHandled?: () => void; previewDisplayId?: string | null; onPreviewHandled?: () => void }) {
  const { t } = useI18n();
  const { run, busy, error } = useAction();
  const [setups, setSetups] = useState<Setup[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [integrations, setIntegrations] = useState<Array<{ id: string; name: string }>>([]);
  const [albums, setAlbums] = useState<Array<{ id: string; name: string; kind: string; owner?: boolean; permissions?: { manage?: boolean } }>>([]);
  const [backgrounds, setBackgrounds] = useState<Array<{ id: string; title: string; albumId: string }>>([]);
  const [editing, setEditing] = useState<Setup | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft(member.household_locale));
  const [preview, setPreview] = useState<{ displayId: string; result: Preview } | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState("");
  const [previewOrientation, setPreviewOrientation] = useState<"portrait" | "landscape">("landscape");
  const [policyDisplay, setPolicyDisplay] = useState<Display | null>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [mediaPolicies, setMediaPolicies] = useState<MediaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [optionalLoadError, setOptionalLoadError] = useState<unknown>(null);
  const [mediaPolicyError, setMediaPolicyError] = useState<unknown>(null);
  const [displayReview, setDisplayReview] = useState<DisplayReview | null>(null);
  const [reviewPreview, setReviewPreview] = useState<Preview | null>(null);
  const [partialDisplay, setPartialDisplay] = useState<Display | null>(null);
  const [confirmingReview, setConfirmingReview] = useState(false);
  const loadGeneration = useRef(0);
  const policyGeneration = useRef(0);
  const previewGeneration = useRef(0);

  const load = async (generation = loadGeneration.current, scopeHousehold = householdId) => {
    setLoading(true);
    setLoadError(null);
    setOptionalLoadError(null);
    try {
      const [setupResponse, connectionResult, integrationResult, mediaResult] = await Promise.all([
        api<{ setups: Setup[] }>(`/households/${scopeHousehold}/display-setups`),
        api<{ connections: CalendarConnection[] }>(`/households/${scopeHousehold}/calendar-connections`).then(value=>({value})).catch(error=>({error})),
        api<{ connections: Array<{ id: string; name: string }> }>(`/households/${scopeHousehold}/integrations`).then(value=>({value})).catch(error=>({error})),
        api<{ albums: Array<{ id: string; name: string; kind: string; owner?: boolean; permissions?: { manage?: boolean } }> }>(`/households/${scopeHousehold}/media/albums`).then(value=>({value})).catch(error=>({error})),
      ]);
      const mediaResponse = "value" in mediaResult ? mediaResult.value : null;
      const backgroundResults = await Promise.all((mediaResponse?.albums ?? []).filter(album => album.kind === "backgrounds").map(async album => {
        try {
          const response = await api<{ assets: Array<{ id: string; title: string }> }>(`/households/${scopeHousehold}/media/albums/${album.id}/assets`);
          return { assets: response.assets.map(asset => ({ ...asset, albumId: album.id })), error: null as unknown };
        } catch (error) {
          return { assets: [], error };
        }
      }));
      if (generation !== loadGeneration.current || scopeHousehold !== householdId) return;
      setSetups(setupResponse.setups);
      setConnections("value" in connectionResult ? connectionResult.value.connections : []);
      setIntegrations("value" in integrationResult ? integrationResult.value.connections : []);
      setAlbums(mediaResponse?.albums ?? []);
      setBackgrounds(backgroundResults.flatMap(result=>result.assets));
      const optionalFailure = [connectionResult, integrationResult, mediaResult].find(result=>"error" in result);
      const assetFailure = backgroundResults.find(result=>result.error !== null);
      if(optionalFailure)setOptionalLoadError(optionalFailure.error);
      else if(assetFailure)setOptionalLoadError(assetFailure.error);
    } catch (cause) {
      if (generation === loadGeneration.current && scopeHousehold === householdId) setLoadError(cause);
      throw cause;
    } finally {
      if (generation === loadGeneration.current && scopeHousehold === householdId) setLoading(false);
    }
  };

  useEffect(() => {
    const generation = ++loadGeneration.current;
    policyGeneration.current++;
    previewGeneration.current++;
    setSetups([]); setConnections([]); setIntegrations([]); setAlbums([]); setBackgrounds([]);
    setPolicyDisplay(null); setPolicy(null); setBoard(null); setMediaPolicies([]); setPreview(null);
    void load(generation, householdId).catch(() => {});
    return () => { if (loadGeneration.current === generation) loadGeneration.current++; };
  }, [householdId]);

  const open = useCallback((setup?: Setup) => { setEditing(setup ?? null); setDraft(setup ? asDraft(setup) : emptyDraft(member.household_locale)); setEditorOpen(true); setPreview(null); }, [member.household_locale]);
  useEffect(() => {
    if (!openSetupId || loading) return;
    const setup = setups.find(item => item.id === openSetupId);
    if (!setup) { onOpenSetupHandled?.(); return; }
    open(setup);
    onOpenSetupHandled?.();
    window.setTimeout(() => document.getElementById("display-setup-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [openSetupId, loading, setups, open, onOpenSetupHandled]);
  const save = async () => {
    const generation = loadGeneration.current;
    const scopeHousehold = householdId;
    const payload = { ...draft, cardOrder: draft.cardOrder.filter(card => draft.cards.includes(card)), familyLayoutEnabled: draft.cards.includes("family_layout") && draft.familyLayoutEnabled };
    if (payload.cardOrder.length !== payload.cards.length) payload.cardOrder = [...payload.cards];
    if (editing) await api(`/households/${scopeHousehold}/display-setups/${editing.id}`, "PATCH", { ...payload, expectedRevision: editing.revision });
    else await api(`/households/${scopeHousehold}/display-setups`, "POST", payload);
    if (generation !== loadGeneration.current) return;
    await load(generation, scopeHousehold);
    await onChanged();
    if (generation === loadGeneration.current) { setEditing(null); setEditorOpen(false); }
  };
  const previewSetup = async (display: Display, setupDraft: Draft = draft) => {
    const generation = ++previewGeneration.current;
    const household = householdId;
    const result = await api<Preview>(`/households/${household}/displays/${display.id}/preview`, "POST", { draft: setupDraft });
    if (generation === previewGeneration.current && household === householdId) setPreview({ displayId: display.id, result });
  };
  const openPolicy = async (display: Display) => {
    const generation = ++policyGeneration.current;
    const household = householdId;
    setPolicyDisplay(display); setPolicy(null); setBoard(null); setMediaPolicies([]); setMediaPolicyError(null);
    const [nextPolicy, nextBoard] = await Promise.all([
      api<any>(`/households/${household}/displays/${display.id}/action-policy`),
      api<any>(`/households/${household}/displays/${display.id}/board-read-grants`),
    ]);
    const mediaResults = await Promise.allSettled(albums.filter(album => album.kind === "photos" && (album.owner === true || album.permissions?.manage === true)).map(async album => {
      const result = await api<any>(`/households/${household}/media/albums/${album.id}/grants`);
      const grant = result.displayGrants.find((item: any) => item.displayId === display.id);
      return { albumId: album.id, name: album.name, albumRevision: result.album.revision, grantRevision: grant?.revision ?? null, canRead: grant?.permissions.read ?? false, canUpload: grant?.permissions.upload ?? false };
    }));
    const nextMedia = mediaResults.flatMap(result=>result.status==="fulfilled"?[result.value]:[]);
    const mediaError = mediaResults.find(result=>result.status==="rejected");
    if (generation === policyGeneration.current && household === householdId) { setPolicy(nextPolicy); setBoard(nextBoard); setMediaPolicies(nextMedia); setMediaPolicyError(mediaError?.status==="rejected"?mediaError.reason:null); }
  };
  const openReview = async (display: Display) => {
    setDisplayReview(null); setReviewPreview(null); setPartialDisplay(null); setConfirmingReview(false);
    const setup = setups.find(item => item.id === display.setup_id) ?? setups.find(item => item.isDefault) ?? null;
    const [nextPolicy, nextBoard] = await Promise.all([
      api<any>(`/households/${householdId}/displays/${display.id}/action-policy`),
      api<any>(`/households/${householdId}/displays/${display.id}/board-read-grants`),
    ]);
    const managedAlbums = albums.filter(album => album.kind === "photos" && (album.owner === true || album.permissions?.manage === true));
    const mediaResults = await Promise.all(managedAlbums.map(async album => {
      const result = await api<any>(`/households/${householdId}/media/albums/${album.id}/grants`);
      const grant = result.displayGrants.find((item: any) => item.displayId === display.id);
      return { albumId: album.id, name: album.name, albumRevision: result.album.revision, grantRevision: grant?.revision ?? null, canRead: grant?.permissions.read ?? false, canUpload: grant?.permissions.upload ?? false } satisfies MediaPolicy;
    }));
    const calendarIds = connections.flatMap(connection => connection.sources.filter(source => source.visibility.displayIds.includes(display.id)).map(source => source.id));
    const sensorIds = connections.flatMap(connection => (connection.temperatureSensors ?? []).filter(sensor => sensor.visibility.displayIds.includes(display.id)).map(sensor => sensor.id));
    setDisplayReview({ display, setup, draft: setup ? asDraft(setup) : emptyDraft(member.household_locale), policy: nextPolicy, originalPolicy: nextPolicy, board: nextBoard, originalBoard: nextBoard, media: mediaResults.map(item => ({ ...item })), originalMedia: mediaResults.map(item => ({ ...item })), calendarIds, sensorIds, profileIds: [...(display.profile_person_ids ?? [])], externalItems: Boolean(display.external_items_enabled) });
  };

  const applyDisplayReview = async () => {
    if (!displayReview || !displayReviewCanApply(confirmingReview, reviewDeltas.length)) return;
    const review = displayReview;
    const currentCalendarIds = connections.flatMap(connection => connection.sources.filter(source => source.visibility.displayIds.includes(review.display.id)).map(source => source.id));
    const currentSensorIds = connections.flatMap(connection => (connection.temperatureSensors ?? []).filter(sensor => sensor.visibility.displayIds.includes(review.display.id)).map(sensor => sensor.id));
    const requestedCalendarSources = connections.flatMap(connection => connection.sources.filter(source => source.visibility.displayIds.includes(review.display.id) || review.calendarIds.includes(source.id)).map(source => ({ connection, source })));
    const requestedSensors = connections.flatMap(connection => (connection.temperatureSensors ?? []).filter(sensor => sensor.visibility.displayIds.includes(review.display.id) || review.sensorIds.includes(sensor.id)).map(sensor => ({ connection, sensor })));
    const accessPlan = displayReviewAccessPlan(
      { canShareCalendars: true, selectedCalendarDisplayIds: currentCalendarIds, requestedCalendarDisplayIds: currentCalendarIds, selectedAlbumReadIds: review.originalMedia.filter(item => item.canRead).map(item => item.albumId), managedAlbumIds: review.media.map(item => item.albumId), requestedAlbumReadIds: review.originalMedia.filter(item => item.canRead).map(item => item.albumId) },
      { canShareCalendars: true, selectedCalendarDisplayIds: currentCalendarIds, requestedCalendarDisplayIds: review.calendarIds, selectedAlbumReadIds: review.originalMedia.filter(item => item.canRead).map(item => item.albumId), managedAlbumIds: review.media.map(item => item.albumId), requestedAlbumReadIds: review.media.filter(item => item.canRead).map(item => item.albumId) },
    );
    if (accessPlan.deniedAlbumIds.length || requestedCalendarSources.some(({ connection, source }) => review.calendarIds.includes(source.id) && !currentCalendarIds.includes(source.id) && !connection.canShare)) throw new Error("FORBIDDEN");
    if (requestedSensors.some(({ connection, sensor }) => review.sensorIds.includes(sensor.id) && !currentSensorIds.includes(sensor.id) && !connection.canShare)) throw new Error("FORBIDDEN");
    if (requestedSensors.some(({ sensor }) => sensor.displayName === null && review.sensorIds.includes(sensor.id) !== sensor.visibility.displayIds.includes(review.display.id))) throw new Error("FORBIDDEN");
    if ((review.policy.messageCreate || review.policy.messageSchedule) && !displayActionHasMessageRecipients(review.policy)) throw new Error("VALIDATION_FAILED");
    const changed = review.setup && JSON.stringify(asDraft(review.setup)) !== JSON.stringify(review.draft);
    try {
      if (changed && review.setup) {
        const payload = { ...review.draft, cardOrder: review.draft.cardOrder.filter(card => review.draft.cards.includes(card)), familyLayoutEnabled: review.draft.cards.includes("family_layout") && review.draft.familyLayoutEnabled };
        const otherDisplays = displays.filter(display => display.id !== review.display.id && display.setup_id === review.setup!.id && !display.revoked_at);
        if (displaySetupNeedsPrivateCopy(review.setup.isDefault, otherDisplays.map(display => display.id), review.display.setup_id, review.setup.id)) {
          const baseName = `${payload.name.slice(0, 54)} · ${review.display.name.slice(0, 20)}`.slice(0, 80);
          const names = new Set(setups.map(item => item.name));
          let name = baseName, suffix = 2;
          while (names.has(name)) { const ending = ` (${suffix++})`; name = `${baseName.slice(0, 80 - ending.length)}${ending}`; }
          const created = await api<{ id: string }>(`/households/${householdId}/display-setups`, "POST", { ...payload, name });
          await api(`/households/${householdId}/displays/${review.display.id}`, "PATCH", { setupId: created.id });
        } else {
          await api(`/households/${householdId}/display-setups/${review.setup.id}`, "PATCH", { ...payload, expectedRevision: review.setup.revision });
        }
      }
      if (JSON.stringify([...new Set(review.profileIds)].sort()) !== JSON.stringify([...(review.display.profile_person_ids ?? [])].sort()) || review.externalItems !== Boolean(review.display.external_items_enabled)) {
        await api(`/households/${householdId}/displays/${review.display.id}`, "PATCH", { profilePersonIds: [...new Set(review.profileIds)], externalItemsEnabled: review.externalItems });
      }
      for (const { connection, source } of requestedCalendarSources) {
        const wantsDisplay = review.calendarIds.includes(source.id);
        const hasDisplay = source.visibility.displayIds.includes(review.display.id);
        if (wantsDisplay === hasDisplay) continue;
        if (!connection.canShare && wantsDisplay) throw new Error("FORBIDDEN");
        await api(`/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}`, "PATCH", displayCalendarSourceUpdate(source, review.display.id, wantsDisplay));
      }
      for (const { connection, sensor } of requestedSensors) {
        const wantsDisplay = review.sensorIds.includes(sensor.id);
        const hasDisplay = sensor.visibility.displayIds.includes(review.display.id);
        if (wantsDisplay === hasDisplay) continue;
        if (!connection.canShare && wantsDisplay) throw new Error("FORBIDDEN");
        const displayIds = wantsDisplay ? [...new Set([...sensor.visibility.displayIds, review.display.id])] : sensor.visibility.displayIds.filter(id => id !== review.display.id);
        await api(`/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}`, "PATCH", { expectedRevision: sensor.revision, enabled: sensor.enabled, displayName: sensor.displayName ?? sensor.name, order: sensor.order, visibility: { ...sensor.visibility, displayIds } });
      }
      if (review.originalBoard && (review.originalBoard.groceryRead !== review.board.groceryRead || review.originalBoard.dinnerRead !== review.board.dinnerRead)) {
        await api(`/households/${householdId}/displays/${review.display.id}/board-read-grants`, "PUT", { expectedRevision: review.originalBoard.revision, groceryRead: review.board.groceryRead, dinnerRead: review.board.dinnerRead });
      }
      for (const item of review.media) {
        const previous = review.originalMedia.find(row => row.albumId === item.albumId)!;
        if (item.canRead === previous.canRead && item.canUpload === previous.canUpload) continue;
        await api(`/households/${householdId}/media/albums/${item.albumId}/displays/${review.display.id}`, "PUT", { expectedRevision: item.grantRevision, canRead: item.canRead, canUpload: item.canUpload, revoke: !item.canRead && !item.canUpload });
      }
      const actionFields = ["messageCreate", "messageSchedule", "groceryWrite", "dinnerWrite", "photoUpload", "homeAssistantControl"];
      const policyChanged = actionFields.some(key => Boolean(review.originalPolicy[key]) !== Boolean(review.policy[key])) || JSON.stringify([...review.originalPolicy.personIds].sort()) !== JSON.stringify([...review.policy.personIds].sort()) || JSON.stringify([...review.originalPolicy.displayIds].sort()) !== JSON.stringify([...review.policy.displayIds].sort());
      if (policyChanged) await api(`/households/${householdId}/displays/${review.display.id}/action-policy`, "PATCH", { expectedRevision: review.originalPolicy.revision, messageCreate: review.policy.messageCreate, messageSchedule: review.policy.messageSchedule, groceryWrite: review.policy.groceryWrite, dinnerWrite: review.policy.dinnerWrite, photoUpload: review.policy.photoUpload, homeAssistantControl: review.policy.homeAssistantControl, personIds: review.policy.personIds, displayIds: review.policy.displayIds });
      await load(); await onChanged();
      setDisplayReview(null); setReviewPreview(null); setConfirmingReview(false);
    } catch (cause) {
      await load().catch(() => {});
      await onChanged().catch(() => {});
      setPartialDisplay(review.display); setDisplayReview(null); setReviewPreview(null);
      throw cause;
    }
  };
  useEffect(() => {
    if (!openPolicyDisplayId) return;
    const display = displays.find(item => item.id === openPolicyDisplayId);
    onOpenPolicyHandled?.();
    if (!display || display.revoked_at) return;
    void run(async () => {
      await openPolicy(display);
      window.setTimeout(() => document.getElementById("display-policy-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    });
  }, [openPolicyDisplayId, displays]);
  useEffect(() => {
    if (!previewDisplayId || loading) return;
    const display = displays.find(item => item.id === previewDisplayId && !item.revoked_at);
    const setup = display ? setups.find(item => item.id === display.setup_id) ?? setups.find(item => item.isDefault) : undefined;
    onPreviewHandled?.();
    if (!display || !setup) return;
    const setupDraft = asDraft(setup);
    setEditing(setup); setDraft(setupDraft); setEditorOpen(true); setPreview(null);
    void run(async () => {
      await previewSetup(display, setupDraft);
      window.setTimeout(() => document.getElementById("display-effective-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    });
  }, [previewDisplayId, loading, displays, setups]);
  const savePolicy = async () => {
    if (!policyDisplay || !policy) return;
    const generation = policyGeneration.current;
    const household = householdId;
    await api(`/households/${household}/displays/${policyDisplay.id}/action-policy`, "PATCH", { expectedRevision: policy.revision, messageCreate: policy.messageCreate, messageSchedule: policy.messageSchedule, groceryWrite: policy.groceryWrite, dinnerWrite: policy.dinnerWrite, photoUpload: policy.photoUpload, homeAssistantControl: policy.homeAssistantControl, personIds: policy.personIds, displayIds: policy.displayIds });
    const updated = await api(`/households/${household}/displays/${policyDisplay.id}/action-policy`);
    if (generation === policyGeneration.current && household === householdId) setPolicy(updated);
  };
  const saveBoards = async () => {
    if (!policyDisplay || !board) return;
    const generation = policyGeneration.current;
    const household = householdId;
    const updated = await api(`/households/${household}/displays/${policyDisplay.id}/board-read-grants`, "PUT", { expectedRevision: board.revision, groceryRead: board.groceryRead, dinnerRead: board.dinnerRead });
    if (generation === policyGeneration.current && household === householdId) setBoard(updated);
  };
  const saveMediaPolicy = async (item: MediaPolicy) => {
    if (!policyDisplay) return;
    const display = policyDisplay;
    const generation = policyGeneration.current;
    const household = householdId;
    await api(`/households/${household}/media/albums/${item.albumId}/displays/${display.id}`, "PUT", { expectedRevision: item.grantRevision, canRead: item.canRead, canUpload: item.canUpload, revoke: !item.canRead && !item.canUpload });
    if (generation === policyGeneration.current && household === householdId) await openPolicy(display);
  };
  const cardLabel = (id: CardId) => t(({ household_messages: "messages", new_message: "newMessage", family_layout: "familyLayout", external_items: "externalItems", worth_remembering: "hubImportant", today: "hubToday", tomorrow: "hubTomorrow", people: "people", week: "week", next: "next", groceries: "boardGroceries", dinners: "boardDinners", photos: "mediaPhotosTitle", home_assistant: "homeAssistantControlsTitle" } as const)[id] as never);
  const selectedSources = connections.flatMap(connection => connection.sources.map(source => ({ id: source.id, label: `${connection.name}: ${source.displayName ?? source.name}` })));
  const selectedSensors = connections.flatMap(connection => (connection.temperatureSensors ?? []).map(sensor => ({ id: sensor.id, label: `${connection.name}: ${sensor.displayName ?? sensor.name}` })));
  const assignedDevices = (setup: Setup) => displays.filter(display => display.setup_id === setup.id && !display.revoked_at).map(display => display.name);
  const activeDisplays = displays.filter(display => !display.revoked_at);
  const previewTarget = activeDisplays.find(display => display.id === previewTargetId) ?? activeDisplays[0];
  const reviewDeltas = displayReview ? (() => {
    const rows: string[] = [];
    const beforeCards = displayReview.setup?.cards ?? [];
    if (JSON.stringify(beforeCards) !== JSON.stringify(displayReview.draft.cards)) {
      rows.push(t("displayReviewDeltaCards", { before: beforeCards.map(cardLabel).join(", ") || t("none"), after: displayReview.draft.cards.map(cardLabel).join(", ") || t("none") }));
      if (displayReview.setup) {
        const otherDisplays = displays.filter(display => display.id !== displayReview.display.id && display.setup_id === displayReview.setup!.id && !display.revoked_at);
        if (displaySetupNeedsPrivateCopy(displayReview.setup.isDefault, otherDisplays.map(display => display.id), displayReview.display.setup_id, displayReview.setup.id)) rows.push(t("displayReviewDeltaPrivateCopy", { name: displayReview.setup.name, displays: otherDisplays.map(display => display.name).join(", ") || t("none") }));
      }
    }
    if (displayReview.setup && displayReview.setup.familyLayoutEnabled !== displayReview.draft.familyLayoutEnabled) rows.push(t(displayReview.draft.familyLayoutEnabled ? "displayReviewDeltaFamilyLayoutEnabled" : "displayReviewDeltaFamilyLayoutDisabled"));
    for (const id of displayReview.draft.personIds.filter(id => !(displayReview.setup?.personIds ?? []).includes(id))) rows.push(t("displayReviewDeltaContentPersonAdded", { name: people.find(person => person.id === id)?.display_name ?? id }));
    for (const id of (displayReview.setup?.personIds ?? []).filter(id => !displayReview.draft.personIds.includes(id))) rows.push(t("displayReviewDeltaContentPersonRemoved", { name: people.find(person => person.id === id)?.display_name ?? id }));
    for (const id of displayReview.draft.calendarSourceIds.filter(id => !(displayReview.setup?.calendarSourceIds ?? []).includes(id))) rows.push(t("displayReviewDeltaLayoutSourceAdded", { name: connections.flatMap(connection => connection.sources).find(source => source.id === id)?.displayName ?? id }));
    for (const id of (displayReview.setup?.calendarSourceIds ?? []).filter(id => !displayReview.draft.calendarSourceIds.includes(id))) rows.push(t("displayReviewDeltaLayoutSourceRemoved", { name: connections.flatMap(connection => connection.sources).find(source => source.id === id)?.displayName ?? id }));
    for (const id of displayReview.draft.sensorIds.filter(id => !(displayReview.setup?.sensorIds ?? []).includes(id))) rows.push(t("displayReviewDeltaLayoutSensorAdded", { name: connections.flatMap(connection => connection.temperatureSensors ?? []).find(sensor => sensor.id === id)?.displayName ?? id }));
    for (const id of (displayReview.setup?.sensorIds ?? []).filter(id => !displayReview.draft.sensorIds.includes(id))) rows.push(t("displayReviewDeltaLayoutSensorRemoved", { name: connections.flatMap(connection => connection.temperatureSensors ?? []).find(sensor => sensor.id === id)?.displayName ?? id }));
    for (const id of displayReview.draft.albumIds.filter(id => !(displayReview.setup?.albumIds ?? []).includes(id))) rows.push(t("displayReviewDeltaLayoutAlbumAdded", { name: albums.find(album => album.id === id)?.name ?? id }));
    for (const id of (displayReview.setup?.albumIds ?? []).filter(id => !displayReview.draft.albumIds.includes(id))) rows.push(t("displayReviewDeltaLayoutAlbumRemoved", { name: albums.find(album => album.id === id)?.name ?? id }));
    const profileNames = (ids: string[]) => ids.map(id => people.find(person => person.id === id)?.display_name).filter((name): name is string => Boolean(name));
    const profileAdded = displayReview.profileIds.filter(id => !displayReview.display.profile_person_ids?.includes(id));
    const profileRemoved = (displayReview.display.profile_person_ids ?? []).filter(id => !displayReview.profileIds.includes(id));
    if (profileAdded.length) rows.push(t("displayReviewDeltaProfilesAdded", { names: profileNames(profileAdded).join(", ") }));
    if (profileRemoved.length) rows.push(t("displayReviewDeltaProfilesRemoved", { names: profileNames(profileRemoved).join(", ") }));
    if (displayReview.externalItems !== Boolean(displayReview.display.external_items_enabled)) rows.push(t("displayReviewDeltaExternal", { value: t(displayReview.externalItems ? "enabled" : "disabled") }));
    for (const { connection, source } of connections.flatMap(connection => connection.sources.map(source => ({ connection, source })))) {
      const before = source.visibility.displayIds.includes(displayReview.display.id), after = displayReview.calendarIds.includes(source.id);
      if (before !== after) rows.push(t(after ? "displayReviewDeltaSourceAdded" : "displayReviewDeltaSourceRemoved", { name: `${connection.name}: ${source.displayName ?? source.name}` }));
    }
    for (const { connection, sensor } of connections.flatMap(connection => (connection.temperatureSensors ?? []).map(sensor => ({ connection, sensor })))) {
      const before = sensor.visibility.displayIds.includes(displayReview.display.id), after = displayReview.sensorIds.includes(sensor.id);
      if (before !== after) rows.push(t(after ? "displayReviewDeltaSensorAdded" : "displayReviewDeltaSensorRemoved", { name: `${connection.name}: ${sensor.displayName ?? sensor.name}` }));
    }
    for (const key of ["groceryRead", "dinnerRead"] as const) if (displayReview.originalBoard[key] !== displayReview.board[key]) rows.push(t(displayReview.board[key] ? "displayReviewDeltaBoardAdded" : "displayReviewDeltaBoardRemoved", { name: t(key === "groceryRead" ? "boardGroceries" : "boardDinners") }));
    for (const item of displayReview.media) {
      const before = displayReview.originalMedia.find(row => row.albumId === item.albumId)!;
      if (before.canRead !== item.canRead) rows.push(t(item.canRead ? "displayReviewDeltaAlbumAdded" : "displayReviewDeltaAlbumRemoved", { name: item.name }));
      if (before.canUpload !== item.canUpload) rows.push(t(item.canUpload ? "displayReviewDeltaUploadAdded" : "displayReviewDeltaUploadRemoved", { name: item.name }));
    }
    for (const [key, label] of [["messageCreate", "newMessage"], ["messageSchedule", "messageSchedule"], ["groceryWrite", "boardGroceries"], ["dinnerWrite", "boardDinners"], ["photoUpload", "mediaPhotosTitle"], ["homeAssistantControl", "homeAssistantControlsTitle"]] as const) {
      if (Boolean(displayReview.originalPolicy[key]) !== Boolean(displayReview.policy[key])) rows.push(t(displayReview.policy[key] ? "displayReviewDeltaActionAdded" : "displayReviewDeltaActionRemoved", { name: t(label) }));
    }
    for (const id of displayReview.policy.personIds.filter((value: string) => !displayReview.originalPolicy.personIds.includes(value))) rows.push(t("displayReviewDeltaRecipientAdded", { name: people.find(person => person.id === id)?.display_name ?? id }));
    for (const id of displayReview.originalPolicy.personIds.filter((value: string) => !displayReview.policy.personIds.includes(value))) rows.push(t("displayReviewDeltaRecipientRemoved", { name: people.find(person => person.id === id)?.display_name ?? id }));
    for (const id of displayReview.policy.displayIds.filter((value: string) => !displayReview.originalPolicy.displayIds.includes(value))) rows.push(t("displayReviewDeltaRecipientAdded", { name: displays.find(display => display.id === id)?.name ?? id }));
    for (const id of displayReview.originalPolicy.displayIds.filter((value: string) => !displayReview.policy.displayIds.includes(value))) rows.push(t("displayReviewDeltaRecipientRemoved", { name: displays.find(display => display.id === id)?.name ?? id }));
    return rows;
  })() : [];

  return <section className="display-setups-admin" id="display-setups-admin">
    <header className="section-heading"><div><p className="eyebrow">{t("displaySetups")}</p><h2>{t("displaySetupsTitle")}</h2><p>{t("displaySetupsBody")}</p></div><button className="button" disabled={busy} onClick={() => open()}><Icon name="plus"/>{t("displaySetupNew")}</button></header>
    {loading && <p role="status">{t("loading")}</p>}
    {loadError && <ErrorNotice error={loadError}/>}
    {optionalLoadError && <p className="field-hint" role="status">{t("displayOptionalSourcesUnavailable")}</p>}
    {error && <ErrorNotice error={error}/>}
    {partialDisplay && <p className="notice error" role="alert">{t("displayReviewPartialFailure")} <button type="button" className="button" onClick={() => void run(() => openReview(partialDisplay))}>{t("displayReviewAccess")}</button></p>}
    <div className="display-setup-list">{setups.map(setup => <article className="display-setup-card" key={setup.id}><div><h3>{setup.name}</h3><p>{setup.cardOrder.map(cardLabel).join(" · ")}</p><p className="field-hint">{t("displaySetupAssignedTo")}: {assignedDevices(setup).join(", ") || t("displaySetupUnassigned")}</p></div><button className="button" disabled={busy} onClick={() => open(setup)}>{t("edit")}</button></article>)}</div>
    {editorOpen && <div className="display-setup-editor" id="display-setup-editor" role="region" aria-label={t("displaySetupEditor")}>
      <fieldset disabled={busy} className="display-editor-controls">
        <div className="form-grid"><Field label={t("displaySetupName")}><input maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></Field><Field label={t("displayLocale")}><select value={draft.locale} onChange={e => setDraft({ ...draft, locale: e.target.value as "en" | "nb" })}><option value="en">{t("en")}</option><option value="nb">{t("nb")}</option></select></Field><Field label={t("displayTheme")}><select value={draft.theme} onChange={e => setDraft({ ...draft, theme: e.target.value as Draft["theme"] })}>{(["light", "dark", "system"] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field></div>
        <fieldset><legend>{t("displaySetupCards")}</legend>{CARD_IDS.map(id => { const peopleIncluded = id === "people" && draft.cards.includes("family_layout") && draft.familyLayoutEnabled; return <Check key={id} label={peopleIncluded ? `${cardLabel(id)} · ${t("displayPeopleIncludedWithFamily")}` : cardLabel(id)} checked={peopleIncluded || draft.cards.includes(id)} disabled={peopleIncluded} onChange={checked => { const cards = toggle(draft.cards, id, checked); setDraft({ ...draft, cards, cardOrder: checked ? [...draft.cardOrder, id] : draft.cardOrder.filter(card => card !== id) }); }}/>; })}<p className="field-hint">{t("displaySetupOrderHint")}</p><ol className="display-card-order">{draft.cardOrder.map((id, index) => <li key={id}><span>{cardLabel(id)}</span><button type="button" className="button subtle" disabled={!index || busy} onClick={() => { const next = [...draft.cardOrder]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setDraft({ ...draft, cardOrder: next }); }} aria-label={t("moveUp")}>↑</button><button type="button" className="button subtle" disabled={index === draft.cardOrder.length - 1 || busy} onClick={() => { const next = [...draft.cardOrder]; [next[index + 1], next[index]] = [next[index + 1]!, next[index]!]; setDraft({ ...draft, cardOrder: next }); }} aria-label={t("moveDown")}>↓</button></li>)}</ol></fieldset>
        <fieldset><legend>{t("displaySetupPeople")}</legend><p className="field-hint">{t("displaySetupPeopleHint")}</p><p className="field-hint">{t("displayPeopleCount",{selected:draft.personIds.filter(id=>people.some(person=>person.id===id)).length,total:people.length})}</p><div className="display-bulk-actions"><button type="button" className="button subtle" disabled={busy||!people.length} onClick={()=>setDraft({...draft,personIds:people.map(person=>person.id)})}>{t("selectAll")}</button><button type="button" className="button subtle" disabled={busy||!people.length} onClick={()=>setDraft({...draft,personIds:[]})}>{t("clearAll")}</button></div>{people.map(person => <Check key={person.id} label={person.display_name} checked={draft.personIds.includes(person.id)} onChange={checked => setDraft({ ...draft, personIds: toggle(draft.personIds, person.id, checked) })}/>)}</fieldset>
        <fieldset><legend>{t("displaySetupSources")}</legend><Check label={t("allSources")} checked={draft.allSources} onChange={checked => setDraft({ ...draft, allSources: checked })}/>{integrations.map(connection => <Check key={connection.id} label={connection.name} checked={draft.sourceIds.includes(connection.id)} onChange={checked => setDraft({ ...draft, sourceIds: toggle(draft.sourceIds, connection.id, checked) })}/>) }{selectedSources.map(source => <Check key={source.id} label={source.label} checked={draft.calendarSourceIds.includes(source.id)} onChange={checked => setDraft({ ...draft, calendarSourceIds: toggle(draft.calendarSourceIds, source.id, checked) })}/>) }<Check label={t("allSensors")} checked={draft.allSensors} onChange={checked => setDraft({ ...draft, allSensors: checked })}/>{selectedSensors.map(sensor => <Check key={sensor.id} label={sensor.label} checked={draft.sensorIds.includes(sensor.id)} onChange={checked => setDraft({ ...draft, sensorIds: toggle(draft.sensorIds, sensor.id, checked) })}/>)}</fieldset>
        <fieldset><legend>{t("displaySetupMedia")}</legend>{albums.filter(album => album.kind === "photos").map(album => <Check key={album.id} label={album.name} checked={draft.albumIds.includes(album.id)} onChange={checked => setDraft({ ...draft, albumIds: toggle(draft.albumIds, album.id, checked) })}/>) }<Field label={t("displayBackground")}><select value={draft.backgroundId ?? ""} onChange={e => setDraft({ ...draft, backgroundId: e.target.value || null })}><option value="">{t("none")}</option>{backgrounds.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></Field></fieldset>
        <div className="form-actions"><button type="button" className="button subtle" onClick={() => { setEditing(null); setEditorOpen(false); setDraft(emptyDraft(member.household_locale)); setPreview(null); }}>{t("cancel")}</button><button type="button" className="button" disabled={!draft.name.trim()} onClick={() => void run(save)}>{t("save")}</button></div>
        {activeDisplays.length > 0 && <div className="display-preview-controls"><Field label={t("displayPreviewTarget")}><select value={previewTarget?.id ?? ""} onChange={event => setPreviewTargetId(event.target.value)}>{activeDisplays.map(display => <option key={display.id} value={display.id}>{display.name}</option>)}</select></Field><Field label={t("displayPreviewOrientation")}><select value={previewOrientation} onChange={event => setPreviewOrientation(event.target.value as "portrait" | "landscape")}><option value="portrait">{t("portrait")}</option><option value="landscape">{t("landscape")}</option></select></Field><button type="button" className="button" disabled={!previewTarget} onClick={() => previewTarget && void run(() => previewSetup(previewTarget))}>{t("displayPreviewButton")}</button><button type="button" className="button" disabled={!previewTarget} onClick={() => previewTarget && void run(() => openReview(previewTarget))}>{t("displayReviewAccess")}{previewTarget ? ` · ${previewTarget.name}` : ""}</button></div>}
      </fieldset>
      {preview && <div id="display-effective-preview" tabIndex={-1}><ReadonlyPreview result={preview.result} displayName={displays.find(display => display.id === preview.displayId)?.name ?? t("displayPreviewTitle")} cardLabel={cardLabel} orientation={previewOrientation}/></div>}
    </div>}
    {displayReview && <section className="display-policy-editor" aria-label={t("displayReviewAccess")}>
      <h3>{t("displayReviewTitle", { name: displayReview.display.name })}</h3>
      <p>{t("displayReviewExplanation")}</p>
      {!displayReview.setup && <p role="status" className="notice">{t("displayReviewNoSetup")}</p>}
      <fieldset disabled={busy}>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayReviewContentStage"), selected: displayReview.draft.cards.length, total: CARD_IDS.length })}</summary>
        <fieldset><legend>{t("displaySetupCards")}</legend>{CARD_IDS.map(id => <Check key={id} label={cardLabel(id)} checked={id === "family_layout" ? displayReview.draft.cards.includes(id) && displayReview.draft.familyLayoutEnabled : displayReview.draft.cards.includes(id)} onChange={checked => setDisplayReview({ ...displayReview, draft: displayReviewCardChange(displayReview.draft, id, checked) })}/>)}</fieldset>
        <fieldset><legend>{t("displayReviewSetupPeople")}</legend><p className="field-hint">{t("displaySetupPeopleHint")}</p><p className="field-hint">{t("displayPeopleCount", { selected: displayReview.draft.personIds.filter(id => people.some(person => person.id === id)).length, total: people.length })}</p><div className="display-bulk-actions"><button type="button" className="button subtle" disabled={busy || !people.length} onClick={() => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, personIds: [...new Set(people.map(person => person.id))] } })}>{t("selectAll")}</button><button type="button" className="button subtle" disabled={busy || !people.length} onClick={() => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, personIds: [] } })}>{t("clearAll")}</button></div>{people.map(person => <Check key={person.id} label={person.display_name} checked={displayReview.draft.personIds.includes(person.id)} onChange={checked => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, personIds: displaySetupPeopleSelection(displayReview.draft.personIds, person.id, checked) } })}/>)}</fieldset>
        <fieldset><legend>{t("displayReviewCalendarContent")}</legend><p className="field-hint">{t("displayReviewLayoutContentHelp")}</p>{connections.flatMap(connection => connection.sources.map(source => <Check key={source.id} label={`${connection.name}: ${source.displayName ?? source.name}`} checked={displayReview.draft.calendarSourceIds.includes(source.id)} onChange={checked => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, calendarSourceIds: toggle(displayReview.draft.calendarSourceIds, source.id, checked) } })}/>))}</fieldset>
        <fieldset><legend>{t("displayReviewSensorContent")}</legend><p className="field-hint">{t("displayReviewLayoutContentHelp")}</p>{connections.flatMap(connection => (connection.temperatureSensors ?? []).map(sensor => <Check key={sensor.id} label={`${connection.name}: ${sensor.displayName ?? sensor.name}`} checked={displayReview.draft.sensorIds.includes(sensor.id)} onChange={checked => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, sensorIds: toggle(displayReview.draft.sensorIds, sensor.id, checked) } })}/>))}</fieldset>
        <fieldset><legend>{t("displayReviewAlbumContent")}</legend><p className="field-hint">{t("displayReviewLayoutContentHelp")}</p>{albums.filter(album => album.kind === "photos" && (album.owner === true || album.permissions?.manage === true)).map(album => <Check key={album.id} label={album.name} checked={displayReview.draft.albumIds.includes(album.id)} onChange={checked => setDisplayReview({ ...displayReview, draft: { ...displayReview.draft, albumIds: toggle(displayReview.draft.albumIds, album.id, checked) } })}/>)}</fieldset>
        </details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayReviewProfilesStage"), selected: displayReview.profileIds.length, total: people.length })}</summary>
        <fieldset><legend>{t("displayProfileGrants")}</legend><p className="field-hint">{t("displayReviewAccessSeparate")}</p>{people.map(person => <Check key={person.id} label={t("displayProfileGrant", { name: person.display_name })} checked={displayReview.profileIds.includes(person.id)} onChange={checked => setDisplayReview({ ...displayReview, profileIds: toggle(displayReview.profileIds, person.id, checked) })}/>)}</fieldset>
        <Check label={t("integrationExternalDisplay")} checked={displayReview.externalItems} onChange={value => setDisplayReview({ ...displayReview, externalItems: value })}/></details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayReviewCalendars"), selected: displayReview.calendarIds.length, total: connections.reduce((count, connection) => count + connection.sources.filter(source => connection.canShare || source.visibility.displayIds.includes(displayReview.display.id)).length, 0) })}</summary>
        <fieldset><legend>{t("displayReviewCalendars")}</legend><p className="field-hint">{t("displayReviewCalendarHelp")}</p>{connections.flatMap(connection => connection.sources.map(source => <Check key={source.id} label={`${connection.name}: ${source.displayName ?? source.name}`} checked={displayReview.calendarIds.includes(source.id)} disabled={!connection.canShare && !source.visibility.displayIds.includes(displayReview.display.id)} onChange={checked => setDisplayReview({ ...displayReview, calendarIds: toggle(displayReview.calendarIds, source.id, checked) })}/>))}</fieldset></details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayReviewSensors"), selected: displayReview.sensorIds.length, total: connections.reduce((count, connection) => count + (connection.canShare ? (connection.temperatureSensors ?? []).length : (connection.temperatureSensors ?? []).filter(sensor => sensor.visibility.displayIds.includes(displayReview.display.id)).length), 0) })}</summary>
        <fieldset><legend>{t("displayReviewSensors")}</legend><p className="field-hint">{t("displayReviewSensorHelp")}</p>{connections.flatMap(connection => (connection.temperatureSensors ?? []).map(sensor => <Check key={sensor.id} label={`${connection.name}: ${sensor.displayName ?? sensor.name}`} checked={displayReview.sensorIds.includes(sensor.id)} disabled={sensor.displayName === null || (!connection.canShare && !sensor.visibility.displayIds.includes(displayReview.display.id))} onChange={checked => setDisplayReview({ ...displayReview, sensorIds: toggle(displayReview.sensorIds, sensor.id, checked) })}/>))}{connections.some(connection => (connection.temperatureSensors ?? []).some(sensor => sensor.displayName === null)) && <p className="field-hint">{t("displayReviewSensorLabelRequired")}</p>}</fieldset></details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayBoardReadGrants"), selected: Number(displayReview.board.groceryRead) + Number(displayReview.board.dinnerRead), total: 2 })}</summary>
        <fieldset><legend>{t("displayBoardReadGrants")}</legend><p className="field-hint">{t("displayReviewBoardHelp")}</p><Check label={t("boardGroceries")} checked={displayReview.board.groceryRead} onChange={value => setDisplayReview({ ...displayReview, board: { ...displayReview.board, groceryRead: value } })}/><Check label={t("boardDinners")} checked={displayReview.board.dinnerRead} onChange={value => setDisplayReview({ ...displayReview, board: { ...displayReview.board, dinnerRead: value } })}/></fieldset></details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("mediaDisplayReadGrant"), selected: displayReview.media.filter(item => item.canRead).length, total: displayReview.media.length })}</summary>
        <fieldset><legend>{t("mediaDisplayReadGrant")}</legend><p className="field-hint">{t("displayReviewAlbumHelp")}</p>{displayReview.media.length ? displayReview.media.map(item => <div key={item.albumId}><strong>{item.name}</strong><Check label={t("mediaDisplayReadGrant")} checked={item.canRead} onChange={value => setDisplayReview({ ...displayReview, media: displayReview.media.map(row => row.albumId === item.albumId ? { ...row, canRead: value } : row) })}/><Check label={t("mediaDisplayUploadGrant")} checked={item.canUpload} onChange={value => setDisplayReview({ ...displayReview, media: displayReview.media.map(row => row.albumId === item.albumId ? { ...row, canUpload: value } : row) })}/></div>) : <p className="field-hint">{t("displayReviewNoManagedAlbums")}</p>}</fieldset></details>
        <details className="display-review-stage"><summary>{t("displayReviewStageCount", { name: t("displayReviewActions"), selected: [displayReview.policy.messageCreate, displayReview.policy.messageSchedule, displayReview.policy.groceryWrite, displayReview.policy.dinnerWrite, displayReview.policy.photoUpload, displayReview.policy.homeAssistantControl].filter(Boolean).length, total: 6 })}</summary>
        <fieldset><legend>{t("displayReviewActions")}</legend>{([["messageCreate", "newMessage"], ["messageSchedule", "messageSchedule"], ["groceryWrite", "boardGroceries"], ["dinnerWrite", "boardDinners"], ["photoUpload", "mediaPhotosTitle"], ["homeAssistantControl", "homeAssistantControlsTitle"]] as const).map(([field, label]) => <Check key={field} label={t(label)} checked={Boolean(displayReview.policy[field])} onChange={value => setDisplayReview({ ...displayReview, policy: { ...displayReview.policy, [field]: value } })}/>)}
          {(displayReview.policy.messageCreate || displayReview.policy.messageSchedule) && <fieldset><legend>{t("displayMessagePeopleRecipients")}</legend><p className="field-hint">{t("displayReviewMessageRecipientsHelp")}</p>{people.map(person => <Check key={`recipient:${person.id}`} label={person.display_name} checked={displayReview.policy.personIds.includes(person.id)} onChange={value => setDisplayReview({ ...displayReview, policy: { ...displayReview.policy, personIds: toggle(displayReview.policy.personIds, person.id, value) } })}/>)}</fieldset>}
          {(displayReview.policy.messageCreate || displayReview.policy.messageSchedule) && <fieldset><legend>{t("displayMessageDisplayRecipients")}</legend>{displays.filter(display => display.id !== displayReview.display.id && !display.revoked_at).map(display => <Check key={`recipient-display:${display.id}`} label={display.name} checked={displayReview.policy.displayIds.includes(display.id)} onChange={value => setDisplayReview({ ...displayReview, policy: { ...displayReview.policy, displayIds: toggle(displayReview.policy.displayIds, display.id, value) } })}/>)}</fieldset>}
          {(displayReview.policy.messageCreate || displayReview.policy.messageSchedule) && !displayActionHasMessageRecipients(displayReview.policy) && <p className="notice">{t("displayReviewMessageRecipientsRequired")}</p>}
          {displayReview.policy.homeAssistantControl && <p className="field-hint">{t("displayReviewHaTargetsSeparate")}</p>}
        </fieldset></details>
        <p className="field-hint">{t("displayReviewPreviewCurrent")}</p>
        <div className="form-actions"><button type="button" className="button" disabled={busy || !displayReview.setup} onClick={() => void run(async () => { const result = await api<Preview>(`/households/${householdId}/displays/${displayReview.display.id}/preview`, "POST", { draft: displayReview.draft }); setReviewPreview(result); })}>{t("displayReviewPreview")}</button><button type="button" className="button subtle" onClick={() => { setDisplayReview(null); setReviewPreview(null); }}>{t("cancel")}</button><button type="button" className="button primary" disabled={busy || reviewDeltas.length === 0} onClick={() => setConfirmingReview(true)}>{t("displayReviewApply")}</button></div>
      </fieldset>
      {reviewPreview && <ReadonlyPreview result={reviewPreview} displayName={displayReview.display.name} cardLabel={cardLabel} orientation={previewOrientation}/>}
    </section>}
    {displayReview && confirmingReview && <Dialog title={t("displayReviewConfirmTitle", { name: displayReview.display.name })} onClose={() => setConfirmingReview(false)}><p>{t("displayReviewConfirmBody")}</p>{reviewDeltas.length ? <ul>{reviewDeltas.map((row, index) => <li key={index}>{row}</li>)}</ul> : <p>{t("displayReviewNoChanges")}</p>}<div className="form-actions"><button type="button" className="button subtle" onClick={() => setConfirmingReview(false)}>{t("cancel")}</button><button type="button" className="button primary" disabled={busy || !displayReviewCanApply(confirmingReview, reviewDeltas.length)} onClick={() => void run(applyDisplayReview)}>{t("displayReviewConfirmApply")}</button></div></Dialog>}
    {policyDisplay && policy && <section className="display-policy-editor" id="display-policy-editor" tabIndex={-1}><h3>{t("displayDeviceGrants")}: {policyDisplay.name}</h3><fieldset disabled={busy}>
      {mediaPolicyError&&<p className="field-hint" role="status">{t("displayOptionalSourcesUnavailable")}</p>}
      <Check label={t("newMessage")} checked={policy.messageCreate} onChange={value => setPolicy({ ...policy, messageCreate: value })}/><Check label={t("messageSchedule")} checked={policy.messageSchedule} onChange={value => setPolicy({ ...policy, messageSchedule: value })}/><Check label={t("boardGroceries")} checked={policy.groceryWrite} onChange={value => setPolicy({ ...policy, groceryWrite: value })}/><Check label={t("boardDinners")} checked={policy.dinnerWrite} onChange={value => setPolicy({ ...policy, dinnerWrite: value })}/><Check label={t("mediaPhotosTitle")} checked={policy.photoUpload} onChange={value => setPolicy({ ...policy, photoUpload: value })}/><Check label={t("homeAssistantControlsTitle")} checked={policy.homeAssistantControl} onChange={value => setPolicy({ ...policy, homeAssistantControl: value })}/>
      <fieldset><legend>{t("displayMessagePeopleRecipients")}</legend>{people.map(person => <Check key={person.id} label={person.display_name} checked={policy.personIds.includes(person.id)} onChange={value => setPolicy({ ...policy, personIds: toggle(policy.personIds, person.id, value) })}/>)}</fieldset>
      <fieldset><legend>{t("displayMessageDisplayRecipients")}</legend>{displays.filter(display => display.id !== policyDisplay.id && !display.revoked_at).map(display => <Check key={display.id} label={display.name} checked={policy.displayIds.includes(display.id)} onChange={value => setPolicy({ ...policy, displayIds: toggle(policy.displayIds, display.id, value) })}/>)}</fieldset>
      {board && <fieldset><legend>{t("displayBoardReadGrants")}</legend><Check label={t("boardGroceries")} checked={board.groceryRead} onChange={value => setBoard({ ...board, groceryRead: value })}/><Check label={t("boardDinners")} checked={board.dinnerRead} onChange={value => setBoard({ ...board, dinnerRead: value })}/><button type="button" className="button" onClick={() => void run(saveBoards)}>{t("save")}</button></fieldset>}
      {mediaPolicies.length > 0 && <fieldset><legend>{t("mediaDisplayReadGrant")}</legend>{mediaPolicies.map(item => <div key={item.albumId}><strong>{item.name}</strong><Check label={t("mediaDisplayReadGrant")} checked={item.canRead} onChange={value => setMediaPolicies(rows => rows.map(row => row.albumId === item.albumId ? { ...row, canRead: value } : row))}/><Check label={t("mediaDisplayUploadGrant")} checked={item.canUpload} onChange={value => setMediaPolicies(rows => rows.map(row => row.albumId === item.albumId ? { ...row, canUpload: value } : row))}/><button type="button" className="button" onClick={() => void run(() => saveMediaPolicy(item))}>{t("save")}</button></div>)}</fieldset>}
      <div className="form-actions"><button type="button" className="button" onClick={() => void run(savePolicy)}>{t("save")}</button><button type="button" className="button subtle" onClick={() => { policyGeneration.current++; setPolicyDisplay(null); setPolicy(null); }}>{t("close")}</button></div>
    </fieldset></section>}
  </section>;
}
