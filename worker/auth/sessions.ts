import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../http";
import { hashToken, randomToken } from "./passwords";
import { createSession, deleteSession, findSessionUser } from "./queries";

// Session cookies and the middleware that turns one into c.var.user.

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

export async function startSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken();
  await createSession(c.env.DB, await hashToken(token), userId, SESSION_DAYS);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, await hashToken(token));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

async function sessionUser(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return findSessionUser(c.env.DB, await hashToken(token));
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
