
## Steps to run

```bash
npm install
npm run dev      # http://localhost:3000  (writes to data.db)
npm test         # runs the full test suite
```

To run the UI, see the README in `../frontend`; start this API first so it has
something to talk to.

## What it does

**Ledger (Part 1).** Accounts and transactions. Every transaction is
double-entry — one or more legs that must sum to zero. Entries are stored one row
per leg with a *signed* `amount_cents` (positive debits the account, negative
credits it). The API speaks in those terms explicitly rather than making callers
juggle signs: `POST /transactions` takes `{debitAccountId, creditAccountId,
amountCents}` and `GET /transactions?accountId=` tags each entry with a
`direction` of `'debit'` or `'credit'`. A balance is never stored; it's always
`SUM(amount_cents)` over an account's entries, and the whole system always sums to
zero (there's a `/health` endpoint that surfaces that invariant). Money is integer
cents throughout — no floats anywhere near a currency value.

**Invoices (Part 2).** Invoices have line items, a due date, and a status. The
total and the amount paid are both derived (from line items and from the payments
table) rather than stored, so they can't drift. Payments can be partial; the
invoice flips to `paid` automatically the moment the sum of payments equals the
total. Overpayment is rejected. Duplicate webhooks are absorbed via an idempotency
key (more below).

**Concurrent payments (Part 3).** This is the edge case I chose. See below.

### API

```
POST /accounts                      {name, type}
GET  /accounts                      list
GET  /accounts/:id/balance          derived balance

POST /transactions                  {description, debitAccountId, creditAccountId, amountCents}
GET  /transactions?accountId=       entries tagged with direction: 'debit' | 'credit'

POST /invoices                      {customerAccountId, dueDate, lineItems:[...]}       -> draft
GET  /invoices/:id                  includes totalCents / paidCents / remainingCents / effectiveStatus
POST /invoices/:id/send             draft -> sent (posts the receivable to the ledger)
POST /invoices/:id/void
POST /invoices/:id/payments         {idempotencyKey, amountCents}   -> 201 new / 200 replay
GET  /invoices/:id/payments

GET  /health                        {systemBalanceCents: 0}
```

## Design decisions

**Journal-style ledger, signed amounts.** I used a `transactions` header plus a
`ledger_entries` table with one row per leg, rather than a single row carrying
`debit_account`/`credit_account`. It makes balance derivation a single uniform
`SUM` instead of a two-branch query, generalizes to N-leg transactions (fees,
splits) for free, and makes the "everything sums to zero" invariant a one-liner —
which is the ledger test I care most about.

**Nothing derivable is stored.** Account balances, invoice totals, amount paid,
and remaining due are all queries. The one stored derived-ish value is the invoice
`status`, and it's only ever flipped to `paid` *inside the same DB transaction* as
the payment that justifies it, so it can't disagree with the payment rows. I
called this out because it's the one place the "derive, don't store" rule bends,
and I'd rather be explicit than pretend.

**Overdue is computed, not a stored state.** The spec lists the lifecycle as
`draft → sent → paid → overdue`, but "overdue" isn't really a state you move
into — it's how an unpaid `sent` invoice looks once its due date passes, and a
partially-paid overdue invoice still needs to be payable (`overdue → paid`). So the
stored status is `draft | sent | paid | void`, and responses carry an
`effectiveStatus` that reports `overdue` at read time. No cron job, never stale.

**Accounting narrative.** Three system accounts are seeded (Cash, Accounts
Receivable, Revenue). Sending an invoice posts debit A/R / credit Revenue; a
payment posts debit Cash / credit A/R. So after an invoice is fully paid, A/R nets
back to zero and Cash holds the money — you can see this in the UI's account list.

### Idempotency & concurrency (the interesting part)

The prompt's hint — "assume the payment webhook can fire twice" — plus my chosen
edge case (concurrent payments on one invoice) are really the same problem, so I
handled them together.

- **Idempotency key** on every payment, with a `UNIQUE` constraint. A repeat of the
  same key + same invoice + same amount returns the *original* payment (HTTP 200,
  `replayed: true`) instead of charging again. The same key with a different amount
  is a caller bug, so it's a 409. Importantly, the replay check runs *before* the
  "is this invoice still payable" check — a retried webhook that already settled the
  invoice must still get its original receipt back, not a "you can't pay a paid
  invoice" error. (My concurrency test caught exactly this ordering bug.)

- **The write is atomic.** `applyPayment` runs the remaining-due check *and* the
  inserts inside one `BEGIN IMMEDIATE` transaction. Two payments can't both read the
  same "remaining" and then both write — the second waits for the lock and re-reads.

**On honesty about the concurrency demo:** better-sqlite3 is synchronous, so a
single Node process already serializes queries — a naive test would pass without
proving anything. So the correctness here comes from two things that hold *by
construction*, not by luck of the event loop: the check-and-write happen with no
`await` between them (atomic), and `BEGIN IMMEDIATE` + the `UNIQUE` key make it
correct even across multiple processes. To prove the race is real,
`concurrency.test.ts` includes a deliberately *unsafe* variant that reads the
balance, yields the event loop, then writes — and it genuinely overpays under a
parallel burst, while the real implementation does not. Demonstrating the failure
mode I'm preventing felt more convincing than a suite that's only ever green.

## Tests

```bash
npm test
```

- `ledger.test.ts` — balance derivation, the system-sums-to-zero invariant,
  rejection of unbalanced/single-entry/zero/unknown-account transactions.
- `payments.test.ts` — partial payments, auto-`paid`, overpayment rejection,
  idempotent replay (one row, one ledger transaction), same-key-different-amount
  conflict, paying a non-sent invoice.
- `concurrency.test.ts` — a burst of conflicting payments (exactly one wins), a
  duplicated webhook fired 10× (booked once), and the unsafe-variant demonstration.
- `invoices.test.ts` — transition rules, totals from line items, overdue over time.
- `api.test.ts` — thin HTTP smoke over the routes (status codes, replay, 400/404).

Each test opens a fresh in-memory database, so they're isolated and fast.

## Shortcuts I took

- **SQLite, no migration framework.** The schema is one `schema.sql` applied with
  `CREATE TABLE IF NOT EXISTS` on startup. Fine for a take-home; a real service
  wants versioned migrations.
- **No auth, no pagination, no rate limiting.** Out of scope.
- **Domain functions take the `db` handle as their first argument** instead of a
  repository/DI layer. That's the seam that lets tests use `:memory:`; I didn't want
  to build abstraction I wasn't going to need.
- **The UI keeps its list of created invoice IDs in `localStorage`** because I
  didn't add a "list all invoices" endpoint — a deliberately small corner to cut.

## What I'd do with more time

- **Postgres** with `SERIALIZABLE` (or `SELECT ... FOR UPDATE`) so the concurrency
  story is genuinely multi-process and load-testable, not just correct-by-design on
  one Node process.
- **Balance snapshots.** Deriving balances by summing all history is O(entries); at
  scale I'd periodically checkpoint balances and sum only entries since the last
  snapshot.
- **A background job** to materialize `overdue` for querying and notifications
  (correctness still wouldn't depend on it).
- **Refunds** as reversing transactions, which the signed-entry ledger already
  supports cleanly — this was the other Part 3 option I'd have added next.
- Richer invoice listing/filtering endpoints and a proper multi-currency model
  (per-transaction currency + a rates table) rather than the implied single
  currency.
