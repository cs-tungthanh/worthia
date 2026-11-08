import { useEffect, useState, type ReactNode } from "react";
import { AreaChart, LineChart } from "@mantine/charts";
import { Alert, Button, Group, Loader, Modal, NumberInput, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { ReferenceDot, type TooltipContentProps } from "recharts";
import { getPriceHistory, movementsApi, type Dividend, type Movement, type PricePoint } from "./api";
import { useMoney } from "./currency";
import { DATE_INPUT_FORMAT } from "./config";
import { compactVnd, dmy, dmyShort } from "./format";
import {
  buildLifecycle,
  historyStart,
  profitSummary,
  type EventKind,
  type LifecycleEvent,
  type ProfitSummary,
} from "./lifecycleData";
import type { Holding } from "./Stocks";
import { ProfitLoss, RowActions, toNumber, today, vndInput } from "./ui";

// One stock's life in the portfolio: price with buy/sell/dividend markers, shares held, value vs cost, and the
// transactions themselves, which can be edited here. Charts share one hover (syncId) so the same day lines up.

const SYNC = "lifecycle";

const EVENT: Record<EventKind, { label: string; color: string }> = {
  buy: { label: "Buy", color: "var(--lc-buy)" },
  sell: { label: "Sell", color: "var(--lc-sell)" },
  bonus: { label: "Bonus shares", color: "var(--lc-dividend)" },
  cash: { label: "Cash dividend", color: "var(--lc-dividend)" },
};

// Shape carries identity too (never colour alone): ▲ buy, ▼ sell, ◆ bonus shares, ● cash dividend.
// Drawn 10px with a 2px ring in the page background so overlapping markers stay separable.
function Marker({ kind, cx = 6, cy = 6 }: { kind: EventKind; cx?: number; cy?: number }) {
  const r = 5;
  const common = { fill: EVENT[kind].color, stroke: "var(--mantine-color-body)", strokeWidth: 2 };
  if (kind === "buy")
    return <polygon points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`} {...common} />;
  if (kind === "sell")
    return <polygon points={`${cx},${cy + r + 1} ${cx + r + 1},${cy - r} ${cx - r - 1},${cy - r}`} {...common} />;
  if (kind === "bonus")
    return (
      <polygon points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`} {...common} />
    );
  return <circle cx={cx} cy={cy} r={r} {...common} />;
}

const MarkerIcon = ({ kind }: { kind: EventKind }) => (
  <svg width={14} height={14} viewBox="0 0 12 12" aria-hidden style={{ overflow: "visible", flex: "none" }}>
    <Marker kind={kind} />
  </svg>
);

const shares = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

// Calendar time between two YYYY-MM-DD dates, e.g. "1 yr 7 mo", "3 mo 12 d", "9 days".
function span(from: string, to: string) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months--;
  const lastDay = new Date(Date.UTC(y1, m1 + months, 0)).getUTCDate(); // 31 Jan + 1 mo → 28/29 Feb
  const anchor = new Date(Date.UTC(y1, m1 - 1 + months, Math.min(d1, lastDay)));
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - anchor.getTime()) / 86_400_000);
  const years = Math.floor(months / 12);
  months %= 12;
  if (years) return months ? `${years} yr ${months} mo` : `${years} yr`;
  if (months) return days ? `${months} mo ${days} d` : `${months} mo`;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
        {children}
      </Text>
    </Paper>
  );
}

function eventText(e: LifecycleEvent, money: (n: number) => string) {
  if (e.kind === "cash") return `${EVENT.cash.label} ${money(e.cash ?? 0)}`;
  const sign = e.kind === "sell" ? "−" : "+";
  const at = e.price != null ? ` at ${money(e.price)}` : "";
  return `${EVENT[e.kind].label} ${sign}${shares(e.shares ?? 0)}${at}`;
}

// One label/value row of the profit panel.
const Line = ({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) => (
  <Group justify="space-between" wrap="nowrap" gap="xs">
    <Text size="sm" c={strong ? undefined : "dimmed"} fw={strong ? 600 : undefined}>
      {label}
    </Text>
    <Text size="sm" fw={strong ? 700 : 500} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {children}
    </Text>
  </Group>
);

// The stock's whole result: money in and out, and the same total by source. Both add up to one number.
function ProfitPanel({
  p,
  shares: held,
  price,
  money,
}: {
  p: ProfitSummary;
  shares: number;
  price: number | null;
  money: (n: number) => string;
}) {
  const amount = (v: number | null) =>
    v == null ? (
      <Text span inherit c="dimmed">
        —
      </Text>
    ) : (
      money(v)
    );
  const signed = (v: number | null) =>
    v == null ? (
      <Text span inherit c="dimmed">
        —
      </Text>
    ) : (
      <ProfitLoss cost={0} value={v} />
    );
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" align="baseline" mb="xs" wrap="wrap" gap="xs">
        <Text size="sm" fw={600}>
          Profit summary
        </Text>
        <Text size="lg" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
          {p.total == null ? (
            <Text span inherit c="dimmed">
              —
            </Text>
          ) : (
            <ProfitLoss cost={0} value={p.total} />
          )}
          {p.returnPct != null && (
            <Text span size="sm" c="dimmed" fw={500}>
              {" "}
              ({p.returnPct > 0 ? "+" : ""}
              {p.returnPct.toFixed(2)}% of invested)
            </Text>
          )}
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Stack gap={4}>
          <Text size="xs" c="dimmed" tt="uppercase">
            Money in and out
          </Text>
          <Line label="Received from sales (after fees & tax)">{amount(p.received)}</Line>
          <Line label="Cash dividends">{money(p.dividends)}</Line>
          <Line
            label={
              held > 0
                ? `Value held (${held.toLocaleString("vi-VN")} × ${price != null ? money(price) : "—"})`
                : "Value held"
            }
          >
            {amount(p.value)}
          </Line>
          <Line label="− Invested (buys incl. fees)">
            {p.invested == null ? amount(null) : `−${money(p.invested)}`}
          </Line>
          <Line label="Total profit" strong>
            {signed(p.total)}
          </Line>
        </Stack>
        <Stack gap={4}>
          <Text size="xs" c="dimmed" tt="uppercase">
            By source
          </Text>
          <Line label="Realised from sales">{signed(p.realised)}</Line>
          <Line label="Cash dividends">{signed(p.dividends)}</Line>
          <Line label="Unrealised on shares held">{signed(p.unrealised)}</Line>
          <Line label="Total profit" strong>
            {signed(p.total)}
          </Line>
        </Stack>
      </SimpleGrid>
      {p.total == null && (
        <Text size="xs" c="dimmed" mt="xs">
          A total needs a price on every buy and sale (import the cash statement or add them below) and a current price.
        </Text>
      )}
    </Paper>
  );
}

// Inline editor for one transaction. Imported rows keep their date, type and shares (re-importing matches on
// them); only price, fee and tax change. Transactions entered in the app can change everything but the type.
function EditRow({
  m,
  onSave,
  onCancel,
}: {
  m: Movement;
  onSave: (m: Movement) => Promise<void>;
  onCancel: () => void;
}) {
  const imported = m.source === "statement";
  const traded = m.kind !== "bonus";
  const [v, setV] = useState({
    date: m.date as string | null,
    quantity: m.quantity as number | string,
    price: (m.price ?? "") as number | string,
    fee: (m.fee ?? "") as number | string,
    tax: (m.tax ?? "") as number | string,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        ...m,
        date: v.date ?? m.date,
        quantity: Number(v.quantity) || m.quantity,
        price: traded ? toNumber(v.price) : null,
        fee: traded ? toNumber(v.fee) : null,
        tax: m.kind === "sell" ? toNumber(v.tax) : null,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Table.Tr>
      <Table.Td colSpan={9}>
        <Group gap="xs" align="flex-end" wrap="wrap">
          <DateInput
            size="xs"
            label="Date"
            valueFormat={DATE_INPUT_FORMAT}
            w={130}
            disabled={imported}
            value={v.date}
            onChange={(d) => setV({ ...v, date: d })}
          />
          <NumberInput
            size="xs"
            label="Shares"
            w={100}
            disabled={imported}
            thousandSeparator="."
            decimalSeparator=","
            hideControls
            value={v.quantity}
            onChange={(q) => setV({ ...v, quantity: q })}
          />
          {traded && (
            <>
              <NumberInput
                size="xs"
                label="Price (VND)"
                w={130}
                {...vndInput}
                decimalScale={2}
                hideControls
                value={v.price}
                onChange={(p) => setV({ ...v, price: p })}
              />
              <NumberInput
                size="xs"
                label="Fee (VND)"
                w={110}
                {...vndInput}
                allowDecimal={false}
                hideControls
                value={v.fee}
                onChange={(f) => setV({ ...v, fee: f })}
              />
            </>
          )}
          {m.kind === "sell" && (
            <NumberInput
              size="xs"
              label="Tax (VND)"
              w={110}
              {...vndInput}
              allowDecimal={false}
              hideControls
              value={v.tax}
              onChange={(t) => setV({ ...v, tax: t })}
            />
          )}
          <Button size="xs" onClick={save} loading={busy}>
            Save
          </Button>
          <Button size="xs" variant="default" onClick={onCancel}>
            Cancel
          </Button>
          {imported && (
            <Text size="xs" c="dimmed">
              Imported: date and shares come from the statement.
            </Text>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

export function LifecycleModal({
  holding,
  dividends,
  onClose,
  onChanged,
  price,
}: {
  holding: Holding | null;
  dividends: Dividend[];
  onClose: () => void;
  onChanged: () => Promise<unknown>; // refreshes holdings after a transaction is edited or deleted
  price: number | null; // live price, VND; the last close is used without one
}) {
  const { convert, currency, fmt } = useMoney();
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [prices, setPrices] = useState<PricePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  // Charts share a crosshair (syncId), but only the one under the pointer shows its tooltip.
  const [hovered, setHovered] = useState<string | null>(null);

  const symbol = holding?.symbol;
  const ownDividends = holding ? dividends.filter((d) => d.stock_id === holding.id) : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: ownDividends is derived from props; refetch only when the stock changes.
  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setMovements(null);
    setPrices(null);
    setError(null);
    movementsApi
      .list(symbol)
      .then(async (m) => {
        if (!live) return;
        setMovements(m);
        const from = historyStart(m, ownDividends, today());
        const p = await getPriceHistory(symbol, from).catch(() => []);
        if (live) setPrices(p);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [symbol]);

  const reload = async () => {
    if (!symbol) return;
    setMovements(await movementsApi.list(symbol));
    await onChanged();
  };
  const act = async (p: Promise<unknown>) => {
    setError(null);
    try {
      await p;
      setEditing(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Amounts are stored in VND; charts follow the display currency when a rate exists.
  const unit = convert(1, "VND") != null ? currency : "VND";
  const conv = (v: number) => convert(v, "VND") ?? v;
  const axis = (v: number) =>
    unit === "VND"
      ? compactVnd(v)
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: unit,
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(v);
  const vnd = (v: number) => fmt(v, "VND");

  const loading = !!holding && (movements == null || prices == null) && !error;
  const lc = movements && prices ? buildLifecycle(movements, ownDividends, prices) : null;
  const data = (lc?.days ?? []).map((d) => ({
    date: d.date,
    close: conv(d.close),
    held: d.held,
    value: conv(d.value),
    cost: d.cost == null || d.held === 0 ? null : conv(d.cost),
  }));
  const hasCost = data.some((d) => d.cost != null);

  // Each event sits on the first trading day on or after its date.
  const markers = new Map<string, { date: string; close: number; kinds: Set<EventKind>; events: LifecycleEvent[] }>();
  for (const e of lc?.events ?? []) {
    const day = data.find((d) => d.date >= e.date) ?? data[data.length - 1];
    if (!day) continue;
    const m = markers.get(day.date) ?? { date: day.date, close: day.close, kinds: new Set(), events: [] };
    m.kinds.add(e.kind);
    m.events.push(e);
    markers.set(day.date, m);
  }

  const tooltip = ({ active, label: rawLabel, payload }: TooltipContentProps<number, string>) => {
    const label = rawLabel == null ? "" : String(rawLabel);
    if (!active || !payload?.length || !label) return null;
    const d = payload[0].payload as (typeof data)[number];
    const onDay = markers.get(label)?.events ?? [];
    return (
      <Paper withBorder shadow="sm" p="xs" radius="md" style={{ fontVariantNumeric: "tabular-nums" }}>
        <Text size="xs" c="dimmed">
          {dmy(label)}
        </Text>
        <Text size="sm">Price {fmt(d.close, unit)}</Text>
        <Text size="sm">Held {shares(d.held)}</Text>
        {d.held > 0 && <Text size="sm">Value {fmt(d.value, unit)}</Text>}
        {d.cost != null && (
          <Text size="sm" c="dimmed">
            Cost {fmt(d.cost, unit)}
          </Text>
        )}
        {onDay.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a day's events are a static list that is never reordered.
          <Group key={i} gap={6} wrap="nowrap">
            <MarkerIcon kind={e.kind} />
            <Text size="sm">{eventText(e, vnd)}</Text>
          </Group>
        ))}
      </Paper>
    );
  };

  const hoverProps = (chart: string) => ({
    onMouseEnter: () => setHovered(chart),
    onMouseLeave: () => setHovered((h) => (h === chart ? null : h)),
  });
  const tooltipFor = (chart: string) => ({
    content: (p: TooltipContentProps<number, string>) => (hovered === chart ? tooltip(p) : null),
  });

  const common = {
    data,
    dataKey: "date",
    withDots: false,
    gridAxis: "x" as const, // Mantine names the grid by axis: "x" draws faint horizontal lines
    tickLine: "none" as const,
    strokeWidth: 2,
    xAxisProps: { tickFormatter: dmyShort, minTickGap: 48 },
    tooltipAnimationDuration: 0,
  };

  return (
    <Modal opened={!!holding} onClose={onClose} title={symbol ? `${symbol}: lifecycle` : ""} size="80rem">
      {loading && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}
      {error && (
        <Alert color="red" mb="sm" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {lc && holding && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 2, sm: 4, md: 8 }} spacing="xs">
            <Stat label="Held now">{shares(holding.shares)}</Stat>
            <Stat label="Avg cost">{holding.avg_price != null ? vnd(holding.avg_price) : "—"}</Stat>
            <Stat label="Avg cost after dividends">
              {holding.net_avg_price != null ? vnd(holding.net_avg_price) : "—"}
            </Stat>
            <Stat label="First event">
              {lc.firstDate ? dmy(lc.firstDate) : "—"}
              {lc.firstDate && (
                <Text span display="block" size="xs" c="dimmed" fw={400}>
                  {lc.lastHeldDate
                    ? `held ${span(lc.firstDate, lc.lastHeldDate)}, to ${dmy(lc.lastHeldDate)}`
                    : `${span(lc.firstDate, today())} ago`}
                </Text>
              )}
            </Stat>
            <Stat label="Bought / sold">
              {shares(lc.totals.bought)} / {shares(lc.totals.sold)}
            </Stat>
            <Stat label="Bonus shares">{shares(lc.totals.bonus)}</Stat>
            <Stat label="Cash dividends">{vnd(lc.totals.cash)}</Stat>
            <Stat label="Fees & tax">{vnd(lc.totals.fees)}</Stat>
          </SimpleGrid>

          {lc.events.length > 0 && (
            <ProfitPanel
              p={profitSummary(lc, price ?? lc.days[lc.days.length - 1]?.close ?? null)}
              shares={holding.shares}
              price={price ?? lc.days[lc.days.length - 1]?.close ?? null}
              money={vnd}
            />
          )}

          {lc.events.length === 0 && (
            <Alert color="gray">
              No transactions for {symbol} yet. Import your statements or add a transaction, and they'll appear here.
              Showing the last year of prices.
            </Alert>
          )}

          {data.length === 0 ? (
            <Alert color="gray">No price history is available for {symbol}.</Alert>
          ) : (
            <>
              <div {...hoverProps("price")}>
                <Group justify="space-between" mb={4} wrap="wrap" gap="xs">
                  <Text size="sm" fw={600}>
                    Price ({unit})
                  </Text>
                  <Group gap="md" wrap="wrap">
                    {(["buy", "sell", "bonus", "cash"] as const).map((k) => (
                      <Group key={k} gap={4} wrap="nowrap">
                        <MarkerIcon kind={k} />
                        <Text size="xs" c="dimmed">
                          {EVENT[k].label}
                        </Text>
                      </Group>
                    ))}
                  </Group>
                </Group>
                <LineChart
                  {...common}
                  h={260}
                  series={[{ name: "close", label: "Price", color: "var(--mantine-color-dimmed)" }]}
                  valueFormatter={axis}
                  yAxisProps={{ domain: ["auto", "auto"], width: 64 }}
                  lineChartProps={{ syncId: SYNC }}
                  tooltipProps={tooltipFor("price")}
                >
                  {[...markers.values()].flatMap((m) =>
                    [...m.kinds].map((k, i) => (
                      <ReferenceDot
                        key={`${m.date}-${k}`}
                        x={m.date}
                        y={m.close}
                        ifOverflow="extendDomain"
                        shape={(p: { cx?: number; cy?: number }) => (
                          <Marker kind={k} cx={p.cx} cy={(p.cy ?? 0) - i * 12} />
                        )}
                      />
                    )),
                  )}
                </LineChart>
                <Text size="xs" c="dimmed">
                  Price history is adjusted for bonus issues and splits, so before a bonus issue it sits below the
                  prices you actually paid (the timeline shows those).
                </Text>
              </div>

              <div {...hoverProps("held")}>
                <Text size="sm" fw={600} mb={4}>
                  Shares held
                </Text>
                <AreaChart
                  {...common}
                  h={140}
                  series={[{ name: "held", label: "Shares held", color: "var(--mantine-color-dimmed)" }]}
                  curveType="stepAfter"
                  fillOpacity={0.15}
                  withGradient={false}
                  valueFormatter={(v) => shares(v)}
                  yAxisProps={{ width: 64, allowDecimals: false }}
                  areaChartProps={{ syncId: SYNC }}
                  tooltipProps={tooltipFor("held")}
                />
              </div>

              <div {...hoverProps("value")}>
                <Text size="sm" fw={600} mb={4}>
                  Value vs cost ({unit})
                </Text>
                {!hasCost ? (
                  <Text size="sm" c="dimmed">
                    Cost appears once the buys have prices: import the cash statement or add them in the timeline below.
                  </Text>
                ) : (
                  <LineChart
                    {...common}
                    h={200}
                    series={[
                      { name: "value", label: "Market value", color: "var(--mantine-color-text)" },
                      { name: "cost", label: "Cost", color: "var(--mantine-color-dimmed)", strokeDasharray: "6 4" },
                    ]}
                    withLegend
                    legendProps={{ verticalAlign: "top", height: 32 }}
                    valueFormatter={axis}
                    yAxisProps={{ width: 64 }}
                    lineChartProps={{ syncId: SYNC }}
                    tooltipProps={tooltipFor("value")}
                  />
                )}
              </div>
            </>
          )}

          {lc.events.length > 0 && (
            <div>
              <Text size="sm" fw={600} mb={4}>
                Transactions
              </Text>
              <Table.ScrollContainer minWidth={820} maxHeight={360}>
                <Table striped verticalSpacing={4} stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Event</Table.Th>
                      <Table.Th ta="right">Shares</Table.Th>
                      <Table.Th ta="right">Price</Table.Th>
                      <Table.Th ta="right">Fee & tax</Table.Th>
                      <Table.Th ta="right">Amount</Table.Th>
                      <Table.Th ta="right">Profit vs avg cost</Table.Th>
                      <Table.Th ta="right">Held after</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...lc.events].reverse().map((e, i) =>
                      e.movement && editing === e.movement.id ? (
                        <EditRow
                          key={`edit-${e.movement.id}`}
                          m={e.movement}
                          onCancel={() => setEditing(null)}
                          onSave={(m) => act(movementsApi.update(m.id, m))}
                        />
                      ) : (
                        <Table.Tr key={e.movement ? e.movement.id : `cash-${i}`}>
                          <Table.Td>{dmy(e.date)}</Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <MarkerIcon kind={e.kind} />
                              {EVENT[e.kind].label}
                            </Group>
                          </Table.Td>
                          <Table.Td ta="right">
                            {e.shares == null ? "" : `${e.kind === "sell" ? "−" : "+"}${shares(e.shares)}`}
                          </Table.Td>
                          <Table.Td ta="right">
                            {e.kind === "buy" || e.kind === "sell" ? (
                              e.price != null ? (
                                vnd(e.price)
                              ) : (
                                <Text span inherit c="dimmed">
                                  no price
                                </Text>
                              )
                            ) : (
                              ""
                            )}
                          </Table.Td>
                          <Table.Td ta="right">
                            {e.fee != null || e.tax != null ? vnd((e.fee ?? 0) + (e.tax ?? 0)) : ""}
                          </Table.Td>
                          <Table.Td ta="right">
                            {e.kind === "cash"
                              ? vnd(e.cash ?? 0)
                              : e.price != null && e.shares != null
                                ? vnd(e.price * e.shares)
                                : ""}
                          </Table.Td>
                          <Table.Td
                            ta="right"
                            title={
                              e.profit != null && e.avgCostAtSale != null && e.shares != null && e.price != null
                                ? `${shares(e.shares)} × ${vnd(e.price)} − fee & tax ${vnd((e.fee ?? 0) + (e.tax ?? 0))} − ${shares(e.shares)} × avg cost ${vnd(e.avgCostAtSale)}`
                                : undefined
                            }
                          >
                            {e.profit != null ? <ProfitLoss cost={0} value={e.profit} /> : ""}
                          </Table.Td>
                          <Table.Td ta="right">{shares(e.heldAfter)}</Table.Td>
                          <Table.Td>
                            {e.movement && (
                              <RowActions
                                label={`${EVENT[e.kind].label} ${dmy(e.date)}`}
                                onEdit={() => setEditing(e.movement!.id)}
                                onDelete={() =>
                                  confirm(
                                    e.movement!.source === "statement"
                                      ? "Delete this imported transaction? Importing the statement again brings it back."
                                      : "Delete this transaction?",
                                  ) && act(movementsApi.remove(e.movement!.id))
                                }
                              />
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ),
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Text size="xs" c="dimmed" mt={4}>
                Imported transactions are dated by trade day when the cash statement is imported, else by settlement
                day. Amount is shares × price. Profit vs avg cost is a sale's proceeds after fees and tax minus the
                shares sold × the average cost at that moment (all earlier buys with their fees, spread over the shares
                then held, bonus shares included); hover it to see the sum.
              </Text>
            </div>
          )}
        </Stack>
      )}
    </Modal>
  );
}
