import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { GOOGLE, googleSettings } from "../config";
import type { AppEnv } from "../http";
import { b64url, fromB64url, randomToken, sha256 } from "./passwords";
import { createGoogleUser, findUserIdByEmail, findUserIdByGoogleSub, linkGoogleAccount } from "./queries";
import { isHttps, startSession } from "./sessions";

// Google sign-in: OAuth 2.0 authorization code flow with PKCE. Mounted at /api/auth/google.

const redirectUri = (c: Context) => `${new URL(c.req.url).origin}/api/auth/google/callback`;
const failGoogle = (c: Context, message: string) => c.redirect(`/?auth_error=${encodeURIComponent(message)}`);

export const google = new Hono<AppEnv>();

google.get("/", async (c) => {
  const settings = googleSettings(c.env);
  if (!settings) return failGoogle(c, "Google sign-in is not configured");
  const state = randomToken(16);
  const verifier = randomToken();
  setCookie(c, GOOGLE.stateCookie, `${state}.${verifier}`, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax", // must survive the top-level redirect back from Google
    path: "/api/auth/google",
    maxAge: GOOGLE.stateMaxAgeSeconds,
  });
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri(c),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return c.redirect(`${GOOGLE.authUrl}?${params}`);
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
  const [state, verifier] = (getCookie(c, GOOGLE.stateCookie) ?? "").split(".");
  deleteCookie(c, GOOGLE.stateCookie, { path: "/api/auth/google" });
  const { code, state: returnedState, error } = c.req.query();
  if (error)
    return failGoogle(
      c,
      error === "access_denied" ? "Google sign-in was cancelled" : `Google sign-in failed: ${error}`,
    );
  if (!code || !state || !verifier || returnedState !== state)
    return failGoogle(c, "Google sign-in expired. Please try again.");
  const settings = googleSettings(c.env);
  if (!settings) return failGoogle(c, "Google sign-in failed. Please try again.");

  const res = await fetch(GOOGLE.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
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
    claims.aud !== settings.clientId ||
    !(GOOGLE.issuers as readonly string[]).includes(claims.iss) ||
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
