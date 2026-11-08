import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppEnv, idParam } from "../http";
import {
  addFavouriteBank,
  deleteSaving,
  insertSaving,
  listFavouriteBanks,
  listSavings,
  removeFavouriteBank,
  updateSaving,
} from "./queries";

// Savings deposits and the banks a user stars for quick entry.

export const savings = new Hono<AppEnv>();

const savingInput = z.object({
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

// ---------- deposits ----------

savings.get("/savings", async (c) => c.json(await listSavings(c.env.DB, c.var.user.id)));

savings.post("/savings", zValidator("json", savingInput), async (c) =>
  c.json(await insertSaving(c.env.DB, c.var.user.id, c.req.valid("json")), 201),
);

savings.put("/savings/:id", idParam, zValidator("json", savingInput), async (c) => {
  const row = await updateSaving(c.env.DB, c.var.user.id, c.req.valid("param").id, c.req.valid("json"));
  return row ? c.json(row) : c.json({ error: "Not found" }, 404);
});

savings.delete("/savings/:id", idParam, async (c) =>
  (await deleteSaving(c.env.DB, c.var.user.id, c.req.valid("param").id))
    ? c.body(null, 204)
    : c.json({ error: "Not found" }, 404),
);

// ---------- favourite banks ----------

const bankName = zValidator("param", z.object({ name: z.string().trim().min(1).max(100) }));

savings.get("/favourite-banks", async (c) => c.json(await listFavouriteBanks(c.env.DB, c.var.user.id)));

// PUT and DELETE are idempotent, so starring twice or unstarring a non-favourite is harmless.
savings.put("/favourite-banks/:name", bankName, async (c) => {
  await addFavouriteBank(c.env.DB, c.var.user.id, c.req.valid("param").name);
  return c.body(null, 204);
});

savings.delete("/favourite-banks/:name", bankName, async (c) => {
  await removeFavouriteBank(c.env.DB, c.var.user.id, c.req.valid("param").name);
  return c.body(null, 204);
});
