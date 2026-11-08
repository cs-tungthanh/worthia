import { useState } from "react";
import {
  ActionIcon,
  Autocomplete,
  Button,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { CURRENCIES, favouriteBanksApi, savingsApi, type Saving } from "./api";
import { PREDEFINED_BANKS, TERM_SUGGESTIONS } from "./config";
import { useMoney } from "./currency";
import {
  cell,
  FormButtons,
  MobileRow,
  ResponsiveList,
  RowActions,
  toNumber,
  today,
  vndInput,
  type SectionProps,
} from "./ui";

// Same day N months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb), as banks do.
function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const daysUntil = (isoDate: string) => Math.round((Date.parse(isoDate) - Date.parse(today())) / 86_400_000);

function Maturity({ saving }: { saving: Saving }) {
  if (!saving.start_date || !saving.term_months) return null;
  const date = addMonths(saving.start_date, saving.term_months);
  return (
    <Text span inherit c={daysUntil(date) < 0 ? "dimmed" : undefined}>
      {date}
    </Text>
  );
}

// The deposit's own amount, shown under the converted one when the display currency differs.
function OriginalAmount({ amount, currency }: { amount: number; currency: string }) {
  const money = useMoney();
  if (currency === money.currency || money.convert(amount, currency) == null) return null;
  return (
    <Text span size="xs" c="dimmed" display="block" fw={400}>
      {cell(amount, currency)}
    </Text>
  );
}

const termLabel = (months: number | null) => (months ? `${months} ${months === 1 ? "month" : "months"}` : "No term");

// Simple interest paid at maturity: amount × annual rate × term in years. Banks count actual days, so this is an estimate.
const interestAtMaturity = (s: Saving) =>
  s.interest_rate != null && s.term_months ? Math.round((s.amount * s.interest_rate * s.term_months) / 100 / 12) : null;

type SavingForm = {
  bank: string;
  amount: number | string;
  currency: string;
  interest_rate: number | string;
  start_date: string | null;
  term_months: string;
};

const emptyForm: SavingForm = {
  bank: "",
  amount: "",
  currency: "VND",
  interest_rate: "",
  start_date: today(),
  term_months: "",
};

export function SavingsSection({ rows, favourites, run }: SectionProps<Saving> & { favourites: string[] }) {
  const [editing, setEditing] = useState<Saving | null>(null);
  const { fmt } = useMoney();
  const form = useForm<SavingForm>({
    initialValues: emptyForm,
    validate: {
      bank: (v) => (v.trim() ? null : "Required"),
      amount: (v) => (v === "" ? "Required" : null),
    },
  });

  const banks = [...new Set([...favourites, ...PREDEFINED_BANKS, ...rows.map((s) => s.bank)])];

  // Deposits use the supported currencies. A deposit saved earlier in another currency keeps it while being edited.
  const currencies: string[] = [...CURRENCIES];
  if (editing && !currencies.includes(editing.currency)) currencies.push(editing.currency);

  // Reuse a known spelling when the typed name matches one ignoring case, so "vietcombank" isn't a new bank.
  const canonicalBank = (typed: string) => {
    const name = typed.trim();
    return banks.find((b) => b.toLowerCase() === name.toLowerCase()) ?? name;
  };
  const bank = canonicalBank(form.values.bank);
  const isFavourite = favourites.includes(bank);

  const startEdit = (s: Saving | null) => {
    setEditing(s);
    if (s)
      form.setValues({
        bank: s.bank,
        amount: s.amount,
        currency: s.currency,
        interest_rate: s.interest_rate ?? "",
        start_date: s.start_date,
        term_months: s.term_months ? String(s.term_months) : "",
      });
    else form.reset();
  };

  const submit = (v: SavingForm) => {
    const body = {
      bank: canonicalBank(v.bank),
      amount: Number(v.amount),
      currency: v.currency.trim().toUpperCase() || "VND",
      interest_rate: toNumber(v.interest_rate),
      start_date: v.start_date || null,
      term_months: v.term_months ? Number(v.term_months) : null,
    };
    run(editing ? savingsApi.update(editing.id, body) : savingsApi.create(body));
    startEdit(null);
  };

  return (
    <section>
      <Title order={2} size="h4" mt="xl" mb="sm">
        Savings accounts
      </Title>
      {rows.length > 0 && (
        <ResponsiveList
          table={
            <Table.ScrollContainer minWidth={760}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Bank</Table.Th>
                    <Table.Th ta="right">Amount</Table.Th>
                    <Table.Th ta="right">Rate</Table.Th>
                    <Table.Th ta="right">Term</Table.Th>
                    <Table.Th>Start</Table.Th>
                    <Table.Th>Matures</Table.Th>
                    <Table.Th ta="right">Est. interest</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((s) => {
                    const interest = interestAtMaturity(s);
                    return (
                      <Table.Tr key={s.id}>
                        <Table.Td fw={600}>{s.bank}</Table.Td>
                        <Table.Td ta="right">
                          {fmt(s.amount, s.currency, true)}
                          <OriginalAmount amount={s.amount} currency={s.currency} />
                        </Table.Td>
                        <Table.Td ta="right">{s.interest_rate != null ? `${s.interest_rate}%` : ""}</Table.Td>
                        <Table.Td ta="right">{termLabel(s.term_months)}</Table.Td>
                        <Table.Td>{s.start_date}</Table.Td>
                        <Table.Td>
                          <Maturity saving={s} />
                        </Table.Td>
                        <Table.Td ta="right">{interest != null ? fmt(interest, s.currency, true) : ""}</Table.Td>
                        <Table.Td>
                          <RowActions
                            label={s.bank}
                            onEdit={() => startEdit(s)}
                            onDelete={() => confirm(`Delete ${s.bank}?`) && run(savingsApi.remove(s.id))}
                          />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          }
          cards={rows.map((s) => {
            const interest = interestAtMaturity(s);
            return (
              <MobileRow
                key={s.id}
                title={s.bank}
                subtitle={
                  <>
                    {[s.interest_rate != null ? `${s.interest_rate}%` : null, termLabel(s.term_months)]
                      .filter(Boolean)
                      .join(" · ")}
                    {s.start_date && s.term_months ? (
                      <>
                        {" "}
                        · <Maturity saving={s} />
                      </>
                    ) : null}
                  </>
                }
                value={
                  <>
                    {fmt(s.amount, s.currency, true)}
                    <OriginalAmount amount={s.amount} currency={s.currency} />
                  </>
                }
                detail={interest != null ? `+${fmt(interest, s.currency, true)}` : undefined}
                onEdit={() => startEdit(s)}
                onDelete={() => confirm(`Delete ${s.bank}?`) && run(savingsApi.remove(s.id))}
              />
            );
          })}
        />
      )}
      <form onSubmit={form.onSubmit(submit)}>
        {favourites.length > 0 && (
          <Group gap={6} mt="sm">
            {favourites.map((f) => (
              <Button
                key={f}
                size="compact-sm"
                radius="xl"
                variant={f === bank ? "light" : "default"}
                onClick={() => form.setFieldValue("bank", f)}
              >
                {f}
              </Button>
            ))}
          </Group>
        )}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="sm">
          <Autocomplete
            placeholder="Bank"
            data={banks}
            renderOption={({ option }) => (favourites.includes(option.value) ? `★ ${option.value}` : option.value)}
            rightSectionPointerEvents="all"
            rightSection={
              <ActionIcon
                variant="subtle"
                aria-label={isFavourite ? "Remove favourite" : "Add favourite"}
                aria-pressed={isFavourite}
                disabled={!bank}
                onClick={() => run(isFavourite ? favouriteBanksApi.remove(bank) : favouriteBanksApi.add(bank))}
              >
                {isFavourite ? "★" : "☆"}
              </ActionIcon>
            }
            {...form.getInputProps("bank")}
          />
          <NumberInput
            placeholder="Amount"
            {...vndInput}
            allowDecimal={false}
            hideControls
            {...form.getInputProps("amount")}
          />
          <Select
            placeholder="Currency"
            aria-label="Currency"
            data={currencies}
            allowDeselect={false}
            checkIconPosition="right"
            {...form.getInputProps("currency")}
          />
          <NumberInput
            placeholder="Rate %"
            min={0}
            decimalScale={2}
            suffix="%"
            hideControls
            {...form.getInputProps("interest_rate")}
          />
          <DateInput placeholder="Start" valueFormat="YYYY-MM-DD" {...form.getInputProps("start_date")} />
          <Autocomplete
            placeholder="Months"
            data={TERM_SUGGESTIONS}
            {...form.getInputProps("term_months")}
            onChange={(v) => form.setFieldValue("term_months", v.replace(/\D/g, "").replace(/^0+/, ""))}
          />
          <FormButtons editing={!!editing} addLabel="Add deposit" onCancel={() => startEdit(null)} />
        </SimpleGrid>
      </form>
    </section>
  );
}
