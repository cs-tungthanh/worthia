import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Alert, Anchor, Button, Container, Group, Paper, Select, SimpleGrid, Text, Title } from "@mantine/core";
import {
  authApi,
  CURRENCIES,
  dividendsApi,
  favouriteBanksApi,
  getPrices,
  getRates,
  savingsApi,
  stocksApi,
  type Currency,
  type Dividend,
  type Quote,
  type Rates,
  type Saving,
  type Stock,
  type User,
} from "./api";
import { CurrencyProvider, useMoney } from "./currency";
import { DividendsSection } from "./Dividends";
import { ImportStatement } from "./ImportStatement";
import { money } from "./format";
import { SavingsSection } from "./Savings";
import { StocksSection, type Holding } from "./Stocks";
import { ProfitLoss } from "./ui";

// The lifecycle view brings the chart library (~150 KB gzipped), so it loads the first time it's opened.
const LifecycleModal = lazy(() => import("./Lifecycle").then((m) => ({ default: m.LifecycleModal })));

const PRICE_REFRESH_MS = 60_000;
const RATES_REFRESH_MS = 60 * 60_000; // the source updates daily

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz={{ base: "md", sm: "lg" }} style={{ fontVariantNumeric: "tabular-nums" }}>
        {children}
      </Text>
    </Paper>
  );
}

export default function App({
  user,
  onUserChange,
  onSignOut,
}: {
  user: User;
  onUserChange: (u: User) => void;
  onSignOut: () => void;
}) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [savings, setSavings] = useState<Saving[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [favouriteBanks, setFavouriteBanks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([stocksApi.list(), savingsApi.list(), dividendsApi.list(), favouriteBanksApi.list()])
      .then(([s, v, d, f]) => {
        setStocks(s);
        setSavings(v);
        setDividends(d);
        setFavouriteBanks(f);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; refresh only calls state setters.
  useEffect(() => {
    refresh();
  }, []);

  const run = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));

  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const symbolKey = [...new Set(stocks.map((s) => s.symbol))].sort().join(",");

  useEffect(() => {
    if (!symbolKey) return;
    const load = () =>
      getPrices(symbolKey.split(","))
        .then(setQuotes)
        .catch(() => {}); // keep showing the last prices; the next tick retries
    load();
    const timer = setInterval(load, PRICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [symbolKey]);

  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    const load = () =>
      getRates()
        .then(setRates)
        .catch(() => {}); // amounts fall back to their own currency
    load();
    const timer = setInterval(load, RATES_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Switch at once; put it back if the server refuses.
  const changeCurrency = (currency: Currency) => {
    const previous = user;
    onUserChange({ ...user, currency });
    authApi.updateMe({ currency }).then(onUserChange, (e: Error) => {
      onUserChange(previous);
      setError(e.message);
    });
  };

  const holdings: Holding[] = stocks; // computed from transactions by the server
  const [lifecycleId, setLifecycleId] = useState<number | null>(null);
  const lifecycleHolding = holdings.find((h) => h.id === lifecycleId) ?? null;

  return (
    <CurrencyProvider currency={user.currency} rates={rates}>
      <Container size="lg" px={{ base: "sm", sm: "md" }} py="lg" pb={64}>
        <Group justify="space-between" align="center" mb="md" wrap="nowrap" gap="sm">
          <Title order={1} size="h2">
            Worthia
          </Title>
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Text size="sm" c="dimmed" truncate visibleFrom="xs">
              {user.name ?? user.email}
            </Text>
            <Select
              size="xs"
              w={84}
              aria-label="Display currency"
              data={[...CURRENCIES]}
              value={user.currency}
              allowDeselect={false}
              checkIconPosition="right"
              onChange={(v) => v && v !== user.currency && changeCurrency(v as Currency)}
            />
            <Button size="compact-sm" variant="default" onClick={onSignOut}>
              Sign out
            </Button>
          </Group>
        </Group>
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}

        <Summary holdings={holdings} quotes={quotes} dividends={dividends} savings={savings} />

        <StocksSection
          rows={holdings}
          quotes={quotes}
          run={run}
          headerAction={<ImportStatement onImported={refresh} />}
          onView={(h) => setLifecycleId(h.id)}
          dividends={dividends}
        />
        {lifecycleHolding && (
          <Suspense fallback={null}>
            <LifecycleModal
              holding={lifecycleHolding}
              dividends={dividends}
              onClose={() => setLifecycleId(null)}
              onChanged={refresh}
              price={quotes[lifecycleHolding.symbol]?.price ?? null}
            />
          </Suspense>
        )}
        <DividendsSection rows={dividends} stocks={stocks} run={run} />
        <SavingsSection rows={savings} favourites={favouriteBanks} run={run} />
      </Container>
    </CurrencyProvider>
  );
}

function Summary({
  holdings,
  quotes,
  dividends,
  savings,
}: {
  holdings: Holding[];
  quotes: Record<string, Quote | null>;
  dividends: Dividend[];
  savings: Saving[];
}) {
  const { fmt, currency, rates } = useMoney();

  // Totals are added up in VND, then shown in the display currency.
  const toVnd = (amount: number, from: string) =>
    from === "VND" ? amount : rates?.rates[from] ? amount / rates.rates[from] : null;

  const stocksValue = holdings.reduce((sum, h) => sum + (quotes[h.symbol]?.price ?? 0) * h.shares, 0);
  // Profit/loss only counts holdings that have both a known cost and a current price.
  const tracked = holdings.filter((h) => h.shares > 0 && h.cost != null && quotes[h.symbol]);
  const trackedCost = tracked.reduce((sum, h) => sum + h.cost!, 0);
  const trackedValue = tracked.reduce((sum, h) => sum + quotes[h.symbol]!.price * h.shares, 0);
  // Realised profit from sales, over every holding whose sales can be valued.
  const realisedKnown = holdings.filter((h) => h.realised != null);
  const realised = realisedKnown.reduce((sum, h) => sum + h.realised!, 0);
  const cashDividends = dividends.reduce((sum, d) => sum + (d.cash_amount ?? 0), 0);

  // Savings with a known rate join the total; any without one keep their own tile and stay out of net worth.
  let savingsVnd = 0;
  const unconverted: Record<string, number> = {};
  for (const s of savings) {
    const v = toVnd(s.amount, s.currency);
    if (v == null) unconverted[s.currency] = (unconverted[s.currency] ?? 0) + s.amount;
    else savingsVnd += v;
  }
  const missing = Object.keys(unconverted);
  const usesRates = currency !== "VND" || savings.some((s) => s.currency !== "VND");

  return (
    <>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Stat label="Net worth">{fmt(stocksValue + savingsVnd)}</Stat>
        <Stat label="Stocks">{fmt(stocksValue)}</Stat>
        {tracked.length > 0 && (
          <Stat label="Stocks profit/loss">
            <ProfitLoss cost={trackedCost} value={trackedValue} />
          </Stat>
        )}
        {realisedKnown.some((h) => h.realised !== 0) && (
          <Stat label="Realised profit/loss">
            <ProfitLoss cost={0} value={realised} />
          </Stat>
        )}
        {cashDividends > 0 && <Stat label="Cash dividends received">{fmt(cashDividends)}</Stat>}
        {savings.length > missing.length && <Stat label="Savings">{fmt(savingsVnd)}</Stat>}
        {missing.map((cur) => (
          <Stat key={cur} label={`Savings (${cur})`}>
            {money(unconverted[cur], cur)}
          </Stat>
        ))}
      </SimpleGrid>
      {missing.length > 0 && (
        <Text size="xs" c="dimmed" mt={6}>
          Net worth leaves out savings in {missing.join(", ")}: no exchange rate available.
        </Text>
      )}
      {usesRates && rates && (
        <Text size="xs" c="dimmed" mt={6}>
          {currency !== "VND" && (
            <>
              1 {currency} = {money(1 / rates.rates[currency], "VND")} ·{" "}
            </>
          )}
          <Anchor href={rates.source} target="_blank" rel="noopener" inherit c="dimmed" underline="always">
            Rates by ExchangeRate-API
          </Anchor>
          , updated {rates.updated.slice(0, 10)}
        </Text>
      )}
      {usesRates && !rates && currency !== "VND" && (
        <Text size="xs" c="dimmed" mt={6}>
          Exchange rates are unavailable, so amounts are shown in their own currency.
        </Text>
      )}
    </>
  );
}
