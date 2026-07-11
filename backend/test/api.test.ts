import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createDb, DB } from "../src/db/connection.js";
import { createApp } from "../src/http/app.js";

let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = createDb(":memory:");
  app = createApp(db);
});

async function openInvoice(amount = 10000) {
  const acct = await request(app)
    .post("/accounts")
    .send({ name: "Acme", type: "liability" });
  const inv = await request(app)
    .post("/invoices")
    .send({
      customerAccountId: acct.body.id,
      dueDate: "2030-01-01",
      lineItems: [{ description: "Freight", quantity: 1, unitPriceCents: amount }],
    });
  await request(app).post(`/invoices/${inv.body.id}/send`);
  return inv.body.id as string;
}

describe("api", () => {
  it("walks an invoice from creation to paid", async () => {
    const id = await openInvoice(10000);

    const partial = await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "k1", amountCents: 4000 });
    expect(partial.status).toBe(201);
    expect(partial.body.invoice.remainingCents).toBe(6000);

    const rest = await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "k2", amountCents: 6000 });
    expect(rest.status).toBe(201);
    expect(rest.body.invoice.status).toBe("paid");
  });

  it("returns 200 and the same payment on an idempotent replay", async () => {
    const id = await openInvoice(10000);
    const first = await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "dup", amountCents: 5000 });
    const second = await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "dup", amountCents: 5000 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.payment.id).toBe(first.body.payment.id);
  });

  it("rejects overpayment with 422", async () => {
    const id = await openInvoice(10000);
    const res = await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "big", amountCents: 20000 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("overpayment");
  });

  it("returns 400 on a malformed body", async () => {
    const res = await request(app).post("/accounts").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown invoice", async () => {
    const res = await request(app).get("/invoices/nope");
    expect(res.status).toBe(404);
  });

  it("records a debit/credit transaction between two accounts", async () => {
    const cash = await request(app).post("/accounts").send({ name: "Cash", type: "asset" });
    const rev = await request(app).post("/accounts").send({ name: "Revenue", type: "revenue" });

    const txn = await request(app).post("/transactions").send({
      description: "cash sale",
      debitAccountId: cash.body.id,
      creditAccountId: rev.body.id,
      amountCents: 2500,
    });
    expect(txn.status).toBe(201);

    const cashBal = await request(app).get(`/accounts/${cash.body.id}/balance`);
    expect(cashBal.body.balanceCents).toBe(2500);

    const entries = await request(app).get(`/transactions?accountId=${cash.body.id}`);
    expect(entries.body[0].direction).toBe("debit");
    expect(entries.body[0].amountCents).toBe(2500);
  });

  it("reports a healthy, balanced ledger", async () => {
    const id = await openInvoice(10000);
    await request(app)
      .post(`/invoices/${id}/payments`)
      .send({ idempotencyKey: "k", amountCents: 10000 });
    const res = await request(app).get("/health");
    expect(res.body.systemBalanceCents).toBe(0);
  });
});
