import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ownsStock } from "../holdings/queries";
import { type AppEnv, idParam } from "../http";
import { deleteDividend, insertDividend, listDividends, updateDividend } from "./queries";

// Cash dividends entered by hand (imported ones arrive through imports/).

export const dividends = new Hono<AppEnv>();

// Cash dividends only: bonus shares are share movements (see holdings/routes.ts).
const dividendInput = z.object({
  stock_id: z.number().int().positive(),
  type: z.literal("cash", { error: "Record bonus shares as a Bonus transaction" }),
  cash_amount: z.number().int().nonnegative(),
  shares: z
    .null()
    .optional()
    .transform(() => null),
  paid_date: z.iso.date(),
});

dividends.get("/dividends", async (c) => c.json(await listDividends(c.env.DB, c.var.user.id)));

dividends.post("/dividends", zValidator("json", dividendInput), async (c) => {
  const body = c.req.valid("json");
  if (!(await ownsStock(c.env.DB, c.var.user.id, body.stock_id))) return c.json({ error: "Unknown stock_id" }, 400);
  return c.json(await insertDividend(c.env.DB, c.var.user.id, body), 201);
});

dividends.put("/dividends/:id", idParam, zValidator("json", dividendInput), async (c) => {
  const body = c.req.valid("json");
  if (!(await ownsStock(c.env.DB, c.var.user.id, body.stock_id))) return c.json({ error: "Unknown stock_id" }, 400);
  const row = await updateDividend(c.env.DB, c.var.user.id, c.req.valid("param").id, body);
  return row ? c.json(row) : c.json({ error: "Not found" }, 404);
});

dividends.delete("/dividends/:id", idParam, async (c) =>
  (await deleteDividend(c.env.DB, c.var.user.id, c.req.valid("param").id))
    ? c.body(null, 204)
    : c.json({ error: "Not found" }, 404),
);
