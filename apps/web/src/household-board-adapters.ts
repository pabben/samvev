import { api } from "./api";

export type GroceryItem = { id: string; label: string; checked: boolean; revision: number };
export type DinnerOption = { id: string; title: string; emoji: string; revision: number };
export type DinnerAssignment = { id: string; localDate: string; title: string | null; emoji: string | null; revision: number; cleared: boolean };
export type BoardCard = "groceries" | "dinners";
export type BoardDateWindow = { from: string; to: string };

type RequestKey = { requestKey: string };
type Expected = { expectedRevision: number; requestKey: string };

/** Transport contract shared by the member Home and paired display surfaces. */
export interface HouseholdBoardAdapter {
  readonly kind: "member" | "display";
  readonly scopeKey: string;
  /** A display surface supplies the current server-projected read grants. */
  readonly readable: Readonly<Record<BoardCard, boolean>>;
  /** Device write affordances are opt-in and still checked by the server. */
  readonly writable: Readonly<Record<BoardCard, boolean>>;
  listGroceries(): Promise<{ items: GroceryItem[] }>;
  createGrocery(input: { label: string; checked: false } & RequestKey): Promise<unknown>;
  updateGrocery(id: string, input: { checked?: boolean; label?: string } & Expected): Promise<unknown>;
  deleteGrocery(id: string, input: Expected): Promise<unknown>;
  listDinnerOptions(): Promise<{ options: DinnerOption[] }>;
  createDinnerOption(input: { title: string; emoji: string } & RequestKey): Promise<unknown>;
  updateDinnerOption(id: string, input: { title?: string; emoji?: string } & Expected): Promise<unknown>;
  deleteDinnerOption(id: string, input: Expected): Promise<unknown>;
  listDinners(window: BoardDateWindow): Promise<{ assignments: DinnerAssignment[] }>;
  setDinner(localDate: string, input: { optionId: string | null; expectedRevision: number; requestKey: string }): Promise<unknown>;
}

function memberPath(householdId: string, suffix: string): string {
  return `/households/${encodeURIComponent(householdId)}/${suffix}`;
}

/** Member adapter always uses the household-scoped member API and CSRF wrapper. */
export function memberHouseholdBoardAdapter(householdId: string): HouseholdBoardAdapter {
  return {
    kind: "member",
    scopeKey: `member:${householdId}`,
    readable: { groceries: true, dinners: true },
    writable: { groceries: true, dinners: true },
    listGroceries: () => api<{ items: GroceryItem[] }>(memberPath(householdId, "groceries")),
    createGrocery: (input) => api(memberPath(householdId, "groceries"), "POST", input),
    updateGrocery: (id, input) => api(memberPath(householdId, `groceries/${encodeURIComponent(id)}`), "PATCH", input),
    deleteGrocery: (id, input) => api(memberPath(householdId, `groceries/${encodeURIComponent(id)}`), "DELETE", input),
    listDinnerOptions: () => api<{ options: DinnerOption[] }>(memberPath(householdId, "dinner-options")),
    createDinnerOption: (input) => api(memberPath(householdId, "dinner-options"), "POST", input),
    updateDinnerOption: (id, input) => api(memberPath(householdId, `dinner-options/${encodeURIComponent(id)}`), "PATCH", input),
    deleteDinnerOption: (id, input) => api(memberPath(householdId, `dinner-options/${encodeURIComponent(id)}`), "DELETE", input),
    listDinners: ({ from, to }) => api<{ assignments: DinnerAssignment[] }>(`${memberPath(householdId, "dinners")}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    setDinner: (date, input) => api(memberPath(householdId, `dinners/${encodeURIComponent(date)}`), "PUT", input),
  };
}

/** Device transport stays under /display; read-only unless grants are explicit. */
export function displayHouseholdBoardAdapter(displayId: string, readGrants: Partial<Record<BoardCard, boolean>> = {}, actionGrants: Partial<Record<BoardCard, boolean>> = {}): HouseholdBoardAdapter {
  if (!displayId.trim()) throw new Error("A paired display ID is required for board scoping.");
  const path = (suffix: string) => `/display/${suffix}`;
  return {
    kind: "display",
    scopeKey: `display:${displayId}`,
    readable: { groceries: readGrants.groceries === true, dinners: readGrants.dinners === true },
    writable: { groceries: actionGrants.groceries === true, dinners: actionGrants.dinners === true },
    listGroceries: () => api<{ items: GroceryItem[] }>(path("groceries")),
    createGrocery: (input) => api(path("groceries"), "POST", input),
    updateGrocery: (id, input) => api(path(`groceries/${encodeURIComponent(id)}`), "PATCH", input),
    deleteGrocery: (id, input) => api(path(`groceries/${encodeURIComponent(id)}`), "DELETE", input),
    listDinnerOptions: () => api<{ options: DinnerOption[] }>(path("dinner-options")),
    createDinnerOption: (input) => api(path("dinner-options"), "POST", input),
    updateDinnerOption: (id, input) => api(path(`dinner-options/${encodeURIComponent(id)}`), "PATCH", input),
    deleteDinnerOption: (id, input) => api(path(`dinner-options/${encodeURIComponent(id)}`), "DELETE", input),
    listDinners: ({ from, to }) => api<{ assignments: DinnerAssignment[] }>(`${path("dinners")}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    setDinner: (date, input) => api(path(`dinners/${encodeURIComponent(date)}`), "PUT", input),
  };
}

export function dateOffset(localDate: string, offset: number): string {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function sevenDayWindow(start: string): BoardDateWindow {
  return { from: start, to: dateOffset(start, 6) };
}
