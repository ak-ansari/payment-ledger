import express, { Express } from "express";
import { DB, SYSTEM_ACCOUNTS } from "../db/connection.js";
import { systemBalance } from "../domain/ledger.js";
import { accountsRouter } from "./routes/accounts.js";
import { transactionsRouter } from "./routes/transactions.js";
import { invoicesRouter } from "./routes/invoices.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp(db: DB): Express {
  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, systemBalanceCents: systemBalance(db), systemAccounts: SYSTEM_ACCOUNTS });
  });

  app.use("/accounts", accountsRouter(db));
  app.use("/transactions", transactionsRouter(db));
  app.use("/invoices", invoicesRouter(db));

  app.use(errorHandler);
  return app;
}
