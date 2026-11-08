// Display currencies a user can pick. Keep in sync with CURRENCIES in src/api.ts.
export const CURRENCIES = ["VND", "USD", "EUR", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

// Exchange rates from ExchangeRate-API's free open-access endpoint (https://www.exchangerate-api.com/docs/free).
// No key needed; it updates once a day and asks callers to cache, and its terms require a visible credit link,
// which the app shows next to the totals.
const SOURCE = "https://open.er-api.com/v6/latest/VND";
const CACHE_MS = 60 * 60 * 1000; // rates change daily; one upstream call per hour per Worker instance is plenty

// rates[X] = how many X one VND buys (VND itself is 1).
export type Rates = { base: "VND"; rates: Record<string, number>; updated: string; source: string };

let cached: { at: number; value: Rates } | undefined;

async function fetchRates(): Promise<Rates> {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(8000) });
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
    source: "https://www.exchangerate-api.com",
  };
}

// Fresh rates when the cache is older than an hour; if the source fails, the last good rates (however old)
// are better than none. Returns null only when there has never been a successful fetch in this instance.
export async function getRates(): Promise<Rates | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    cached = { at: Date.now(), value: await fetchRates() };
  } catch (e) {
    console.error("Exchange rates unavailable:", (e as Error).message);
  }
  return cached?.value ?? null;
}
