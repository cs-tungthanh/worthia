# Worthia: service requirements

What the app does today, written as requirements. Use it as the reference when changing behaviour: a change
that contradicts a rule here should update this document in the same change. Setup, deployment and
third-party accounts are in the [README](../README.md).

Requirement IDs (`AUTH-3`, `STK-2`, …) are stable; reference them in commits and discussions.

## 1. Purpose and scope

Worthia is a personal finance tracker for Vietnamese investors. Each signed-in user records:

- **Stock transactions** for shares listed in Vietnam (HOSE, HNX, UPCoM, ETFs): buys, sales and bonus shares,
  typed in or imported from Pinetree statements. Holdings, average cost and profit/loss are computed from them.
- **Cash dividends** received on those stocks.
- **Savings deposits** at banks, with term, interest rate, maturity date and estimated interest.

It shows a dashboard of totals (net worth, stock value, profit/loss, dividends, savings), in the display currency
the user picks (VND by default).

**Users:** individuals managing their own money. Anyone can register; there are no roles, admins or shared
portfolios. Every record belongs to exactly one user and is visible only to that user.

**Out of scope today:** see [§12](#12-known-limitations-and-out-of-scope).

## 2. Glossary

| Term | Meaning |
|---|---|
| Transaction | A dated buy, sale or bonus-share issue of one stock (`stock_movements`). The source of truth. |
| Holding | A stock's position computed from its transactions: shares held, cost basis, average cost. |
| Bonus shares | Free shares from a stock dividend or bonus issue. They add shares but no cost. |
| Avg cost | Cost basis ÷ shares held: the broker-style moving average ("giá vốn"), buy fees included. |
| Avg cost after dividends | Avg cost lowered by the cash dividends received, as Pinetree's "TB" shows it (STK-2a). Initial value and unrealised profit/loss use it, per holding (STK-4) and on the dashboard (DSH-2). |
| Realised P/L | Profit already locked in by selling: proceeds after fees and tax − the average cost of the shares sold. Excludes dividends and shares still held. |
| Unrealised P/L | Paper profit on shares still held: current value − their cost. Changes with the price until sold. |
| Total profit | Realised + cash dividends + unrealised: everything a stock has earned or lost (LIF-7). |
| Trade date / settlement date | The day a trade happens / the day shares change hands, 2 sessions later (T+2). |
| Deposit | One savings row at one bank. |
| Term | Deposit length in months. No term = demand deposit (không kỳ hạn). |
| Password account | An account with a password set. May also be linked to Google. |
| Google-only account | An account that signs in only with Google; it has no password. |
| Display currency | The currency a user views amounts in (VND, USD, EUR or JPY). Stored amounts never change. |

## 3. Accounts and authentication

### Registration and sign-in

- **AUTH-1** A visitor can register with email, password and an optional name.
  - Email: valid format, max 254 characters, stored lowercased; unique regardless of case.
  - Password: 8–200 characters. Name: max 100 characters.
  - Registering an email that already exists fails with "An account with this email already exists. Sign in
    instead." and creates nothing.
  - Successful registration signs the user in.
- **AUTH-2** A user can sign in with email and password. Wrong password, unknown email and Google-only
  accounts all get the same message, "Wrong email or password", and take about the same time, so the form does
  not reveal which emails are registered.
- **AUTH-3** A user can sign in with Google ("Continue with Google").
  - Uses the OAuth 2.0 authorization code flow with PKCE and a `state` check; the attempt expires after 10
    minutes. Google always shows the account picker.
  - Requests only `openid email profile`. Stores the email, name and Google account id (`sub`).
  - Google sign-in is refused if Google reports the email as unverified.
  - First Google sign-in with a new email creates the account (this is registration).
- **AUTH-4** Linking: Google sign-in with an email that already has a password account links Google to it and
  **removes the password**, because registration never verifies email ownership and Google does. From then on
  the account is Google-only.
- **AUTH-5** Errors from the Google flow return the user to the sign-in page with a readable message (cancelled,
  expired, not configured, unverified email).

### Sessions

- **AUTH-6** Signing in creates a session lasting 30 days, held in an `HttpOnly`, `SameSite=Lax` cookie (`sid`),
  `Secure` on HTTPS. Only the SHA-256 of the session token is stored.
- **AUTH-7** Sign out ends the current session only.
- **AUTH-8** Every API route except the sign-in, registration and password reset routes requires a valid
  session; otherwise it answers `401`. When any data request gets `401`, the app returns to the sign-in page.
- **AUTH-9** Expired sessions and expired reset tokens are deleted opportunistically (when new ones are created).

### Password reset

- **AUTH-10** "Forgot password?" asks only for an email and always answers the same way: "If an account with a
  password exists for that email, we've sent a reset link…". It never reveals whether the email is registered.
- **AUTH-11** Only password accounts receive a reset email. Google-only accounts and unknown emails get the same
  answer and nothing is sent; Google-only users can't reset or add a password in the app.
- **AUTH-12** At most one reset email per account per minute. A new request replaces any earlier link.
- **AUTH-13** The reset link is single use, expires after 30 minutes, and only its hash is stored. Opening it
  removes the token from the address bar.
- **AUTH-14** Setting a new password (8–200 characters, entered twice) invalidates every reset link for the
  account, **signs out all its sessions**, and signs the user in. A link for an account that has since become
  Google-only no longer works.
- **AUTH-15** The email is sent after the response, so response time doesn't reveal whether an account exists.
  It contains the user's name, a button, the raw link, the expiry and a "didn't ask for this" note, in HTML and
  plain text. See [§10](#10-external-services) for providers.

### Not provided

No email verification at registration, password change while signed in, profile editing, account deletion,
"sign out everywhere" button, or rate limiting on sign-in attempts.

## 4. Stocks

### Transactions and holdings

- **STK-1** Stocks are recorded as transactions: **buy** (symbol, date, shares, price per share, fee),
  **sell** (the same plus tax) or **bonus shares** (symbol, date, shares). Symbol: 1–20 letters/digits, stored
  uppercase. Shares > 0 (decimals allowed). Price, fee and tax are VND, ≥ 0.
- **STK-2** A holding's position is computed from its transactions in date order (`shared/position.ts`), used by
  the server and the app alike:
  - buy: cost += shares × price + fee; shares += n;
  - bonus: shares += n (cost unchanged, so the average falls);
  - sell: cost −= average × n; realised += (n × price − fee − tax) − average × n; shares −= n;
  - back to 0 shares: cost resets (realised profit is kept).
  - A buy without a price makes the cost (and average) unknown until the position next returns to 0; a sale
    without a price, or from an unknown cost, makes realised profit unknown.
  - A statement whose first row implies shares held before it starts the position there, with unknown cost.
- **STK-2a** Avg cost after dividends: a second moving average, kept the same way except that each cash dividend
  lowers its cost by the amount received, on its paid date, before that day's transactions. A dividend paid after
  the position was sold out carries into the next one. It's unknown whenever avg cost is.
- **STK-3** A sale can't exceed the shares held at that point; adding, editing or deleting a transaction that
  would cause that is refused with the date and the shares held.
- **STK-4** Holdings are listed by symbol: shares, avg cost (— with a hint when buys lack prices), avg cost after
  dividends (STK-2a), current price, day change, **initial value** (shares × avg cost after dividends; Pinetree's
  *Giá trị ban đầu*), **market value** (shares × price; *Giá trị thị trường*) and unrealised profit/loss (market
  value − initial value, with percentage), as Pinetree's table shows them. A **Total** row sums initial and market
  value over the rows shown, and profit/loss over those with both. Columns sort by clicking their header; a search
  box filters by symbol.
- **STK-5** Stocks sold down to 0 move to a **Sold out** list showing their total profit: realised profit from
  sales + cash dividends (the split on hover); their lifecycle stays available.
- **STK-6** Deleting a holding asks for confirmation and deletes all its transactions and dividends.

### Importing statements

- **IMP-1** "Import statements" accepts one or both Pinetree exports (.xlsx) at once, in any order, telling them
  apart by title: the **securities statement** (*Sao kê giao dịch chứng khoán*) and the **cash statement**
  (*Sao kê giao dịch tiền*). Files are read in the browser and never uploaded. Columns are found by heading, so
  layout shifts don't matter; other files are rejected with a clear message.
- **IMP-1a** "Import statements" first opens a guide: (1) download the securities statement and (2) the cash
  statement from Pinetree, each with a link to its page (trade.pinetree.vn → Giao dịch → Sao kê …) and, once
  something was imported, the end of that statement's last imported period (IMP-10); (3) upload the .xlsx files,
  picked or dropped, one or both. The missing-statement warning (IMP-5a) links to that statement's page too.
- **IMP-2** Securities statement rows, by description: *…đã mua* = buy; *…đã bán* = sale; *…chuyển từ chờ
  giao dịch sang giao dịch* = bonus shares. Each row is dated at settlement and carries the balance after it, but
  no price.
- **IMP-3** Cash statement rows: *Chuyển tiền khớp mua* / *Nhận thanh toán tiền bán* describe each trade (trade
  date, symbol, shares, gross value, fee, tax, transfer fee); *Nhận cổ tức bằng tiền* is a cash dividend naming
  its stock. Rights subscriptions are listed but not imported; deposits, withdrawals, custody fees and loans are
  skipped.
- **IMP-4** Prices: trades are matched to securities-statement rows by symbol and side, comparing per-day totals
  (one order filled in parts may settle as one row, or as several), with settlement 0–10 days after the trade
  (the latest such trade day wins). Matched rows get price = gross value ÷ shares, fee (broker + transfer fee) and
  tax split by shares, and the trade date.
- **IMP-5** Cash statement on its own: trades matching no securities row (saved or in the same import) become
  transactions of their own, one per symbol, side and trade day (partial fills summed), dated at the trade date
  with exact price, fees and tax. Bonus shares exist only in the securities statement, so the preview warns that
  they're missing and flags stocks whose sales then exceed their buys.
- **IMP-5a** A complete timeline needs both statements. When the preview lacks one and it would add something
  (bonus shares not yet saved, or buys and sales still without a price), it shows a warning naming that statement
  and what's missing, with a button that adds the file to the same preview.
- **IMP-6** Importing the securities statement later replaces those cash-only transactions with its own rows
  (which take over their prices), so no trade is counted twice. Importing both files at once, cash then
  securities, or securities then cash all give the same holdings.
- **IMP-7** Syncing, not adding: securities rows are matched to saved ones by (symbol, settlement date, type,
  shares, balance) and only gain a price they lacked; cash-only transactions by (symbol, side, trade day); cash
  dividends by (stock, date, amount). Importing the same files again changes nothing ("Already up to date").
- **IMP-8** A preview shows the counts (new transactions, prices filled in, cash dividends, cash-only trades
  replaced) and, per stock, shares and avg cost before → after, realised profit/loss and a status
  (New / Update / No change). Nothing is saved until "Import N changes".
- **IMP-9** If saving fails midway, the error says so; importing the same files again completes the rest.
- **IMP-10** Import history: each saved import records, per statement file, the statement type, broker, file
  name, the period it covers (from its title), its rows and the changes the import saved. A **History** button
  next to "Import statements" lists them newest first and sums up the periods each statement type covers,
  merging overlapping or touching ones; more than one range means a gap. An import with no changes isn't saved,
  so it isn't recorded.

### Lifecycle view

- **LIF-1** Each holding (and sold-out stock) has a lifecycle view: totals (held now, avg cost, avg cost after
  dividends, first event,
  bought / sold, bonus shares, cash dividends, fees & tax; profit is in the summary, LIF-7), then three charts sharing one time axis
  and hover guide:
  - **Price** (daily close) with markers: ▲ buy, ▼ sell, ◆ bonus shares, ● cash dividend. The price history is
    adjusted for bonus issues and splits (noted under the chart), so it can sit below what was actually paid.
  - **Shares held** over time (step chart).
  - **Value vs cost**: market value (close × shares held) against the cost basis (STK-2); shown once any cost is
    known.
- **LIF-7** A **profit summary** gives the stock's whole result, two ways that always agree:
  - money in and out: received from sales (after fees & tax) + cash dividends + value of shares held (shares ×
    live price, else the last close) − invested (every buy: shares × price + fee);
  - by source: realised from sales + cash dividends + unrealised on shares held (value − their cost).
  - Return % = total ÷ invested (all buys over the stock's history, including buying again after selling out).
  - Shown as "—" while a buy or sale has no price.
- **LIF-2** A transactions table, newest first: date (trade date when known, else settlement), event, shares,
  price, fee & tax, amount (shares × price, or the dividend), **profit vs avg cost** for sales, and shares held
  after. A sale's profit = shares × price − fee − tax − shares × the average cost just before the sale (every
  earlier buy with its fees, over the shares then held, bonus shares included). Later buys don't change it.
  Hovering it shows the sum.
- **LIF-3** Transactions are edited and deleted here. Imported transactions keep their date, type and shares
  (re-importing relies on them) and allow only price, fee and tax to change; transactions entered in the app can
  change date, shares, price, fee and tax. Deleting asks for confirmation; deleting an imported one notes that
  re-importing brings it back (and while its statement's later balances remain, the shares stay, as an opening
  position of unknown cost).
- **LIF-4** Charts start two weeks before the first event (a year back with none) and end at the last trading day,
  extended to any later event at the last known price.
- **LIF-5** Hovering a chart shows one tooltip there (date, price, held, value, cost, that day's events) and a guide
  line on the others. Amounts follow the display currency. Event colours (blue buy, orange sell, aqua dividends)
  are validated for colour-blind separation in light and dark; shapes and labels also carry the meaning.
- **LIF-6** Price history comes from the same source as live prices (PRC-3), cached an hour per Worker instance.

## 5. Cash dividends

- **DIV-1** A cash dividend belongs to one stock (held or sold out) and has the VND actually received (after the
  5% tax), a whole number ≥ 0, and a paid date. Bonus shares are transactions (STK-1), not dividends.
- **DIV-2** Listed newest first; editing replaces values; deleting asks for confirmation. A dividend can only
  reference the user's own stock.

## 6. Savings deposits

- **SAV-1** A user can add a deposit: bank (required, 1–100 characters), amount (required, whole number ≥ 0),
  currency (picked from the supported list VND, USD, EUR, JPY; default VND; a deposit saved earlier in another
  currency keeps it when edited), annual interest rate % (optional, 0–100, up to 2 decimals), start
  date (optional, defaults to today), term in months (optional, 1–600; empty = no term).
- **SAV-2** Bank names: the field suggests favourite banks, then 25 common Vietnamese banks, then banks already
  used. A typed name that matches a known one ignoring case is saved with the known spelling.
- **SAV-3** Term suggestions: 1, 3, 6, 9, 12, 13, 18, 24, 36 months; any whole number is accepted.
- **SAV-4** Maturity date = start date + term months, clamped to the month's last day (31 Jan + 1 month =
  28/29 Feb). Shown only with both start date and term; dimmed once past.
- **SAV-5** Estimated interest at maturity = `amount × rate% × term months ÷ 12`, rounded; simple interest, an
  estimate because banks count actual days. Shown only with both rate and term.
- **SAV-6** Listed by bank, then start date. Clicking the Bank, Start or Matures header sorts by it, ascending
  then descending; deposits without that date stay last. Editing replaces values; deleting asks for confirmation.
- **SAV-7** *Group by bank* shows each bank as a heading with its number of deposits and their total in the
  display currency (a currency without a rate is totalled in its own currency), its deposits beneath in the
  current sort; banks follow the order of their first deposit. The switch is remembered per browser.

### Favourite banks

- **FAV-1** A user can star or unstar the bank currently typed in the deposit form. Favourites are per user,
  unique by name, and listed in the order they were added.
- **FAV-2** Favourites appear as quick-pick chips above the form and are marked ★ in suggestions.
- **FAV-3** Starring an already-favourite bank or unstarring a non-favourite is harmless (idempotent).

## 7. Prices

- **PRC-1** The app fetches the latest price for every held symbol on load and every 60 seconds while open.
  Failed refreshes keep showing the last prices.
- **PRC-2** `GET /api/prices?symbols=…` accepts up to 40 distinct symbols (A–Z, 0–9, 1–20 characters; invalid
  ones are ignored, duplicates merged, case-insensitive) and returns, per symbol, `{ price, prevClose, time }`
  in VND, or `null` if it isn't listed or the source failed.
- **PRC-3** Source: Entrade's public daily-candle chart API (unofficial). Price = latest daily close × 1000;
  previous close = the candle before it; looks back 14 days to cover weekends and holidays. 8-second timeout.
- **PRC-4** Each quote is cached for 60 seconds per Worker instance.
- **PRC-5** If the source is down, prices show "—" and everything else keeps working.

## 8. Display currency

- **CUR-1** A user can pick a display currency from VND, USD, EUR and JPY in the header. The default is VND.
  The choice is saved on the account, so it applies on every device, and takes effect immediately.
- **CUR-2** Stored amounts keep their own currency: stock prices, avg buy prices and cash dividends are in VND;
  each deposit is in its own currency. Forms always take amounts in that stored currency; VND-only fields say
  "(VND)".
- **CUR-3** Every amount shown (dashboard tiles, prices, values, profit/loss, dividends, deposit amounts and
  estimated interest) is converted into the display currency. Percentages are unaffected.
- **CUR-4** When a deposit's currency differs from the display currency, the original amount is shown under the
  converted one.
- **CUR-5** Exchange rates come from ExchangeRate-API's free open-access endpoint (base VND, about 160
  currencies), updated daily by the source, cached for one hour per Worker instance, and reloaded by the app
  every hour. If the source fails, the last good rates are used.
- **CUR-6** If rates are unavailable, or a currency has no rate, those amounts are shown in their own currency
  rather than converted, so nothing shows a wrong number.
- **CUR-7** The dashboard shows the rate used (e.g. "1 USD = 25.641 ₫"), the date the rates were updated, and the
  credit link "Rates by ExchangeRate-API" required by its terms, whenever rates are in use.

## 9. Dashboard and presentation

- **DSH-1** Header shows the app name, the user's name (or email) and Sign out.
- **DSH-2** Summary tiles:
  Totals are added up in VND, then shown in the display currency (CUR-3).
  - **Net worth** = stocks value + all savings converted to VND. Savings in a currency with no exchange rate are
    left out, and a note under the tiles says which.
  - **Stocks** = Σ price × shares held over holdings that have a price.
  - **Stocks profit/loss (after dividends)**: over holdings with a known cost and a price, value − cost after
    dividends (avg cost after dividends × shares, STK-2a), as Pinetree totals it. Hidden if no holding qualifies.
  - **Realised profit/loss**: Σ realised profit over stocks whose sales can be valued (STK-2); hidden while 0.
  - **Cash dividends received** = Σ cash dividends; hidden when 0.
  - **Savings**: all convertible deposits in one total; any currency without a rate gets its own tile in that
    currency.
- **DSH-3** Formatting: VND uses Vietnamese conventions. Dashboard tiles show the full amount (`52.900 ₫`);
  table cells shorten it with K = thousand, M = million, B = billion, up to 2 decimals (`52,9K`, `1,07M`,
  `1,25B`), using the largest unit reached (999.999 shows as `1M`) and plain digits under 1.000; other currencies use their usual symbol and decimals (`$1,234.56`, `€3.50`, `¥916,627`). Inputs use `.` for thousands and `,` for decimals.
  A shortened amount shows the full one on hover, or on tap on a phone (`1,22M` → `1.222.000 ₫`).
  Dates show as day/month/year (`08/11/2026`; import times `08/11/2026 15:48`, local time) and date pickers
  accept `DD/MM/YYYY`; the API and database keep `YYYY-MM-DD`.
- **DSH-4** Responsive: below the `md` breakpoint, lists become one card per row; wider screens show tables.
  Light and dark themes follow the device setting.
- **DSH-5** Request errors appear in a red alert at the top; validation errors show the first problem in words.

## 10. External services

| Service | Used for | Failure impact |
|---|---|---|
| Cloudflare Workers + D1 | Hosting, API, database | Whole app down |
| Google OAuth | AUTH-3 | Google sign-in fails; email/password works |
| Brevo (current) or Resend | Reset emails (AUTH-15) | Reset emails not sent; the rest works |
| Entrade chart API | PRC-3 | Prices show "—" |
| ExchangeRate-API | CUR-5 | Amounts shown in their own currency (CUR-6) |

Email provider: Brevo if `BREVO_API_KEY` is set, else Resend if `RESEND_API_KEY` is set; both need
`EMAIL_FROM`. With neither on localhost, reset links are printed to the dev server log; in production nothing is
sent and an error is logged. Details and setup: [README → Third-party services](../README.md#third-party-services).

## 11. Non-functional requirements

### Security and privacy

- **SEC-1** Passwords are hashed with PBKDF2-SHA256, 100,000 iterations (the Workers maximum), 16-byte random salt;
  compared in constant time.
- **SEC-2** Session and reset tokens are 256-bit random values; only their SHA-256 is stored.
- **SEC-3** Every data query is scoped to the signed-in user; another user's row behaves as "Not found".
- **SEC-4** Cookies are `HttpOnly` and `SameSite=Lax` (blocks cross-site writes); `Secure` on HTTPS.
- **SEC-5** Request bodies are validated (types, ranges, lengths) before reaching the database.
- **SEC-6** User-supplied text placed in emails is HTML-escaped.
- **SEC-7** Secrets live in `.dev.vars` locally and Worker secrets in production, never in code; secret files
  in the repo go in `.credential/` (git-ignored).
- **SEC-8** Third parties receive only what they need: Brevo/Resend the recipient's email and reset link; Entrade
  stock symbols; ExchangeRate-API nothing at all; Google nothing beyond the sign-in redirect.

### Platform and limits

- **NFR-1** Runs on Cloudflare's free plan: one Worker serves the frontend and `/api`, one D1 (SQLite) database.
  No work may run at module load (Workers forbid random values and I/O outside handlers).
- **NFR-2** Free-plan limits to stay within: 10 ms CPU per request, 50 subrequests per request (hence the
  40-symbol cap), 100,000 requests/day, 5 GB D1.
- **NFR-3** Schema changes only through numbered migrations in `migrations/`; applied migrations are never edited.
- **NFR-4** Backups: D1 7-day point-in-time restore, plus manual `pnpm db:backup` exports.

## 12. Known limitations and out of scope

- No email verification; no sign-in rate limiting or lockout.
- No password change or account deletion in the app; Google-only users can't set a password.
- Only four display currencies; stocks and dividends can only be entered in VND.
- Conversion uses today's rate for everything, including past buys and dividends (no historical rates).
- Interest is a simple estimate; no compounding, early withdrawal or rollover.
- Prices rely on an unofficial endpoint that can change without notice.
- Single language (English UI) and Vietnamese number formatting; no export.
- Statement import supports Pinetree only; without the cash statement, imported trades have no prices.
- Only the moving-average cost method (no FIFO / tax lots); stocks can only be traded in VND.
- Rights subscriptions aren't imported; cash movements other than trades and dividends (deposits, fees, loans)
  aren't tracked.
- No notes on holdings, dividends or deposits. The `note` columns remain in the database (older rows may have
  one) but the API neither accepts nor changes them.

## 13. API summary

All under `/api`, JSON in and out. ✱ = no session required.

| Method and path | Purpose | Rules |
|---|---|---|
| `POST /auth/register` ✱ | Create password account, sign in | AUTH-1 |
| `POST /auth/login` ✱ | Password sign-in | AUTH-2 |
| `GET /auth/google` ✱, `GET /auth/google/callback` ✱ | Google sign-in | AUTH-3–5 |
| `POST /auth/logout` ✱ | End current session | AUTH-7 |
| `GET /auth/me` | Current user `{ id, email, name, currency }` | AUTH-8 |
| `PATCH /auth/me` | `{ currency }` → updated user | CUR-1 |
| `POST /auth/forgot` ✱ | Request reset email; always `{ ok: true }` | AUTH-10–12 |
| `POST /auth/reset` ✱ | `{ token, password }` → new password, signed in | AUTH-13–14 |
| `GET /stocks` | Holdings computed from transactions: `{ id, symbol, shares, avg_price, net_avg_price, cost, realised, unpriced, cash_only, first_date }` | STK-2, STK-4 |
| `DELETE /stocks/:id` | Delete a holding with its transactions and dividends | STK-6 |
| `GET/POST /dividends`, `PUT/DELETE /dividends/:id` | Cash dividends | DIV-1–2 |
| `GET/POST /savings`, `PUT/DELETE /savings/:id` | Deposits | SAV-1, SAV-6–7 |
| `GET /favourite-banks`, `PUT/DELETE /favourite-banks/:name` | Favourite banks | FAV-1–3 |
| `GET /prices?symbols=` | Latest prices | PRC-2–4 |
| `GET /prices/history?symbol=&from=` | Daily closes since `from`; `503` if unavailable | LIF-6 |
| `GET /movements?symbol=` | Transactions (all, or one symbol) | LIF-2 |
| `POST /movements` | Add `{ symbol, date, kind, quantity, price?, fee?, tax? }`; `400` if it oversells | STK-1, STK-3 |
| `PUT /movements/:id`, `DELETE /movements/:id` | Edit / delete; imported rows only change price, fee, tax | LIF-3, STK-3 |
| `POST /movements/import` | `{ movements, cashMovements, remove, dividends, files, changes }` worked out by the app; returns `{ ok, warnings }` | IMP-4–7, IMP-10 |
| `GET /imports` | Import history, newest first: `{ id, statement, broker, file_name, period_from, period_to, rows, changes, imported_at }` | IMP-10 |
| `GET /rates` | `{ base: "VND", rates, updated, source }`; `503` if never loaded | CUR-5 |

Errors: `400` invalid input, `401` not signed in / wrong credentials, `404` not found (including other users'
rows), `409` email already registered, `500` unexpected. Bodies are `{ "error": "message" }`, except validation
failures, which carry the validator's details.

## 14. Data model

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `email` (unique, case-insensitive), `name`, `google_sub` (unique), `password_hash`, `currency` | A user has a Google id, a password, or both; `currency` defaults to VND |
| `sessions` | `token_hash`, `user_id`, `expires_at` | 30-day sessions |
| `password_resets` | `token_hash`, `user_id`, `expires_at` | 30-minute single-use links |
| `stock_movements` | `id`, `user_id`, `symbol`, `date`, `kind`, `quantity`, `balance`, `price`, `fee`, `tax`, `trade_date`, `source`, `origin` | The transactions (source of truth). `origin`: `securities` (unique per symbol, date, kind, quantity, balance), `cash` (unique per symbol, trade date, kind) or NULL for ones entered in the app |
| `import_history` | `id`, `user_id`, `statement`, `broker`, `file_name`, `period_from`, `period_to`, `rows`, `changes`, `imported_at` | One row per statement file per saved import (IMP-10) |
| `stocks` | `id`, `user_id`, `symbol` (unique per user) | A holding's identity, for dividends to point at; its `shares` / `avg_price` columns are legacy and unused |
| `dividends` | `id`, `user_id`, `stock_id`, `cash_amount`, `paid_date` | Cash only (`type = 'cash'`); deleted with their stock |
| `savings` | `id`, `user_id`, `bank`, `amount`, `currency`, `interest_rate`, `start_date`, `term_months` | Maturity is derived, not stored |
| `favourite_banks` | `user_id`, `name` (unique together) | |

`stocks`, `dividends` and `savings` also have an unused `note` column, kept so older data isn't lost. Migration
`0005` turned the earlier typed-in totals into transactions (stock dividends → bonus shares; an opening buy or sale
for any difference), preserving every holding's total.

Deleting a user deletes all their rows. Full definitions: [migrations/](../migrations/).
