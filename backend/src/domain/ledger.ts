import { DB, newId } from "../db/connection.js";
import { NotFoundError, UnbalancedTransactionError, ValidationError } from "./errors.js";

export type AccountType = "asset" | "liability" | "revenue" | "expense" | "equity";
export type Direction = "debit" | "credit";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  created_at: string;
}

export interface EntryInput {
  accountId: string;
  amountCents: number;
}

export function createAccount(db: DB, name: string, type: AccountType): Account {
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, name, type, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, name, type, now);
  return { id, name, type, created_at: now };
}

export function getAccount(db: DB, id: string): Account | undefined {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
}

export function listAccounts(db: DB): Account[] {
  return db.prepare(`SELECT * FROM accounts ORDER BY created_at`).all() as Account[];
}

export function postTransaction(
  db: DB,
  description: string,
  entries: EntryInput[]
): string {
  if (entries.length < 2) {
    throw new ValidationError("a transaction needs at least two entries");
  }

  const sum = entries.reduce((acc, e) => acc + e.amountCents, 0);
  if (sum !== 0) throw new UnbalancedTransactionError(sum);

  for (const e of entries) {
    if (!Number.isInteger(e.amountCents)) {
      throw new ValidationError("amountCents must be an integer");
    }
    if (e.amountCents === 0) {
      throw new ValidationError("entries cannot be zero");
    }
    if (!getAccount(db, e.accountId)) {
      throw new NotFoundError(`account ${e.accountId}`);
    }
  }

  const txnId = newId();
  const now = new Date().toISOString();

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (id, description, created_at) VALUES (?, ?, ?)`
    ).run(txnId, description, now);

    const insertEntry = db.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const e of entries) {
      insertEntry.run(newId(), txnId, e.accountId, e.amountCents, now);
    }
  });
  write();

  return txnId;
}

export function recordTransfer(
  db: DB,
  description: string,
  debitAccountId: string,
  creditAccountId: string,
  amountCents: number
): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError("amountCents must be a positive integer");
  }
  return postTransaction(db, description, [
    { accountId: debitAccountId, amountCents },
    { accountId: creditAccountId, amountCents: -amountCents },
  ]);
}

export function directionOf(amountCents: number): Direction {
  return amountCents >= 0 ? "debit" : "credit";
}

export function getBalance(db: DB, accountId: string): number {
  if (!getAccount(db, accountId)) throw new NotFoundError(`account ${accountId}`);
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM ledger_entries WHERE account_id = ?`)
    .get(accountId) as { balance: number };
  return row.balance;
}

export function systemBalance(db: DB): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_entries`)
    .get() as { total: number };
  return row.total;
}
