import { PRICES } from "../config";

// Latest prices for Vietnamese listed stocks (HOSE, HNX, UPCoM, ETFs) from Entrade's public
// chart API (settings in ../config.ts). It returns daily candles priced in thousands of VND; the latest
// candle updates during trading hours, so its close is the current price.

export type Quote = { price: number; prevClose: number | null; time: string };

// Per-isolate cache: enough to avoid hitting the upstream on every page load.
const cache = new Map<string, { at: number; quote: Quote | null }>();

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const to = Math.floor(Date.now() / 1000);
  let data: { t?: number[]; c?: number[] } = {};
  for (const days of PRICES.lookbackDays) {
    const url = `${PRICES.url}?resolution=1D&symbol=${encodeURIComponent(symbol)}&from=${to - days * 86400}&to=${to}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(PRICES.timeoutMs) });
    if (!res.ok) return null; // unknown symbol answers 400
    data = (await res.json()) as { t?: number[]; c?: number[] };
    if (data.c?.length) break;
  }
  const n = data.c?.length ?? 0;
  if (!data.t || !data.c || n === 0) return null;
  return {
    price: Math.round(data.c[n - 1] * 1000),
    prevClose: n > 1 ? Math.round(data.c[n - 2] * 1000) : null,
    time: new Date(data.t[n - 1] * 1000).toISOString(),
  };
}

export async function getQuotes(symbols: string[]): Promise<Record<string, Quote | null>> {
  const now = Date.now();
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      const hit = cache.get(symbol);
      if (hit && now - hit.at < PRICES.cacheMs) return [symbol, hit.quote] as const;
      const quote = await fetchQuote(symbol).catch(() => null);
      cache.set(symbol, { at: now, quote });
      return [symbol, quote] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// Daily closing prices (VND) from `from` to today, for the lifecycle chart. One upstream call per symbol and
// start date per PRICES.historyCacheMs per Worker instance.
const historyCache = new Map<string, { at: number; points: { date: string; close: number }[] }>();

export async function getHistory(symbol: string, from: string): Promise<{ date: string; close: number }[] | null> {
  const key = `${symbol}:${from}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < PRICES.historyCacheMs) return hit.points;
  const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const end = Math.floor(Date.now() / 1000);
  const url = `${PRICES.url}?resolution=1D&symbol=${encodeURIComponent(symbol)}&from=${start}&to=${end}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PRICES.historyTimeoutMs) });
    if (!res.ok) return null;
    const data = (await res.json()) as { t?: number[]; c?: number[] };
    if (!data.t || !data.c) return null;
    // Candles are stamped at 09:00 Vietnam time (02:00 UTC), so the UTC date is the trading day.
    const points = data.t.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: Math.round(data.c![i] * 1000),
    }));
    if (historyCache.size > PRICES.historyCacheEntries) historyCache.clear(); // keep the per-instance cache bounded
    historyCache.set(key, { at: Date.now(), points });
    return points;
  } catch {
    return null;
  }
}
