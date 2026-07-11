import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createDb, DB, newId, SYSTEM_ACCOUNTS } from "../src/db/connection.js";
import { createApp } from "../src/http/app.js";
import { systemBalance } from "../src/domain/ledger.js";
import { invoicePaidCents, invoiceTotalCents } from "../src/domain/invoices.js";

let db: DB;
let app: ReturnType<typeof createApp>;
let invoiceId: string;
const TOTAL = 10000;

beforeEach(async () => {
  db = createDb(":memory:");
  app = createApp(db);
  const acct = await request(app).post("/accounts").send({ name: "Acme", type: "liability" });
  const inv = await request(app)
    .post("/invoices")
    .send({
      customerAccountId: acct.body.id,
      dueDate: "2030-01-01",
      lineItems: [{ description: "Freight", quantity: 1, unitPriceCents: TOTAL }],
    });
  await request(app).post(`/invoices/${inv.body.id}/send`);
  invoiceId = inv.body.id;
});

describe("concurrent payments", () => {
  it("lets only one of several conflicting payments through", async () => {
    const each = Math.floor(TOTAL * 0.6);
    const numberOfConcurrentPayments = 5;
    const results = await Promise.all(
      Array.from({ length: numberOfConcurrentPayments }, (_, i) =>
        request(app)
          .post(`/invoices/${invoiceId}/payments`)
          .send({ idempotencyKey: `k-${i}`, amountCents: each })
      )
    );

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(numberOfConcurrentPayments - 1);

    expect(invoicePaidCents(db, invoiceId)).toBeLessThanOrEqual(TOTAL);
    expect(systemBalance(db)).toBe(0);
  });

  it("books a duplicated webhook exactly once", async () => {
    const duplicateWebhookTries = 10;
    const results = await Promise.all(
      Array.from({ length: duplicateWebhookTries }, () =>
        request(app)
          .post(`/invoices/${invoiceId}/payments`)
          .send({ idempotencyKey: "same-key", amountCents: TOTAL })
      )
    );

    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    expect(ok).toHaveLength(duplicateWebhookTries);
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    const rows = db
      .prepare(`SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?`)
      .get(invoiceId) as { n: number };
    expect(rows.n).toBe(1);
    expect(invoicePaidCents(db, invoiceId)).toBe(TOTAL);
  });

  it("demonstrates that a naive check-then-write DOES overpay", async () => {
    async function unsafePay(amount: number) {
      const total = invoiceTotalCents(db, invoiceId);
      const paid = invoicePaidCents(db, invoiceId);
      await new Promise((r) => setImmediate(r));
      if (amount > total - paid) return false;
      const txnId = newId();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO transactions (id, description, created_at) VALUES (?, ?, ?)`).run(
        txnId,
        "unsafe",
        now
      );
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, amount_cents, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newId(), txnId, SYSTEM_ACCOUNTS.cash, amount, now);
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, amount_cents, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newId(), txnId, SYSTEM_ACCOUNTS.receivable, -amount, now);
      db.prepare(
        `INSERT INTO payments (id, invoice_id, idempotency_key, amount_cents, transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId(), invoiceId, newId(), amount, txnId, now);
      return true;
    }

    const each = Math.floor(TOTAL * 0.6);
    await Promise.all(Array.from({ length: 5 }, () => unsafePay(each)));

    expect(invoicePaidCents(db, invoiceId)).toBeGreaterThan(TOTAL);
  });
});
