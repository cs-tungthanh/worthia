import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { overSoldWarnings } from "../holdings/positions";
import { listMovements } from "../holdings/queries";
import { movementInput } from "../holdings/routes";
import type { AppEnv } from "../http";
import { listImports, saveImport } from "./queries";

// Statement import and its history. The app parses the statements and works out what to save
// (src/import/plan.ts); the server only applies that plan.

export const imports = new Hono<AppEnv>();

imports.get("/imports", async (c) => c.json(await listImports(c.env.DB, c.var.user.id)));

const importInput = z.object({
  movements: z
    .array(
      movementInput.extend({
        balance: z.number().nonnegative(),
        trade_date: z.iso
          .date()
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .max(5000),
  cashMovements: z
    .array(movementInput.extend({ kind: z.enum(["buy", "sell"]), trade_date: z.iso.date() }))
    .max(5000)
    .default([]),
  remove: z.array(z.number().int().positive()).max(5000).default([]),
  dividends: z
    .array(z.object({ symbol: movementInput.shape.symbol, date: z.iso.date(), amount: z.number().int().positive() }))
    .max(2000)
    .default([]),
  // The statement files behind this import, recorded in the import history.
  files: z
    .array(
      z.object({
        statement: z.enum(["securities", "cash"]),
        broker: z.string().trim().min(1).max(50),
        file_name: z.string().trim().max(255).nullish(),
        from: z.iso.date().nullish(),
        to: z.iso.date().nullish(),
        rows: z.number().int().nonnegative(),
      }),
    )
    .max(2)
    .default([]),
  changes: z.number().int().nonnegative().default(0),
});

imports.post("/movements/import", zValidator("json", importInput), async (c) => {
  const db = c.env.DB;
  const userId = c.var.user.id;
  await saveImport(db, userId, c.req.valid("json"));
  // Saving a statement can't oversell (its balances never go negative), but report any symbol that now does,
  // e.g. after a sale entered by hand overlaps imported history.
  return c.json({ ok: true, warnings: overSoldWarnings(await listMovements(db, userId)) });
});
