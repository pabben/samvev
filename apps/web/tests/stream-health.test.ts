import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disconnected,
  streamSignal,
  projectionRecovered,
} from "../src/stream-health.ts";
test("degraded start and healthy heartbeats cannot claim recovery", () => {
  let state = streamSignal(disconnected(), "ready", {
    listenerConnected: false,
    pollingFallback: true,
  });
  assert.equal(state.phase, "degraded");
  state = streamSignal(state, "heartbeat", {
    listenerConnected: true,
    pollingFallback: false,
  });
  assert.equal(state.phase, "degraded");
  assert.equal(projectionRecovered(state, state.epoch).phase, "degraded");
});
test("restoration requires a successful fresh projection, not a stale request or heartbeat", () => {
  let state = streamSignal(disconnected(), "ready", {
    listenerConnected: true,
    pollingFallback: false,
  });
  state = projectionRecovered(state, state.epoch);
  assert.equal(state.phase, "live");
  const oldEpoch = state.epoch;
  state = streamSignal(state, "listener-degraded", {
    listenerConnected: true,
    pollingFallback: true,
  });
  assert.equal(state.phase, "degraded");
  state = streamSignal(state, "listener-restored", {
    listenerConnected: true,
    pollingFallback: true,
    refetchRequired: true,
  });
  assert.equal(projectionRecovered(state, oldEpoch).phase, "refreshing");
  state = streamSignal(state, "heartbeat", {
    listenerConnected: true,
    pollingFallback: false,
  });
  assert.equal(state.phase, "refreshing");
  assert.equal(projectionRecovered(state, state.epoch).phase, "live");
});
test("local offline, cache loss or stream closure invalidate the old live epoch", () => {
  let state = streamSignal(disconnected(), "ready", {
    listenerConnected: true,
    pollingFallback: false,
  });
  state = projectionRecovered(state, state.epoch);
  const old = state.epoch;
  state = streamSignal(state, "error");
  assert.equal(state.phase, "disconnected");
  assert.equal(projectionRecovered(state, old).phase, "disconnected");
  state = streamSignal(state, "heartbeat", {
    listenerConnected: true,
    pollingFallback: false,
  });
  assert.equal(state.phase, "disconnected");
  state = streamSignal(state, "ready", {
    listenerConnected: true,
    pollingFallback: false,
  });
  assert.equal(state.phase, "refreshing");
  assert.equal(projectionRecovered(state, state.epoch).phase, "live");
});
