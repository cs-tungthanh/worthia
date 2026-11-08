import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { emailConfigured, sendEmail, type EmailEnv } from "./email";
import { resetPasswordEmail } from "./emails/reset-password";
import { CURRENCIES, type Currency } from "./currency";

// Email settings (BREVO_API_KEY / RESEND_API_KEY, EMAIL_FROM) are described in ./email.ts.
export type Bindings = Env &
  EmailEnv & {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
export type User = { id: number; email: string; name: string | null; currency: Currency };
export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
const OAUTH_COOKIE = "google_oauth";
const RESET_MINUTES = 30;
// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

// ---------- encoding and crypto helpers ----------

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
  );
}

// Stored as pbkdf2$<iterations>$<salt>$<hash> so the iteration count can be raised later.
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter));
  const expected = fromB64url(hash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

// Hash compared against when the email is unknown, so a wrong email takes as long as a wrong password.
// Made on first use: Workers forbid generating random values at module load.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

// ---------- sessions ----------

const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

async function startSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    c.env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    ).bind(b64url(await sha256(token)), userId),
  ]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

async function sessionUser(c: Context<AppEnv>): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.currency FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  )
    .bind(b64url(await sha256(token)))
    .first<User>();
}

const PUBLIC_PATHS = new Set([
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/forgot",
  "/api/auth/reset",
]);

// Every other /api route needs a signed-in user, available as c.var.user.
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "Not signed in" }, 401);
  c.set("user", user);
  return next();
};

// ---------- routes (mounted at /api/auth) ----------

export const auth = new Hono<AppEnv>();

const credentials = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
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
    const user = await c.env.DB.prepare(
      "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING RETURNING id, email, name, currency",
    )
      .bind(email, name, await hashPassword(password))
      .first<User>();
    if (!user) return c.json({ error: "An account with this email already exists. Sign in instead." }, 409);
    await startSession(c, user.id);
    return c.json(user, 201);
  },
);

auth.post("/login", zValidator("json", credentials), async (c) => {
  const { email, password } = c.req.valid("json");
  const row = await c.env.DB.prepare("SELECT id, email, name, currency, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<User & { password_hash: string | null }>();
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row?.password_hash || !ok) return c.json({ error: "Wrong email or password" }, 401);
  await startSession(c, row.id);
  return c.json({ id: row.id, email: row.email, name: row.name, currency: row.currency });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(b64url(await sha256(token)))
      .run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

auth.get("/me", (c) => c.json(c.var.user));

// Account preferences. Only the display currency for now.
auth.patch("/me", zValidator("json", z.object({ currency: z.enum(CURRENCIES) })), async (c) => {
  const { currency } = c.req.valid("json");
  const user = await c.env.DB.prepare("UPDATE users SET currency = ? WHERE id = ? RETURNING id, email, name, currency")
    .bind(currency, c.var.user.id)
    .first<User>();
  return c.json(user);
});

// ---------- password reset (password accounts only; Google-only accounts have nothing to reset) ----------

async function sendResetEmail(c: Context<AppEnv>, to: string, name: string | null, link: string) {
  if (!emailConfigured(c.env)) {
    // Local dev without an email provider: print the link instead. Never in production, where logs aren't private.
    if (new URL(c.req.url).hostname === "localhost") console.log(`[dev] Password reset link for ${to}: ${link}`);
    else
      console.error(
        "Password reset requested but no email provider is configured (EMAIL_FROM plus BREVO_API_KEY or RESEND_API_KEY)",
      );
    return;
  }
  try {
    await sendEmail(c.env, { to, ...resetPasswordEmail({ name, link, minutes: RESET_MINUTES }) });
  } catch (e) {
    console.error("Password reset email failed:", (e as Error).message);
  }
}

// Always answers the same way, so the form can't be used to find out which emails have accounts.
auth.post("/forgot", zValidator("json", z.object({ email: z.email().trim().toLowerCase().max(254) })), async (c) => {
  const { email } = c.req.valid("json");
  const db = c.env.DB;
  const user = await db
    .prepare("SELECT id, email, name FROM users WHERE email = ? AND password_hash IS NOT NULL")
    .bind(email)
    .first<{ id: number; email: string; name: string | null }>();
  // At most one email a minute per account, so the form can't be used to flood someone's inbox.
  const recent = user
    ? await db
        .prepare("SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 minute')")
        .bind(user.id)
        .first()
    : null;
  if (user && !recent) {
    const token = randomToken();
    await db.batch([
      db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at <= datetime('now')").bind(user.id),
      db
        .prepare(
          `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${RESET_MINUTES} minutes'))`,
        )
        .bind(b64url(await sha256(token)), user.id),
    ]);
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
    const tokenHash = b64url(await sha256(token));
    // The account must still have a password: one that was linked to Google since the email went out has none.
    const user = await db
      .prepare(
        `SELECT u.id, u.email, u.name, u.currency FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ? AND r.expires_at > datetime('now') AND u.password_hash IS NOT NULL`,
      )
      .bind(tokenHash)
      .first<User>();
    if (!user) return c.json({ error: "This reset link is invalid or has expired. Request a new one." }, 400);
    // New password, every reset link used up, and every existing session signed out.
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), user.id),
      db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    ]);
    await startSession(c, user.id);
    return c.json(user);
  },
);

// ---------- Google (OAuth 2.0 authorization code flow with PKCE) ----------

const redirectUri = (c: Context) => `${new URL(c.req.url).origin}/api/auth/google/callback`;
const failGoogle = (c: Context, message: string) => c.redirect(`/?auth_error=${encodeURIComponent(message)}`);

auth.get("/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return failGoogle(c, "Google sign-in is not configured");
  const state = randomToken(16);
  const verifier = randomToken();
  setCookie(c, OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax", // must survive the top-level redirect back from Google
    path: "/api/auth/google",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

type GoogleClaims = {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  exp: number;
};

auth.get("/google/callback", async (c) => {
  const [state, verifier] = (getCookie(c, OAUTH_COOKIE) ?? "").split(".");
  deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth/google" });
  const { code, state: returnedState, error } = c.req.query();
  if (error)
    return failGoogle(
      c,
      error === "access_denied" ? "Google sign-in was cancelled" : `Google sign-in failed: ${error}`,
    );
  if (!code || !state || !verifier || returnedState !== state)
    return failGoogle(c, "Google sign-in expired. Please try again.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(c),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    console.error("Google token exchange failed", res.status, await res.text());
    return failGoogle(c, "Google sign-in failed. Please try again.");
  }

  // The ID token came straight from Google's token endpoint over TLS, so its signature needn't be re-checked;
  // the claims still must be meant for this app.
  const { id_token } = await res.json<{ id_token: string }>();
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(id_token.split(".")[1]))) as GoogleClaims;
  if (
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    claims.exp * 1000 < Date.now()
  )
    return failGoogle(c, "Google sign-in failed. Please try again.");
  if (!claims.email_verified) return failGoogle(c, "Your Google email address isn't verified");

  const email = claims.email.toLowerCase();
  const db = c.env.DB;
  let user = await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(claims.sub).first<{ id: number }>();
  if (!user) {
    const byEmail = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
    if (byEmail) {
      // Google proves this person owns the email; a password set at registration never did (we don't verify
      // emails). Dropping it stops anyone who registered this email first from keeping access.
      await db
        .prepare("UPDATE users SET google_sub = ?, password_hash = NULL, name = COALESCE(name, ?) WHERE id = ?")
        .bind(claims.sub, claims.name ?? null, byEmail.id)
        .run();
      user = byEmail;
    } else {
      user = await db
        .prepare("INSERT INTO users (email, name, google_sub) VALUES (?, ?, ?) RETURNING id")
        .bind(email, claims.name ?? null, claims.sub)
        .first<{ id: number }>();
    }
  }

  await startSession(c, user!.id);
  return c.redirect("/");
});
