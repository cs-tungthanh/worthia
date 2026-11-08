import type { Currency } from "./config";

// A holding, computed by the server from its share movements (shared/position.ts).
export type Stock = {
  id: number;
  symbol: string;
  shares: number; // held now, bonus shares included
  avg_price: number | null; // moving-average cost per share (fees included); null if a buy has no price
  net_avg_price: number | null; // the same, lowered by cash dividends received (Pinetree's "TB")
  cost: number | null; // cost basis of the shares held
  realised: number | null; // realised profit from sales, after fees and tax; null if a sale can't be valued
  unpriced: number; // buys without a price
  cash_only: number; // trades imported from the cash statement only (bonus shares may be missing)
  first_date: string | null;
};

export type Saving = {
  id: number;
  bank: string;
  amount: number;
  currency: string;
  interest_rate: number | null;
  start_date: string | null;
  term_months: number | null;
};

export type Dividend = {
  id: number;
  stock_id: number;
  type: "cash" | "stock";
  cash_amount: number | null;
  shares: number | null;
  paid_date: string;
};

export type Quote = { price: number; prevClose: number | null; time: string };

export { CURRENCIES, type Currency } from "./config";

export type User = { id: number; email: string; name: string | null; currency: Currency };

// rates[X] = how many X one VND buys (VND itself is 1).
export type Rates = { base: "VND"; rates: Record<string, number>; updated: string; source: string };

// Fired when any API call finds the session gone, so the app can show the sign-in page.
export const SIGNED_OUT_EVENT = "worthia:signed-out";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const body = JSON.parse(text);
      // Validation failures arrive as a ZodError whose message is the JSON list of issues; show the first.
      message = body.error?.name === "ZodError" ? JSON.parse(body.error.message)[0]?.message : body.error;
    } catch {}
    throw new Error(typeof message === "string" ? message : `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export function resource<T extends { id: number }>(path: string) {
  return {
    list: () => request<T[]>(path),
    create: (body: Omit<T, "id">) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    update: (id: number, body: Omit<T, "id">) =>
      request<T>(`${path}/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: number) => request<void>(`${path}/${id}`, { method: "DELETE" }),
  };
}

export const stocksApi = {
  list: () => request<Stock[]>("/stocks"),
  remove: (id: number) => request<void>(`/stocks/${id}`, { method: "DELETE" }),
};
export const savingsApi = resource<Saving>("/savings");
export const dividendsApi = resource<Dividend>("/dividends");

export const favouriteBanksApi = {
  list: () => request<string[]>("/favourite-banks"),
  add: (name: string) => request<void>(`/favourite-banks/${encodeURIComponent(name)}`, { method: "PUT" }),
  remove: (name: string) => request<void>(`/favourite-banks/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

export const getPrices = (symbols: string[]) =>
  request<Record<string, Quote | null>>(`/prices?symbols=${encodeURIComponent(symbols.join(","))}`);

export const authApi = {
  me: () => request<User>("/auth/me"),
  updateMe: (changes: { currency: Currency }) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(changes) }),
  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, name: string | null) =>
    request<User>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  forgot: (email: string) => request<{ ok: true }>("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) =>
    request<User>("/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  googleUrl: "/api/auth/google",
};

export const getRates = () => request<Rates>("/rates");

// A dated share movement (lifecycle history). See migrations/0004_stock_movements.sql.
export type Movement = {
  id: number;
  symbol: string;
  date: string;
  kind: "buy" | "sell" | "bonus";
  quantity: number;
  balance: number | null;
  price: number | null; // VND per share
  fee: number | null;
  tax: number | null;
  trade_date: string | null; // trade day when `date` is the settlement date (imported rows)
  source: "statement" | "manual";
  // Imported rows: a securities-statement row, or a cash-statement trade saved without one (migration 0006).
  origin: "securities" | "cash" | null;
};

export type MovementInput = Pick<Movement, "date" | "kind" | "quantity" | "price" | "fee" | "tax">;

export type ImportedMovement = Pick<
  Movement,
  "symbol" | "date" | "kind" | "quantity" | "price" | "fee" | "tax" | "trade_date"
> & {
  balance: number;
};
// A cash-statement trade day saved on its own (no securities row yet): dated at the trade date, no balance.
export type CashMovement = Pick<Movement, "symbol" | "date" | "kind" | "quantity" | "price" | "fee" | "tax"> & {
  trade_date: string;
};

// A statement file sent with an import, recorded in the import history.
export type ImportFile = {
  statement: "securities" | "cash";
  broker: string;
  file_name: string | null;
  from: string | null;
  to: string | null;
  rows: number;
};

export type ImportRecord = {
  id: number;
  statement: "securities" | "cash";
  broker: string;
  file_name: string | null;
  period_from: string | null;
  period_to: string | null;
  rows: number;
  changes: number;
  imported_at: string; // UTC, "YYYY-MM-DD HH:MM:SS"
};

export const importsApi = { list: () => request<ImportRecord[]>("/imports") };

export const movementsApi = {
  list: (symbol?: string) => request<Movement[]>(`/movements${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`),
  create: (m: MovementInput & { symbol: string }) =>
    request<Movement>("/movements", { method: "POST", body: JSON.stringify(m) }),
  update: (id: number, m: MovementInput) =>
    request<Movement>(`/movements/${id}`, { method: "PUT", body: JSON.stringify(m) }),
  remove: (id: number) => request<void>(`/movements/${id}`, { method: "DELETE" }),
  importMany: (body: {
    movements: ImportedMovement[];
    cashMovements: CashMovement[];
    remove: number[];
    dividends: { symbol: string; date: string; amount: number }[];
    files: ImportFile[];
    changes: number;
  }) => request<{ ok: true; warnings: string[] }>("/movements/import", { method: "POST", body: JSON.stringify(body) }),
};

export type PricePoint = { date: string; close: number };
export const getPriceHistory = (symbol: string, from: string) =>
  request<PricePoint[]>(`/prices/history?symbol=${encodeURIComponent(symbol)}&from=${from}`);
