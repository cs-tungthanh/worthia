import { type Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { CURRENCIES } from "../../shared/config";
import { emailSettings, PASSWORD, PASSWORD_RESET } from "../config";
import { sendEmail } from "../email/send";
import { resetPasswordEmail } from "../email/templates/reset-password";
import type { AppEnv } from "../http";
import { google } from "./google";
import { getDummyHash, hashPassword, hashToken, randomToken, verifyPassword } from "./passwords";
import {
  createPasswordUser,
  findPasswordUser,
  findResetUser,
  findUserForLogin,
  replaceResetToken,
  resetRequestedWithin,
  setCurrency,
  setPassword,
} from "./queries";
import { endSession, startSession } from "./sessions";

// Accounts: registration, password sign-in, preferences and password reset. Mounted at /api/auth.

export const auth = new Hono<AppEnv>();

auth.route("/google", google);

const credentials = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(PASSWORD.minLength, `Password must be at least ${PASSWORD.minLength} characters`).max(200),
});

auth.post(
  "/register",
  zValidator(
    "json",
    credentials.extend({
      name: z
        .string()
        .trim()
        .max(100)
        .nullish()
        .transform((v) => v || null),
    }),
  ),
  async (c) => {
    const { email, password, name } = c.req.valid("json");
    const user = await createPasswordUser(c.env.DB, email, name, await hashPassword(password));
    if (!user) return c.json({ error: "An account with this email already exists. Sign in instead." }, 409);
    await startSession(c, user.id);
    return c.json(user, 201);
  },
);

auth.post("/login", zValidator("json", credentials), async (c) => {
  const { email, password } = c.req.valid("json");
  const row = await findUserForLogin(c.env.DB, email);
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row?.password_hash || !ok) return c.json({ error: "Wrong email or password" }, 401);
  await startSession(c, row.id);
  return c.json({ id: row.id, email: row.email, name: row.name, currency: row.currency });
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

auth.get("/me", (c) => c.json(c.var.user));

// Account preferences. Only the display currency for now.
auth.patch("/me", zValidator("json", z.object({ currency: z.enum(CURRENCIES) })), async (c) =>
  c.json(await setCurrency(c.env.DB, c.var.user.id, c.req.valid("json").currency)),
);

// ---------- password reset (password accounts only; Google-only accounts have nothing to reset) ----------

async function sendResetEmail(c: Context<AppEnv>, to: string, name: string | null, link: string) {
  const email = emailSettings(c.env);
  if (!email) {
    // Local dev without an email provider: print the link instead. Never in production, where logs aren't private.
    if (new URL(c.req.url).hostname === "localhost") console.log(`[dev] Password reset link for ${to}: ${link}`);
    else
      console.error(
        "Password reset requested but no email provider is configured (EMAIL_FROM plus BREVO_API_KEY or RESEND_API_KEY)",
      );
    return;
  }
  try {
    await sendEmail(email, { to, ...resetPasswordEmail({ name, link, minutes: PASSWORD_RESET.minutes }) });
  } catch (e) {
    console.error("Password reset email failed:", (e as Error).message);
  }
}

// Always answers the same way, so the form can't be used to find out which emails have accounts.
auth.post("/forgot", zValidator("json", z.object({ email: z.email().trim().toLowerCase().max(254) })), async (c) => {
  const db = c.env.DB;
  const user = await findPasswordUser(db, c.req.valid("json").email);
  if (user && !(await resetRequestedWithin(db, user.id, PASSWORD_RESET.cooldownMinutes))) {
    const token = randomToken();
    await replaceResetToken(db, user.id, await hashToken(token), PASSWORD_RESET.minutes);
    const link = `${new URL(c.req.url).origin}/reset-password?token=${token}`;
    // Sent after the response, so its timing doesn't reveal whether the account exists.
    c.executionCtx.waitUntil(sendResetEmail(c, user.email, user.name, link));
  }
  return c.json({ ok: true });
});

auth.post(
  "/reset",
  zValidator("json", z.object({ token: z.string().min(1).max(100), password: credentials.shape.password })),
  async (c) => {
    const { token, password } = c.req.valid("json");
    const db = c.env.DB;
    const user = await findResetUser(db, await hashToken(token));
    if (!user) return c.json({ error: "This reset link is invalid or has expired. Request a new one." }, 400);
    await setPassword(db, user.id, await hashPassword(password));
    await startSession(c, user.id);
    return c.json(user);
  },
);
