import { Fragment, useState } from "react";
import {
  ActionIcon,
  Autocomplete,
  Button,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { CURRENCIES, favouriteBanksApi, savingsApi, type Saving } from "./api";
import { DATE_INPUT_FORMAT, PREDEFINED_BANKS, TERM_SUGGESTIONS } from "./config";
import { dmy } from "./format";
import { Money, useMoney } from "./currency";
import {
  FormButtons,
  MobileRow,
  ResponsiveList,
  RowActions,
  type Sort,
  SortHeader,
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

// Null without both a start date and a term.
const maturityDate = (s: Saving) => (s.start_date && s.term_months ? addMonths(s.start_date, s.term_months) : null);

function Maturity({ saving }: { saving: Saving }) {
  const date = maturityDate(saving);
  if (!date) return null;
  return (
    <Text span inherit c={daysUntil(date) < 0 ? "dimmed" : undefined}>
      {dmy(date)}
    </Text>
  );
}

// The deposit's own amount, shown under the converted one when the display currency differs.
function OriginalAmount({ amount, currency }: { amount: number; currency: string }) {
  const money = useMoney();
  if (currency === money.currency || money.convert(amount, currency) == null) return null;
  return (
    <Text span size="xs" c="dimmed" display="block" fw={400}>
      <Money amount={amount} from={currency} own />
    </Text>
  );
}

const termLabel = (months: number | null) => (months ? `${months} ${months === 1 ? "month" : "months"}` : "No term");

// Simple interest paid at maturity: amount × annual rate × term in years. Banks count actual days, so this is an estimate.
const interestAtMaturity = (s: Saving) =>
  s.interest_rate != null && s.term_months ? Math.round((s.amount * s.interest_rate * s.term_months) / 100 / 12) : null;

type SortKey = "bank" | "start" | "matures";

// Deposits in the current order, then by bank. A deposit without the sorted date goes last either way.
function sortSavings(rows: Saving[], sort: Sort<SortKey>) {
  const value = (s: Saving) => (sort.key === "bank" ? s.bank : sort.key === "start" ? s.start_date : maturityDate(s));
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    const c = x.localeCompare(y); // dates are YYYY-MM-DD, so text order is date order
    return (
      (sort.desc ? -c : c) ||
      a.bank.localeCompare(b.bank) ||
      (a.start_date ?? "").localeCompare(b.start_date ?? "") ||
      a.id - b.id
    );
  });
}

// Banks in the order their first deposit appears, so groups follow the chosen sort.
function groupByBank(rows: Saving[]) {
  const groups = new Map<string, Saving[]>();
  for (const s of rows) groups.set(s.bank, [...(groups.get(s.bank) ?? []), s]);
  return [...groups].map(([bank, items]) => ({ bank, items }));
}

// "Group by bank" is a per-browser preference; storage may be unavailable (private mode), so it's best effort.
const GROUP_PREF = "worthia:savings-group-by-bank";
const readGroupPref = () => {
  try {
    return localStorage.getItem(GROUP_PREF) === "1";
  } catch {
    return false;
  }
};
const writeGroupPref = (on: boolean) => {
  try {
    localStorage.setItem(GROUP_PREF, on ? "1" : "0");
  } catch {
    // keep the choice for this page only
  }
};

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
  const [sort, setSort] = useState<Sort<SortKey>>({ key: "bank", desc: false });
  const [grouped, setGrouped] = useState(readGroupPref);
  const { convert, currency } = useMoney();
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

  // Without grouping, one unnamed group holds every deposit, so the table renders the same way either way.
  const sorted = sortSavings(rows, sort);
  const groups = grouped ? groupByBank(sorted) : [{ bank: "", items: sorted }];
  const depositCount = (n: number) => `${n} ${n === 1 ? "deposit" : "deposits"}`;
  // A bank's total in the display currency; if a currency has no rate, its part is shown in that currency.
  const subtotal = (items: Saving[]) => {
    const byCurrency = new Map<string, number>();
    for (const s of items) byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + s.amount);
    const converted = [...byCurrency].map(([cur, amount]) => convert(amount, cur));
    if (converted.every((v) => v != null))
      return <Money amount={converted.reduce((n, v) => n + v!, 0)} from={currency} />;
    return [...byCurrency].map(([cur, amount], i) => (
      <Fragment key={cur}>
        {i > 0 && " + "}
        <Money amount={amount} from={cur} />
      </Fragment>
    ));
  };

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
      <Group justify="space-between" align="center" mt="xl" mb="sm">
        <Title order={2} size="h4">
          Savings accounts
        </Title>
        {rows.length > 0 && (
          <Switch
            label="Group by bank"
            checked={grouped}
            onChange={(e) => {
              setGrouped(e.currentTarget.checked);
              writeGroupPref(e.currentTarget.checked);
            }}
          />
        )}
      </Group>
      {rows.length > 0 && (
        <ResponsiveList
          table={
            <Table.ScrollContainer minWidth={760}>
              <Table striped={!grouped} highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <SortHeader label="Bank" k="bank" sort={sort} onSort={setSort} />
                    <Table.Th ta="right">Amount</Table.Th>
                    <Table.Th ta="right">Rate</Table.Th>
                    <Table.Th ta="right">Term</Table.Th>
                    <SortHeader label="Start" k="start" sort={sort} onSort={setSort} />
                    <SortHeader label="Matures" k="matures" sort={sort} onSort={setSort} />
                    <Table.Th ta="right">Est. interest</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {groups.map((g) => (
                    <Fragment key={g.bank}>
                      {grouped && (
                        <Table.Tr bg="var(--mantine-color-default-hover)">
                          <Table.Td fw={700}>
                            {g.bank}{" "}
                            <Text span size="xs" c="dimmed" fw={400}>
                              {depositCount(g.items.length)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right" fw={700}>
                            {subtotal(g.items)}
                          </Table.Td>
                          <Table.Td colSpan={6} />
                        </Table.Tr>
                      )}
                      {g.items.map((s) => {
                        const interest = interestAtMaturity(s);
                        return (
                          <Table.Tr key={s.id}>
                            <Table.Td fw={600} pl={grouped ? "lg" : undefined}>
                              {grouped ? "" : s.bank}
                            </Table.Td>
                            <Table.Td ta="right">
                              <Money amount={s.amount} from={s.currency} />
                              <OriginalAmount amount={s.amount} currency={s.currency} />
                            </Table.Td>
                            <Table.Td ta="right">{s.interest_rate != null ? `${s.interest_rate}%` : ""}</Table.Td>
                            <Table.Td ta="right">{termLabel(s.term_months)}</Table.Td>
                            <Table.Td>{dmy(s.start_date, "")}</Table.Td>
                            <Table.Td>
                              <Maturity saving={s} />
                            </Table.Td>
                            <Table.Td ta="right">
                              {interest != null ? <Money amount={interest} from={s.currency} /> : ""}
                            </Table.Td>
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
                    </Fragment>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          }
          cards={groups.map((g) => (
            <Fragment key={g.bank}>
              {grouped && (
                <Group justify="space-between" mt="xs">
                  <Text fw={700} size="sm">
                    {g.bank}{" "}
                    <Text span size="xs" c="dimmed" fw={400}>
                      {depositCount(g.items.length)}
                    </Text>
                  </Text>
                  <Text fw={700} size="sm">
                    {subtotal(g.items)}
                  </Text>
                </Group>
              )}
              {g.items.map((s) => {
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
                        <Money amount={s.amount} from={s.currency} />
                        <OriginalAmount amount={s.amount} currency={s.currency} />
                      </>
                    }
                    detail={
                      interest != null ? (
                        <>
                          +<Money amount={interest} from={s.currency} />
                        </>
                      ) : undefined
                    }
                    onEdit={() => startEdit(s)}
                    onDelete={() => confirm(`Delete ${s.bank}?`) && run(savingsApi.remove(s.id))}
                  />
                );
              })}
            </Fragment>
          ))}
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
          <DateInput placeholder="Start" valueFormat={DATE_INPUT_FORMAT} {...form.getInputProps("start_date")} />
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
