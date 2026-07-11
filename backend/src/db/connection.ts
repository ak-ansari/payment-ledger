import Database from "better-sqlite3";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import { randomUUID } from "node:crypto";

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "schema.sql"), "utf8");

export const SYSTEM_ACCOUNTS = {
  cash: "sys-cash",
  receivable: "sys-accounts-receivable",
  revenue: "sys-revenue",
} as const;

export function createDb(path = ":memory:"): DB {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  seedSystemAccounts(db);
  return db;
}

function seedSystemAccounts(db: DB) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO accounts (id, name, type, created_at) VALUES (?, ?, ?, ?)`
  );
  insert.run(SYSTEM_ACCOUNTS.cash, "Cash", "asset", now);
  insert.run(SYSTEM_ACCOUNTS.receivable, "Accounts Receivable", "asset", now);
  insert.run(SYSTEM_ACCOUNTS.revenue, "Revenue", "revenue", now);
}

export const newId = () => randomUUID();
