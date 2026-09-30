import { pathToFileURL } from "node:url";
import { hashPassword, verifyLoginPassword } from "@samvev/core";
import pg from "pg";

const { Pool } = pg;

export const QA_DATABASE_URL =
  "postgresql://samvev_qa:synthetic-qa-data-only@qa-db:5432/samvev_qa";
export const QA_ADMIN_EMAIL = "admin@demo.invalid";
const QA_ADMIN_PASSWORD = "admin";
const LOCAL_QA_ORIGINS = new Set([
  "http://qa-app:4173",
  "http://192.168.0.220:4173",
]);

type Environment = Record<string, string | undefined>;
type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type QueryClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export function validateQaDemoEnvironment(environment: Environment): void {
  if (environment.DATABASE_URL !== QA_DATABASE_URL) {
    throw new Error("Refusing non-QA database URL.");
  }
  if (environment.SAMVEV_DEMO_MODE !== "true") {
    throw new Error("Refusing runtime without synthetic demo mode.");
  }
  if (!LOCAL_QA_ORIGINS.has(environment.SAMVEV_PUBLIC_ORIGIN ?? "")) {
    throw new Error("Refusing non-local QA public origin.");
  }
}

export async function updateQaDemoAdminPassword(
  client: QueryClient,
  password = QA_ADMIN_PASSWORD,
  passwordOps = { hashPassword, verifyLoginPassword },
): Promise<"updated" | "unchanged"> {
  const databaseIdentity = await client.query(
    "SELECT current_database() AS database_name,current_user AS database_user",
  );
  if (
    databaseIdentity.rowCount !== 1 ||
    databaseIdentity.rows[0]?.database_name !== "samvev_qa" ||
    databaseIdentity.rows[0]?.database_user !== "samvev_qa"
  ) {
    throw new Error("Refusing unexpected QA database identity.");
  }

  const installation = await client.query(
    "SELECT id,claimed_at,demo_mode FROM installations WHERE singleton=true FOR UPDATE",
  );
  const current = installation.rows[0] as
    | { id: string; claimed_at: Date | null; demo_mode: boolean }
    | undefined;
  if (
    installation.rowCount !== 1 ||
    !current?.claimed_at ||
    current.demo_mode !== true
  ) {
    throw new Error("Refusing database without one claimed synthetic demo installation.");
  }

  const account = await client.query(
    `SELECT id,installation_id,password_hash,disabled_at
     FROM accounts
     WHERE installation_id=$1 AND email_normalized=$2
     FOR UPDATE`,
    [current.id, QA_ADMIN_EMAIL],
  );
  const admin = account.rows[0] as
    | {
        id: string;
        installation_id: string;
        password_hash: string | null;
        disabled_at: Date | null;
      }
    | undefined;
  if (
    account.rowCount !== 1 ||
    !admin ||
    admin.installation_id !== current.id ||
    admin.disabled_at !== null ||
    !admin.password_hash
  ) {
    throw new Error("Refusing database without the enabled synthetic installation administrator.");
  }

  const binding = await client.query(
    `SELECT COUNT(*)::int AS membership_count,
      COUNT(*) FILTER (WHERE m.role_preset='installation_admin')::int AS installation_admin_count,
      COUNT(*) FILTER (WHERE h.installation_id=$1 AND h.data_kind IN ('demo','synthetic'))::int AS synthetic_household_count,
      COUNT(*) FILTER (WHERE h.data_kind='live')::int AS live_household_count,
      COUNT(*) FILTER (WHERE h.installation_id<>$1)::int AS foreign_installation_count
     FROM memberships m
     JOIN households h ON h.id=m.household_id
     WHERE m.account_id=$2`,
    [current.id, admin.id],
  );
  const scope = binding.rows[0];
  if (
    binding.rowCount !== 1 ||
    scope?.membership_count !== 1 ||
    scope.installation_admin_count !== 1 ||
    scope.synthetic_household_count !== 1 ||
    scope.live_household_count !== 0 ||
    scope.foreign_installation_count !== 0
  ) {
    throw new Error("Refusing administrator outside one synthetic QA household.");
  }

  if (
    await passwordOps.verifyLoginPassword(password, admin.password_hash, true)
  ) {
    return "unchanged";
  }

  const replacement = await passwordOps.hashPassword(password);
  const updated = await client.query(
    `UPDATE accounts
     SET password_hash=$1,password_changed_at=clock_timestamp(),revision=revision+1
     WHERE id=$2 AND installation_id=$3 AND email_normalized=$4 AND disabled_at IS NULL
     RETURNING id`,
    [replacement, admin.id, current.id, QA_ADMIN_EMAIL],
  );
  if (updated.rowCount !== 1 || updated.rows[0]?.id !== admin.id) {
    throw new Error("Synthetic administrator changed concurrently; no password was confirmed.");
  }
  return "updated";
}

export async function runQaDemoAdminPassword(
  environment: Environment = process.env,
): Promise<"updated" | "unchanged"> {
  validateQaDemoEnvironment(environment);
  const pool = new Pool({ connectionString: environment.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await updateQaDemoAdminPassword(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runQaDemoAdminPassword();
  console.log(
    result === "updated"
      ? "Updated only the existing synthetic QA administrator password."
      : "Synthetic QA administrator password already matches; no row was updated.",
  );
}
