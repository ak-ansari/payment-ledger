import { Router } from "express";
import { z } from "zod";
import { DB } from "../../db/connection.js";
import { directionOf, recordTransfer } from "../../domain/ledger.js";
import { validateBody } from "../middleware/validate.js";

const createSchema = z.object({
  description: z.string().min(1),
  debitAccountId: z.string().min(1),
  creditAccountId: z.string().min(1),
  amountCents: z.number().int().positive(),
});

export function transactionsRouter(db: DB): Router {
  const r = Router();

  r.post("/", validateBody(createSchema), (req, res) => {
    const { description, debitAccountId, creditAccountId, amountCents } = req.body;
    const id = recordTransfer(db, description, debitAccountId, creditAccountId, amountCents);
    res.status(201).json({ id });
  });

  r.get("/", (req, res) => {
    const accountId = req.query.accountId as string | undefined;
    if (accountId) {
      const rows = db
        .prepare(
          `SELECT le.*, t.description FROM ledger_entries le
           JOIN transactions t ON t.id = le.transaction_id
           WHERE le.account_id = ? ORDER BY le.created_at`
        )
        .all(accountId) as { amount_cents: number }[];
      return res.json(
        rows.map((row) => ({
          ...row,
          direction: directionOf(row.amount_cents),
          amountCents: Math.abs(row.amount_cents),
        }))
      );
    }
    const rows = db.prepare(`SELECT * FROM transactions ORDER BY created_at`).all();
    res.json(rows);
  });

  return r;
}
