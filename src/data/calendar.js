// src/data/calendar.js
// ─────────────────────────────────────────────────────────────────────────
// Year registry for the marketing calendar. The app imports year-independent
// constants directly from here, and calls getCalendar(year) to obtain the data
// bundle (holidays, events, campaigns, visitor intensity, hot/cold, helpers) for
// the selected year. Add a new year by creating calendarYYYY.js (same exports as
// calendar2026.js) and registering it in BY_YEAR below.

import * as C2026 from "./calendar2026.js";
import * as C2027 from "./calendar2027.js";

export const YEARS = [2026, 2027];
export const DEFAULT_YEAR = 2026;

const BY_YEAR = { 2026: C2026, 2027: C2027 };

// The full data bundle (plus year-aware helpers) for a given year.
export function getCalendar(year) {
  return BY_YEAR[year] || C2026;
}

// ─── Year-independent constants (identical across years) ───
// Safe to import directly; they never change from one year to the next.
export const {
  MONTH_NAMES, MONTH_SHORT,
  VENUE_KEYS, VENUE_SUBBRANDS,
  DATE_CODE_COLORS, LAYER_COLORS, SALES_SQUARE_COLORS, INTENSITY_COLORS,
  isInRange, getMonthIndex,
} = C2026;

// Venue metadata (name / shortName / description) — identical across years.
// Use this for venue label lookups anywhere the year doesn't matter.
export const VENUE_META = C2026.VENUE_HC_RAW;
