// Settings the Worker and the app must agree on. Server-only settings are in worker/config.ts, app-only ones in
// src/config.ts. Nothing secret belongs here: this file ships in the browser bundle.

// Display currencies a user can pick. The API rejects any other; the app offers these in its menus.
export const CURRENCIES = ["VND", "USD", "EUR", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];
