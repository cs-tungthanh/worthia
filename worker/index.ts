import { Hono } from "hono";
import { auth } from "./auth/routes";
import { requireUser } from "./auth/sessions";
import { dividends } from "./dividends/routes";
import { holdings } from "./holdings/routes";
import type { AppEnv } from "./http";
import { imports } from "./imports/routes";
import { market } from "./market/routes";
import { savings } from "./savings/routes";

// The /api app: one router per business domain (see the "Backend layout" section of README.md).

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireUser);
app.route("/auth", auth);
app.route("/", holdings);
app.route("/", imports);
app.route("/", dividends);
app.route("/", savings);
app.route("/", market);

app.notFound((c) => c.json({ error: "Not found" }, 404));

// A dividend pointing at a holding that doesn't exist fails the foreign key: that's bad input, not a crash.
app.onError((err, c) => {
  if (/FOREIGN KEY constraint failed/.test(err.message)) return c.json({ error: "Unknown stock_id" }, 400);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
