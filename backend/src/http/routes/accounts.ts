import { Router } from "express";
import { z } from "zod";
import { DB } from "../../db/connection.js";
import { createAccount, getBalance, listAccounts } from "../../domain/ledger.js";
import { validateBody } from "../middleware/validate.js";

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["asset", "liability", "revenue", "expense", "equity"]),
});

export function accountsRouter(db: DB): Router {
  const r = Router();

  r.post("/", validateBody(createSchema), (req, res) => {
    const { name, type } = req.body;
    res.status(201).json(createAccount(db, name, type));
  });

  r.get("/", (_req, res) => {
    res.json(listAccounts(db));
  });

  r.get("/:id/balance", (req, res) => {
    res.json({ accountId: req.params.id, balanceCents: getBalance(db, req.params.id) });
  });

  return r;
}
