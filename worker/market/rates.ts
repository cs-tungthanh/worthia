import { CURRENCIES } from "../../shared/config";
import { RATES } from "../config";

// Exchange rates from ExchangeRate-API (source and cache time in ../config.ts). It updates once a day and asks
// callers to cache.

// rates[X] = how many X one VND buys (VND itself is 1).
export type Rates = { base: "VND"; rates: Record<string, number>; updated: string; source: string };

let cached: { at: number; value: Rates } | undefined;

async function fetchRates(): Promise<Rates> {
  const res = await fetch(RATES.url, { signal: AbortSignal.timeout(RATES.timeoutMs) });
  if (!res.ok) throw new Error(`ExchangeRate-API ${res.status}`);
  const data = (await res.json()) as {
    result?: string;
    time_last_update_unix?: number;
    rates?: Record<string, number>;
  };
  if (data.result !== "success" || !data.rates) throw new Error("ExchangeRate-API returned no rates");
  // Keep every currency, not just the display ones: savings can be in any currency and need converting too.
  const rates = Object.fromEntries(Object.entries(data.rates).filter(([, r]) => typeof r === "number" && r > 0));
  for (const c of CURRENCIES) if (!rates[c]) throw new Error(`ExchangeRate-API has no rate for ${c}`);
  return {
    base: "VND",
    rates,
    updated: new Date((data.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
    source: RATES.credit,
  };
}

// Fresh rates when the cache is older than an hour; if the source fails, the last good rates (however old)
// are better than none. Returns null only when there has never been a successful fetch in this instance.
export async function getRates(): Promise<Rates | null> {
  if (cached && Date.now() - cached.at < RATES.cacheMs) return cached.value;
  try {
    cached = { at: Date.now(), value: await fetchRates() };
  } catch (e) {
    console.error("Exchange rates unavailable:", (e as Error).message);
  }
  return cached?.value ?? null;
}
