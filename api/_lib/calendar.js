// api/_lib/calendar.js
// ─────────────────────────────────────────────────────────────────────────
// Turns the shared 2026 calendar dataset (src/data/calendar2026.js) into the
// shape the 1HostHub integration consumes:
//
//   { demand:  { level, score, label },
//     context: [ { kind, title, date, notes, impact } ],
//     events:  [ { date, venue, type, title, status, notes } ] }
//
// `events`  = what's physically on at the venue that day (marketing activations
//             + an aggregate count of confirmed bookings from the master
//             calendar — individual booking titles are withheld for privacy).
// `demand`  = the venue's hot/cold read for that day, derived from the master
//             calendar's rating + booking count.
// `context` = Singapore-wide demand drivers active that day (public holidays,
//             long weekends, school holidays, MICE conventions, major events,
//             group campaigns, peak tourist season).

import {
  VENUE_HC_RAW, VENUE_KEYS, parseVenueData,
  MICE_EVENTS, SG_EVENTS, SCHOOL_HOLIDAYS, PUBLIC_HOLIDAYS,
  CAMPAIGNS, SEED_VENUE_EVENTS, DOUBLE_DIGIT_DATES,
  isInRange, getVisitorPeaks, getMonthIndex, MONTH_NAMES,
} from "../../src/data/calendar2026.js";

// ─── Venue name resolution ─────────────────────────────────────────────────
// The hub addresses venues by these exact display names. Map them (and the
// app's internal labels, and the raw keys) onto the internal venue keys.
const CANONICAL_NAME = {
  alfaro: "1-Alfaro",
  altitude: "1-Altitude Coast",
  arden: "1-Arden",
  atico: "1-Atico",
  flowerhill: "1-Flowerhill",
  monti: "Monti",
  alkaff: "The Alkaff Mansion",
  garage: "The Garage",
  riverhouse: "The River House",
  summerhouse: "The Summer House",
  group: "1-HOST Group Level",
};

// Venues the hub is allowed to ask about (excludes the internal group roll-up).
export const PUBLIC_VENUE_KEYS = VENUE_KEYS.filter((k) => k !== "group");

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// "1-Flowerhill" / "1 flowerhill" / "flowerhill" → "flowerhill";
// "The Summer House" / "The Summerhouse" → "summerhouse" (handles the spacing
// difference between the hub's name and the app's stored label).
const KEY_BY_NORM = (() => {
  const m = {};
  for (const key of VENUE_KEYS) {
    m[normalize(key)] = key;
    m[normalize(VENUE_HC_RAW[key]?.name)] = key;
    m[normalize(CANONICAL_NAME[key])] = key;
  }
  return m;
})();

export function resolveVenueKey(input) {
  if (!input) return null;
  return KEY_BY_NORM[normalize(input)] || null;
}

export function venueDisplayName(key) {
  return CANONICAL_NAME[key] || VENUE_HC_RAW[key]?.name || key;
}

// ─── Date helpers (UTC, dates are plain "YYYY-MM-DD") ───────────────────────
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekday(date) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
function isWeekend(date) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}
function isPublicHol(date) {
  return PUBLIC_HOLIDAYS.some((h) => h.date === date);
}
function isNonWorking(date) {
  return isWeekend(date) || isPublicHol(date);
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Length of the consecutive run of non-working days (weekend + PH) containing
// `date`. >= 3 means it's part of a long weekend.
function longWeekendLength(date) {
  if (!isNonWorking(date)) return 0;
  let len = 1;
  for (let c = addDays(date, -1); isNonWorking(c); c = addDays(c, -1)) len++;
  for (let c = addDays(date, 1); isNonWorking(c); c = addDays(c, 1)) len++;
  return len;
}

// ─── Demand ─────────────────────────────────────────────────────────────────
const RATING_BASE = { "hot-hot": 88, hot: 65, cold: 35, "cold-cold": 15 };

export function computeDemand(key, date) {
  const day = parseVenueData(key)[date];
  const rating = day?.rating || "cold-cold";
  const count = day?.count || 0;
  const base = RATING_BASE[rating] ?? 30;
  const score = Math.min(100, Math.round(base + Math.min(count, 12)));
  const level = score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";
  return { level, score, label: buildLabel(date, score) };
}

function buildLabel(date, score) {
  const ph = PUBLIC_HOLIDAYS.find((h) => h.date === date);
  if (ph) return ph.name;
  const wd = weekday(date);
  if (longWeekendLength(date) >= 3) return `Long weekend ${wd}`;
  const tier = score >= 70 ? "Peak " : score >= 45 ? "" : "Quiet ";
  return `${tier}${wd}`.trim();
}

// ─── Context (Singapore-wide demand drivers for a date) ─────────────────────
export function computeContext(date) {
  const ctx = [];
  const mi = getMonthIndex(date);

  for (const h of PUBLIC_HOLIDAYS) {
    if (h.date === date) {
      ctx.push({ kind: "holiday", title: h.name, date: h.date, notes: "Singapore public holiday", impact: "demand_up" });
    }
  }

  const lw = longWeekendLength(date);
  if (lw >= 3) {
    ctx.push({ kind: "long_weekend", title: "Long weekend", date, notes: `${lw} consecutive non-working days`, impact: "demand_up" });
  }

  for (const s of SCHOOL_HOLIDAYS) {
    if (isInRange(date, s.start, s.end)) {
      ctx.push({ kind: "school_holiday", title: s.name, date: s.start, notes: `School holidays ${s.start} → ${s.end}`, impact: "demand_up" });
    }
  }

  for (const m of MICE_EVENTS) {
    if (isInRange(date, m.start, m.end)) {
      ctx.push({ kind: "mice", title: m.name, date: m.start, notes: m.cat || "MICE / convention", impact: "demand_up" });
    }
  }

  for (const e of SG_EVENTS) {
    if (e.start && isInRange(date, e.start, e.end)) {
      ctx.push({ kind: "event", title: e.name, date: e.start, notes: [e.venue, e.industry].filter(Boolean).join(" · "), impact: "demand_up" });
    }
  }

  for (const c of CAMPAIGNS) {
    const end = typeof c.endMonth === "number" ? c.endMonth : c.month;
    if (mi >= c.month && mi <= end) {
      ctx.push({ kind: "other", title: c.name, date, notes: c.tagline ? `1-Group campaign · ${c.tagline}` : "1-Group campaign", impact: "demand_up" });
    }
  }

  if (DOUBLE_DIGIT_DATES.has(date)) {
    ctx.push({ kind: "other", title: "Double-digit promo date", date, notes: "Promo-ready double-digit date", impact: "demand_up" });
  }

  const peaks = getVisitorPeaks(mi);
  if (peaks.length >= 4) {
    ctx.push({ kind: "peak_season", title: "Peak tourist season", date, notes: `Peak arrivals from ${peaks.join(", ")}`, impact: "demand_up" });
  }

  return ctx;
}

// ─── Events (what's physically on at the venue that day) ────────────────────
function activityType(v) {
  return v.subBrand ? `venue · ${v.subBrand}` : "venue activity";
}

export function computeEvents(key, date) {
  const out = [];
  const name = venueDisplayName(key);

  for (const v of SEED_VENUE_EVENTS) {
    if (v.venue !== key) continue;
    let on = false;
    if (v.start && v.end) on = isInRange(date, v.start, v.end);
    else if (typeof v.month === "number") on = getMonthIndex(date) === v.month;
    if (!on) continue;
    out.push({
      date,
      venue: name,
      type: activityType(v),
      title: v.name,
      status: v.start ? "confirmed" : "planned",
      notes: v.hook || (typeof v.month === "number" ? `Runs across ${MONTH_NAMES[v.month]}` : ""),
    });
  }

  const day = parseVenueData(key)[date];
  if (day && day.count > 0) {
    out.push({
      date,
      venue: name,
      type: "booking",
      title: `${day.count} confirmed booking${day.count > 1 ? "s" : ""}`,
      status: "confirmed",
      notes: "Aggregate from master calendar (individual titles withheld for privacy)",
    });
  }

  return out;
}

// All marketing activities for the given venue keys, ignoring the date filter
// (used for loose/no-date queries so the hub can confirm the wiring).
export function listActivities(keys) {
  const out = [];
  for (const key of keys) {
    const name = venueDisplayName(key);
    for (const v of SEED_VENUE_EVENTS) {
      if (v.venue !== key) continue;
      const d = v.start || (typeof v.month === "number" ? `2026-${String(v.month + 1).padStart(2, "0")}-01` : "");
      out.push({
        date: d,
        venue: name,
        type: activityType(v),
        title: v.name,
        status: v.start ? "confirmed" : "planned",
        notes: v.hook || (typeof v.month === "number" ? `Runs across ${MONTH_NAMES[v.month]}` : ""),
      });
    }
  }
  return out;
}
