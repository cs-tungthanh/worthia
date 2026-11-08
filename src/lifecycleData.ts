import { computePosition } from "../shared/position";
import type { Dividend, Movement, PricePoint } from "./api";

// One stock's lifecycle, built from its transactions (with the shared position maths), its cash dividends and
// daily prices. Pure, so it's testable.

export type EventKind = "buy" | "sell" | "bonus" | "cash";

export type LifecycleEvent = {
  movement: Movement | null; // null for cash dividends
  date: string; // trade date when known, else the statement's (settlement) date
  kind: EventKind;
  shares: number | null;
  price: number | null; // VND per share, buys and sells
  fee: number | null;
  tax: number | null;
  cash: number | null; // cash dividend, VND
  heldAfter: number;
  costAfter: number | null; // cost basis of the shares held after this event
  realisedAfter: number | null; // cumulative realised profit after this event
  profit: number | null; // a sale's profit: proceeds after fees and tax − shares sold × avgCostAtSale
  avgCostAtSale: number | null; // average cost per share just before a sale (moving average, fees included)
};

export type DayPoint = { date: string; close: number; held: number; value: number; cost: number | null };

export type Lifecycle = {
  events: LifecycleEvent[]; // oldest first
  days: DayPoint[];
  firstDate: string | null;
  lastHeldDate: string | null; // when the position was last sold down to 0; null while shares are held
  totals: { bought: number; sold: number; bonus: number; cash: number; fees: number; realised: number | null };
  // Money in and out of this stock, VND. null when a buy (invested, cost) or sale (received) has no price.
  money: { invested: number | null; received: number | null; costHeld: number | null; held: number };
};

export type ProfitSummary = {
  invested: number | null; // every buy: shares × price + fee
  received: number | null; // every sale: shares × price − fee − tax
  dividends: number;
  value: number | null; // shares held × current price
  realised: number | null; // from sales, after fees and tax, against average cost
  unrealised: number | null; // value − cost of the shares held
  total: number | null; // realised + dividends + unrealised = received + dividends + value − invested
  returnPct: number | null; // total ÷ invested
};

// One stock's whole result, combining sales, dividends and the shares still held.
export function profitSummary(lc: Lifecycle, price: number | null): ProfitSummary {
  const { invested, received, costHeld, held } = lc.money;
  const value = held === 0 ? 0 : price != null ? price * held : null;
  const unrealised = held === 0 ? 0 : value != null && costHeld != null ? value - costHeld : null;
  const realised = lc.totals.realised;
  const total = realised != null && unrealised != null ? realised + lc.totals.cash + unrealised : null;
  return {
    invested,
    received,
    dividends: lc.totals.cash,
    value,
    realised,
    unrealised,
    total,
    returnPct: total != null && invested ? (total / invested) * 100 : null,
  };
}

const shownDate = (m: Movement) => m.trade_date ?? m.date;

// Where the price chart should start: a little before the first event, or a year back without history.
export function historyStart(movements: Movement[], dividends: Dividend[], today: string): string {
  const first = [...movements.map(shownDate), ...dividends.map((d) => d.paid_date)].sort()[0];
  const d = new Date(`${first ?? today}T00:00:00Z`);
  if (first) d.setUTCDate(d.getUTCDate() - 14);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function buildLifecycle(movements: Movement[], dividends: Dividend[], prices: PricePoint[]): Lifecycle {
  // Position maths runs in settlement order (statement balances are settlement balances).
  const sorted = [...movements].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const position = computePosition(sorted);

  const moveEvents: LifecycleEvent[] = sorted.map((m, i) => {
    const before = i > 0 ? position.steps[i - 1].realised : 0;
    const after = position.steps[i].realised;
    return {
      movement: m,
      date: shownDate(m),
      kind: m.kind,
      shares: m.quantity,
      price: m.price,
      fee: m.fee,
      tax: m.tax,
      cash: null,
      heldAfter: position.steps[i].shares,
      costAfter: position.steps[i].cost,
      realisedAfter: after,
      profit: m.kind === "sell" && after != null && before != null ? after - before : null,
      avgCostAtSale: (() => {
        if (m.kind !== "sell" || i === 0) return null;
        const prev = position.steps[i - 1];
        return prev.cost != null && prev.shares > 0 ? prev.cost / prev.shares : null;
      })(),
    };
  });

  // Cash dividends sit between transactions; they take the position as it stood on their date.
  const cashEvents: LifecycleEvent[] = dividends
    .filter((d) => d.type === "cash")
    .map((d) => {
      const last = [...moveEvents].reverse().find((e) => e.date <= d.paid_date);
      return {
        movement: null,
        date: d.paid_date,
        kind: "cash",
        shares: null,
        price: null,
        fee: null,
        tax: null,
        cash: d.cash_amount,
        heldAfter: last?.heldAfter ?? 0,
        costAfter: last?.costAfter ?? 0,
        realisedAfter: last?.realisedAfter ?? 0,
        profit: null,
        avgCostAtSale: null,
      };
    });

  const events = [...moveEvents, ...cashEvents].sort((a, b) => a.date.localeCompare(b.date));
  const lastMove = events.filter((e) => e.kind !== "cash").at(-1);

  const totals = { bought: 0, sold: 0, bonus: 0, cash: 0, fees: 0, realised: position.realised };
  let invested: number | null = 0;
  let received: number | null = 0;
  for (const e of moveEvents) {
    if (e.kind === "buy")
      invested = e.price == null || invested == null ? null : invested + e.price * e.shares! + (e.fee ?? 0);
    if (e.kind === "sell")
      received =
        e.price == null || received == null ? null : received + e.price * e.shares! - (e.fee ?? 0) - (e.tax ?? 0);
  }
  for (const e of events) {
    if (e.kind === "buy") totals.bought += e.shares ?? 0;
    if (e.kind === "sell") totals.sold += e.shares ?? 0;
    if (e.kind === "bonus") totals.bonus += e.shares ?? 0;
    if (e.kind === "cash") totals.cash += e.cash ?? 0;
    totals.fees += (e.fee ?? 0) + (e.tax ?? 0);
  }

  // Daily series: each day takes the position after that day's transactions. Transactions after the last
  // trading day (e.g. entered on a weekend) extend the series at the last known price.
  const timeline = moveEvents
    .map((e) => ({ date: e.date, held: e.heldAfter, cost: e.costAfter }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const series = [...prices];
  const lastPrice = prices[prices.length - 1];
  if (lastPrice)
    for (const t of timeline)
      if (t.date > series[series.length - 1].date) series.push({ date: t.date, close: lastPrice.close });

  let i = 0;
  let current: { held: number; cost: number | null } = { held: 0, cost: 0 };
  const days: DayPoint[] = series.map((p) => {
    while (i < timeline.length && timeline[i].date <= p.date) current = timeline[i++];
    return { date: p.date, close: p.close, held: current.held, value: p.close * current.held, cost: current.cost };
  });

  return {
    events,
    days,
    firstDate: events[0]?.date ?? null,
    lastHeldDate: lastMove && lastMove.heldAfter === 0 ? lastMove.date : null,
    totals,
    money: { invested, received, costHeld: position.cost, held: position.shares },
  };
}
