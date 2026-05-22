// Vercel Serverless Function: POST /api/log/hit
// -----------------------------------------------
// Records one "calendar opened" entry. Called fire-and-forget by the client
// each time a signed-in user opens the calendar (fresh sign-in OR restored
// session). Logging must never break sign-in, so this ALWAYS returns 204 and
// swallows every error.
//
// Body: { name, role, dept, venue?, email?, auth?, sessionToken? }
//   - If sessionToken is present and its HMAC verifies (via OTP_SECRET), the
//     entry is marked verified:true and identity is taken from the token.
//   - Otherwise verified:false and identity comes from the body. Master/admin
//     sign in client-side with no token — verified:false is expected for them.
//
// Env vars (auto-injected when you add Upstash Redis via Vercel -> Storage):
//   KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel KV naming), OR
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash naming)
// Optional:
//   OTP_SECRET  — enables sessionToken verification (already set for OTP auth)
//
// Storage: appended to Redis list "cal:accesslog", trimmed to the latest 1000.

import crypto from "node:crypto";

const LOG_LIST = "cal:accesslog";
const MAX_ENTRIES = 1000;

function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(creds, command) {
  // Upstash REST API: POST the command as a JSON array, auth via Bearer token.
  const resp = await fetch(creds.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  return resp.json();
}

function verifyToken(token) {
  // Returns the decoded session payload if the HMAC is valid and not expired.
  const secret = process.env.OTP_SECRET;
  if (!secret || typeof token !== "string" || !token.includes(".")) return null;
  try {
    const dot = token.lastIndexOf(".");
    const payloadStr = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(payloadStr);
    if (typeof payload.expiresAt === "number" && Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
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

  // Logging must NEVER break the app — swallow all errors, always 204.
  try {
    const creds = redisCreds();
    if (!creds) {
      console.warn("[log/hit] Redis not configured — entry skipped");
      return res.status(204).end();
    }

    const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
    const verified = verifyToken(body.sessionToken);
    const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
    const ip = clip(String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(), 45);

    const entry = {
      ts: Date.now(),
      name: clip(verified?.name || body.name || "Unknown", 80),
      role: clip(verified?.role || body.role || "unknown", 24),
      dept: clip(verified?.dept || body.dept || "", 48),
      venue: clip(verified?.venue || body.venue || "", 32),
      email: clip(verified?.email || body.email || "", 120),
      auth: clip(verified ? (verified.auth || "otp") : (body.auth || "client"), 16),
      verified: !!verified,
      ua: clip(req.headers["user-agent"] || "", 180),
      ip,
    };

    await redis(creds, ["LPUSH", LOG_LIST, JSON.stringify(entry)]);
    await redis(creds, ["LTRIM", LOG_LIST, 0, MAX_ENTRIES - 1]);
  } catch (err) {
    console.error("[log/hit] error (ignored):", err && err.message);
  }
  return res.status(204).end();
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
