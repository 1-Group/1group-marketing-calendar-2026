// api/_lib/confirmed.js
// ─────────────────────────────────────────────────────────────────────────
// Live "confirmed events in Tripleseat" counts, per venue per day.
//
// The 1HostHub app owns the Tripleseat integration. Once a week it rolls its
// confirmed bookings up into a compact { venueKey: { "YYYY-MM-DD": count } }
// map and POSTs it here (see api/confirmed.js). We stash that map in the same
// Upstash Redis the member allowlist uses, under the key `cal:confirmed`.
//
// The calendar UI fetches it (GET /api/confirmed) and overlays it onto the
// static VENUE_HC_RAW snapshot in src/data/calendar2026.js — so the heatmap's
// "N 1-Host events confirmed in Tripleseat" numbers become live, refreshed
// weekly, instead of a frozen transcription. When nothing has been pushed yet
// (or Redis is down) callers fall back to the static snapshot, so the app
// never hard-fails.
//
// Only aggregate integer counts cross the wire — no guest names, no financials,
// no PII — which keeps this consistent with the hub's Section-G data-handling
// commitments.

import { redisCreds, redis } from "./members.js";

export const CONFIRMED_KEY = "cal:confirmed";

// Calendar venue keys the hub may send counts for (mirrors VENUE_KEYS in
// src/data/calendar2026.js, including the "group" roll-up).
export const VALID_VENUE_KEYS = new Set([
  "group", "summerhouse", "garage", "altitude", "arden", "alkaff",
  "alfaro", "atico", "riverhouse", "flowerhill", "monti",
]);

// Accept any 20xx date so the feed keeps working past 2026 without a code change.
const DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Read the stored map. Returns null when unset / Redis unavailable.
export async function getConfirmed() {
  const creds = redisCreds();
  if (!creds) return null;
  const r = await redis(creds, ["GET", CONFIRMED_KEY]);
  if (r && typeof r.result === "string" && r.result.length) {
    try {
      const parsed = JSON.parse(r.result);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* fall through */ }
  }
  return null;
}

export async function saveConfirmed(doc) {
  const creds = redisCreds();
  if (!creds) throw new Error("Storage not configured");
  await redis(creds, ["SET", CONFIRMED_KEY, JSON.stringify(doc)]);
}

// Validate + normalise an incoming counts payload from the hub. Unknown venue
// keys, malformed dates and negative/non-numeric counts are dropped silently
// rather than failing the whole push. Only positive counts are stored — a date
// absent from a venue's map means "nothing confirmed" (count 0), so cancelled
// or moved bookings self-correct on the next weekly push.
export function sanitiseCounts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "`counts` must be an object of { venueKey: { date: count } }." };
  }
  const out = {};
  let venues = 0, days = 0;
  for (const [venueRaw, dayMap] of Object.entries(input)) {
    const venue = String(venueRaw).toLowerCase();
    if (!VALID_VENUE_KEYS.has(venue)) continue;
    if (!dayMap || typeof dayMap !== "object" || Array.isArray(dayMap)) continue;
    const clean = {};
    for (const [date, n] of Object.entries(dayMap)) {
      if (!DATE_RE.test(date)) continue;
      const c = Number(n);
      if (!Number.isFinite(c) || c < 0) continue;
      const count = Math.min(Math.floor(c), 100000);
      if (count > 0) { clean[date] = count; days++; }
    }
    if (Object.keys(clean).length) { out[venue] = clean; venues++; }
  }
  if (venues === 0) return { error: "No valid venue counts in payload." };
  return { counts: out, venues, days };
}
