// Date display shared by the Worker (error messages) and the app. Dates travel as YYYY-MM-DD and are shown
// day/month/year.

// 2026-11-08 → 08/11/2026; `missing` when there is no date.
export const dmy = (iso: string | null | undefined, missing = "?") =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : missing;
