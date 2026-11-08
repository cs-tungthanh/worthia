import { PASSWORD } from "../config";

// Encoding, token and password-hashing helpers. Pure: no database, no request.

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
// Session and reset tokens are stored only as this hash, so a leaked table can't be used to sign in.
export const hashToken = async (token: string) => b64url(await sha256(token));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
  );
}

// Stored as pbkdf2$<iterations>$<salt>$<hash> so the iteration count can be raised later.
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = PASSWORD.pbkdf2Iterations;
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter));
  const expected = fromB64url(hash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

// Hash compared against when the email is unknown, so a wrong email takes as long as a wrong password.
// Made on first use: Workers forbid generating random values at module load.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));
