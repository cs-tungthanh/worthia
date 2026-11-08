import type { ReactNode } from "react";
import { Alert, Group, Paper, Table, Text, Title, Tooltip } from "@mantine/core";
import { stocksApi, type Dividend, type Quote, type Stock } from "./api";
import { useMoney } from "./currency";
import { TransactionForm } from "./TransactionForm";
import { DayChange, MobileRow, ProfitLoss, ResponsiveList, RowActions, type SectionProps } from "./ui";

// Holdings are computed from transactions (buys, sells, bonus shares); they're changed by adding or editing
// transactions, not by typing totals. A holding's average cost is the broker-style moving average, fees included.
export type Holding = Stock;

const shares = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

function AvgCost({ s }: { s: Holding }) {
  const { fmt } = useMoney();
  if (s.avg_price != null) return <>{fmt(s.avg_price, "VND", true)}</>;
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
  const held = rows.filter((s) => s.shares > 0);
  const soldOut = rows.filter((s) => s.shares === 0);
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
        {headerAction}
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
            <Table.ScrollContainer minWidth={760}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Symbol</Table.Th>
                    <Table.Th ta="right">Shares</Table.Th>
                    <Table.Th ta="right">Avg cost</Table.Th>
                    <Table.Th ta="right">Price</Table.Th>
                    <Table.Th ta="right">Day</Table.Th>
                    <Table.Th ta="right">Value</Table.Th>
                    <Table.Th ta="right">Profit/loss</Table.Th>
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
                          <AvgCost s={s} />
                        </Table.Td>
                        <Table.Td ta="right">{quote ? fmt(quote.price, "VND", true) : "—"}</Table.Td>
                        <Table.Td ta="right">
                          <DayChange quote={quote} />
                        </Table.Td>
                        <Table.Td ta="right">{quote ? fmt(quote.price * s.shares, "VND", true) : "—"}</Table.Td>
                        <Table.Td ta="right">
                          {quote && s.cost != null && (
                            <ProfitLoss cost={s.cost} value={quote.price * s.shares} compact />
                          )}
                        </Table.Td>
                        <Table.Td>
                          <RowActions label={s.symbol} onView={() => onView(s)} onDelete={() => remove(s)} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
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
                  quote && s.cost != null ? (
                    <ProfitLoss cost={s.cost} value={quote.price * s.shares} compact />
                  ) : undefined
                }
                onView={() => onView(s)}
                onDelete={() => remove(s)}
              />
            );
          })}
        />
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
