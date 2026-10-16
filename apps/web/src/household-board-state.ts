export type BoardReadResult<T> = { value: T } | { error: unknown } | { skipped: true };
export type BoardReadState = "unknown" | "fresh" | "denied" | "stale" | "skipped";
export type BoardSnapshot<T> = { value: T | undefined; state: BoardReadState };

/** Reconcile one independently authorized board without turning failures into empty data. */
export function reconcileBoardSnapshot<T>(previous: BoardSnapshot<T>, result: BoardReadResult<T>): BoardSnapshot<T> {
  if ("value" in result) return { value: result.value, state: "fresh" };
  if ("skipped" in result) return { value: previous.value, state: "skipped" };
  const status = (result.error as { status?: number } | null)?.status;
  if ([401, 403, 404].includes(status ?? 0)) return { value: undefined, state: "denied" };
  return previous.value === undefined
    ? { value: undefined, state: "unknown" }
    : { value: previous.value, state: "stale" };
}

export function mayApplyBoardRead(requestedView: string, activeView: string, requestGeneration: number, currentGeneration: number): boolean {
  return requestedView === activeView && requestGeneration === currentGeneration;
}

export type MutationFailure = { refresh: boolean; revokeBoard: boolean; clearAll: boolean; message: "boardChangedRefresh" | "boardPermissionLost" | "boardSaveError" };
export function mutationFailure(status?: number): MutationFailure {
  if (status === 409) return { refresh: true, revokeBoard: false, clearAll: false, message: "boardChangedRefresh" };
  if (status === 403) return { refresh: false, revokeBoard: true, clearAll: false, message: "boardPermissionLost" };
  if (status === 401) return { refresh: false, revokeBoard: false, clearAll: true, message: "boardPermissionLost" };
  return { refresh: false, revokeBoard: false, clearAll: false, message: "boardSaveError" };
}
