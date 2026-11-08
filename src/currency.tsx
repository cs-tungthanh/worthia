import { createContext, useContext, type ReactNode } from "react";
import { Tooltip } from "@mantine/core";
import type { Currency, Rates } from "./api";
import { cell, money } from "./format";

// Converts stored amounts (each in its own currency) into the user's display currency.
// When rates are missing, or a currency has no rate, amounts are shown in their own currency instead of a
// wrong number.

type Ctx = { currency: Currency; rates: Rates | null };
const CurrencyContext = createContext<Ctx>({ currency: "VND", rates: null });

export function CurrencyProvider({ currency, rates, children }: Ctx & { children: ReactNode }) {
  return <CurrencyContext.Provider value={{ currency, rates }}>{children}</CurrencyContext.Provider>;
}

// Amount in `from` → amount in `to`, or null if either rate is unknown.
function convertWith(rates: Rates | null, amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const a = rates?.rates[from];
  const b = rates?.rates[to];
  return a && b ? (amount / a) * b : null;
}

export function useMoney() {
  const { currency, rates } = useContext(CurrencyContext);
  const convert = (amount: number, from: string) => convertWith(rates, amount, from, currency);
  return {
    currency,
    rates,
    convert,
    // Formats an amount stored in `from` in the display currency; compact = table style (VND in thousands).
    fmt(amount: number, from: string = "VND", compact = false) {
      const converted = convert(amount, from);
      const [value, cur] = converted == null ? [amount, from] : [converted, currency];
      return compact ? cell(value, cur) : money(value, cur);
    },
  };
}

// A table-style amount (VND shortened to K/M/B) that shows the whole amount on hover, or on tap on a phone:
// 1,22M → 1.222.000 ₫. In the display currency, unless `own` keeps the amount in its own currency.
export function Money({ amount, from = "VND", own = false }: { amount: number; from?: string; own?: boolean }) {
  const { fmt } = useMoney();
  const short = own ? cell(amount, from) : fmt(amount, from, true);
  const full = own ? money(amount, from) : fmt(amount, from);
  if (short === full) return <>{short}</>;
  return (
    <Tooltip label={full} withArrow openDelay={150} events={{ hover: true, focus: true, touch: true }}>
      <span style={{ cursor: "default" }}>{short}</span>
    </Tooltip>
  );
}
