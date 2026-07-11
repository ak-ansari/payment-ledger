import { DB, newId, SYSTEM_ACCOUNTS } from "../db/connection.js";
import {
  IdempotencyConflictError,
  NotFoundError,
  OverpaymentError,
  ValidationError,
} from "./errors.js";
import { recordTransfer } from "./ledger.js";
import { getInvoice, invoicePaidCents, invoiceTotalCents } from "./invoices.js";

export interface Payment {
  id: string;
  invoice_id: string;
  idempotency_key: string;
  amount_cents: number;
  transaction_id: string;
  created_at: string;
}

export interface ApplyPaymentResult {
  payment: Payment;
  replayed: boolean;
}

function getByKey(db: DB, key: string): Payment | undefined {
  return db
    .prepare(`SELECT * FROM payments WHERE idempotency_key = ?`)
    .get(key) as Payment | undefined;
}

export function applyPayment(
  db: DB,
  invoiceId: string,
  idempotencyKey: string,
  amountCents: number
): ApplyPaymentResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError("amountCents must be a positive integer");
  }
  if (!idempotencyKey) throw new ValidationError("idempotencyKey is required");

  const run = db.transaction((): ApplyPaymentResult => {
    const existing = getByKey(db, idempotencyKey);
    if (existing) {
      if (existing.invoice_id === invoiceId && existing.amount_cents === amountCents) {
        return { payment: existing, replayed: true };
      }
      throw new IdempotencyConflictError();
    }

    const invoice = getInvoice(db, invoiceId);
    if (!invoice) throw new NotFoundError(`invoice ${invoiceId}`);
    if (invoice.status !== "sent") {
      throw new ValidationError(`cannot pay an invoice in status '${invoice.status}'`);
    }

    const total = invoiceTotalCents(db, invoiceId);
    const paid = invoicePaidCents(db, invoiceId);
    const remaining = total - paid;
    if (amountCents > remaining) {
      throw new OverpaymentError(remaining, amountCents);
    }

    const now = new Date().toISOString();
    const txnId = recordTransfer(
      db,
      `Payment for invoice ${invoiceId}`,
      SYSTEM_ACCOUNTS.cash,
      SYSTEM_ACCOUNTS.receivable,
      amountCents
    );

    const paymentId = newId();
    db.prepare(
      `INSERT INTO payments (id, invoice_id, idempotency_key, amount_cents, transaction_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(paymentId, invoiceId, idempotencyKey, amountCents, txnId, now);

    if (paid + amountCents === total) {
      db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoiceId);
    }

    const payment = db
      .prepare(`SELECT * FROM payments WHERE id = ?`)
      .get(paymentId) as Payment;
    return { payment, replayed: false };
  });

  try {
    return run.immediate();
  } catch (err: any) {
    if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const existing = getByKey(db, idempotencyKey);
      if (existing && existing.invoice_id === invoiceId && existing.amount_cents === amountCents) {
        return { payment: existing, replayed: true };
      }
      throw new IdempotencyConflictError();
    }
    throw err;
  }
}

export function listPayments(db: DB, invoiceId: string): Payment[] {
  return db
    .prepare(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at`)
    .all(invoiceId) as Payment[];
}
