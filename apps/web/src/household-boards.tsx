import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, useI18n } from "./ui";
import { dateOffset, memberHouseholdBoardAdapter, sevenDayWindow, type BoardCard, type DinnerAssignment, type DinnerOption, type GroceryItem, type HouseholdBoardAdapter } from "./household-board-adapters";
import { mayApplyBoardRead, mutationFailure, reconcileBoardSnapshot, type BoardReadResult, type BoardSnapshot } from "./household-board-state";
import { secureUuid } from "./secure-uuid";
import { todayDinnerSummary } from "./household-board-summary";
function requestKey(): string { return secureUuid(); }
function readResult<T>(promise: Promise<T>): Promise<BoardReadResult<T>> { return promise.then(value => ({ value }), error => ({ error })); }
export function MemberHouseholdBoards({ householdId, localDate }: { householdId: string; localDate: string }) {
  const adapter = useMemo(() => memberHouseholdBoardAdapter(householdId), [householdId]);
  const { t } = useI18n();
  const [selected, setSelected] = useState<BoardCard>("groceries");
  const [open, setOpen] = useState(false);
  return <details className="household-board-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Icon name="list" size={17}/>{t("boardsOpen")}</summary>
    <div className="household-board-content">
      <div className="household-board-tabs" role="group" aria-label={t("boardsTitle")}>
        <button type="button" aria-pressed={selected === "groceries"} onClick={() => setSelected("groceries")}>{t("boardGroceries")}</button>
        <button type="button" aria-pressed={selected === "dinners"} onClick={() => setSelected("dinners")}>{t("boardDinners")}</button>
      </div>
      {open && <HouseholdBoardCards adapter={adapter} localDate={localDate} visibleCards={[selected]} display={false}/>}
    </div>
  </details>;
}

type HouseholdBoardCardProps = {
  adapter: HouseholdBoardAdapter;
  localDate: string;
  visibleCards?: BoardCard[];
  display?: boolean;
  compact?: boolean;
};

export function HouseholdBoardCards(props: HouseholdBoardCardProps) {
  return <HouseholdBoardCardsForScope key={props.adapter.scopeKey} {...props}/>;
}

function HouseholdBoardCardsForScope({ adapter, localDate, visibleCards, display = adapter.kind === "display", compact = false }: HouseholdBoardCardProps) {
  const { t, locale } = useI18n();
  const requestedCards = visibleCards ?? ["groceries", "dinners"];
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const [groceries, setGroceries] = useState<GroceryItem[]>([]);
  const [options, setOptions] = useState<DinnerOption[]>([]);
  const [assignments, setAssignments] = useState<DinnerAssignment[]>([]);
  const emptySnapshots = () => ({
    groceries: { value: undefined, state: "unknown" as const } as BoardSnapshot<{ items: GroceryItem[] }>,
    options: { value: undefined, state: "unknown" as const } as BoardSnapshot<{ options: DinnerOption[] }>,
    assignments: { value: undefined, state: "unknown" as const } as BoardSnapshot<{ assignments: DinnerAssignment[] }>,
  });
  const snapshotsRef = useRef(emptySnapshots());
  const [freshness, setFreshness] = useState(emptySnapshots());
  const [weekStart, setWeekStart] = useState(localDate);
  const [selectedDate, setSelectedDate] = useState(localDate);
  const viewKey = `${adapter.scopeKey}|${requestedCards.join(",")}|${localDate}|${weekStart}|${adapter.readable.groceries}|${adapter.readable.dinners}`;
  const viewRef = useRef(viewKey);
  viewRef.current = viewKey;
  const [loadedView, setLoadedView] = useState("");
  const [unavailable, setUnavailable] = useState<BoardCard[]>([]);
  const [writeDenied, setWriteDenied] = useState<BoardCard[]>([]);
  const [error, setError] = useState<{ view: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [groceryDraft, setGroceryDraft] = useState("");
  const [optionTitle, setOptionTitle] = useState("");
  const [optionEmoji, setOptionEmoji] = useState("🍲");
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editEmoji, setEditEmoji] = useState("🍲");
  const pendingGroceryCreate = useRef<{ label: string; key: string } | null>(null);
  const pendingDinnerCreate = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    setGroceryDraft(""); setOptionTitle(""); setOptionEmoji("🍲"); setEditingOption(null); setEditTitle(""); setEditEmoji("🍲");
    pendingGroceryCreate.current = null; pendingDinnerCreate.current = null;
  }, [adapter.scopeKey]);

  useEffect(() => {
    setWeekStart(localDate);
    setSelectedDate(localDate);
  }, [localDate]);

  const activeCards = requestedCards.filter(card => adapter.readable[card]);
  const reconcile = async (force = false): Promise<void> => {
    if (busyRef.current && !force) return;
    const requestedView = viewKey;
    const generation = ++generationRef.current;
    const [groceryResult, optionResult, dinnerResult] = await Promise.all([
      activeCards.includes("groceries") ? readResult(adapter.listGroceries()) : Promise.resolve({ skipped: true as const }),
      activeCards.includes("dinners") ? readResult(adapter.listDinnerOptions()) : Promise.resolve({ skipped: true as const }),
      activeCards.includes("dinners") ? readResult(adapter.listDinners(sevenDayWindow(weekStart))) : Promise.resolve({ skipped: true as const }),
    ]);
    if (!mountedRef.current || !mayApplyBoardRead(requestedView, viewRef.current, generation, generationRef.current)) return;
    const previous = snapshotsRef.current;
    const groceryRead = reconcileBoardSnapshot(previous.groceries, groceryResult);
    const optionsRead = reconcileBoardSnapshot(previous.options, optionResult);
    const dinnerRead = reconcileBoardSnapshot(previous.assignments, dinnerResult);
    snapshotsRef.current = { groceries: groceryRead, options: optionsRead, assignments: dinnerRead };
    setFreshness(snapshotsRef.current);
    const groceryDenied = groceryRead.state === "denied";
    const dinnerDenied = optionsRead.state === "denied" || dinnerRead.state === "denied";
    if (groceryRead.value !== undefined) setGroceries(groceryRead.value.items);
    else if (groceryDenied) setGroceries([]);
    if (optionsRead.value !== undefined) setOptions(optionsRead.value.options);
    else if (optionsRead.state === "denied") setOptions([]);
    if (dinnerRead.value !== undefined) setAssignments(dinnerRead.value.assignments);
    else if (dinnerRead.state === "denied") setAssignments([]);
    setUnavailable(previous => {
      const next = previous.filter(card => !(card === "groceries" && groceryRead.state !== "denied") && !(card === "dinners" && optionsRead.state !== "denied" && dinnerRead.state !== "denied"));
      if (groceryDenied && !next.includes("groceries")) next.push("groceries");
      if (dinnerDenied && !next.includes("dinners")) next.push("dinners");
      return next;
    });
    const transientFailure = (activeCards.includes("groceries") && ["unknown", "stale"].includes(groceryRead.state)) || (activeCards.includes("dinners") && (["unknown", "stale"].includes(optionsRead.state) || ["unknown", "stale"].includes(dinnerRead.state)));
    setError(transientFailure ? { view: requestedView, key: "boardLoadError" } : null);
    setLoadedView(requestedView);
  };

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current++;
    setGroceries([]); setOptions([]); setAssignments([]); snapshotsRef.current = emptySnapshots(); setFreshness(snapshotsRef.current); setUnavailable([]); setWriteDenied([]); setError(null); setLoadedView(""); setBusy(false); busyRef.current = false;
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 7000);
    return () => { mountedRef.current = false; generationRef.current++; window.clearInterval(timer); };
  }, [adapter, viewKey]);

  const runMutation = async (board: BoardCard, operation: () => Promise<unknown>): Promise<boolean> => {
    const requestedView = viewKey;
    busyRef.current = true; setBusy(true); setError(null); generationRef.current++;
    try {
      await operation();
      if (viewRef.current !== requestedView) return false;
      await reconcile(true);
      return true;
    } catch (cause) {
      if (viewRef.current !== requestedView) return false;
      const status = (cause as { status?: number }).status;
      const recovery = mutationFailure(status);
      if (recovery.revokeBoard) setWriteDenied(previous => previous.includes(board) ? previous : [...previous, board]);
      if (recovery.clearAll) { setGroceries([]); setOptions([]); setAssignments([]); snapshotsRef.current = { groceries: { value: undefined, state: "denied" }, options: { value: undefined, state: "denied" }, assignments: { value: undefined, state: "denied" } }; setFreshness(snapshotsRef.current); setUnavailable(activeCards); }
      setError({ view: requestedView, key: recovery.message });
      if (recovery.refresh) {
        await reconcile(true);
        setError({ view: requestedView, key: "boardChangedRefresh" });
      }
      return false;
    } finally {
      if (viewRef.current === requestedView) { busyRef.current = false; setBusy(false); }
    }
  };

  const currentUnavailable = loadedView === viewKey ? unavailable : [];
  const currentWriteDenied = loadedView === viewKey ? writeDenied : [];
  const showGroceries = activeCards.includes("groceries") && !currentUnavailable.includes("groceries");
  const showDinners = activeCards.includes("dinners") && !currentUnavailable.includes("dinners");
  const canGroceries = showGroceries && adapter.writable.groceries && !currentWriteDenied.includes("groceries");
  const canDinners = showDinners && adapter.writable.dinners && !currentWriteDenied.includes("dinners");
  const selectedAssignment = assignments.find(row => row.localDate === selectedDate);
  const todayDinner = todayDinnerSummary(assignments,localDate,freshness.assignments.state==="fresh");
  const hasGroceryPreview=showGroceries&&groceries.length>0;
  const hasDinnerPreview=showDinners&&todayDinner.kind==='planned';
  const emptyHomeSummary=!hasGroceryPreview&&!hasDinnerPreview;
  const selectedOption = selectedAssignment?.title ? options.find(option => option.title === selectedAssignment.title && option.emoji === selectedAssignment.emoji) : undefined;
  const selectedDinnerValue = selectedOption?.id ?? (selectedAssignment?.title ? "__saved_snapshot__" : "");
  const dateLabel = (date: string, weekday: "short" | "long" = "short") => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday, day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
  const titleForDate = (date: string) => date === localDate ? t("boardToday") : date === dateOffset(localDate, 1) ? t("boardTomorrow") : dateLabel(date);

  if (!activeCards.length || activeCards.every(card => currentUnavailable.includes(card))) return <section className="hub-panel household-boards" aria-label={t("boardsTitle")}><p className="hub-empty">{t("boardPermissionLost")}</p></section>;
  if (loadedView !== viewKey) return <section className="hub-panel household-boards" aria-label={t("boardsTitle")}><p className="field-hint">{t("loading")}</p></section>;

  if(compact)return <section className={`hub-panel household-boards household-board-summary ${emptyHomeSummary?"is-empty":"has-preview"}`} aria-label={t("boardsTitle")}>
    {!emptyHomeSummary&&<header className="hub-panel-title"><h2><Icon name="list"/>{t("boardsTitle")}</h2></header>}
    {error?.view===viewKey&&<p className="household-board-error" role="status">{t(error.key as "boardChangedRefresh"|"boardLoadError"|"boardPermissionLost"|"boardSaveError")}</p>}
    {hasGroceryPreview&&<section aria-labelledby="home-grocery-summary"><h3 id="home-grocery-summary">{t("boardGroceries")}</h3><ul className="board-summary-list">{groceries.slice(0,3).map(item=><li className={item.checked?"is-checked":""} key={item.id}><span aria-hidden="true">{item.checked?"✓":"•"}</span><span data-review-private="grocery-label">{item.label}</span></li>)}</ul>{groceries.length>3&&<p className="field-hint">{t("boardMoreItems",{count:groceries.length-3})}</p>}</section>}
    {hasDinnerPreview&&<section aria-labelledby="home-dinner-summary"><h3 id="home-dinner-summary">{t("boardDinners")}</h3><p className="board-summary-dinner"><span aria-hidden="true">{todayDinner.assignment.emoji??"🍽️"}</span><strong data-review-private="dinner-current">{todayDinner.assignment.title}</strong></p></section>}
    <details className="household-board-edit-disclosure" onToggle={event=>setEditOpen(event.currentTarget.open)}>
      <summary>{t("boardEditFromHome")}</summary>
      {editOpen&&<HouseholdBoardCards adapter={adapter} localDate={localDate} visibleCards={requestedCards} display={display}/>}
    </details>
  </section>;

  return <section className={`hub-panel household-boards ${display ? "household-boards-display" : ""}`} aria-label={t("boardsTitle")}>
    <header className="hub-panel-title"><h2><Icon name="list"/>{t("boardsTitle")}</h2></header>
    {error?.view === viewKey && <p className="household-board-error" role="status">{t(error.key as "boardChangedRefresh" | "boardLoadError" | "boardPermissionLost" | "boardSaveError")}</p>}
    {showGroceries && <section className="board-card board-groceries" aria-labelledby="board-groceries-title">
      <h3 id="board-groceries-title">{t("boardGroceries")}</h3>
      {!groceries.length && freshness.groceries.state === "fresh" && <p className="field-hint">{t("boardGroceriesEmpty")}</p>}
      <ul className="board-list">{groceries.map(item => <li key={item.id} className={item.checked ? "is-checked" : ""}>
        <label><input type="checkbox" checked={item.checked} disabled={busy || !canGroceries} onChange={event => void runMutation("groceries", () => adapter.updateGrocery(item.id, { checked: event.currentTarget.checked, expectedRevision: item.revision, requestKey: requestKey() }))}/><span data-review-private="grocery-label">{item.label}</span></label>
        {canGroceries && <button type="button" className="board-icon-button" aria-label={t("boardDeleteGrocery", { label: item.label })} disabled={busy} onClick={() => void runMutation("groceries", () => adapter.deleteGrocery(item.id, { expectedRevision: item.revision, requestKey: requestKey() }))}><Icon name="close" size={16}/></button>}
      </li>)}</ul>
      {canGroceries && <form className="board-add-row" onSubmit={event => { event.preventDefault(); const label = groceryDraft.trim(); if (!label) return; const key = pendingGroceryCreate.current?.label === label ? pendingGroceryCreate.current.key : requestKey(); pendingGroceryCreate.current = { label, key }; void runMutation("groceries", () => adapter.createGrocery({ label, checked: false, requestKey: key })).then(saved => { if (saved && pendingGroceryCreate.current?.key === key) { pendingGroceryCreate.current = null; setGroceryDraft(""); } }); }}>
        <label className="sr-only" htmlFor="board-grocery-add">{t("boardAddGrocery")}</label><input id="board-grocery-add" data-review-private="grocery-draft" maxLength={120} value={groceryDraft} onChange={event => setGroceryDraft(event.target.value)} placeholder={t("boardGroceryPlaceholder")} disabled={busy}/><button type="submit" className="button" disabled={busy || !groceryDraft.trim()}><Icon name="plus" size={16}/>{t("boardAdd")}</button>
      </form>}
    </section>}
    {showDinners && <section className="board-card board-dinners" aria-labelledby="board-dinners-title">
      <div className="board-section-heading"><h3 id="board-dinners-title">{t("boardDinners")}</h3><div className="board-week-nav"><button className="board-icon-button" type="button" aria-label={t("boardPreviousWeek")} disabled={busy} onClick={() => { const next = dateOffset(weekStart, -7); setWeekStart(next); setSelectedDate(next); }}><Icon name="back" size={16}/></button><button className="board-icon-button" type="button" aria-label={t("boardNextWeek")} disabled={busy} onClick={() => { const next = dateOffset(weekStart, 7); setWeekStart(next); setSelectedDate(next); }}><Icon name="arrow" size={16}/></button></div></div>
      <div className="board-day-picker" role="group" aria-label={t("boardChooseDay")}>{Array.from({ length: 7 }, (_, index) => dateOffset(weekStart, index)).map(date => <button type="button" key={date} aria-pressed={date === selectedDate} className={date === selectedDate ? "is-selected" : ""} onClick={() => setSelectedDate(date)}><span>{titleForDate(date)}</span></button>)}</div>
      {selectedAssignment?.title ? <p className="board-dinner-current" data-review-private="dinner-current"><span aria-hidden="true">{selectedAssignment.emoji ?? "🍽️"}</span> {selectedAssignment.title}</p> : freshness.assignments.state === "fresh" && <p className="field-hint">{t("boardDinnerEmpty")}</p>}
      {canDinners && <label className="board-dinner-select"><span>{t("boardChooseDinner", { day: titleForDate(selectedDate) })}</span><select data-review-private="dinner-choice" value={selectedAssignment?.cleared ? "" : selectedDinnerValue} disabled={busy} onChange={event => {
        const option = options.find(item => item.id === event.currentTarget.value);
        void runMutation("dinners", () => adapter.setDinner(selectedDate, { optionId: option?.id ?? null, expectedRevision: selectedAssignment?.revision ?? 0, requestKey: requestKey() }));
      }}><option value="">{t("boardNoDinner")}</option>{selectedAssignment?.title && !selectedOption && <option value="__saved_snapshot__">{selectedAssignment.emoji ?? "🍽️"} {selectedAssignment.title}</option>}{options.map(option => <option value={option.id} key={option.id}>{option.emoji} {option.title}</option>)}</select></label>}
      {canDinners && <div className="board-options"><h4>{t("boardDinnerOptions")}</h4><ul className="board-option-list">{options.map(option => <li key={option.id}>
        {editingOption === option.id ? <form onSubmit={event => { event.preventDefault(); void runMutation("dinners", () => adapter.updateDinnerOption(option.id, { title: editTitle.trim(), emoji: editEmoji, expectedRevision: option.revision, requestKey: requestKey() })).then(saved => { if (saved) setEditingOption(null); }); }}><input data-review-private="dinner-edit-title" aria-label={t("boardOptionName")} maxLength={80} value={editTitle} onChange={event => setEditTitle(event.target.value)}/><input data-review-private="dinner-edit-emoji" aria-label={t("boardOptionEmoji")} maxLength={16} value={editEmoji} onChange={event => setEditEmoji(event.target.value)}/><button className="board-icon-button" type="submit" disabled={busy || !editTitle.trim()} aria-label={t("boardSaveOption")}><Icon name="check" size={16}/></button></form> : <><span data-review-private="dinner-option">{option.emoji} {option.title}</span><button className="board-icon-button" type="button" aria-label={t("boardEditOption", { title: option.title })} disabled={busy} onClick={() => { setEditingOption(option.id); setEditTitle(option.title); setEditEmoji(option.emoji); }}><Icon name="settings" size={16}/></button><button className="board-icon-button" type="button" aria-label={t("boardDeleteOption", { title: option.title })} disabled={busy} onClick={() => void runMutation("dinners", () => adapter.deleteDinnerOption(option.id, { expectedRevision: option.revision, requestKey: requestKey() }))}><Icon name="close" size={16}/></button></>}
      </li>)}</ul>
      <form className="board-add-row board-option-add-row" onSubmit={event => { event.preventDefault(); const title = optionTitle.trim(); if (!title) return; const emoji = optionEmoji.trim() || "🍲"; const signature = JSON.stringify([title, emoji]); const key = pendingDinnerCreate.current?.signature === signature ? pendingDinnerCreate.current.key : requestKey(); pendingDinnerCreate.current = { signature, key }; void runMutation("dinners", () => adapter.createDinnerOption({ title, emoji, requestKey: key })).then(saved => { if (saved && pendingDinnerCreate.current?.key === key) { pendingDinnerCreate.current = null; setOptionTitle(""); } }); }}><label className="sr-only" htmlFor="board-option-emoji">{t("boardOptionEmoji")}</label><input id="board-option-emoji" data-review-private="dinner-new-emoji" aria-label={t("boardOptionEmoji")} maxLength={16} value={optionEmoji} onChange={event => setOptionEmoji(event.target.value)}/><label className="sr-only" htmlFor="board-option-add">{t("boardOptionName")}</label><input id="board-option-add" data-review-private="dinner-new-title" maxLength={80} value={optionTitle} onChange={event => setOptionTitle(event.target.value)} placeholder={t("boardOptionPlaceholder")} disabled={busy}/><button type="submit" className="button" disabled={busy || !optionTitle.trim()}><Icon name="plus" size={16}/>{t("boardAdd")}</button></form></div>}
      {display && !canDinners && <p className="field-hint">{t("boardDisplayReadOnly")}</p>}
    </section>}
    {display && showGroceries && !canGroceries && <p className="field-hint">{t("boardDisplayReadOnly")}</p>}
  </section>;
}
