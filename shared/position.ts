// A stock position computed from its share movements. Used by the Worker (to store each holding's shares,
// average cost and realised profit) and by the app (import preview, lifecycle chart), so they always agree.
//
// Moving-average cost, as Vietnamese brokers report "giá vốn":
//   buy   → cost += shares × price + fee; shares += n
//   bonus → shares += n (no cost: the average falls)
//   sell  → cost −= average × n; realised += (n × price − fee − tax) − average × n; shares −= n
//   back to 0 shares → cost and the "unknown" flag reset (realised profit is kept)
// A buy with no price makes the cost unknown until the position next returns to zero.
//
// Net cost is a second moving average, as Pinetree's "TB" shows it: the same, except each cash dividend received
// lowers it (net cost −= amount). Dividends apply before movements on the same date. One paid after the position
// was sold out (its record date fell while held) carries into the next position, as Pinetree does. Net cost can
// go below zero once dividends exceed the cost.

export type PositionMovement = {
  date: string; // order: date, then the given order (pass movements sorted by date, then id)
  kind: "buy" | "sell" | "bonus";
  quantity: number;
  price: number | null; // VND per share
  fee: number | null;
  tax: number | null;
  balance?: number | null; // stated balance after the movement (statements), used for an opening position
};

export type PositionStep = {
  shares: number; // held after this movement
  cost: number | null; // cost basis of the shares held, null if unknown
  realised: number | null; // cumulative realised profit, null once a sale's profit is unknown
};

export type PositionDividend = { date: string; amount: number }; // cash received, VND

export type Position = PositionStep & {
  avgCost: number | null; // cost per share held
  netCost: number | null; // cost minus cash dividends received (see above), null if the cost is unknown
  netAvgCost: number | null; // net cost per share held
  steps: PositionStep[]; // after each movement, same order as the input
  overSold: { index: number; held: number } | null; // first sale of more shares than held, if any
};

export function computePosition(movements: PositionMovement[], dividends: PositionDividend[] = []): Position {
  // A statement may start mid-position: its first stated balance implies what was held before (cost unknown).
  const first = movements[0];
  const delta = (m: PositionMovement) => (m.kind === "sell" ? -m.quantity : m.quantity);
  const opening = first?.balance != null ? Math.max(0, first.balance - delta(first)) : 0;

  let shares = opening;
  let cost = 0;
  let netCost = 0;
  let costKnown = opening === 0;
  let realised = 0;
  let realisedKnown = true;
  let overSold: Position["overSold"] = null;
  const steps: PositionStep[] = [];

  const paid = [...dividends].sort((a, b) => a.date.localeCompare(b.date));
  let next = 0;
  const receiveUpTo = (date: string | null) => {
    for (; next < paid.length && (date == null || paid[next].date <= date); next++) {
      netCost -= paid[next].amount;
    }
  };

  movements.forEach((m, index) => {
    receiveUpTo(m.date);
    if (m.kind === "buy") {
      if (m.price == null) costKnown = false;
      else {
        cost += m.quantity * m.price + (m.fee ?? 0);
        netCost += m.quantity * m.price + (m.fee ?? 0);
      }
      shares += m.quantity;
    } else if (m.kind === "bonus") {
      shares += m.quantity;
    } else {
      if (m.quantity > shares + 1e-9 && !overSold) overSold = { index, held: shares };
      const sold = Math.min(m.quantity, shares);
      const avg = shares > 0 ? cost / shares : 0;
      if (m.price == null || !costKnown) realisedKnown = false;
      else realised += sold * m.price - (m.fee ?? 0) - (m.tax ?? 0) - avg * sold;
      cost -= avg * sold;
      if (shares > 0) netCost -= (netCost / shares) * sold;
      shares -= sold;
    }
    if (shares <= 1e-9) {
      shares = 0;
      cost = 0;
      netCost = 0;
      costKnown = true;
    }
    steps.push({ shares, cost: costKnown ? cost : null, realised: realisedKnown ? realised : null });
  });

  receiveUpTo(null);

  return {
    shares,
    cost: costKnown ? cost : null,
    avgCost: costKnown && shares > 0 ? cost / shares : null,
    netCost: costKnown ? netCost : null,
    netAvgCost: costKnown && shares > 0 ? netCost / shares : null,
    realised: realisedKnown ? realised : null,
    steps,
    overSold,
  };
}
