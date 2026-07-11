import { FormEvent, useEffect, useState } from "react";
import { api, Account, Invoice, dollars, balanceView } from "./api";

const STORAGE_KEY = "tms.invoiceIds";

function loadInvoiceIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setAccounts(await api.listAccounts());
    const ids = loadInvoiceIds();
    const loaded = await Promise.all(
      ids.map((id) => api.getInvoice(id).catch(() => null))
    );
    setInvoices(loaded.filter(Boolean) as Invoice[]);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  function rememberInvoice(id: string) {
    const ids = Array.from(new Set([id, ...loadInvoiceIds()]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  const wrap = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Payment Ledger</h1>
        <p className="sub">Double-entry ledger, invoices, and partial payments.</p>
      </header>

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="columns">
        <section className="panel">
          <h2>Ledger</h2>
          <AccountList accounts={accounts} />
          <NewAccount
            onCreated={wrap(async () => {
              await refresh();
            })}
            onError={setError}
          />
          <RecordTransaction
            accounts={accounts}
            onRecorded={wrap(async () => {
              await refresh();
            })}
            onError={setError}
          />
        </section>

        <section className="panel">
          <h2>Invoices</h2>
          <InvoiceList
            invoices={invoices}
            selectedId={selected}
            onSelect={setSelected}
          />
          <NewInvoice
            accounts={accounts}
            onCreated={async (id) => {
              rememberInvoice(id);
              setSelected(id);
              await refresh().catch((e) => setError(e.message));
            }}
            onError={setError}
          />
        </section>

        <section className="panel">
          <h2>Detail</h2>
          {selected ? (
            <InvoiceDetail
              invoiceId={selected}
              onChanged={() => refresh().catch((e) => setError(e.message))}
              onError={setError}
            />
          ) : (
            <p className="muted">Select an invoice to see its ledger and take a payment.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  const [balances, setBalances] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    Promise.all(accounts.map((a) => api.balance(a.id).then((b) => [a.id, b.balanceCents] as const)))
      .then((pairs) => {
        if (live) setBalances(Object.fromEntries(pairs));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accounts]);

  if (accounts.length === 0) return <p className="muted">No accounts yet.</p>;
  return (
    <table>
      <tbody>
        {accounts.map((a) => (
          <tr key={a.id}>
            <td>
              {a.name}
              <span className="tag">{a.type}</span>
            </td>
            <td className="num">
              <BalanceCell type={a.type} signedCents={balances[a.id] ?? 0} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BalanceCell({ type, signedCents }: { type: string; signedCents: number }) {
  const { magnitudeCents, side, abnormal } = balanceView(type, signedCents);
  if (side === "zero") return <span className="muted">{dollars(0)}</span>;
  return (
    <span>
      {dollars(magnitudeCents)}
      <span className={`side ${side}${abnormal ? " abnormal" : ""}`}>
        {side === "debit" ? "Dr" : "Cr"}
      </span>
    </span>
  );
}

function NewAccount({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("liability");

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        try {
          await api.createAccount(name.trim(), type);
          setName("");
          onCreated();
        } catch (err: any) {
          onError(err.message);
        }
      }}
    >
      <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="asset">asset</option>
        <option value="liability">liability</option>
        <option value="revenue">revenue</option>
        <option value="expense">expense</option>
        <option value="equity">equity</option>
      </select>
      <button type="submit">Add account</button>
    </form>
  );
}

function RecordTransaction({
  accounts,
  onRecorded,
  onError,
}: {
  accounts: Account[];
  onRecorded: () => void;
  onError: (m: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (accounts.length < 2) {
    return (
      <p className="muted small tx-hint">
        Add at least two accounts to record a transaction between them.
      </p>
    );
  }

  return (
    <form
      className="stack tx"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        const parsed = parseFloat(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setLocalError("Enter an amount greater than zero.");
          return;
        }
        if (!debit || !credit) {
          setLocalError("Pick both a debit and a credit account.");
          return;
        }
        if (debit === credit) {
          setLocalError("Debit and credit must be different accounts.");
          return;
        }
        try {
          await api.recordTransaction(
            description.trim() || "manual entry",
            debit,
            credit,
            Math.round(parsed * 100)
          );
          setAmount("");
          setDescription("");
          onRecorded();
        } catch (err: any) {
          onError(err.message);
        }
      }}
    >
      <h3>Record a transaction</h3>
      <input
        placeholder="Description (e.g. cash sale)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label className="field">
        Debit (money in / expense)
        <select value={debit} onChange={(e) => setDebit(e.target.value)}>
          <option value="">— account —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Credit (source / revenue)
        <select value={credit} onChange={(e) => setCredit(e.target.value)}>
          <option value="">— account —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <input placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {localError && <p className="pay-error">{localError}</p>}
      <button type="submit">Post to ledger</button>
    </form>
  );
}

function InvoiceList({
  invoices,
  selectedId,
  onSelect,
}: {
  invoices: Invoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (invoices.length === 0) return <p className="muted">No invoices yet.</p>;
  return (
    <ul className="invoice-list">
      {invoices.map((inv) => (
        <li
          key={inv.id}
          className={inv.id === selectedId ? "active" : ""}
          onClick={() => onSelect(inv.id)}
        >
          <div className="row">
            <span>{dollars(inv.totalCents)}</span>
            <StatusPill status={inv.effectiveStatus} />
          </div>
          <div className="muted small">
            due {inv.dueDate} · {dollars(inv.remainingCents)} left
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

interface Draft {
  description: string;
  quantity: string;
  unitPrice: string;
}

function NewInvoice({
  accounts,
  onCreated,
  onError,
}: {
  accounts: Account[];
  onCreated: (id: string) => void;
  onError: (m: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("2030-01-01");
  const [items, setItems] = useState<Draft[]>([
    { description: "", quantity: "1", unitPrice: "" },
  ]);

  useEffect(() => {
    if (!customerId && accounts.length) setCustomerId(accounts[0].id);
  }, [accounts, customerId]);

  function update(i: number, patch: Partial<Draft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const lineItems = items
            .filter((it) => it.description.trim())
            .map((it) => ({
              description: it.description.trim(),
              quantity: parseInt(it.quantity, 10),
              unitPriceCents: Math.round(parseFloat(it.unitPrice) * 100),
            }));
          if (!customerId) throw new Error("pick a customer account first");
          if (lineItems.length === 0) throw new Error("add at least one line item");
          const inv = await api.createInvoice(customerId, dueDate, lineItems);
          setItems([{ description: "", quantity: "1", unitPrice: "" }]);
          onCreated(inv.id);
        } catch (err: any) {
          onError(err.message);
        }
      }}
    >
      <label className="field">
        Customer
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Due date
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>

      {items.map((it, i) => (
        <div className="line-item" key={i}>
          <input
            placeholder="Description"
            value={it.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <input
            className="qty"
            type="number"
            min="1"
            value={it.quantity}
            onChange={(e) => update(i, { quantity: e.target.value })}
          />
          <input
            className="price"
            placeholder="$ each"
            value={it.unitPrice}
            onChange={(e) => update(i, { unitPrice: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link"
        onClick={() =>
          setItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "" }])
        }
      >
        + line item
      </button>
      <button type="submit">Create invoice (draft)</button>
    </form>
  );
}

function InvoiceDetail({
  invoiceId,
  onChanged,
  onError,
}: {
  invoiceId: string;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState("");
  const [payError, setPayError] = useState<string | null>(null);

  async function load() {
    setInv(await api.getInvoice(invoiceId));
  }

  useEffect(() => {
    setInv(null);
    setAmount("");
    setKey("");
    setPayError(null);
    load().catch((e) => onError(e.message));
  }, [invoiceId]);

  if (!inv) return <p className="muted">Loading…</p>;

  const remaining = inv.remainingCents;

  async function submitPayment(e: FormEvent) {
    e.preventDefault();
    setPayError(null);

    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPayError("Enter an amount greater than zero.");
      return;
    }
    const cents = Math.round(parsed * 100);
    if (cents > remaining) {
      setPayError(`Payment of ${dollars(cents)} exceeds the ${dollars(remaining)} remaining.`);
      return;
    }

    try {
      const idem = key.trim() || `ui-${Date.now()}`;
      await api.pay(invoiceId, idem, cents);
      setAmount("");
      setKey("");
      await load();
      onChanged();
    } catch (err: any) {
      await load().catch(() => {});
      if (err.code === "overpayment") {
        setPayError("That amount is more than what's still due — someone may have just paid part of it.");
      } else {
        setPayError(err.message);
      }
    }
  }

  return (
    <div className="detail">
      <div className="row">
        <StatusPill status={inv.effectiveStatus} />
        <span className="muted small">due {inv.dueDate}</span>
      </div>

      <table className="items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Each</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lineItems.map((li, i) => (
            <tr key={i}>
              <td>{li.description}</td>
              <td className="num">{li.quantity}</td>
              <td className="num">{dollars(li.unit_price_cents)}</td>
              <td className="num">{dollars(li.quantity * li.unit_price_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="totals">
        <div>
          <dt>Total</dt>
          <dd>{dollars(inv.totalCents)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{dollars(inv.paidCents)}</dd>
        </div>
        <div className="remaining">
          <dt>Remaining</dt>
          <dd>{dollars(inv.remainingCents)}</dd>
        </div>
      </dl>

      {inv.status === "draft" && (
        <button
          onClick={async () => {
            try {
              await api.sendInvoice(inv.id);
              await load();
              onChanged();
            } catch (e: any) {
              onError(e.message);
            }
          }}
        >
          Send invoice
        </button>
      )}

      {inv.status === "sent" && (
        <form className="stack pay" onSubmit={submitPayment}>
          <h3>Take a payment</h3>
          <input
            placeholder="Amount ($)"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (payError) setPayError(null);
            }}
          />
          <input
            placeholder="Idempotency key (optional)"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (payError) setPayError(null);
            }}
          />
          {payError && <p className="pay-error">{payError}</p>}
          <p className="hint">
            Reuse the same key to simulate a webhook firing twice — it won't double-charge.
          </p>
          <button type="submit">Apply payment</button>
        </form>
      )}

      {inv.status === "paid" && <p className="paid-note">Fully paid. 🎉</p>}
    </div>
  );
}
