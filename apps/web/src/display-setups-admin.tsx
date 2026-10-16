import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Display, Membership, Person, Projection } from "./types";
import type { CalendarConnection } from "./calendar-connection-types";
import { MediaSlideshow } from "./media-library";
import type { DisplayMediaProjection } from "./media-adapters";
import { Check, ErrorNotice, Field, Icon, useAction, useI18n } from "./ui";
import type { TranslationKey } from "./locales/en";
import type { ReactNode } from "react";
import { mergeTimelineEntries } from "./home-activity-presentation";
import type { HouseholdTimelineActivity } from "./home-types";

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
type Preview = Projection & {
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

function ReadonlyPreview({ result, cardLabel, t }: { result: Preview; cardLabel: (id: CardId) => string; t: (key: TranslationKey) => string }) {
  const people = [...new Map([...(result.familyLayout?.people ?? []), ...(result.hub?.people ?? [])].map(person => [person.id, person])).values()];
  const items = result.hub?.items ?? [];
  const board = result.householdBoards;
  const photos = result.media?.assets ?? [];
  const background = result.media?.background ?? result.media?.householdBackground ?? null;
  const zone = result.display.timezone ?? "UTC";
  const today = result.householdBoards?.from ?? new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.parse(result.serverNow));
  const dayActivities = result.dayActivities?.activities ?? [];
  return <section className="display-preview" aria-label={t("displayPreviewTitle")}>
    <header><h3>{t("displayPreviewTitle")}</h3><p>{t("displayPreviewReadonly")}</p></header>
    {background && <img className="display-preview-background" src={background.previewUrl} alt={background.title} referrerPolicy="no-referrer"/>}
    <div className="display-preview-layout">
      {result.setup.cardOrder.map((cardValue, index) => {
        const card = cardValue as CardId;
        if (!CARD_IDS.includes(card)) return null;
        if (!result.setup.cards.includes(card)) return null;
        let content: ReactNode = null;
        if (card === "household_messages") content = result.cards.map(message => <article className="display-preview-message" key={message.id}><strong>{message.author}</strong><p>{message.body}</p>{message.authorPhoto?.url96&&<img src={message.authorPhoto.url96} alt="" referrerPolicy="no-referrer"/>}</article>);
        else if (card === "family_layout") content = <div className="display-preview-people">{!result.setup.cards.includes("people")&&people.map(person => <span className="display-preview-person" key={person.id}>{person.photo?.url96 && <img src={person.photo.url96} alt="" referrerPolicy="no-referrer"/>}{person.displayName}</span>)}</div>;
        else if (card === "people") content = <div className="display-preview-people">{people.map(person => <span className="display-preview-person" key={person.id}>{person.photo?.url96 && <img src={person.photo.url96} alt="" referrerPolicy="no-referrer"/>}{person.displayName}</span>)}</div>;
        else if (card === "new_message") content = <button type="button" className="button" disabled>{t("newMessage")}</button>;
        else if (card === "external_items") content = items.filter(item => item.metadata.calendar).map(item => <article className="display-preview-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>);
        else if (card === "worth_remembering") content = items.filter(item => item.kind === "summary" || item.kind === "list").map(item => <article className="display-preview-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>);
        else if (card === "today" || card === "tomorrow") {
          const targetDate = card === "today" ? today : (() => { const value = new Date(`${today}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); })();
          const dinners = (board?.dinners ?? []).filter(dinner => dinner.localDate === targetDate).map(dinner => ({ ...dinner, emoji: dinner.emoji ?? null, revision: dinner.revision ?? 0, cleared: dinner.cleared ?? false }));
          const timeline = mergeTimelineEntries(dayActivities, dinners, zone, targetDate, targetDate);
          const birthdayDue = card === "today" ? "today" : "tomorrow";
          const due = result.familyLayout?.upcomingBirthdays?.filter(birthday => birthday.due === birthdayDue) ?? [];
          content = <>{due.map(birthday => <p className="hub-person-birthday" key={birthday.personId}>🎂 {birthday.displayName}</p>)}{timeline.map(entry => <article className="display-preview-item" key={`${entry.kind}:${entry.id}`}><strong>{entry.kind === "school" ? entry.activity.title : entry.kind === "calendar" ? entry.activity.title : entry.title}</strong>{entry.kind === "school" && <span>{entry.activity.actions.slice(0, 2).join(" · ")}</span>}{entry.kind === "calendar" && entry.activity.body && <p>{entry.activity.body}</p>}</article>)}</>;
        }
        else if (card === "week") content = (result.weekActivities?.activities ?? []).map(item => <article className="display-preview-item" key={item.id}><strong>{item.title}</strong>{item.type === "school" && <span>{item.actions.slice(0, 2).join(" · ")}</span>}{item.type === "calendar" && <p>{item.body}</p>}</article>);
        else if (card === "next") content = result.nextActivity ? result.nextActivity.type === "school" ? <article className="display-preview-item"><strong>{result.nextActivity.title}</strong><span>{result.nextActivity.actions.slice(0, 2).join(" · ")}</span></article> : <article className="display-preview-item"><strong>{result.nextActivity.title}</strong><p>{result.nextActivity.startsAt ?? ""}</p></article> : <p className="field-hint">{t("displayEmptyBody")}</p>;
        else if (card === "groceries" && board?.readable?.groceries) content = (board.groceries ?? []).map(item => <article className="display-preview-item" key={item.id}><span>{item.checked ? "✓ " : ""}{item.label}</span></article>);
        else if (card === "dinners" && board?.readable?.dinners) content = (board.dinners ?? []).map(item => <article className="display-preview-item" key={item.id}><strong>{item.localDate}</strong><span>{item.title ?? t("boardDinnerEmpty")}</span></article>);
        else if (card === "photos") content = photos.length ? <MediaSlideshow assets={photos} label={cardLabel(card)}/> : <p className="field-hint">{t("displayEmptyBody")}</p>;
        else if (card === "home_assistant") content = <p className="field-hint">{t("displayPreviewHaReadonly")}</p>;
        return <article className={`display-preview-card display-preview-${card}`} key={card} style={{ order: index + 1 }}><h4>{cardLabel(card)}</h4>{content}</article>;
      })}
    </div>
  </section>;
}

export function DisplaySetupsAdmin({ householdId, member, people, displays, onChanged }: { householdId: string; member: Membership; people: Person[]; displays: Display[]; onChanged: () => Promise<void> }) {
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
  const [policyDisplay, setPolicyDisplay] = useState<Display | null>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [mediaPolicies, setMediaPolicies] = useState<MediaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [optionalLoadError, setOptionalLoadError] = useState<unknown>(null);
  const [mediaPolicyError, setMediaPolicyError] = useState<unknown>(null);
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

  const open = (setup?: Setup) => { setEditing(setup ?? null); setDraft(setup ? asDraft(setup) : emptyDraft(member.household_locale)); setEditorOpen(true); setPreview(null); };
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
  const previewSetup = async (display: Display) => {
    const generation = ++previewGeneration.current;
    const household = householdId;
    const result = await api<Preview>(`/households/${household}/displays/${display.id}/preview`, "POST", { draft });
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

  return <section className="display-setups-admin">
    <header className="section-heading"><div><p className="eyebrow">{t("displaySetups")}</p><h2>{t("displaySetupsTitle")}</h2><p>{t("displaySetupsBody")}</p></div><button className="button" disabled={busy} onClick={() => open()}><Icon name="plus"/>{t("displaySetupNew")}</button></header>
    {loading && <p role="status">{t("loading")}</p>}
    {loadError && <ErrorNotice error={loadError}/>}
    {optionalLoadError && <p className="field-hint" role="status">{t("displayOptionalSourcesUnavailable")}</p>}
    {error && <ErrorNotice error={error}/>}
    <div className="display-setup-list">{setups.map(setup => <article className="display-setup-card" key={setup.id}><div><h3>{setup.name}</h3><p>{setup.cardOrder.map(cardLabel).join(" · ")}</p><p className="field-hint">{t("displaySetupAssignedTo")}: {assignedDevices(setup).join(", ") || t("displaySetupUnassigned")}</p></div><button className="button" disabled={busy} onClick={() => open(setup)}>{t("edit")}</button></article>)}</div>
    {editorOpen && <div className="display-setup-editor" role="region" aria-label={t("displaySetupEditor")}>
      <fieldset disabled={busy} className="display-editor-controls">
        <div className="form-grid"><Field label={t("displaySetupName")}><input maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></Field><Field label={t("displayLocale")}><select value={draft.locale} onChange={e => setDraft({ ...draft, locale: e.target.value as "en" | "nb" })}><option value="en">{t("en")}</option><option value="nb">{t("nb")}</option></select></Field><Field label={t("displayTheme")}><select value={draft.theme} onChange={e => setDraft({ ...draft, theme: e.target.value as Draft["theme"] })}>{(["light", "dark", "system"] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field></div>
        <fieldset><legend>{t("displaySetupCards")}</legend>{CARD_IDS.map(id => <Check key={id} label={cardLabel(id)} checked={draft.cards.includes(id)} onChange={checked => { const cards = toggle(draft.cards, id, checked); setDraft({ ...draft, cards, cardOrder: checked ? [...draft.cardOrder, id] : draft.cardOrder.filter(card => card !== id) }); }}/>) }<p className="field-hint">{t("displaySetupOrderHint")}</p><ol className="display-card-order">{draft.cardOrder.map((id, index) => <li key={id}><span>{cardLabel(id)}</span><button type="button" className="button subtle" disabled={!index || busy} onClick={() => { const next = [...draft.cardOrder]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setDraft({ ...draft, cardOrder: next }); }} aria-label={t("moveUp")}>↑</button><button type="button" className="button subtle" disabled={index === draft.cardOrder.length - 1 || busy} onClick={() => { const next = [...draft.cardOrder]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; setDraft({ ...draft, cardOrder: next }); }} aria-label={t("moveDown")}>↓</button></li>)}</ol></fieldset>
        <fieldset><legend>{t("displaySetupPeople")}</legend>{people.map(person => <Check key={person.id} label={person.display_name} checked={draft.personIds.includes(person.id)} onChange={checked => setDraft({ ...draft, personIds: toggle(draft.personIds, person.id, checked) })}/>)}</fieldset>
        <fieldset><legend>{t("displaySetupSources")}</legend><Check label={t("allSources")} checked={draft.allSources} onChange={checked => setDraft({ ...draft, allSources: checked })}/>{integrations.map(connection => <Check key={connection.id} label={connection.name} checked={draft.sourceIds.includes(connection.id)} onChange={checked => setDraft({ ...draft, sourceIds: toggle(draft.sourceIds, connection.id, checked) })}/>) }{selectedSources.map(source => <Check key={source.id} label={source.label} checked={draft.calendarSourceIds.includes(source.id)} onChange={checked => setDraft({ ...draft, calendarSourceIds: toggle(draft.calendarSourceIds, source.id, checked) })}/>) }<Check label={t("allSensors")} checked={draft.allSensors} onChange={checked => setDraft({ ...draft, allSensors: checked })}/>{selectedSensors.map(sensor => <Check key={sensor.id} label={sensor.label} checked={draft.sensorIds.includes(sensor.id)} onChange={checked => setDraft({ ...draft, sensorIds: toggle(draft.sensorIds, sensor.id, checked) })}/>)}</fieldset>
        <fieldset><legend>{t("displaySetupMedia")}</legend>{albums.filter(album => album.kind === "photos").map(album => <Check key={album.id} label={album.name} checked={draft.albumIds.includes(album.id)} onChange={checked => setDraft({ ...draft, albumIds: toggle(draft.albumIds, album.id, checked) })}/>) }<Field label={t("displayBackground")}><select value={draft.backgroundId ?? ""} onChange={e => setDraft({ ...draft, backgroundId: e.target.value || null })}><option value="">{t("none")}</option>{backgrounds.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></Field></fieldset>
        <div className="form-actions"><button type="button" className="button subtle" onClick={() => { setEditing(null); setEditorOpen(false); setDraft(emptyDraft(member.household_locale)); setPreview(null); }}>{t("cancel")}</button><button type="button" className="button" disabled={!draft.name.trim()} onClick={() => void run(save)}>{t("save")}</button>{displays.filter(display => !display.revoked_at).map(display => <button type="button" className="button" key={display.id} disabled={!draft.name.trim()} onClick={() => void run(() => previewSetup(display))}>{t("displayPreviewFor", { name: display.name })}</button>)}</div>
      </fieldset>
      {preview && <ReadonlyPreview result={preview.result} cardLabel={cardLabel} t={t}/>}
    </div>}
    <section><h3>{t("displayDeviceGrants")}</h3>{displays.map(display => <article className="display-setup-card" key={display.id}><div><strong>{display.name}</strong><p className="field-hint">{t("displaySetup")}: {setups.find(setup => setup.id === display.setup_id)?.name ?? t("defaultDisplaySetup")}</p></div><span>{display.revoked_at ? t("revoked") : t("active")}</span>{!display.revoked_at && <button className="button" disabled={busy} onClick={() => void run(() => openPolicy(display))}>{t("displayDeviceGrants")}</button>}</article>)}</section>
    {policyDisplay && policy && <section className="display-policy-editor"><h3>{t("displayDeviceGrants")}: {policyDisplay.name}</h3><fieldset disabled={busy}>
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
