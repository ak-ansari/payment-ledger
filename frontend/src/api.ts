const configured = import.meta.env.VITE_API_URL;
const BASE = configured
  ? configured.startsWith("http")
    ? configured
    : `https://${configured}`
  : "http://localhost:3000";

async function req(path: string, options?: RequestInit) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? `request failed (${res.status})`;
    const error = new Error(message) as ApiError;
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

export interface ApiError extends Error {
  code?: string;
}

export interface Account {
  id: string;
  name: string;
  type: string;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Invoice {
  id: string;
  customerAccountId: string;
  status: string;
  effectiveStatus: string;
  dueDate: string;
  lineItems: LineItem[];
  totalCents: number;
  paidCents: number;
  remainingCents: number;
}

export const api = {
  listAccounts: (): Promise<Account[]> => req("/accounts"),
  balance: (id: string): Promise<{ balanceCents: number }> => req(`/accounts/${id}/balance`),
  createAccount: (name: string, type: string): Promise<Account> =>
    req("/accounts", { method: "POST", body: JSON.stringify({ name, type }) }),

  getInvoice: (id: string): Promise<Invoice> => req(`/invoices/${id}`),
  createInvoice: (
    customerAccountId: string,
    dueDate: string,
    lineItems: { description: string; quantity: number; unitPriceCents: number }[]
  ): Promise<Invoice> =>
    req("/invoices", {
      method: "POST",
      body: JSON.stringify({ customerAccountId, dueDate, lineItems }),
    }),
  sendInvoice: (id: string): Promise<Invoice> => req(`/invoices/${id}/send`, { method: "POST" }),
  pay: (id: string, idempotencyKey: string, amountCents: number) =>
    req(`/invoices/${id}/payments`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey, amountCents }),
    }),

  recordTransaction: (
    description: string,
    debitAccountId: string,
    creditAccountId: string,
    amountCents: number
  ) =>
    req("/transactions", {
      method: "POST",
      body: JSON.stringify({ description, debitAccountId, creditAccountId, amountCents }),
    }),
};

export const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const DEBIT_NORMAL = new Set(["asset", "expense"]);

export type BalanceSide = "debit" | "credit" | "zero";

export function balanceView(type: string, signedCents: number): {
  magnitudeCents: number;
  side: BalanceSide;
  abnormal: boolean;
} {
  if (signedCents === 0) return { magnitudeCents: 0, side: "zero", abnormal: false };
  const side: BalanceSide = signedCents > 0 ? "debit" : "credit";
  const normalSide = DEBIT_NORMAL.has(type) ? "debit" : "credit";
  return { magnitudeCents: Math.abs(signedCents), side, abnormal: side !== normalSide };
}
