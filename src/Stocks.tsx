import { useState, type ReactNode } from "react";
import {
  Alert,
  CloseButton,
  Group,
  Paper,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { stocksApi, type Dividend, type Quote, type Stock } from "./api";
import { useMoney } from "./currency";
import { TransactionForm } from "./TransactionForm";
import { DayChange, MobileRow, ProfitLoss, ResponsiveList, RowActions, type SectionProps } from "./ui";

// Holdings are computed from transactions (buys, sells, bonus shares); they're changed by adding or editing
// transactions, not by typing totals. A holding's average cost is the broker-style moving average, fees included;
// "after dividends" also subtracts the cash dividends received, as Pinetree's "TB" does. Initial value, market value
// and profit/loss follow Pinetree's table: shares × avg cost after dividends, shares × price, and their difference.
export type Holding = Stock;

const shares = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

type SortKey = "symbol" | "shares" | "avg" | "netAvg" | "price" | "day" | "initial" | "value" | "profit";

// Pinetree's "Giá trị ban đầu": shares × avg cost after dividends.
const initialValue = (s: Stock) => (s.net_avg_price != null ? s.net_avg_price * s.shares : null);
type Sort = { key: SortKey; desc: boolean };

// A clickable column header: the first click sorts ascending (A→Z, low→high), the next flips it.
function SortHeader({
  label,
  k,
  sort,
  onSort,
  right = false,
}: {
  label: ReactNode;
  k: SortKey;
  sort: Sort;
  onSort: (s: Sort) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <Table.Th ta={right ? "right" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <UnstyledButton
        fw={600}
        fz="sm"
        onClick={() => onSort({ key: k, desc: active ? !sort.desc : false })}
        style={{ whiteSpace: "nowrap" }}
      >
        {label}{" "}
        <Text span inherit c={active ? undefined : "dimmed"} fw={400}>
          {active ? (sort.desc ? "↓" : "↑") : "↕"}
        </Text>
      </UnstyledButton>
    </Table.Th>
  );
}

function AvgCost({ s, value }: { s: Holding; value: number | null }) {
  const { fmt } = useMoney();
  if (value != null) return <>{fmt(value, "VND", true)}</>;
  return (
    <Tooltip
      label={`${s.unpriced} ${s.unpriced === 1 ? "buy has" : "buys have"} no price. Import the cash statement or add it in the lifecycle.`}
    >
      <Text span inherit c="dimmed">
        —
      </Text>
    </Tooltip>
  );
}

export function StocksSection({
  rows,
  quotes,
  run,
  headerAction,
  onView,
  dividends,
}: SectionProps<Holding> & {
  quotes: Record<string, Quote | null>;
  headerAction?: ReactNode;
  onView: (h: Holding) => void;
  dividends: Dividend[];
}) {
  const { fmt } = useMoney();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "symbol", desc: false });

  // Search matches the symbol only. Sorting puts holdings missing the value (no price, unknown cost) last.
  const q = query.trim().toUpperCase();
  const matches = (s: Holding) => !q || s.symbol.includes(q);
  const sortValue = (s: Holding): number | string | null => {
    const quote = quotes[s.symbol];
    switch (sort.key) {
      case "symbol":
        return s.symbol;
      case "shares":
        return s.shares;
      case "avg":
        return s.avg_price;
      case "netAvg":
        return s.net_avg_price;
      case "price":
        return quote?.price ?? null;
      case "day":
        return quote?.prevClose ? (quote.price - quote.prevClose) / quote.prevClose : null;
      case "initial":
        return initialValue(s);
      case "value":
        return quote ? quote.price * s.shares : null;
      case "profit":
        return quote && initialValue(s) != null ? quote.price * s.shares - initialValue(s)! : null;
    }
  };
  const bySort = (a: Holding, b: Holding) => {
    const x = sortValue(a);
    const y = sortValue(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return (sort.desc ? -c : c) || a.symbol.localeCompare(b.symbol);
  };
  const allHeld = rows.filter((s) => s.shares > 0);
  const held = allHeld.filter(matches).sort(bySort);
  const soldOut = rows.filter((s) => s.shares === 0 && matches(s));
  // Totals of the rows shown, like Pinetree's header row; a holding missing a cost or price is left out of that sum.
  const totalInitial = held.reduce((n, s) => n + (initialValue(s) ?? 0), 0);
  const totalValue = held.reduce((n, s) => n + (quotes[s.symbol] ? quotes[s.symbol]!.price * s.shares : 0), 0);
  const full = (n: number) => fmt(n, "VND");
  // Profit/loss totals only holdings with both a cost and a price, so a missing price doesn't count as a loss.
  const tracked = held.filter((s) => initialValue(s) != null && quotes[s.symbol]);
  const trackedInitial = tracked.reduce((n, s) => n + initialValue(s)!, 0);
  const trackedValue = tracked.reduce((n, s) => n + quotes[s.symbol]!.price * s.shares, 0);
  const header = (label: ReactNode, k: SortKey, right = true) => (
    <SortHeader label={label} k={k} sort={sort} onSort={setSort} right={right} />
  );
  const cashOnly = rows.filter((s) => s.cash_only > 0);
  const dividendsOf = (s: Holding) =>
    dividends.filter((d) => d.stock_id === s.id).reduce((n, d) => n + (d.cash_amount ?? 0), 0);
  const remove = (s: Holding) =>
    confirm(`Delete ${s.symbol} with all its transactions and dividends? This can't be undone.`) &&
    run(stocksApi.remove(s.id));

  return (
    <section>
      <Group justify="space-between" align="center" mt="xl" mb="sm">
        <Title order={2} size="h4">
          Stocks
        </Title>
        <Group gap="xs">
          {rows.length > 0 && (
            <TextInput
              size="xs"
              w={160}
              placeholder="Search symbol"
              aria-label="Search stocks by symbol"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightSection={query && <CloseButton size="sm" aria-label="Clear search" onClick={() => setQuery("")} />}
            />
          )}
          {headerAction}
        </Group>
      </Group>
      {cashOnly.length > 0 && (
        <Alert color="yellow" p="xs" mb="sm">
          {cashOnly.reduce((n, s) => n + s.cash_only, 0)} trades came from the cash statement only, which has no bonus
          shares, so share counts may be short. Import the securities statement (Sao kê giao dịch chứng khoán) to add
          them; it takes over these trades without counting them twice.
        </Alert>
      )}
      {held.length > 0 && (
        <ResponsiveList
          table={
            <Table.ScrollContainer minWidth={1000}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    {header("Symbol", "symbol", false)}
                    {header("Shares", "shares")}
                    {header("Avg cost", "avg")}
                    {header(
                      <Tooltip label="Average cost minus the cash dividends received, as Pinetree shows it (TB)">
                        <span>After dividends</span>
                      </Tooltip>,
                      "netAvg",
                    )}
                    {header("Price", "price")}
                    {header("Day", "day")}
                    {header(
                      <Tooltip label="Shares × avg cost after dividends (Pinetree: Giá trị ban đầu)">
                        <span>Initial value</span>
                      </Tooltip>,
                      "initial",
                    )}
                    {header(
                      <Tooltip label="Shares × current price (Pinetree: Giá trị thị trường)">
                        <span>Market value</span>
                      </Tooltip>,
                      "value",
                    )}
                    {header("Profit/loss", "profit")}
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {held.map((s) => {
                    const quote = quotes[s.symbol];
                    return (
                      <Table.Tr key={s.id}>
                        <Table.Td fw={600}>{s.symbol}</Table.Td>
                        <Table.Td ta="right">{shares(s.shares)}</Table.Td>
                        <Table.Td ta="right">
                          <AvgCost s={s} value={s.avg_price} />
                        </Table.Td>
                        <Table.Td ta="right">
                          <AvgCost s={s} value={s.net_avg_price} />
                        </Table.Td>
                        <Table.Td ta="right">{quote ? fmt(quote.price, "VND", true) : "—"}</Table.Td>
                        <Table.Td ta="right">
                          <DayChange quote={quote} />
                        </Table.Td>
                        <Table.Td ta="right" title={initialValue(s) != null ? full(initialValue(s)!) : undefined}>
                          {initialValue(s) != null ? fmt(initialValue(s)!, "VND", true) : "—"}
                        </Table.Td>
                        <Table.Td ta="right" title={quote ? full(quote.price * s.shares) : undefined}>
                          {quote ? fmt(quote.price * s.shares, "VND", true) : "—"}
                        </Table.Td>
                        <Table.Td ta="right">
                          {quote && initialValue(s) != null && (
                            <ProfitLoss cost={initialValue(s)!} value={quote.price * s.shares} compact />
                          )}
                        </Table.Td>
                        <Table.Td>
                          <RowActions label={s.symbol} onView={() => onView(s)} onDelete={() => remove(s)} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr fw={700}>
                    <Table.Td>Total</Table.Td>
                    <Table.Td colSpan={5} />
                    <Table.Td ta="right">{full(totalInitial)}</Table.Td>
                    <Table.Td ta="right">{full(totalValue)}</Table.Td>
                    <Table.Td ta="right">
                      <ProfitLoss cost={trackedInitial} value={trackedValue} compact />
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          }
          cards={held.map((s) => {
            const quote = quotes[s.symbol];
            return (
              <MobileRow
                key={s.id}
                title={s.symbol}
                subtitle={
                  <>
                    {shares(s.shares)} × {quote ? fmt(quote.price, "VND", true) : "—"} <DayChange quote={quote} />
                  </>
                }
                value={quote ? fmt(quote.price * s.shares, "VND", true) : "—"}
                detail={
                  quote && initialValue(s) != null ? (
                    <ProfitLoss cost={initialValue(s)!} value={quote.price * s.shares} compact />
                  ) : undefined
                }
                onView={() => onView(s)}
                onDelete={() => remove(s)}
              />
            );
          })}
        />
      )}
      {allHeld.length > 0 && held.length === 0 && (
        <Text size="sm" c="dimmed">
          No stocks held match "{query.trim()}".
        </Text>
      )}

      <TransactionForm symbols={rows.map((s) => s.symbol)} run={run} />

      {soldOut.length > 0 && (
        <Paper withBorder radius="md" p="sm" mt="md">
          <Text size="sm" fw={600} mb={6}>
            Sold out{" "}
            <Text span size="xs" c="dimmed" fw={400}>
              · total profit: sales + cash dividends
            </Text>
          </Text>
          <Group gap="xs">
            {soldOut.map((s) => (
              <Paper key={s.id} withBorder radius="md" px="xs" py={4}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {s.symbol}
                  </Text>
                  <Tooltip
                    label={
                      s.realised == null
                        ? "A sale or buy has no price, so the profit isn't known."
                        : `Sales ${fmt(s.realised, "VND")} + dividends ${fmt(dividendsOf(s), "VND")}`
                    }
                  >
                    <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {s.realised == null ? (
                        <Text span inherit c="dimmed">
                          P/L —
                        </Text>
                      ) : (
                        <ProfitLoss cost={0} value={s.realised + dividendsOf(s)} compact />
                      )}
                    </Text>
                  </Tooltip>
                  <RowActions label={s.symbol} onView={() => onView(s)} onDelete={() => remove(s)} />
                </Group>
              </Paper>
            ))}
          </Group>
        </Paper>
      )}
    </section>
  );
}
