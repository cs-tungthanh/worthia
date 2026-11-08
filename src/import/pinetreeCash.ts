import { norm, toDate, toNumber } from "./pinetree";
import type { Cell } from "./xlsx";

// Pinetree's "Sao kê giao dịch tiền" (cash statement). Trade rows describe the trade in their text, e.g.
//   buy:  "Trả tiền mua CK T0 - … - Ngày 28/07/2026 - Mã PNJ - KL 200 - GT 6900000 - Phí 2070"
//   sell: "Nhận tiền bán CK T-2 - … - Ngày 01/06/2026 - Mã EVE - KL 200 - GT 2010000 - Phí 603 - Thuế 2010 - Phí CK 60"
// where Ngày is the trade date, KL the shares, GT the gross value, Phí the broker fee, Thuế the sales tax and
// Phí CK the securities transfer fee. Cash dividends name their stock: "Nhận cổ tức bằng tiền - … - Mã QHW".

export type CashTrade = {
  tradeDate: string;
  symbol: string;
  kind: "buy" | "sell";
  quantity: number;
  value: number; // gross: shares × price
  fee: number; // broker fee + transfer fee
  tax: number;
};

export type CashDividend = { date: string; symbol: string; amount: number };

export type CashStatement = {
  broker: string;
  from: string | null;
  to: string | null;
  trades: CashTrade[];
  dividends: CashDividend[];
  rights: string[]; // rights subscriptions, not imported (their shares arrive in the securities statement)
  skipped: number; // deposits, withdrawals, custody fees, loans…
};

const TRADE =
  /Ngày (\d{1,2}\/\d{1,2}\/\d{4}) - Mã (\S+) - KL ([\d.,]+) - GT ([\d.,]+) - Phí ([\d.,]+)(?: - Thuế ([\d.,]+))?(?: - Phí CK ([\d.,]+))?/;

export function isPinetreeCash(rows: Cell[][]): boolean {
  return rows.slice(0, 10).some((r) => r.some((c) => norm(c) === "sao kê giao dịch tiền"));
}

export function parsePinetreeCash(rows: Cell[][]): CashStatement {
  const header = rows.findIndex(
    (r) =>
      r.some((c) => norm(c) === "giao dịch") &&
      r.some((c) => norm(c) === "mô tả") &&
      r.some((c) => norm(c) === "thời gian"),
  );
  if (header < 0) throw new Error("This doesn't look like a Pinetree cash statement (Sao kê giao dịch tiền).");
  const col = (label: string) => rows[header].findIndex((c) => norm(c) === label);
  const cols = { date: col("thời gian"), type: col("giao dịch"), credit: col("phát sinh tăng"), text: col("mô tả") };

  const out: CashStatement = {
    broker: "Pinetree",
    from: null,
    to: null,
    trades: [],
    dividends: [],
    rights: [],
    skipped: 0,
  };
  for (const r of rows.slice(header + 1)) {
    const type = norm(r[cols.type]);
    const text = String(r[cols.text] ?? "").normalize("NFC");
    if (!type) continue;
    const isBuy = type === "chuyển tiền khớp mua";
    const isSell = type === "nhận thanh toán tiền bán";
    if (isBuy || isSell) {
      const m = text.match(TRADE);
      if (!m) throw new Error(`Couldn't read the trade "${text}".`);
      out.trades.push({
        tradeDate: toDate(m[1]),
        symbol: m[2].toUpperCase(),
        kind: isBuy ? "buy" : "sell",
        quantity: toNumber(m[3]),
        value: toNumber(m[4]),
        fee: toNumber(m[5]) + (m[7] ? toNumber(m[7]) : 0),
        tax: m[6] ? toNumber(m[6]) : 0,
      });
    } else if (type === "nhận cổ tức bằng tiền") {
      const symbol = text.match(/Mã (\S+)\s*$/)?.[1];
      if (!symbol) throw new Error(`Couldn't find the stock in "${text}".`);
      out.dividends.push({
        date: toDate(r[cols.date]),
        symbol: symbol.toUpperCase(),
        amount: Math.round(toNumber(r[cols.credit])),
      });
    } else if (type.startsWith("đăng ký mua quyền")) {
      out.rights.push(text.match(/mua (\S+)/i)?.[1] ?? text);
    } else {
      out.skipped++;
    }
  }

  const title = rows
    .slice(0, header)
    .flat()
    .map((c) => String(c ?? ""))
    .join(" ");
  const period = [...title.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)].map((m) => toDate(m[1]));
  out.from = period[0] ?? null;
  out.to = period[1] ?? null;
  return out;
}
