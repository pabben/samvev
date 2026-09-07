/** A healthy heartbeat is not evidence that a missed projection was recovered. */
export interface StreamHealth {
  phase: "disconnected" | "degraded" | "refreshing" | "live";
  epoch: number;
}
export interface StreamSignal {
  listenerConnected?: boolean;
  pollingFallback?: boolean;
  refetchRequired?: boolean;
}
export const disconnected = (): StreamHealth => ({
  phase: "disconnected",
  epoch: 0,
});
export function streamSignal(
  state: StreamHealth,
  event:
    "ready" | "heartbeat" | "listener-degraded" | "listener-restored" | "error",
  data: StreamSignal = {},
): StreamHealth {
  if (event === "error")
    return { phase: "disconnected", epoch: state.epoch + 1 };
  if (
    event === "listener-degraded" ||
    data.listenerConnected !== true ||
    (event !== "listener-restored" && data.pollingFallback !== false)
  )
    return { phase: "degraded", epoch: state.epoch + 1 };
  if (event === "ready" || event === "listener-restored")
    return { phase: "refreshing", epoch: state.epoch + 1 };
  return state;
}
export function projectionRecovered(
  state: StreamHealth,
  requestEpoch: number,
): StreamHealth {
  return state.phase === "refreshing" && state.epoch === requestEpoch
    ? { ...state, phase: "live" }
    : state;
}
