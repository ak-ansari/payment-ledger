import { Router } from "express";
import { z } from "zod";
import { DB } from "../../db/connection.js";
import {
  createInvoice,
  getInvoiceWithTotals,
  transitionInvoice,
} from "../../domain/invoices.js";
import { applyPayment, listPayments } from "../../domain/payments.js";
import { validateBody } from "../middleware/validate.js";

const createSchema = z.object({
  customerAccountId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD"),
  lineItems: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().nonnegative(),
      })
    )
    .min(1),
});

const paymentSchema = z.object({
  idempotencyKey: z.string().min(1),
  amountCents: z.number().int().positive(),
});

export function invoicesRouter(db: DB): Router {
  const r = Router();

  r.post("/", validateBody(createSchema), (req, res) => {
    const { customerAccountId, dueDate, lineItems } = req.body;
    const inv = createInvoice(db, customerAccountId, dueDate, lineItems);
    res.status(201).json(getInvoiceWithTotals(db, inv.id));
  });

  r.get("/:id", (req, res) => {
    res.json(getInvoiceWithTotals(db, req.params.id));
  });

  r.post("/:id/send", (req, res) => {
    transitionInvoice(db, req.params.id, "sent");
    res.json(getInvoiceWithTotals(db, req.params.id));
  });

  r.post("/:id/void", (req, res) => {
    transitionInvoice(db, req.params.id, "void");
    res.json(getInvoiceWithTotals(db, req.params.id));
  });

  r.post("/:id/payments", validateBody(paymentSchema), (req, res) => {
    const { idempotencyKey, amountCents } = req.body;
    const result = applyPayment(db, req.params.id, idempotencyKey, amountCents);
    res.status(result.replayed ? 200 : 201).json({
      payment: result.payment,
      replayed: result.replayed,
      invoice: getInvoiceWithTotals(db, req.params.id),
    });
  });

  r.get("/:id/payments", (req, res) => {
    res.json(listPayments(db, req.params.id));
  });

  return r;
}
