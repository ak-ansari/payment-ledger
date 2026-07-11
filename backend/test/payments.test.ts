import { beforeEach, describe, expect, it } from "vitest";
import { createDb, DB, SYSTEM_ACCOUNTS } from "../src/db/connection.js";
import { createAccount, getBalance, systemBalance } from "../src/domain/ledger.js";
import { createInvoice, getInvoiceWithTotals, transitionInvoice } from "../src/domain/invoices.js";
import { applyPayment, listPayments } from "../src/domain/payments.js";

let db: DB;
let invoiceId: string;

beforeEach(() => {
  db = createDb(":memory:");
  const customerId = createAccount(db, "Acme", "liability").id;
  const inv = createInvoice(db, customerId, "2030-01-01", [
    { description: "Freight", quantity: 1, unitPriceCents: 10000 },
  ]);
  transitionInvoice(db, inv.id, "sent");
  invoiceId = inv.id;
});

describe("payments", () => {
  it("applies a partial payment and leaves the invoice open", () => {
    applyPayment(db, invoiceId, "pay-1", 4000);
    const view = getInvoiceWithTotals(db, invoiceId);
    expect(view.paidCents).toBe(4000);
    expect(view.remainingCents).toBe(6000);
    expect(view.status).toBe("sent");
  });

  it("marks the invoice paid once fully settled", () => {
    applyPayment(db, invoiceId, "pay-1", 4000);
    applyPayment(db, invoiceId, "pay-2", 6000);
    const view = getInvoiceWithTotals(db, invoiceId);
    expect(view.remainingCents).toBe(0);
    expect(view.status).toBe("paid");
  });

  it("moves money through the ledger and stays balanced", () => {
    applyPayment(db, invoiceId, "pay-1", 10000);
    expect(getBalance(db, SYSTEM_ACCOUNTS.cash)).toBe(10000);
    expect(getBalance(db, SYSTEM_ACCOUNTS.receivable)).toBe(0);
    expect(systemBalance(db)).toBe(0);
  });

  it("rejects a payment larger than the remaining balance", () => {
    expect(() => applyPayment(db, invoiceId, "pay-1", 10001)).toThrow(/exceeds remaining/);
  });

  it("rejects overpayment after a partial payment", () => {
    applyPayment(db, invoiceId, "pay-1", 7000);
    expect(() => applyPayment(db, invoiceId, "pay-2", 4000)).toThrow(/exceeds remaining/);
  });

  it("treats a replayed idempotency key as the same payment", () => {
    const first = applyPayment(db, invoiceId, "webhook-abc", 5000);
    const second = applyPayment(db, invoiceId, "webhook-abc", 5000);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);

    expect(listPayments(db, invoiceId)).toHaveLength(1);
    expect(getInvoiceWithTotals(db, invoiceId).paidCents).toBe(5000);
  });

  it("rejects the same key reused with a different amount", () => {
    applyPayment(db, invoiceId, "webhook-abc", 5000);
    expect(() => applyPayment(db, invoiceId, "webhook-abc", 6000)).toThrow(/different payload/);
  });

  it("refuses payment on an invoice that is not sent", () => {
    const customerId = createAccount(db, "Beta", "liability").id;
    const draft = createInvoice(db, customerId, "2030-01-01", [
      { description: "x", quantity: 1, unitPriceCents: 100 },
    ]);
    expect(() => applyPayment(db, draft.id, "k", 100)).toThrow(/cannot pay/);
  });
});
