import { computePosition, type PositionDividend, type PositionMovement } from "../../shared/position";
import type { MovementRow } from "./queries";

// Holdings rules on top of shared/position.ts (the one place position math lives, shared with the app).
// Pure: callers load the rows.

const byDateThenId = (a: MovementRow, b: MovementRow) => a.date.localeCompare(b.date) || a.id - b.id;

// Why a change can't be saved: it would sell more shares than were held at that point. Null if it's fine.
export function overSoldMessage(symbol: string, rows: MovementRow[]): string | null {
  const sorted = [...rows].sort(byDateThenId);
  const { overSold } = computePosition(sorted as PositionMovement[]);
  if (!overSold) return null;
  const m = sorted[overSold.index];
  return `On ${m.date} you held ${overSold.held} ${symbol}, fewer than the ${m.quantity} sold.`;
}

// One message per symbol that oversells anywhere in its history.
export function overSoldWarnings(all: MovementRow[]): string[] {
  return [...new Set(all.map((m) => m.symbol))]
    .map((s) =>
      overSoldMessage(
        s,
        all.filter((m) => m.symbol === s),
      ),
    )
    .filter((p): p is string => p != null);
}

// A holding as GET /stocks returns it. `movements` are sorted by date, then id.
export function summariseHolding(
  stock: { id: number; symbol: string },
  movements: MovementRow[],
  dividends: PositionDividend[],
) {
  const p = computePosition(movements as PositionMovement[], dividends);
  return {
    id: stock.id,
    symbol: stock.symbol,
    shares: p.shares,
    avg_price: p.avgCost,
    net_avg_price: p.netAvgCost,
    cost: p.cost,
    realised: p.realised,
    // Buys still missing a price in the current position (they make the cost unknown).
    unpriced: movements.filter((m) => m.kind === "buy" && m.price == null).length,
    // Trades known only from the cash statement: bonus shares may be missing until the securities one is imported.
    cash_only: movements.filter((m) => m.origin === "cash").length,
    first_date: movements[0]?.date ?? null,
  };
}
