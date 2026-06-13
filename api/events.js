// Vercel Serverless Function: GET /api/events?venue=&date=
// ---------------------------------------------------------
// Returns sanitised calendar events for the 1HostHub integration, filtered by
// venue and/or date. Protected by a shared bearer token (HUB_API_KEY), compared
// in constant time to match the rest of this codebase (see api/log/list.js,
// api/auth/verify-otp.js).
//
// Data source: public/data/tripleseat-events.json (produced by
// scripts/sync-tripleseat.cjs and served statically at /data/...). Each event:
//   { id, layer, name, venue, category, guest_band, start, end }   // start/end = "YYYY-MM-DD"
//
// Query (both optional — omit one to skip that filter):
//   ?venue=  — case-insensitive exact match on the event's venue label
//   ?date=   — "YYYY-MM-DD"; returns events whose span covers that day (start <= date <= end)
//
// Returns: 200 [ ...events ]   — matches (empty array if none / data not yet generated)
//          400 { error }       — malformed date
//          401 { error }       — wrong / missing bearer token
//          405 { error }       — non-GET
//          500 { error }       — server not configured
//
// Env vars required:
//   HUB_API_KEY  — shared secret set in Vercel -> Settings -> Env Vars (6+ chars)

import crypto from "node:crypto";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function constantEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Fetch the statically-served events file from this same deployment. Returns []
// if the file hasn't been generated yet (sync not run) so the endpoint stays up.
async function loadEvents(req) {
  const host = req.headers.host;
  if (!host) return [];
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  try {
    const resp = await fetch(`${proto}://${host}/data/tripleseat-events.json`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (Array.isArray(data)) return data;
    return Array.isArray(data.events) ? data.events : [];
  } catch (err) {
    console.error("[events] could not load events data:", err && err.message);
    return [];
  }
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
  const venue = String(query.venue || "").trim().toLowerCase();
  const date = String(query.date || "").trim();

  if (date && !DATE_RE.test(date)) {
    return res.status(400).json({ error: "Invalid date — expected format YYYY-MM-DD." });
  }

  let events = await loadEvents(req);
  if (venue) {
    events = events.filter((e) => String(e.venue || "").toLowerCase() === venue);
  }
  if (date) {
    // start/end are "YYYY-MM-DD" strings, so lexicographic compare is date-correct.
    events = events.filter((e) => e.start <= date && date <= (e.end || e.start));
  }

  return res.status(200).json(events);
}
