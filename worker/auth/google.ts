import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../http";
import { b64url, fromB64url, randomToken, sha256 } from "./passwords";
import { createGoogleUser, findUserIdByEmail, findUserIdByGoogleSub, linkGoogleAccount } from "./queries";
import { isHttps, startSession } from "./sessions";

// Google sign-in: OAuth 2.0 authorization code flow with PKCE. Mounted at /api/auth/google.

const OAUTH_COOKIE = "google_oauth";

const redirectUri = (c: Context) => `${new URL(c.req.url).origin}/api/auth/google/callback`;
const failGoogle = (c: Context, message: string) => c.redirect(`/?auth_error=${encodeURIComponent(message)}`);

export const google = new Hono<AppEnv>();

google.get("/", async (c) => {
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

google.get("/callback", async (c) => {
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
  let user = await findUserIdByGoogleSub(db, claims.sub);
  if (!user) {
    const byEmail = await findUserIdByEmail(db, email);
    if (byEmail) {
      await linkGoogleAccount(db, byEmail.id, claims.sub, claims.name ?? null);
      user = byEmail;
    } else {
      user = await createGoogleUser(db, email, claims.name ?? null, claims.sub);
    }
  }

  await startSession(c, user!.id);
  return c.redirect("/");
});
