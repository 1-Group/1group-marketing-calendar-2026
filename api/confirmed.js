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
import { getConfirmed, saveConfirmed, sanitiseCounts } from "./_lib/confirmed.js";

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

  // ─── Read: the calendar UI fetches the live counts to overlay. Never hard-
  // fail — a read error just degrades to the static snapshot on the client. ──
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const doc = await getConfirmed();
      return res.status(200).json(doc || { updatedAt: 0, source: null, generatedAt: null, counts: {} });
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

    const doc = {
      updatedAt: Date.now(),
      source: String(body.source || "1host-hub").slice(0, 40),
      generatedAt: typeof body.generatedAt === "number" ? body.generatedAt : null,
      counts,
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
