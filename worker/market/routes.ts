import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../http";
import { getHistory, getQuotes } from "./prices";
import { getRates } from "./rates";

// Market data from outside services: stock prices and exchange rates. Nothing here touches the database.

export const market = new Hono<AppEnv>();

// Each symbol is one upstream subrequest; Workers Free allows 50 per invocation.
const MAX_SYMBOLS = 40;

market.get("/prices", zValidator("query", z.object({ symbols: z.string().max(1000) })), async (c) => {
  const symbols = [
    ...new Set(
      c.req
        .valid("query")
        .symbols.split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{1,20}$/.test(s)),
    ),
  ];
  if (symbols.length > MAX_SYMBOLS) return c.json({ error: `At most ${MAX_SYMBOLS} symbols` }, 400);
  return c.json(await getQuotes(symbols));
});

// Daily closing prices since `from`, for the lifecycle chart.
market.get(
  "/prices/history",
  zValidator(
    "query",
    z.object({
      symbol: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{1,20}$/),
      from: z.iso.date().refine((d) => d >= "2000-01-01", "Too early"),
    }),
  ),
  async (c) => {
    const { symbol, from } = c.req.valid("query");
    const points = await getHistory(symbol, from);
    return points ? c.json(points) : c.json({ error: "Price history is unavailable right now" }, 503);
  },
);

// Exchange rates for converting amounts into the user's display currency. 503 if none have ever loaded.
market.get("/rates", async (c) => {
  const rates = await getRates();
  return rates ? c.json(rates) : c.json({ error: "Exchange rates are unavailable right now" }, 503);
});
