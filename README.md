# Mini Payment Ledger & Invoice Service

A small accounts-payable module for a TMS: a double-entry ledger, invoices with
line items and partial payments, and safe handling of duplicate/concurrent payment
webhooks. Plus a lightweight React UI to drive it.

The repo has two independent apps that only share the HTTP API:

```
backend/    TypeScript + Express + SQLite (better-sqlite3), tested with Vitest
frontend/   React + Vite, plain CSS
```

They're separate projects (own `package.json`, own build, deployed separately) —
kept in one repo just for convenience.

## Running it locally

**1. Backend** (start this first):

```bash
cd backend
npm install
npm run dev        # http://localhost:3000
npm test           # 31 tests
```

**2. Frontend** (second terminal):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, talks to the API on :3000
```

Then open http://localhost:5173. Point the UI at a different API with
`VITE_API_URL`.

## Where to look

- **`backend/README.md`** — the design writeup: the double-entry ledger, why
  balances are derived and never stored, the idempotency/concurrency handling, the
  tradeoffs, and what I'd do with more time. This is the meat.
- **`backend/src/domain/`** — the domain logic (`ledger.ts`, `invoices.ts`,
  `payments.ts`), testable without HTTP.
- **`backend/test/concurrency.test.ts`** — the Part 3 edge case: concurrent
  payments, including a deliberately unsafe variant that proves the race is real.
- **`frontend/README.md`** — how to run and host the UI.

## Highlights

- **Double-entry, derived balances.** Every transaction nets to zero; account
  balances are always `SUM` over the ledger, never a stored mutable number. Money is
  integer cents throughout — no floats.
- **Partial payments + idempotency.** Invoices can be paid in parts; a duplicated
  payment webhook (same idempotency key) is absorbed instead of double-charging;
  overpayment is rejected.
- **Concurrency handled honestly.** Payments apply inside a `BEGIN IMMEDIATE`
  transaction with a `UNIQUE` idempotency key, and the test suite demonstrates the
  overpayment race it prevents rather than just asserting green.
