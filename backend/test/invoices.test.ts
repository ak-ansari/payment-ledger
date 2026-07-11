import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, DB } from "../src/db/connection.js";
import { createAccount } from "../src/domain/ledger.js";
import {
  createInvoice,
  effectiveStatus,
  getInvoiceWithTotals,
  transitionInvoice,
} from "../src/domain/invoices.js";

let db: DB;
let customerId: string;

beforeEach(() => {
  db = createDb(":memory:");
  customerId = createAccount(db, "Acme Freight", "liability").id;
});

function sampleInvoice(dueDate = "2030-01-01") {
  return createInvoice(db, customerId, dueDate, [
    { description: "Line haul", quantity: 2, unitPriceCents: 15000 },
    { description: "Fuel surcharge", quantity: 1, unitPriceCents: 5000 },
  ]);
}

describe("invoices", () => {
  it("computes the total from line items", () => {
    const inv = sampleInvoice();
    const view = getInvoiceWithTotals(db, inv.id);
    expect(view.totalCents).toBe(2 * 15000 + 5000);
    expect(view.paidCents).toBe(0);
    expect(view.remainingCents).toBe(35000);
    expect(view.status).toBe("draft");
  });

  it("requires at least one line item", () => {
    expect(() => createInvoice(db, customerId, "2030-01-01", [])).toThrow(/at least one/);
  });

  it("allows draft -> sent and blocks illegal jumps", () => {
    const inv = sampleInvoice();
    transitionInvoice(db, inv.id, "sent");
    expect(getInvoiceWithTotals(db, inv.id).status).toBe("sent");

    const other = sampleInvoice();
    expect(() => transitionInvoice(db, other.id, "paid")).toThrow(/cannot move/);
  });

  it("cannot transition out of a terminal state", () => {
    const inv = sampleInvoice();
    transitionInvoice(db, inv.id, "void");
    expect(() => transitionInvoice(db, inv.id, "sent")).toThrow(/cannot move/);
  });

  it("reports overdue when a sent invoice is past its due date", () => {
    const inv = sampleInvoice("2020-01-01");
    transitionInvoice(db, inv.id, "sent");
    const view = getInvoiceWithTotals(db, inv.id);
    expect(view.status).toBe("sent");
    expect(view.effectiveStatus).toBe("overdue");
  });

  it("overdue is a read-time view, not a stored status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2029-12-31T00:00:00Z"));
    const created = sampleInvoice("2030-01-01");
    const inv = transitionInvoice(db, created.id, "sent");
    expect(effectiveStatus(inv)).toBe("sent");

    vi.setSystemTime(new Date("2030-06-01T00:00:00Z"));
    expect(effectiveStatus(inv)).toBe("overdue");
    vi.useRealTimers();
  });

  it("posts the receivable to the ledger when sent", () => {
    const inv = sampleInvoice();
    transitionInvoice(db, inv.id, "sent");
    const entries = db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entries`)
      .get() as { n: number };
    expect(entries.n).toBe(2);
  });
});
