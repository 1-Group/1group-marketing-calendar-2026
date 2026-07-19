// Vercel Serverless Function: /api/confirmed
// ---------------------------------------------------------
// GET  → { updatedAt, source, generatedAt, counts }   (open; non-sensitive
//        aggregate counts the calendar UI overlays onto its heatmap)
// POST → store a fresh per-venue/day confirmed-count map pushed weekly by the
//        1HostHub app. Protected by the same shared bearer token the hub feed
//        uses (HUB_API_KEY) — the hub already holds it to read /api/events.
//
// Body (POST): { counts: { venueKey: { "YYYY-MM-DD": number } },
//                source?: string, generatedAt?: number }
//
// Returns: 200 ok · 400 bad payload · 401 wrong/missing token · 405 method ·
//          500 storage not configured.
//
// Env vars: HUB_API_KEY (shared with the hub) + KV_REST_API_URL / _TOKEN.

import crypto from "node:crypto";
import { getConfirmed, saveConfirmed, sanitiseCounts, sanitiseEvents } from "./_lib/confirmed.js";
import { verifySessionToken } from "./_lib/members.js";

function constantEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }

  // ─── Read: the calendar UI fetches the live data to overlay. Counts are
  // non-sensitive and always returned. The per-event DETAIL includes client
  // names (PII), so it's only included for a caller with a valid session token
  // (i.e. a signed-in member) — the counts still degrade gracefully otherwise.
  // Never hard-fail; a read error just falls back to the static snapshot. ──────
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const doc = await getConfirmed();
      const base = { updatedAt: 0, source: null, generatedAt: null, counts: {} };
      if (!doc) return res.status(200).json(base);
      const out = {
        updatedAt: doc.updatedAt || 0,
        source: doc.source || null,
        generatedAt: doc.generatedAt || null,
        counts: doc.counts || {},
      };
      // Non-sensitive diagnostics (no PII): whether/how much event detail is
      // stored, and whether the caller was recognised as a signed-in member.
      const evDoc = doc.events || {};
      let eventVenues = 0, eventCells = 0, eventsTotal = 0, withPax = 0, withMeal = 0;
      for (const [v, days] of Object.entries(evDoc)) {
        if (v === "group") continue;
        eventVenues += 1;
        for (const list of Object.values(days || {})) {
          eventCells += 1;
          for (const ev of (Array.isArray(list) ? list : [])) {
            eventsTotal += 1;
            if (ev && ev.pax != null) withPax += 1;
            if (ev && ev.meal) withMeal += 1;
          }
        }
      }
      out.eventVenues = eventVenues;
      out.eventCells = eventCells;
      out.eventsTotal = eventsTotal;
      out.eventsWithPax = withPax;
      out.eventsWithMeal = withMeal;
      const authz = req.headers.authorization || "";
      const m = authz.match(/^Bearer\s+(.+)$/i);
      const session = m ? verifySessionToken(m[1]) : null;
      out.authed = Boolean(session);
      if (session) out.events = doc.events || {};
      return res.status(200).json(out);
    } catch {
      return res.status(200).json({ updatedAt: 0, source: null, generatedAt: null, counts: {} });
    }
  }

  // ─── Write: the hub pushes the weekly roll-up. ──────────────────────────────
  if (req.method === "POST") {
    const apiKey = process.env.HUB_API_KEY;
    if (!apiKey || apiKey.length < 6) {
      console.error("[confirmed] HUB_API_KEY missing or too short");
      return res.status(500).json({ error: "Server misconfigured. Set HUB_API_KEY in Vercel (6+ characters)." });
    }
    const auth = req.headers.authorization || "";
    if (!constantEquals(auth, `Bearer ${apiKey}`)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
    const { counts, venues, days, error } = sanitiseCounts(body.counts);
    if (error) return res.status(400).json({ error });
    const events = sanitiseEvents(body.events);

    const doc = {
      updatedAt: Date.now(),
      source: String(body.source || "1host-hub").slice(0, 40),
      generatedAt: typeof body.generatedAt === "number" ? body.generatedAt : null,
      counts,
      events,
    };
    try {
      await saveConfirmed(doc);
    } catch {
      return res.status(500).json({ error: "Could not store counts. Is Upstash Redis connected?" });
    }
    return res.status(200).json({ ok: true, venues, days, updatedAt: doc.updatedAt });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
