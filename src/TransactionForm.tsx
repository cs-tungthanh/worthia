import { Autocomplete, Button, NumberInput, SegmentedControl, SimpleGrid } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { movementsApi, type Movement } from "./api";
import { toNumber, today, vndInput } from "./ui";

// Adds one transaction: a buy, a sale or bonus shares. Holdings follow from transactions (shared/position.ts).

type Kind = Movement["kind"];
type Form = {
  kind: Kind;
  symbol: string;
  date: string | null;
  quantity: number | string;
  price: number | string;
  fee: number | string;
  tax: number | string;
};

const LABEL: Record<Kind, string> = { buy: "Add buy", sell: "Add sale", bonus: "Add bonus shares" };

export function TransactionForm({ symbols, run }: { symbols: string[]; run: (p: Promise<unknown>) => void }) {
  const form = useForm<Form>({
    initialValues: { kind: "buy", symbol: "", date: today(), quantity: "", price: "", fee: "", tax: "" },
    validate: {
      symbol: (v) => (/^[A-Za-z0-9]{1,20}$/.test(v.trim()) ? null : "Required"),
      date: (v) => (v ? null : "Required"),
      quantity: (v) => (v !== "" && Number(v) > 0 ? null : "Required"),
      price: (v, values) => (values.kind === "bonus" || v !== "" ? null : "Required"),
    },
  });
  const kind = form.values.kind;

  const submit = form.onSubmit((v) => {
    const traded = v.kind !== "bonus";
    run(
      movementsApi
        .create({
          symbol: v.symbol.trim().toUpperCase(),
          date: v.date!,
          kind: v.kind,
          quantity: Number(v.quantity),
          price: traded ? toNumber(v.price) : null,
          fee: traded ? toNumber(v.fee) : null,
          tax: v.kind === "sell" ? toNumber(v.tax) : null,
        })
        .then(() => form.setValues({ symbol: "", quantity: "", price: "", fee: "", tax: "" })),
    );
  });

  return (
    <form onSubmit={submit}>
      <SegmentedControl
        mt="sm"
        size="xs"
        data={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
          { value: "bonus", label: "Bonus shares" },
        ]}
        {...form.getInputProps("kind")}
      />
      <SimpleGrid cols={{ base: 2, sm: 4, lg: kind === "sell" ? 8 : kind === "buy" ? 7 : 5 }} spacing="xs" mt="xs">
        <Autocomplete placeholder="Symbol" data={symbols} {...form.getInputProps("symbol")} />
        <DateInput placeholder="Date" valueFormat="YYYY-MM-DD" {...form.getInputProps("date")} />
        <NumberInput
          placeholder="Shares"
          min={0}
          thousandSeparator="."
          decimalSeparator=","
          hideControls
          {...form.getInputProps("quantity")}
        />
        {kind !== "bonus" && (
          <>
            <NumberInput
              placeholder="Price (VND)"
              {...vndInput}
              decimalScale={2}
              hideControls
              {...form.getInputProps("price")}
            />
            <NumberInput
              placeholder="Fee (VND)"
              {...vndInput}
              allowDecimal={false}
              hideControls
              {...form.getInputProps("fee")}
            />
          </>
        )}
        {kind === "sell" && (
          <NumberInput
            placeholder="Tax (VND)"
            {...vndInput}
            allowDecimal={false}
            hideControls
            {...form.getInputProps("tax")}
          />
        )}
        <Button type="submit" className="form-actions" style={{ gridColumn: "span 2" }}>
          {LABEL[kind]}
        </Button>
      </SimpleGrid>
    </form>
  );
}
