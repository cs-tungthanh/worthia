// Pure number formatting. Display-currency conversion lives in ./currency.tsx.

export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", { style: "currency", currency }).format(amount);

const VND_SCALES = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Short VND for table cells: 52.900 → 52,9K, 100.000.000 → 100M, 1.250.000.000 → 1,25B; under 1.000 as is.
// Uses the largest unit the amount reaches, moving up one when rounding would show 1.000 (999.999 → 1M).
export function compactVnd(amount: number) {
  const abs = Math.abs(amount);
  let i = -1;
  while (i + 1 < VND_SCALES.length && abs >= VND_SCALES[i + 1][0]) i++;
  if (i < 0) return amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
  if (i < VND_SCALES.length - 1 && round2(abs / VND_SCALES[i][0]) >= 1000) i++;
  const [size, unit] = VND_SCALES[i];
  return `${(amount / size).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}${unit}`;
}

// Compact form for table cells: VND shortened with K/M/B; other currencies unchanged.
export const cell = (amount: number, currency = "VND") =>
  currency === "VND" ? compactVnd(amount) : money(amount, currency);
