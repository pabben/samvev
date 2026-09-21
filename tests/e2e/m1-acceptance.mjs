import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const baseURL = process.env.BASE_URL ?? "http://qa-app:4173";
const phase = process.env.QA_PHASE ?? "pre";
const out = "docs/implementation/artifacts/qa";
const stateFile = `${out}/restart-state.json`;
const owner = { email: "owner@pilot.invalid", password: "Synthetic-pilot-pass-42" };
await mkdir(out, { recursive: true });

const result = { executedAt: new Date().toISOString(), baseURL, phase, checks: [] };
const pass = (label) => { result.checks.push(label); console.log(`PASS ${label}`); };
const login = async (request) => {
  const response = await request.post("/api/v1/auth/login", { data: owner });
  expect(response.ok(), await response.text()).toBeTruthy();
  const me = await (await request.get("/api/v1/me")).json();
  return me;
};

try {
  if (phase === "pre" || phase === "restart-pre") {
    // This is the full browser acceptance path, including setup, pairing, roles,
    // live delivery/ACK, edit/withdraw, i18n, themes, responsive captures and offline recovery.
    if (phase === "pre") {
      await import("../../apps/web/tests/smoke.mjs");
      pass("full clean-install browser acceptance path completed");
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL });
    const me = await login(context.request);
    const householdId = me.memberships[0].household_id;
    const displays = await (await context.request.get(`/api/v1/households/${householdId}/displays`)).json();
    const display = displays.displays.find(
      (candidate) =>
        candidate.name === "Kitchen · example" && !candidate.revoked_at,
    );
    expect(display, "active canonical Kitchen fixture display").toBeTruthy();
    const csrf = me.csrfToken;
    const now = Date.now();
    const create = async (body, publishInMs, expiresInMs, key) => {
      const response = await context.request.post(`/api/v1/households/${householdId}/messages`, {
        headers: { "X-CSRF-Token": csrf },
        data: {
          body,
          importance: "normal",
          audience: { household: false, personIds: [], displayIds: [display.id] },
          publishAt: new Date(now + publishInMs).toISOString(),
          expiresAt: new Date(now + expiresInMs).toISOString(),
          idempotencyKey: key,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const missed = await create("QA missed restart window · synthetic", 15_000, 30_000, `qa-missed-${now}`);
    const recover = await create("QA restart recovery window · synthetic", 15_000, 95_000, `qa-recover-${now}`);
    await writeFile(stateFile, JSON.stringify({ householdId, missed, recover, createdAt: now }, null, 2) + "\n");
    await context.close();
    await browser.close();
    pass("two durable schedules committed before worker stop: one missed window and one recoverable window");
  } else if (phase === "post") {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL });
    const me = await login(context.request);
    const list = async () => (await (await context.request.get(`/api/v1/households/${state.householdId}/messages`)).json()).messages;
    await expect.poll(async () => (await list()).find((item) => item.id === state.missed.id)?.state, { timeout: 25_000 }).toBe("expired");
    await expect.poll(async () => (await list()).find((item) => item.id === state.recover.id)?.state, { timeout: 25_000 }).toBe("published");
    pass("stopped worker restart expires a schedule whose whole publication window elapsed");
    pass("restarted worker publishes a still-valid durable schedule automatically");
    await expect.poll(async () => (await list()).find((item) => item.id === state.recover.id)?.state, { timeout: 50_000 }).toBe("expired");
    pass("recovered schedule expires automatically after restarted-worker publication");
    const databaseUrl = process.env.QA_DATABASE_URL;
    expect(databaseUrl).toBeTruthy();
    const database = new pg.Pool({ connectionString: databaseUrl });
    try {
      const events = await database.query("SELECT message_id,to_state FROM message_lifecycle_events WHERE message_id = ANY($1::uuid[]) ORDER BY id", [[state.missed.id, state.recover.id]]);
      const transitions = new Map([[state.missed.id, []], [state.recover.id, []]]);
      for (const event of events.rows) transitions.get(event.message_id).push(event.to_state);
      expect(transitions.get(state.missed.id)).toEqual(["scheduled", "expired"]);
      expect(transitions.get(state.recover.id)).toEqual(["scheduled", "published", "expired"]);
    } finally {
      await database.end();
    }
    pass("lifecycle ledger proves no missed-window publication and exactly one recovery publication");
    await context.close();
    await browser.close();
  } else {
    throw new Error(`Unknown QA_PHASE: ${phase}`);
  }
  await writeFile(`${out}/acceptance-${phase}.json`, JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  result.error = String(error?.stack ?? error);
  await writeFile(`${out}/acceptance-${phase}.json`, JSON.stringify(result, null, 2) + "\n");
  throw error;
}
