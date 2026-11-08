# Worthia

_Know what you're worth._

Personal tracker for stock holdings (shares per symbol) and savings deposits across banks.

Stack: Cloudflare Workers (Hono API under `/api`) + D1 (SQLite) + React/Vite frontend, served by one Worker.

What the app does, rule by rule: [docs/requirements.md](docs/requirements.md).

## Run locally

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in for Google sign-in; email/password works without it
pnpm db:migrate:local
pnpm dev
```

Open http://localhost:5173. Local data lives in `.wrangler/` and never leaves your machine.

## Accounts

Each account sees only its own holdings, savings, dividends and favourite banks. Anyone can register, either
with **Continue with Google** or with an email and password (hashed with PBKDF2-SHA256). Sessions last 30 days
in an HttpOnly cookie; only a SHA-256 of the session token is stored.

- **Google setup:** in Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID
  (Web application) with redirect URIs `http://localhost:5173/api/auth/google/callback` and
  `https://<your-worker>.workers.dev/api/auth/google/callback`. Put the ID and secret in `.dev.vars` locally,
  and in production run `pnpm wrangler secret put GOOGLE_CLIENT_ID` and `... GOOGLE_CLIENT_SECRET`.
- **Same email, both methods:** signing in with Google to an email that was registered with a password links
  the two and **removes the password** (emails are never verified at registration, so Google is the proof of
  ownership). From then on that account signs in with Google.
- **Forgot password:** accounts with a password get an emailed link (single use, valid 30 minutes) that sets a
  new password and signs out every other session. Google-only accounts can't reset here; they use Google.
  The form answers the same way whatever the email, and sends at most one link a minute per account.
  Emails need `EMAIL_FROM` plus one provider key (see [worker/email/send.ts](worker/email/send.ts)):
  - **[Brevo](https://brevo.com), free, no domain:** verify a sender address (e.g. your Gmail) under Senders, then set
    `BREVO_API_KEY` and `EMAIL_FROM=Worthia <you@gmail.com>`. Emails from a Gmail address may land in spam.
  - **[Resend](https://resend.com), needs a domain you own:** verify it there, then set `RESEND_API_KEY` and
    `EMAIL_FROM=Worthia <noreply@yourdomain.com>`.

  Locally, leave them empty and the link is printed in the `pnpm dev` output instead.

## Third-party services

Everything the app talks to outside its own code. All run on free tiers; the only optional cost is a custom domain.

| Service | Used for | Plan / cost | Config | If it's down or unset |
|---|---|---|---|---|
| [Cloudflare](https://dash.cloudflare.com) Workers + D1 | Hosting the API and frontend; the database | Free | `wrangler.jsonc`, `pnpm wrangler login` | The whole app is down |
| [Google Cloud](https://console.cloud.google.com) OAuth | **Continue with Google** | Free | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in fails; email/password still works |
| [Brevo](https://app.brevo.com) | Password reset emails (current provider) | Free, 300 emails/day | `BREVO_API_KEY`, `EMAIL_FROM` | Reset emails aren't sent (the error is in `pnpm wrangler tail`); everything else works |
| [Resend](https://resend.com) | Alternative email provider, used only if `BREVO_API_KEY` is unset | Free, 3,000 emails/month; needs your own domain | `RESEND_API_KEY`, `EMAIL_FROM` | Same as Brevo |
| [Entrade](https://services.entrade.com.vn) chart API | Live Vietnamese stock prices | Free, unofficial, no account | None | Prices show "—"; everything else works |
| [ExchangeRate-API](https://www.exchangerate-api.com/docs/free) | Exchange rates for the display currency | Free open access, no key; credit link required | None | Amounts show in their own currency; everything else works |

Secrets live in `.dev.vars` locally (git-ignored; template in [.dev.vars.example](.dev.vars.example)) and as Worker
secrets in production (`pnpm wrangler secret put NAME`, listed with `pnpm wrangler secret list`).

**Cloudflare.** One Worker (`wealth`) serves the React app and the `/api` routes; one D1 database (`wealth-db`)
holds all data. The free plan's limits (100k requests/day, 10 ms CPU per request, 5 GB D1) are far above what
this app uses. Manage both under Workers & Pages and Storage & databases → D1 in the dashboard.
They keep their names from before the rename to Worthia: renaming the Worker would deploy a new one at a new
`*.workers.dev` URL (breaking the Google redirect URI), and a D1 database cannot be renamed.

**Google OAuth.** An OAuth client of type "Web application" in Google Cloud Console → APIs & Services →
Credentials. Its authorized redirect URIs must list every place the app runs, exactly:
`http://localhost:5173/api/auth/google/callback` and `https://<your-worker>.workers.dev/api/auth/google/callback`.
The consent screen must be published (or your account added as a test user) for sign-in to work. The app asks
only for `openid email profile` and stores the email, name and Google account id.

**Brevo.** Sends from a single verified sender address (Senders, Domains & Dedicated IPs → Senders), so no domain
is needed; `EMAIL_FROM` must use exactly that address, e.g. `Worthia <you@gmail.com>`. Mail from a Gmail address
sent through Brevo may land in spam. The API key is under SMTP & API → API Keys; delivery status per email is
under Transactional → Logs. Brevo receives only the recipient's email and the reset link.

**Resend.** Only needed if you buy a domain and want `Worthia <noreply@yourdomain.com>`: verify the domain under
Domains (add its DNS records), set `RESEND_API_KEY`, and remove `BREVO_API_KEY`. Brevo can also send from a
verified domain, so switching providers is optional.

**ExchangeRate-API.** `open.er-api.com/v6/latest/VND`, the free open-access endpoint: no key, updated once a day,
rate-limited if called too often, so the Worker caches it for an hour (see [worker/market/rates.ts](worker/market/rates.ts)).
Its terms require the "Rates by ExchangeRate-API" link, which the dashboard shows whenever rates are used. It
receives no user data.

**Entrade.** `services.entrade.com.vn/chart-api` is a public endpoint used by DNSE's charts, not a documented API;
it can change or disappear without notice. The Worker sends it only stock symbols, never user data. See
[Stock prices](#stock-prices).

## Deploy (first time)

1. `pnpm wrangler login`
2. `pnpm wrangler d1 create wealth-db`, then paste the printed `database_id` into `wrangler.jsonc`.
3. `pnpm db:migrate:remote`
4. `pnpm run deploy` (prints your `*.workers.dev` URL)
5. Set the secrets from [Accounts](#accounts) (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_FROM`, and `BREVO_API_KEY` or `RESEND_API_KEY`).
   Every API route except sign-in and registration requires a signed-in user.

## Schema changes

Add a new numbered file in `migrations/` (e.g. `0002_add_price.sql`), then run `pnpm db:migrate:local`
and, when ready, `pnpm db:migrate:remote`. Never edit a migration that has already been applied.

## Backups

D1 keeps 7 days of point-in-time restore on the free plan. Also export regularly:

```bash
pnpm db:backup
```

`backup.sql` is git-ignored; store it somewhere private.

## API

Apart from the `/api/auth` sign-in routes, every route needs a session cookie and acts on the signed-in user's rows only.

| Method | Path | Body |
|---|---|---|
| GET | `/api/auth/google` | redirects to Google; the callback is `/api/auth/google/callback` |
| POST | `/api/auth/register` | `{ email, password, name? }` (password ≥ 8 chars) |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | returns `{ id, email, name, currency }` |
| PATCH | `/api/auth/me` | `{ currency: "VND" \| "USD" \| "EUR" \| "JPY" }` |
| POST | `/api/auth/forgot` | `{ email }`; always `{ ok: true }` |
| POST | `/api/auth/reset` | `{ token, password }`; token comes from the emailed link |

| Method | Path | Body |
|---|---|---|
| GET | `/api/stocks` | holdings computed from transactions |
| DELETE | `/api/stocks/:id` | deletes the holding, its transactions and dividends |
| GET | `/api/movements?symbol=` | transactions |
| POST / PUT `/:id` | `/api/movements` | `{ symbol, date, kind: "buy" \| "sell" \| "bonus", quantity, price?, fee?, tax? }` |
| DELETE | `/api/movements/:id` | |
| POST | `/api/movements/import` | `{ movements, cashMovements?, remove?, dividends?, files?, changes? }` worked out by the import screen; returns `{ ok, warnings }` |
| GET | `/api/imports` | import history, newest first |
| GET | `/api/savings` | |
| POST / PUT `/:id` | `/api/savings` | `{ bank, amount, currency?, interest_rate?, start_date?, term_months? }` |
| DELETE | `/api/savings/:id` | |
| GET | `/api/dividends` | |
| POST / PUT `/:id` | `/api/dividends` | `{ stock_id, type: "cash", cash_amount, paid_date }` |
| DELETE | `/api/dividends/:id` | |

## Backend layout

The Worker ([worker/](worker/)) is split by business domain. Each domain has a `routes.ts` (a Hono router: paths,
zod validation, status codes) and a `queries.ts` (its D1 SQL, nothing else); rules that are neither live in their
own file. [worker/index.ts](worker/index.ts) only signs requests in, mounts the routers and maps errors.

| Domain | Owns | Notes |
|---|---|---|
| `auth/` | `users`, `sessions`, `password_resets`; `/api/auth/*` | `sessions.ts` (cookie + `requireUser` middleware), `passwords.ts` (hashing, tokens), `google.ts` (OAuth) |
| `holdings/` | `stocks`, `stock_movements`; `/api/stocks`, `/api/movements` | `positions.ts`: holding summaries and the oversell check, on top of [shared/position.ts](shared/position.ts) |
| `imports/` | `import_history`; `POST /api/movements/import`, `/api/imports` | Applies the plan the app worked out, in one batch |
| `dividends/` | `dividends`; `/api/dividends` | Cash only; bonus shares are movements |
| `savings/` | `savings`, `favourite_banks`; `/api/savings`, `/api/favourite-banks` | |
| `market/` | `/api/prices`, `/api/rates` | Entrade prices and exchange rates, cached per Worker instance; no database |
| `email/` | | Brevo/Resend sending and the email templates |

[worker/http.ts](worker/http.ts) holds what every router shares (`AppEnv`, `idParam`). A domain may read another
domain's queries (holdings reads dividends to work out net cost; imports writes holdings and dividends) but routes
never call each other. Position math lives only in `shared/position.ts`, which the app also uses, so the server
and the import preview always agree.

## Stocks: transactions

Stocks are recorded as transactions (buy, sell, bonus shares), not totals. Each holding's shares, moving-average
cost (fees included, like the broker's "giá vốn") and realised profit/loss are computed from them by
[shared/position.ts](shared/position.ts), which the Worker and the app both use. Add transactions with the form
under the holdings; edit or delete them in a stock's lifecycle view. Sales can't exceed the shares held.

## Importing statements

**Import statements** (next to the Stocks heading) takes Pinetree's two exports (.xlsx), together or separately:
the securities statement (*Sao kê giao dịch chứng khoán*: buys, sales, bonus shares) and the cash statement
(*Sao kê giao dịch tiền*: each trade's price, fees and tax, and cash dividends). The cash statement alone records
your buys and sales; the securities statement adds bonus shares and, when imported, takes over those trades
(matched across T+2 settlement and partial fills) so nothing counts twice. Every import is previewed and synced:
importing again changes nothing. Files are parsed
in the browser ([src/import/](src/import/)) and never uploaded. Rules: IMP-1…7 in
[docs/requirements.md](docs/requirements.md).

Statement files contain your account number; `*.xlsx` is git-ignored so they aren't committed by accident.

## Lifecycle view

The chart icon on a holding opens its lifecycle: price with buy/sell/dividend markers, shares held, value vs
cost, and the stock's transactions, which can be edited there. Charts use
[Mantine Charts](https://mantine.dev/charts/getting-started/) (Recharts); the price history they draw is adjusted for
bonus issues. Rules: LIF-1…6 in [docs/requirements.md](docs/requirements.md).

## Stock prices

`GET /api/prices?symbols=FPT,VCB` returns the latest price in VND (and the previous close) for each symbol,
or `null` if it isn't listed in Vietnam. Prices come from Entrade's public chart API (HOSE, HNX, UPCoM, ETFs),
are cached for 60 seconds, and the page refreshes them every minute. Up to 40 symbols per request.
This is an unofficial public endpoint: if it stops answering, prices show "—" and the rest of the app keeps working.

## Cash dividends

Cash dividends record the VND you actually received (after the 5% tax) and are summed in "Cash dividends
received"; the cash statement import adds them automatically. Bonus shares (stock dividends) are transactions:
they add shares at no cost, which lowers the average cost. Deleting a holding deletes its dividends.
