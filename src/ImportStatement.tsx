import { useRef, useState } from "react";
import { Alert, Badge, Button, FileButton, Group, List, Modal, Stack, Table, Text } from "@mantine/core";
import { dividendsApi, movementsApi, stocksApi, type Dividend, type Movement, type Stock } from "./api";
import { useMoney } from "./currency";
import { parsePinetree, type Statement } from "./import/pinetree";
import { isPinetreeCash, parsePinetreeCash, type CashStatement } from "./import/pinetreeCash";
import { planImport, type SymbolPlan } from "./import/plan";
import { readFirstSheet } from "./import/xlsx";

// Imports Pinetree statements (.xlsx): the securities statement (share movements) and/or the cash statement
// (trade prices, fees, tax, cash dividends). Files are read in the browser and never uploaded; only the
// resulting movements and dividends are saved, after the user reviews them.

const shares = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "?");

type Files = { securities: Statement | null; cash: CashStatement | null };

function status(p: SymbolPlan): { label: string; color: string } {
  if (!p.before) return { label: "New", color: "teal" };
  if (p.touched) return { label: "Update", color: "blue" };
  return { label: "No change", color: "gray" };
}

export function ImportStatement({ onImported }: { onImported: () => Promise<unknown> }) {
  const { fmt } = useMoney();
  const [files, setFiles] = useState<Files | null>(null);
  const [context, setContext] = useState<{ saved: Movement[]; stocks: Stock[]; dividends: Dividend[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Clears the file input after each pick: browsers don't report choosing the same file again otherwise.
  const resetFile = useRef<() => void>(null);

  // The preview compares the files with what's saved now, so it's reloaded after importing.
  const loadContext = async () => {
    const [saved, stocks, dividends] = await Promise.all([movementsApi.list(), stocksApi.list(), dividendsApi.list()]);
    setContext({ saved, stocks, dividends });
  };

  const plan = files && context ? planImport({ ...files, ...context }) : null;

  const open = async (picked: File[]) => {
    if (!picked.length) return;
    setError(null);
    setDone(null);
    try {
      const next: Files = { securities: null, cash: null };
      for (const f of picked) {
        const rows = readFirstSheet(new Uint8Array(await f.arrayBuffer()));
        if (isPinetreeCash(rows)) next.cash = parsePinetreeCash(rows);
        else next.securities = parsePinetree(rows);
      }
      await loadContext();
      setFiles(next);
    } catch (e) {
      setFiles(null);
      setError((e as Error).message);
    } finally {
      resetFile.current?.();
    }
  };

  const close = () => {
    setFiles(null);
    setError(null);
    setDone(null);
  };

  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await movementsApi.importMany({
        movements: plan.movements,
        cashMovements: plan.cashMovements,
        remove: plan.remove,
        dividends: plan.dividends,
      });
      await onImported();
      await loadContext();
      const missing = plan.counts.stillUnpriced;
      setDone(
        `Imported ${plan.changes} ${plan.changes === 1 ? "change" : "changes"}.` +
          (missing
            ? ` ${missing} ${missing === 1 ? "buy or sell has" : "buys or sells have"} no price yet; import the cash statement too, or add the price in the stock's lifecycle.`
            : "") +
          (result.warnings.length ? ` ${result.warnings.join(" ")}` : ""),
      );
    } catch (e) {
      setError(`Import stopped: ${(e as Error).message}. Importing the same files again finishes the rest.`);
    } finally {
      setBusy(false);
    }
  };

  // Stocks held before or after, plus any touched by this import.
  const shown = plan?.symbols.filter((p) => p.after.shares > 0 || (p.before?.shares ?? 0) > 0 || p.touched) ?? [];
  const avg = (v: number | null | undefined) => (v == null ? "—" : fmt(v, "VND", true));
  const change = (a: string, b: string) =>
    a === b ? (
      b
    ) : (
      <>
        <Text span c="dimmed" td="line-through">
          {a}
        </Text>{" "}
        {b}
      </>
    );

  return (
    <>
      <FileButton
        resetRef={resetFile}
        onChange={open}
        multiple
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      >
        {(props) => (
          <Button {...props} size="compact-sm" variant="default">
            Import statements
          </Button>
        )}
      </FileButton>

      {error && !files && (
        <Alert color="red" mt="sm" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Modal opened={!!files} onClose={close} title="Import statements" size="xl">
        {files && plan && (
          <Stack gap="sm">
            <List size="sm" c="dimmed" spacing={2}>
              {files.securities && (
                <List.Item>
                  Securities statement, {dmy(files.securities.from)} to {dmy(files.securities.to)}:{" "}
                  {files.securities.movements.length} share movements.
                </List.Item>
              )}
              {files.cash && (
                <List.Item>
                  Cash statement, {dmy(files.cash.from)} to {dmy(files.cash.to)}: {files.cash.trades.length} trades and{" "}
                  {files.cash.dividends.length} cash dividends ({files.cash.skipped} deposits, fees and loans aren't
                  needed).
                </List.Item>
              )}
              {!files.cash && (
                <List.Item>
                  Add the cash statement (Sao kê giao dịch tiền) for real trade prices, fees and cash dividends.
                </List.Item>
              )}
              {!files.securities && (
                <List.Item>
                  Without the securities statement, trades become transactions dated by trade day, and prices fill in
                  any transactions saved by an earlier import.
                </List.Item>
              )}
            </List>

            {error && <Alert color="red">{error}</Alert>}
            {done && <Alert color="teal">{done}</Alert>}

            <Text size="sm">
              {plan.counts.newMovements} new transactions · {plan.counts.pricesFilled} prices filled in ·{" "}
              {plan.counts.newDividends} cash dividends
              {plan.counts.replaced > 0 && (
                <> · {plan.counts.replaced} cash-statement trades replaced by securities rows</>
              )}
            </Text>

            <Table.ScrollContainer minWidth={620} maxHeight={360}>
              <Table verticalSpacing={6} striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Stock</Table.Th>
                    <Table.Th ta="right">Shares</Table.Th>
                    <Table.Th ta="right">Avg cost</Table.Th>
                    <Table.Th ta="right">Realised P/L</Table.Th>
                    <Table.Th w={110}>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((p) => {
                    const s = status(p);
                    return (
                      <Table.Tr key={p.symbol}>
                        <Table.Td fw={600}>{p.symbol}</Table.Td>
                        <Table.Td ta="right">
                          {change(p.before ? shares(p.before.shares) : "—", shares(p.after.shares))}
                        </Table.Td>
                        <Table.Td ta="right">{change(avg(p.before?.avg), avg(p.after.avgCost))}</Table.Td>
                        <Table.Td ta="right">
                          {p.after.realised == null ? "—" : fmt(p.after.realised, "VND", true)}
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={s.color} miw="max-content">
                            {s.label}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {plan.missingBonus && (
              <Alert color="yellow" p="xs">
                Bonus shares (stock dividends) are only in the securities statement (Sao kê giao dịch chứng khoán).
                Import it too, now or later, to add them; it replaces these trades with its own rows, keeping their
                prices.
              </Alert>
            )}
            {plan.overSold.length > 0 && (
              <Text size="sm" c="orange">
                {plan.overSold.join(", ")}: more shares sold than bought, usually because bonus shares are missing.
                Their share counts and profit are incomplete until the securities statement is imported.
              </Text>
            )}
            {plan.rights.length > 0 && (
              <Text size="sm" c="dimmed">
                Rights subscriptions ({plan.rights.join(", ")}) aren't imported; the shares, if any, arrive in the
                securities statement.
              </Text>
            )}

            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={close}>
                {done ? "Close" : "Cancel"}
              </Button>
              {!done && (
                <Button onClick={confirm} loading={busy} disabled={plan.changes === 0}>
                  {plan.changes === 0
                    ? "Already up to date"
                    : `Import ${plan.changes} ${plan.changes === 1 ? "change" : "changes"}`}
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
