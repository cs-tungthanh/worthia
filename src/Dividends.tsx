import { useState } from "react";
import { NumberInput, Select, SimpleGrid, Table, Title } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { dividendsApi, type Dividend, type Stock } from "./api";
import { DATE_INPUT_FORMAT } from "./config";
import { useMoney } from "./currency";
import { dmy } from "./format";
import { FormButtons, MobileRow, ResponsiveList, RowActions, today, vndInput, type SectionProps } from "./ui";

// Cash dividends. Bonus shares (stock dividends) are transactions of their own: see TransactionForm.

type DividendForm = { stock_id: string | null; amount: number | string; paid_date: string | null };

export function DividendsSection({ rows, stocks, run }: SectionProps<Dividend> & { stocks: Stock[] }) {
  const [editing, setEditing] = useState<Dividend | null>(null);
  const { fmt } = useMoney();
  const form = useForm<DividendForm>({
    initialValues: { stock_id: null, amount: "", paid_date: today() },
    validate: {
      stock_id: (v) => (v ? null : "Required"),
      amount: (v) => (v === "" ? "Required" : null),
      paid_date: (v) => (v ? null : "Required"),
    },
  });

  const stockById = new Map(stocks.map((s) => [s.id, s]));
  const symbol = (id: number) => stockById.get(id)?.symbol ?? "Deleted";
  // Stocks still held first, then sold-out ones (their past dividends can be recorded too).
  const options = [...stocks].sort(
    (a, b) => Number(b.shares > 0) - Number(a.shares > 0) || a.symbol.localeCompare(b.symbol),
  );

  const startEdit = (d: Dividend | null) => {
    setEditing(d);
    if (d) form.setValues({ stock_id: String(d.stock_id), amount: d.cash_amount ?? "", paid_date: d.paid_date });
    else form.reset();
  };

  const submit = (v: DividendForm) => {
    const body = {
      stock_id: Number(v.stock_id),
      type: "cash" as const,
      cash_amount: Number(v.amount),
      shares: null,
      paid_date: v.paid_date!,
    };
    run(editing ? dividendsApi.update(editing.id, body) : dividendsApi.create(body));
    startEdit(null);
  };

  if (stocks.length === 0) return null;

  return (
    <section>
      <Title order={2} size="h4" mt="xl" mb="sm">
        Cash dividends
      </Title>
      {rows.length > 0 && (
        <ResponsiveList
          table={
            <Table.ScrollContainer minWidth={480} maxHeight={360}>
              <Table striped highlightOnHover verticalSpacing="xs" stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Stock</Table.Th>
                    <Table.Th ta="right">Received</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((d) => (
                    <Table.Tr key={d.id}>
                      <Table.Td>{dmy(d.paid_date)}</Table.Td>
                      <Table.Td fw={600}>{symbol(d.stock_id)}</Table.Td>
                      <Table.Td ta="right">{fmt(d.cash_amount ?? 0, "VND", true)}</Table.Td>
                      <Table.Td>
                        <RowActions
                          label={`${symbol(d.stock_id)} dividend ${dmy(d.paid_date)}`}
                          onEdit={() => startEdit(d)}
                          onDelete={() => confirm("Delete this dividend?") && run(dividendsApi.remove(d.id))}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          }
          cards={rows.map((d) => (
            <MobileRow
              key={d.id}
              title={symbol(d.stock_id)}
              label={`${symbol(d.stock_id)} dividend ${dmy(d.paid_date)}`}
              subtitle={dmy(d.paid_date)}
              value={fmt(d.cash_amount ?? 0, "VND", true)}
              onEdit={() => startEdit(d)}
              onDelete={() => confirm("Delete this dividend?") && run(dividendsApi.remove(d.id))}
            />
          ))}
        />
      )}
      <form onSubmit={form.onSubmit(submit)}>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="sm">
          <Select
            placeholder="Stock"
            searchable
            data={options.map((s) => ({ value: String(s.id), label: s.shares > 0 ? s.symbol : `${s.symbol} (sold)` }))}
            {...form.getInputProps("stock_id")}
          />
          <NumberInput
            placeholder="Amount (VND)"
            {...vndInput}
            allowDecimal={false}
            hideControls
            {...form.getInputProps("amount")}
          />
          <DateInput placeholder="Date" valueFormat={DATE_INPUT_FORMAT} {...form.getInputProps("paid_date")} />
          <FormButtons editing={!!editing} addLabel="Add dividend" onCancel={() => startEdit(null)} />
        </SimpleGrid>
      </form>
    </section>
  );
}
