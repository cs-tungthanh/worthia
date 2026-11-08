// The Worker's configuration, in one place: the secrets it reads from the environment and the tunable values
// every domain uses. Values both the Worker and the app need are in shared/config.ts.
//
// Secrets come from `.dev.vars` locally (template: .dev.vars.example) and `pnpm wrangler secret put NAME` in
// production. Everything else is a constant here: changing one is a commit and a deploy.

// ---------- environment ----------

export type Secrets = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Email: EMAIL_FROM plus one provider key (Brevo wins if both are set). See email/send.ts.
  EMAIL_FROM?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
};
export type Bindings = Env & Secrets;

export type GoogleSettings = { clientId: string; clientSecret: string };
export type EmailSettings = { from: string; provider: "brevo" | "resend"; apiKey: string };

// Null when Google sign-in isn't set up. An empty value counts as unset.
export function googleSettings(env: Secrets): GoogleSettings | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null;
}

// Null when no email provider is set up: password reset links are then only logged locally.
export function emailSettings(env: Secrets): EmailSettings | null {
  if (!env.EMAIL_FROM) return null;
  if (env.BREVO_API_KEY) return { from: env.EMAIL_FROM, provider: "brevo", apiKey: env.BREVO_API_KEY };
  if (env.RESEND_API_KEY) return { from: env.EMAIL_FROM, provider: "resend", apiKey: env.RESEND_API_KEY };
  return null;
}

// ---------- accounts ----------

export const SESSION = { cookie: "sid", days: 30 } as const;

export const PASSWORD = {
  minLength: 8,
  pbkdf2Iterations: 100_000, // Workers caps PBKDF2 at 100k
} as const;

export const PASSWORD_RESET = {
  minutes: 30, // how long an emailed link works
  // At most one email a minute per account, so the form can't be used to flood someone's inbox.
  cooldownMinutes: 1,
} as const;

export const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  issuers: ["accounts.google.com", "https://accounts.google.com"],
  stateCookie: "google_oauth",
  stateMaxAgeSeconds: 600, // time allowed on Google's sign-in page
} as const;

export const EMAIL_PROVIDERS = {
  brevo: "https://api.brevo.com/v3/smtp/email",
  resend: "https://api.resend.com/emails",
} as const;

// ---------- market data ----------

export const PRICES = {
  // Entrade's public chart API: daily candles in thousands of VND.
  url: "https://services.entrade.com.vn/chart-api/v2/ohlcs/stock",
  // Each symbol is one upstream subrequest; Workers Free allows 50 per invocation.
  maxSymbols: 40,
  cacheMs: 60_000,
  timeoutMs: 8_000,
  // Two weeks covers weekends and Tết-length holidays. Thinly traded stocks (e.g. CMF) can go weeks without a
  // trade, so an empty answer is retried over a year: their last trade price is what brokers value them at.
  lookbackDays: [14, 365],
  // History doesn't change, only the last candle moves.
  historyCacheMs: 60 * 60_000,
  historyCacheEntries: 200, // per Worker instance
  historyTimeoutMs: 10_000,
  historyEarliest: "2000-01-01",
} as const;

export const RATES = {
  // ExchangeRate-API's free open-access endpoint (https://www.exchangerate-api.com/docs/free). No key needed;
  // its terms require a visible credit link, which the app shows next to the totals.
  url: "https://open.er-api.com/v6/latest/VND",
  credit: "https://www.exchangerate-api.com",
  cacheMs: 60 * 60_000, // rates change daily; one upstream call per hour per Worker instance is plenty
  timeoutMs: 8_000,
} as const;
