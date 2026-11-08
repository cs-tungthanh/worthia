import type { Cell } from "./xlsx";

// Pinetree's "Sao kê giao dịch chứng khoán" (securities statement): one row per share movement, newest first,
// with the balance after each. It records quantities only; buy rows carry no price.

export type MovementKind = "buy" | "sell" | "bonus" | "other";

export type Movement = {
  date: string; // YYYY-MM-DD
  symbol: string;
  kind: MovementKind;
  description: string;
  quantityIn: number;
  quantityOut: number;
  balance: number; // shares held after this movement
};

export type Statement = { broker: string; from: string | null; to: string | null; movements: Movement[] }; // oldest first

export const norm = (v: Cell) =>
  String(v ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();

// Quantities arrive as numbers; prices as Vietnamese text ("76.600"); "-" means none.
export function toNumber(v: Cell): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (s === "" || s === "-") return 0;
  const n = Number(
    /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", "."),
  );
  if (Number.isNaN(n)) throw new Error(`Unexpected number "${s}" in the statement.`);
  return n;
}

// "30/07/2026" → "2026-07-30"; also accepts Excel date serials.
export function toDate(v: Cell): string {
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = String(v ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Unexpected date "${v}" in the statement.`);
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function kindOf(description: string): MovementKind {
  const d = norm(description);
  if (d.includes("chờ giao dịch sang giao dịch")) return "bonus"; // pending shares becoming tradable: bonus issues
  if (d.includes("đã mua")) return "buy";
  if (d.includes("đã bán")) return "sell";
  return "other";
}

export function parsePinetree(rows: Cell[][]): Statement {
  const header = rows.findIndex(
    (r) =>
      r.some((c) => norm(c) === "mã") &&
      r.some((c) => norm(c) === "giao dịch") &&
      r.some((c) => norm(c).startsWith("số dư cuối")),
  );
  if (header < 0) {
    throw new Error("This doesn't look like a Pinetree securities statement (Sao kê giao dịch chứng khoán).");
  }
  const top = rows[header];
  const sub = rows[header + 1] ?? [];
  const col = (r: Cell[], label: string) => r.findIndex((c) => norm(c).startsWith(label));
  const cols = {
    date: col(top, "thời gian"),
    symbol: col(top, "mã"),
    description: col(top, "giao dịch"),
    balance: col(top, "số dư cuối"),
    in: col(sub, "kl tăng"),
    out: col(sub, "kl giảm"),
  };
  if (Object.values(cols).some((i) => i < 0)) throw new Error("The statement is missing an expected column.");

  const movements: Movement[] = [];
  for (const r of rows.slice(header + 2)) {
    const symbol = String(r[cols.symbol] ?? "")
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const description = String(r[cols.description] ?? "").trim();
    movements.push({
      date: toDate(r[cols.date]),
      symbol,
      kind: kindOf(description),
      description,
      quantityIn: toNumber(r[cols.in]),
      quantityOut: toNumber(r[cols.out]),
      balance: toNumber(r[cols.balance]),
    });
  }
  if (movements.length === 0) throw new Error("The statement has no transactions.");

  // Rows are newest first; reversing keeps same-day rows in the order they happened.
  movements.reverse();
  movements.sort((a, b) => a.date.localeCompare(b.date));

  const title = rows
    .slice(0, header)
    .flat()
    .map((c) => String(c ?? ""))
    .join(" ");
  const period = [...title.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)].map((m) => toDate(m[1]));
  return { broker: "Pinetree", from: period[0] ?? null, to: period[1] ?? null, movements };
}
