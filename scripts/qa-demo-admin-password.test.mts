import assert from "node:assert/strict";
import test from "node:test";
import { passwordSchema } from "@samvev/contracts";
import { hashPassword, verifyLoginPassword } from "@samvev/core";
import {
  QA_ADMIN_EMAIL,
  QA_DATABASE_URL,
  updateQaDemoAdminPassword,
  validateQaDemoEnvironment,
  type QueryClient,
} from "./qa-demo-admin-password.mts";

const validEnvironment = {
  DATABASE_URL: QA_DATABASE_URL,
  SAMVEV_DEMO_MODE: "true",
  SAMVEV_PUBLIC_ORIGIN: "http://qa-app:4173",
};

test("runtime guard accepts only the exact isolated synthetic QA environment", () => {
  assert.doesNotThrow(() => validateQaDemoEnvironment(validEnvironment));
  for (const environment of [
    { ...validEnvironment, DATABASE_URL: "postgresql://example.invalid/live" },
    { ...validEnvironment, SAMVEV_DEMO_MODE: "false" },
    { ...validEnvironment, SAMVEV_PUBLIC_ORIGIN: "https://samvev.example" },
  ]) {
    assert.throws(() => validateQaDemoEnvironment(environment), /Refusing/);
  }
});

function fixtureClient(alreadyMatches: boolean) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client: QueryClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.startsWith("SELECT current_database")) {
        return { rowCount: 1, rows: [{ database_name: "samvev_qa", database_user: "samvev_qa" }] };
      }
      if (text.startsWith("SELECT id,claimed_at")) {
        return { rowCount: 1, rows: [{ id: "installation", claimed_at: new Date(), demo_mode: true }] };
      }
      if (text.startsWith("SELECT id,installation_id")) {
        return { rowCount: 1, rows: [{ id: "account", installation_id: "installation", password_hash: alreadyMatches ? "matching" : "old", disabled_at: null }] };
      }
      if (text.startsWith("SELECT COUNT(*)")) return { rowCount: 1, rows: [{ membership_count: 1, installation_admin_count: 1, synthetic_household_count: 1, live_household_count: 0, foreign_installation_count: 0 }] };
      if (text.startsWith("UPDATE accounts")) return { rowCount: 1, rows: [{ id: "account" }] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return { client, calls };
}

function guardedClient(options: {
  databaseName?: string;
  databaseUser?: string;
  demoMode?: boolean;
  disabled?: boolean;
  accountCount?: number;
  membershipCount?: number;
  installationAdminCount?: number;
  syntheticHouseholdCount?: number;
  liveHouseholdCount?: number;
  foreignInstallationCount?: number;
} = {}) {
  const calls: string[] = [];
  const accountCount = options.accountCount ?? 1;
  const client: QueryClient = { async query(text) {
    calls.push(text);
    if (text.startsWith("SELECT current_database")) return { rowCount: 1, rows: [{ database_name: options.databaseName ?? "samvev_qa", database_user: options.databaseUser ?? "samvev_qa" }] };
    if (text.startsWith("SELECT id,claimed_at")) return { rowCount: 1, rows: [{ id: "installation", claimed_at: new Date(), demo_mode: options.demoMode ?? true }] };
    if (text.startsWith("SELECT id,installation_id")) return { rowCount: accountCount, rows: Array.from({ length: accountCount }, (_, index) => ({ id: `account-${index}`, installation_id: "installation", password_hash: "old", disabled_at: options.disabled ? new Date() : null })) };
    if (text.startsWith("SELECT COUNT(*)")) return { rowCount: 1, rows: [{ membership_count: options.membershipCount ?? 1, installation_admin_count: options.installationAdminCount ?? 1, synthetic_household_count: options.syntheticHouseholdCount ?? 1, live_household_count: options.liveHouseholdCount ?? 0, foreign_installation_count: options.foreignInstallationCount ?? 0 }] };
    if (text.startsWith("UPDATE accounts")) return { rowCount: 1, rows: [{ id: "account-0" }] };
    throw new Error(`Unexpected query: ${text}`);
  } };
  return { client, calls };
}

test("procedure targets only the bound synthetic admin and is idempotent", async () => {
  const first = fixtureClient(false);
  assert.equal(await updateQaDemoAdminPassword(first.client, "admin", {
    hashPassword: async (value) => `hash:${value}`,
    verifyLoginPassword: async (_value, hash) => hash === "matching",
  }), "updated");
  const update = first.calls.find(({ text }) => text.startsWith("UPDATE accounts"));
  assert.deepEqual(update?.values, ["hash:admin", "account", "installation", QA_ADMIN_EMAIL]);
  assert.match(update?.text ?? "", /email_normalized=\$4/);

  const second = fixtureClient(true);
  assert.equal(await updateQaDemoAdminPassword(second.client, "admin", {
    hashPassword: async () => { throw new Error("idempotent path must not generate a new hash"); },
    verifyLoginPassword: async (_value, hash) => hash === "matching",
  }), "unchanged");
  assert.equal(second.calls.some(({ text }) => text.startsWith("UPDATE accounts")), false);
});

test("procedure exercises every database and account boundary before any write", async () => {
  const cases = [
    [guardedClient({ databaseName: "samvev" }), /database identity/],
    [guardedClient({ databaseUser: "samvev" }), /database identity/],
    [guardedClient({ demoMode: false }), /synthetic demo installation/],
    [guardedClient({ disabled: true }), /enabled synthetic installation administrator/],
    [guardedClient({ accountCount: 0 }), /enabled synthetic installation administrator/],
    [guardedClient({ accountCount: 2 }), /enabled synthetic installation administrator/],
    [guardedClient({ membershipCount: 2, syntheticHouseholdCount: 2 }), /one synthetic QA household/],
    [guardedClient({ liveHouseholdCount: 1 }), /one synthetic QA household/],
    [guardedClient({ foreignInstallationCount: 1 }), /one synthetic QA household/],
    [guardedClient({ installationAdminCount: 0 }), /one synthetic QA household/],
  ] as const;
  for (const [{ client, calls }, message] of cases) {
    await assert.rejects(() => updateQaDemoAdminPassword(client), message);
    assert.equal(calls.some((text) => text.startsWith("UPDATE accounts")), false);
  }
});

test("admin uses ordinary password hashing while new-password policy stays strong", async () => {
  const encoded = await hashPassword("admin");
  assert.equal(await verifyLoginPassword("admin", encoded, true), true);
  assert.equal(await verifyLoginPassword("wrong", encoded, true), false);
  assert.equal(passwordSchema.safeParse("admin").success, false);
  assert.equal(passwordSchema.safeParse("Synthetic-strong-42").success, true);
});
