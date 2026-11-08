// The app's tunable values, in one place. Values the Worker must agree on are in shared/config.ts.
// Everything here ships in the browser bundle: never put a secret in it.

export { CURRENCIES, type Currency } from "../shared/config";

// How often open pages refresh market data. The Worker caches prices for a minute and rates for an hour.
export const PRICE_REFRESH_MS = 60_000;
export const RATES_REFRESH_MS = 60 * 60_000; // the source updates daily

// Where Pinetree lets a signed-in customer download each statement as Excel.
export const PINETREE_STATEMENTS = {
  securities: {
    url: "https://trade.pinetree.vn/#/home/transaction/securities-statement",
    title: "Sao kê giao dịch chứng khoán",
    what: "buys, sales and bonus shares",
  },
  cash: {
    url: "https://trade.pinetree.vn/#/home/transaction/cash-statement",
    title: "Sao kê giao dịch tiền",
    what: "trade prices, fees, tax and cash dividends",
  },
} as const;

// Common Vietnamese deposit terms, offered as suggestions; any whole number of months is accepted.
export const TERM_SUGGESTIONS = ["1", "3", "6", "9", "12", "13", "18", "24", "36"];

// Common Vietnamese banks, offered as suggestions; any other name can be typed and is suggested once used.
export const PREDEFINED_BANKS = [
  "Vietcombank",
  "BIDV",
  "VietinBank",
  "Agribank",
  "Techcombank",
  "MB Bank",
  "ACB",
  "VPBank",
  "Sacombank",
  "TPBank",
  "HDBank",
  "VIB",
  "SHB",
  "MSB",
  "OCB",
  "SeABank",
  "LPBank",
  "Eximbank",
  "Nam A Bank",
  "Bac A Bank",
  "ABBank",
  "PVcomBank",
  "Cake",
  "Timo",
  "Tikop",
];
