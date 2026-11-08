import { useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  FileButton,
  Group,
  List,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  dividendsApi,
  importsApi,
  movementsApi,
  stocksApi,
  type Dividend,
  type ImportFile,
  type Movement,
  type Stock,
} from "./api";
import { PINETREE_STATEMENTS } from "./config";
import { useMoney } from "./currency";
import { parsePinetree, type Statement } from "./import/pinetree";
import { isPinetreeCash, parsePinetreeCash, type CashStatement } from "./import/pinetreeCash";
import { type ImportPlan, planImport, type SymbolPlan } from "./import/plan";
import { readFirstSheet } from "./import/xlsx";

// Imports Pinetree statements (.xlsx): the securities statement (share movements) and/or the cash statement
// (trade prices, fees, tax, cash dividends). Files are read in the browser and never uploaded; only the
// resulting movements and dividends are saved, after the user reviews them.

const shares = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "?");

type Files = {
  securities: Statement | null;
  cash: CashStatement | null;
  names: { securities?: string; cash?: string }; // file names, for the import history
};

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="sm">
      <ThemeIcon radius="xl" size="md" variant="light">
        <Text size="sm" fw={700}>
          {n}
        </Text>
      </ThemeIcon>
      <Box style={{ flex: 1 }}>{children}</Box>
    </Group>
  );
}

// Each statement holds half of the timeline, so the preview asks for whichever one is missing.
function missingStatement(files: Files, plan: ImportPlan): { name: string; why: string; url: string } | null {
  if (!files.securities && plan.missingBonus)
    return {
      name: "securities statement",
      url: PINETREE_STATEMENTS.securities.url,
      why:
        "Bonus shares (Nhận số dư chứng khoán chuyển từ chờ giao dịch sang giao dịch) appear only in Sao kê giao dịch " +
        "chứng khoán, so they'll be missing and some holdings may show more shares sold than bought. You can also " +
        "import it later; it merges with these trades without counting them twice.",
    };
  if (!files.cash && plan.counts.stillUnpriced > 0)
    return {
      name: "cash statement",
      url: PINETREE_STATEMENTS.cash.url,
      why:
        "Trade prices, fees, tax and cash dividends appear only in Sao kê giao dịch tiền, so these buys and sales " +
        "will have no price, and cost and profit stay unknown until it's imported.",
    };
  return null;
}

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
  // The download-and-upload guide shown before any file is picked, with the end of each statement's last
  // imported period (so the user knows where to start the next download).
  const [guide, setGuide] = useState(false);
  const [lastTo, setLastTo] = useState<{ securities?: string; cash?: string }>({});
  const [dragging, setDragging] = useState(false);
  // Clears the file input after each pick: browsers don't report choosing the same file again otherwise.
  const resetFile = useRef<() => void>(null);
  const resetAdd = useRef<() => void>(null);

  // The preview compares the files with what's saved now, so it's reloaded after importing.
  const loadContext = async () => {
    const [saved, stocks, dividends] = await Promise.all([movementsApi.list(), stocksApi.list(), dividendsApi.list()]);
    setContext({ saved, stocks, dividends });
  };

  const plan = files && context ? planImport({ ...files, ...context }) : null;
  const missing = files && plan ? missingStatement(files, plan) : null;

  // `base`: files already open in the preview, when adding the other statement to them.
  const open = async (picked: File[], base: Files | null = null) => {
    if (!picked.length) return;
    setError(null);
    setDone(null);
    try {
      const next: Files = base ? { ...base, names: { ...base.names } } : { securities: null, cash: null, names: {} };
      for (const f of picked) {
        const rows = readFirstSheet(new Uint8Array(await f.arrayBuffer()));
        if (isPinetreeCash(rows)) {
          next.cash = parsePinetreeCash(rows);
          next.names.cash = f.name;
        } else {
          next.securities = parsePinetree(rows);
          next.names.securities = f.name;
        }
      }
      await loadContext();
      setFiles(next);
      setGuide(false);
    } catch (e) {
      if (!base) setFiles(null);
      setError((e as Error).message);
    } finally {
      resetFile.current?.();
      resetAdd.current?.();
    }
  };

  const openGuide = async () => {
    setError(null);
    setGuide(true);
    try {
      const history = await importsApi.list();
      const latest = (kind: "securities" | "cash") =>
        history
          .filter((r) => r.statement === kind && r.period_to)
          .map((r) => r.period_to!)
          .sort()
          .at(-1);
      setLastTo({ securities: latest("securities"), cash: latest("cash") });
    } catch {
      setLastTo({}); // the guide works without it
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const picked = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
    if (picked.length) open(picked);
    else setError("Drop the statements as Excel files (.xlsx), as Pinetree exports them.");
  };

  const close = () => {
    setFiles(null);
    setError(null);
    setDone(null);
  };

  // The files behind this import and the period each covers, for the import history.
  const historyFiles = (f: Files): ImportFile[] => [
    ...(f.securities
      ? [
          {
            statement: "securities" as const,
            broker: f.securities.broker,
            file_name: f.names.securities ?? null,
            from: f.securities.from,
            to: f.securities.to,
            rows: f.securities.movements.length,
          },
        ]
      : []),
    ...(f.cash
      ? [
          {
            statement: "cash" as const,
            broker: f.cash.broker,
            file_name: f.names.cash ?? null,
            from: f.cash.from,
            to: f.cash.to,
            rows: f.cash.trades.length + f.cash.dividends.length,
          },
        ]
      : []),
  ];

  const confirm = async () => {
    if (!plan || !files) return;
    setBusy(true);
    setError(null);
    try {
      const result = await movementsApi.importMany({
        movements: plan.movements,
        cashMovements: plan.cashMovements,
        remove: plan.remove,
        dividends: plan.dividends,
        files: historyFiles(files),
        changes: plan.changes,
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
      <Button size="compact-sm" variant="default" onClick={openGuide}>
        Import statements
      </Button>

      <Modal opened={guide && !files} onClose={() => setGuide(false)} title="Import Pinetree statements" size="lg">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Worthia needs both statements for a complete timeline. Download them from Pinetree as Excel files, then
            upload them here. The files are read in your browser and never uploaded to a server.
          </Text>

          {(["securities", "cash"] as const).map((kind, i) => (
            <Step key={kind} n={i + 1}>
              <Text size="sm" fw={600}>
                Download the {kind === "securities" ? "securities" : "cash"} statement (
                {PINETREE_STATEMENTS[kind].title})
              </Text>
              <Text size="sm" c="dimmed">
                It has your {PINETREE_STATEMENTS[kind].what}. Sign in to Pinetree, choose the period, and export it to
                Excel (.xlsx).
                {lastTo[kind] && <> Your last import of it ran to {dmy(lastTo[kind]!)}.</>}
              </Text>
              <Anchor href={PINETREE_STATEMENTS[kind].url} target="_blank" rel="noopener noreferrer" size="sm">
                Open {kind === "securities" ? "securities" : "cash"} statement on Pinetree ↗
              </Anchor>
            </Step>
          ))}

          <Step n={3}>
            <Text size="sm" fw={600}>
              Upload both files
            </Text>
            <Text size="sm" c="dimmed" mb="xs">
              Pick them together, or one now and the other later. You'll see a preview before anything is saved, and
              importing a period again never counts anything twice, so overlapping periods are fine.
            </Text>
            <Paper
              withBorder
              radius="md"
              p="md"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
              style={{
                borderStyle: "dashed",
                borderColor: dragging ? "var(--mantine-color-blue-filled)" : undefined,
                background: dragging ? "var(--mantine-color-blue-light)" : undefined,
              }}
            >
              <Stack align="center" gap={6}>
                <FileButton resetRef={resetFile} onChange={open} multiple accept={XLSX}>
                  {(props) => <Button {...props}>Choose .xlsx files</Button>}
                </FileButton>
                <Text size="xs" c="dimmed">
                  or drop them here
                </Text>
              </Stack>
            </Paper>
          </Step>

          {error && (
            <Alert color="red" withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </Modal>

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
            </List>

            {missing && (
              <Alert color="yellow" title={`Add the ${missing.name} for a complete timeline`}>
                <Stack gap="xs" align="flex-start">
                  <Text size="sm">{missing.why}</Text>
                  <Anchor href={missing.url} target="_blank" rel="noopener noreferrer" size="sm">
                    Download it from Pinetree ↗
                  </Anchor>
                  <FileButton resetRef={resetAdd} onChange={(f) => f && open([f], files)} accept={XLSX}>
                    {(props) => (
                      <Button {...props} size="compact-sm" variant="light" color="yellow">
                        Add {missing.name}
                      </Button>
                    )}
                  </FileButton>
                </Stack>
              </Alert>
            )}

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
