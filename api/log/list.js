// Vercel Serverless Function: POST /api/log/list
// ------------------------------------------------
// Returns the calendar access log. PROTECTED by a passphrase: master/admin
// users sign in client-side and carry no server token, so a shared secret in
// an env var is the read gate. The passphrase travels in the POST body (never
// the URL, so it stays out of access logs) and is compared in constant time.
//
// Body: { key }   — must equal env var CALENDAR_LOG_KEY
// Returns: 200 { entries: [...], total }   — newest first
//          401 { error }                   — wrong / missing key
//          405 { error }                   — non-POST
//          500 { error }                   — server not configured
//
// Env vars required:
//   CALENDAR_LOG_KEY  — passphrase you choose and set in Vercel -> Settings -> Env Vars
//   KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL / _TOKEN)

import crypto from "node:crypto";

const LOG_LIST = "cal:accesslog";

function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(creds, command) {
  const resp = await fetch(creds.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  return resp.json();
}

function constantEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CALENDAR_LOG_KEY;
  if (!expected || expected.length < 6) {
    console.error("[log/list] CALENDAR_LOG_KEY missing or too short");
    return res.status(500).json({ error: "Access log not configured. Set CALENDAR_LOG_KEY in Vercel (6+ characters)." });
  }

  const creds = redisCreds();
  if (!creds) {
    return res.status(500).json({ error: "Log storage not connected. Add Upstash Redis in Vercel -> Storage." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  const key = String(body.key || "");
  if (!key || !constantEquals(key, expected)) {
    return res.status(401).json({ error: "Incorrect access key." });
  }

  try {
    const result = await redis(creds, ["LRANGE", LOG_LIST, 0, 999]);
    const raw = Array.isArray(result && result.result) ? result.result : [];
    const entries = raw
      .map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
    return res.status(200).json({ entries, total: entries.length });
  } catch (err) {
    console.error("[log/list] redis error:", err && err.message);
    return res.status(500).json({ error: "Could not read the log. Please try again." });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
