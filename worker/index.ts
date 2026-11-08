import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getHistory, getQuotes } from "./prices";
import { getRates } from "./currency";
import { auth, requireUser, type AppEnv } from "./auth";
import { ledger } from "./ledger";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireUser);
app.route("/auth", auth);
app.route("/", ledger); // holdings and share movements

const savingSchema = z.object({
  bank: z.string().trim().min(1).max(100),
  amount: z.number().int().nonnegative(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((s) => s.toUpperCase())
    .default("VND"),
  interest_rate: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .transform((v) => v ?? null),
  start_date: z.iso
    .date()
    .nullish()
    .transform((v) => v || null),
  term_months: z
    .number()
    .int()
    .positive()
    .max(600)
    .nullish()
    .transform((v) => v ?? null),
});

// Cash dividends only: bonus shares are share movements (see ledger.ts).
const dividendSchema = z.object({
  stock_id: z.number().int().positive(),
  type: z.literal("cash", { error: "Record bonus shares as a Bonus transaction" }),
  cash_amount: z.number().int().nonnegative(),
  shares: z
    .null()
    .optional()
    .transform(() => null),
  paid_date: z.iso.date(),
});

const idParam = zValidator("param", z.object({ id: z.coerce.number().int().positive() }));

// Registers list/create/update/delete routes for one table, scoped to the signed-in user. Column names
// come from the schema keys, never from the request, so building SQL from them is safe.
// `check` can reject a body (e.g. one pointing at another user's row) with an error message.
function crud<S extends z.ZodObject>(
  path: string,
  table: string,
  schema: S,
  orderBy: string,
  check?: (db: D1Database, userId: number, body: Record<string, unknown>) => Promise<string | null>,
) {
  const columns = Object.keys(schema.shape);

  app.get(path, async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${orderBy}`)
      .bind(c.var.user.id)
      .all();
    return c.json(results);
  });

  app.post(path, zValidator("json", schema), async (c) => {
    const body = c.req.valid("json") as Record<string, unknown>;
    const problem = await check?.(c.env.DB, c.var.user.id, body);
    if (problem) return c.json({ error: problem }, 400);
    const row = await c.env.DB.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}, user_id) VALUES (${columns.map(() => "?").join(", ")}, ?) RETURNING *`,
    )
      .bind(...columns.map((k) => body[k]), c.var.user.id)
      .first();
    return c.json(row, 201);
  });

  app.put(`${path}/:id`, idParam, zValidator("json", schema), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json") as Record<string, unknown>;
    const problem = await check?.(c.env.DB, c.var.user.id, body);
    if (problem) return c.json({ error: problem }, 400);
    const row = await c.env.DB.prepare(
      `UPDATE ${table} SET ${columns.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? RETURNING *`,
    )
      .bind(...columns.map((k) => body[k]), id, c.var.user.id)
      .first();
    return row ? c.json(row) : c.json({ error: "Not found" }, 404);
  });

  app.delete(`${path}/:id`, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const { meta } = await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`)
      .bind(id, c.var.user.id)
      .run();
    return meta.changes ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
  });
}

crud("/savings", "savings", savingSchema, "bank, start_date");
crud("/dividends", "dividends", dividendSchema, "paid_date DESC, id DESC", async (db, userId, body) => {
  const owned = await db
    .prepare("SELECT 1 FROM stocks WHERE id = ? AND user_id = ?")
    .bind(body.stock_id, userId)
    .first();
  return owned ? null : "Unknown stock_id";
});

// Each symbol is one upstream subrequest; Workers Free allows 50 per invocation.
const MAX_SYMBOLS = 40;

app.get("/prices", zValidator("query", z.object({ symbols: z.string().max(1000) })), async (c) => {
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
app.get(
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
app.get("/rates", async (c) => {
  const rates = await getRates();
  return rates ? c.json(rates) : c.json({ error: "Exchange rates are unavailable right now" }, 503);
});

const bankName = zValidator("param", z.object({ name: z.string().trim().min(1).max(100) }));

app.get("/favourite-banks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name FROM favourite_banks WHERE user_id = ? ORDER BY created_at, name",
  )
    .bind(c.var.user.id)
    .all<{ name: string }>();
  return c.json(results.map((r) => r.name));
});

// PUT and DELETE are idempotent, so starring twice or unstarring a non-favourite is harmless.
app.put("/favourite-banks/:name", bankName, async (c) => {
  await c.env.DB.prepare("INSERT OR IGNORE INTO favourite_banks (user_id, name) VALUES (?, ?)")
    .bind(c.var.user.id, c.req.valid("param").name)
    .run();
  return c.body(null, 204);
});

app.delete("/favourite-banks/:name", bankName, async (c) => {
  await c.env.DB.prepare("DELETE FROM favourite_banks WHERE user_id = ? AND name = ?")
    .bind(c.var.user.id, c.req.valid("param").name)
    .run();
  return c.body(null, 204);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

// A dividend pointing at a holding that doesn't exist fails the foreign key: that's bad input, not a crash.
app.onError((err, c) => {
  if (/FOREIGN KEY constraint failed/.test(err.message)) return c.json({ error: "Unknown stock_id" }, 400);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
