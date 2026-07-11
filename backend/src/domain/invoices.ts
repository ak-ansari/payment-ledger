import { DB, newId, SYSTEM_ACCOUNTS } from "../db/connection.js";
import { InvalidTransitionError, NotFoundError, ValidationError } from "./errors.js";
import { recordTransfer } from "./ledger.js";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type EffectiveStatus = InvoiceStatus | "overdue";

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Invoice {
  id: string;
  customer_account_id: string;
  status: InvoiceStatus;
  due_date: string;
  created_at: string;
}

const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "void"],
  sent: ["void"],
  paid: [],
  void: [],
};

export function createInvoice(
  db: DB,
  customerAccountId: string,
  dueDate: string,
  lineItems: LineItemInput[]
): Invoice {
  if (lineItems.length === 0) {
    throw new ValidationError("an invoice needs at least one line item");
  }
  const customer = db
    .prepare(`SELECT id FROM accounts WHERE id = ?`)
    .get(customerAccountId);
  if (!customer) throw new NotFoundError(`account ${customerAccountId}`);

  const id = newId();
  const now = new Date().toISOString();

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO invoices (id, customer_account_id, status, due_date, created_at)
       VALUES (?, ?, 'draft', ?, ?)`
    ).run(id, customerAccountId, dueDate, now);

    const insertItem = db.prepare(
      `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price_cents)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const item of lineItems) {
      if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
        throw new ValidationError("unitPriceCents must be a non-negative integer");
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new ValidationError("quantity must be a positive integer");
      }
      insertItem.run(newId(), id, item.description, item.quantity, item.unitPriceCents);
    }
  });
  write();

  return getInvoice(db, id)!;
}

export function getInvoice(db: DB, id: string): Invoice | undefined {
  return db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id) as Invoice | undefined;
}

export function invoiceTotalCents(db: DB, invoiceId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity * unit_price_cents), 0) AS total
       FROM invoice_line_items WHERE invoice_id = ?`
    )
    .get(invoiceId) as { total: number };
  return row.total;
}

export function invoicePaidCents(db: DB, invoiceId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE invoice_id = ?`)
    .get(invoiceId) as { paid: number };
  return row.paid;
}

export function effectiveStatus(inv: Invoice, now = new Date()): EffectiveStatus {
  if (inv.status === "sent" && inv.due_date < now.toISOString().slice(0, 10)) {
    return "overdue";
  }
  return inv.status;
}

export function getInvoiceWithTotals(db: DB, id: string, now = new Date()) {
  const inv = getInvoice(db, id);
  if (!inv) throw new NotFoundError(`invoice ${id}`);

  const lineItems = db
    .prepare(`SELECT * FROM invoice_line_items WHERE invoice_id = ?`)
    .all(id);
  const total = invoiceTotalCents(db, id);
  const paid = invoicePaidCents(db, id);

  return {
    id: inv.id,
    customerAccountId: inv.customer_account_id,
    status: inv.status,
    effectiveStatus: effectiveStatus(inv, now),
    dueDate: inv.due_date,
    createdAt: inv.created_at,
    lineItems,
    totalCents: total,
    paidCents: paid,
    remainingCents: total - paid,
  };
}

export function transitionInvoice(db: DB, id: string, to: InvoiceStatus): Invoice {
  const inv = getInvoice(db, id);
  if (!inv) throw new NotFoundError(`invoice ${id}`);
  if (!ALLOWED[inv.status].includes(to)) {
    throw new InvalidTransitionError(inv.status, to);
  }

  if (to === "sent") {
    const total = invoiceTotalCents(db, id);
    if (total > 0) {
      recordTransfer(
        db,
        `Invoice ${id} sent`,
        SYSTEM_ACCOUNTS.receivable,
        SYSTEM_ACCOUNTS.revenue,
        total
      );
    }
  }

  db.prepare(`UPDATE invoices SET status = ? WHERE id = ?`).run(to, id);
  return getInvoice(db, id)!;
}
