import { beforeEach, describe, expect, it } from "vitest";
import { createDb, DB } from "../src/db/connection.js";
import {
  createAccount,
  getBalance,
  postTransaction,
  recordTransfer,
  systemBalance,
} from "../src/domain/ledger.js";

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("ledger", () => {
  it("derives an account balance from its entries", () => {
    const a = createAccount(db, "A", "asset");
    const b = createAccount(db, "B", "revenue");

    postTransaction(db, "sale", [
      { accountId: a.id, amountCents: 5000 },
      { accountId: b.id, amountCents: -5000 },
    ]);

    expect(getBalance(db, a.id)).toBe(5000);
    expect(getBalance(db, b.id)).toBe(-5000);
  });

  it("debits one account and credits another via a transfer", () => {
    const cash = createAccount(db, "Cash", "asset");
    const revenue = createAccount(db, "Revenue", "revenue");

    recordTransfer(db, "sale", cash.id, revenue.id, 5000);

    expect(getBalance(db, cash.id)).toBe(5000);
    expect(getBalance(db, revenue.id)).toBe(-5000);
    expect(systemBalance(db)).toBe(0);
  });

  it("rejects a transfer with a non-positive amount", () => {
    const a = createAccount(db, "A", "asset");
    const b = createAccount(db, "B", "revenue");
    expect(() => recordTransfer(db, "bad", a.id, b.id, 0)).toThrow();
    expect(() => recordTransfer(db, "bad", a.id, b.id, -100)).toThrow();
  });

  it("keeps the whole system balanced to zero after arbitrary activity", () => {
    const accts = ["a", "b", "c"].map((n) => createAccount(db, n, "asset"));
    postTransaction(db, "t1", [
      { accountId: accts[0].id, amountCents: 1000 },
      { accountId: accts[1].id, amountCents: -1000 },
    ]);
    postTransaction(db, "t2", [
      { accountId: accts[1].id, amountCents: 300 },
      { accountId: accts[2].id, amountCents: -300 },
    ]);
    postTransaction(db, "t3 (three legs)", [
      { accountId: accts[0].id, amountCents: -250 },
      { accountId: accts[1].id, amountCents: 100 },
      { accountId: accts[2].id, amountCents: 150 },
    ]);

    expect(systemBalance(db)).toBe(0);
    const total =
      getBalance(db, accts[0].id) + getBalance(db, accts[1].id) + getBalance(db, accts[2].id);
    expect(total).toBe(0);
  });

  it("balance of an untouched account is zero", () => {
    const a = createAccount(db, "fresh", "asset");
    expect(getBalance(db, a.id)).toBe(0);
  });

  it("rejects a transaction whose entries do not sum to zero", () => {
    const a = createAccount(db, "A", "asset");
    const b = createAccount(db, "B", "revenue");
    expect(() =>
      postTransaction(db, "bad", [
        { accountId: a.id, amountCents: 5000 },
        { accountId: b.id, amountCents: -4000 },
      ])
    ).toThrow(/sum to zero/);
  });

  it("rejects a single-entry transaction", () => {
    const a = createAccount(db, "A", "asset");
    expect(() =>
      postTransaction(db, "lonely", [{ accountId: a.id, amountCents: 100 }])
    ).toThrow(/at least two/);
  });

  it("rejects zero-amount entries", () => {
    const a = createAccount(db, "A", "asset");
    const b = createAccount(db, "B", "revenue");
    expect(() =>
      postTransaction(db, "zero", [
        { accountId: a.id, amountCents: 0 },
        { accountId: b.id, amountCents: 0 },
      ])
    ).toThrow();
  });

  it("rejects entries against an unknown account and writes nothing", () => {
    const a = createAccount(db, "A", "asset");
    expect(() =>
      postTransaction(db, "ghost", [
        { accountId: a.id, amountCents: 100 },
        { accountId: "does-not-exist", amountCents: -100 },
      ])
    ).toThrow(/not found/);
    expect(getBalance(db, a.id)).toBe(0);
    expect(systemBalance(db)).toBe(0);
  });
});
