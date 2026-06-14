// Vercel Serverless Function: GET /api/events?venue=&date=
// ---------------------------------------------------------
// Calendar feed for the 1HostHub integration. Protected by a shared bearer
// token (HUB_API_KEY), compared in constant time to match the rest of this
// codebase (see api/log/list.js, api/auth/verify-otp.js).
//
// Data source: the 2026 marketing calendar dataset in src/data/calendar2026.js
// (the same data the React app renders), reshaped by api/_lib/calendar.js into
// the demand / context / events model the hub consumes.
//
// Query (both optional):
//   ?venue=  — venue display name (e.g. "1-Flowerhill", "The Summer House"),
//              internal key, or the app label; matched case/spacing-insensitively
//   ?date=   — "YYYY-MM-DD"; the day to read demand + what's on
//
// Returns 200 with:
//   {
//     query:    { venue, date },                 // echo of the resolved query
//     demand:   { level, score, label } | null,  // venue+date only
//     context:  [ { kind, title, date, notes, impact } ],
//     events:   [ { date, venue, type, title, status, notes } ],
//     value:    <events>,   // OData-style aliases kept for backward-compat
//     Count:    <events.length>
//   }
//   400 { error }  — malformed date
//   401 { error }  — wrong / missing bearer token
//   405 { error }  — non-GET
//   500 { error }  — server not configured (HUB_API_KEY unset/too short)
//
// Env vars required:
//   HUB_API_KEY — shared secret set in Vercel → Settings → Env Vars (6+ chars)

import crypto from "node:crypto";
import {
  PUBLIC_VENUE_KEYS, resolveVenueKey, venueDisplayName,
  computeDemand, computeContext, computeEvents, listActivities,
} from "./_lib/calendar.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function constantEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.HUB_API_KEY;
  if (!apiKey || apiKey.length < 6) {
    console.error("[events] HUB_API_KEY missing or too short");
    return res.status(500).json({ error: "Server misconfigured. Set HUB_API_KEY in Vercel (6+ characters)." });
  }

  const auth = req.headers.authorization || "";
  if (!constantEquals(auth, `Bearer ${apiKey}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const query = req.query || {};
  const venueRaw = String(query.venue || "").trim();
  const date = String(query.date || "").trim();

  if (date && !DATE_RE.test(date)) {
    return res.status(400).json({ error: "Invalid date — expected format YYYY-MM-DD." });
  }

  const venueKey = venueRaw ? resolveVenueKey(venueRaw) : null;
  const venueUnknown = Boolean(venueRaw) && !venueKey;

  let demand = null;
  let context = [];
  let events = [];

  if (date) {
    context = computeContext(date);
    if (venueKey) {
      events = computeEvents(venueKey, date);
      demand = computeDemand(venueKey, date);
    } else if (!venueUnknown) {
      // No venue filter → everything physically on across all venues that day.
      for (const k of PUBLIC_VENUE_KEYS) events.push(...computeEvents(k, date));
    }
  } else if (!venueUnknown) {
    // No date → list the marketing activities (whole year) so the hub can
    // confirm the wiring even with loose filters.
    events = listActivities(venueKey ? [venueKey] : PUBLIC_VENUE_KEYS);
  }

  const payload = {
    query: { venue: venueKey ? venueDisplayName(venueKey) : (venueRaw || null), date: date || null },
    demand,
    context,
    events,
    // Backward-compatible OData-style aliases the hub historically read.
    value: events,
    Count: events.length,
  };
  if (venueUnknown) payload.warning = `Unknown venue "${venueRaw}". Expected one of: ${PUBLIC_VENUE_KEYS.map(venueDisplayName).join(", ")}.`;

  return res.status(200).json(payload);
}
