import { useState } from "react";
import { Alert, Badge, Button, Loader, Modal, Stack, Table, Text } from "@mantine/core";
import { importsApi, type ImportRecord } from "./api";
import { dmy, dmyTime } from "./format";

// Lists the statement files imported so far, with the period each covers, and sums up which time ranges each
// statement type covers overall, so gaps (a month never imported) are easy to spot.

const NAMES = { securities: "Securities", cash: "Cash" } as const;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Periods merged where they overlap or touch, oldest first.
function coverage(records: ImportRecord[]): { from: string; to: string }[] {
  const periods = records
    .filter((r) => r.period_from && r.period_to)
    .map((r) => ({ from: r.period_from!, to: r.period_to! }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const merged: { from: string; to: string }[] = [];
  for (const p of periods) {
    const last = merged.at(-1);
    if (last && p.from <= nextDay(last.to)) {
      if (p.to > last.to) last.to = p.to;
    } else merged.push({ ...p });
  }
  return merged;
}

export function ImportHistory() {
  const [opened, setOpened] = useState(false);
  const [records, setRecords] = useState<ImportRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setOpened(true);
    setError(null);
    try {
      setRecords(await importsApi.list());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <Button size="compact-sm" variant="default" onClick={open}>
        History
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Import history" size="xl">
        {error && <Alert color="red">{error}</Alert>}
        {!records && !error && <Loader size="sm" />}
        {records?.length === 0 && (
          <Text size="sm" c="dimmed">
            No statements imported yet.
          </Text>
        )}
        {records && records.length > 0 && (
          <Stack gap="sm">
            <Stack gap={4}>
              {(["securities", "cash"] as const).map((kind) => {
                const ranges = coverage(records.filter((r) => r.statement === kind));
                return (
                  <Text key={kind} size="sm">
                    <Text span fw={600}>
                      {NAMES[kind]} statement covers:
                    </Text>{" "}
                    {ranges.length === 0 ? (
                      <Text span c="dimmed">
                        nothing imported yet
                      </Text>
                    ) : (
                      ranges.map((r) => `${dmy(r.from)} – ${dmy(r.to)}`).join(", ")
                    )}
                    {ranges.length > 1 && (
                      <Text span c="orange">
                        {" "}
                        (gaps between these periods)
                      </Text>
                    )}
                  </Text>
                );
              })}
            </Stack>

            <Table.ScrollContainer minWidth={640} maxHeight={400}>
              <Table striped verticalSpacing={6} stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Imported</Table.Th>
                    <Table.Th>Statement</Table.Th>
                    <Table.Th>Period</Table.Th>
                    <Table.Th>File</Table.Th>
                    <Table.Th ta="right">Rows</Table.Th>
                    <Table.Th ta="right">Changes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {records.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>{dmyTime(r.imported_at)}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={r.statement === "cash" ? "teal" : "blue"} miw="max-content">
                          {r.broker} · {NAMES[r.statement]}
                        </Badge>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {r.period_from || r.period_to ? `${dmy(r.period_from)} – ${dmy(r.period_to)}` : "—"}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" truncate maw={220} title={r.file_name ?? undefined}>
                          {r.file_name ?? "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">{r.rows}</Table.Td>
                      <Table.Td ta="right">{r.changes}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="xs" c="dimmed">
              Rows: share movements in a securities statement, trades and cash dividends in a cash statement. Changes:
              what that import saved (both files of one import share it).
            </Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}
