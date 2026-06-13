// Vercel Serverless Function: GET /api/events?venue=&date=
// ---------------------------------------------------------
// Protected by a shared bearer token (HUB_API_KEY). The token is compared in
// constant time to match the rest of this codebase (see api/log/list.js,
// api/auth/verify-otp.js).
//
// Query: ?venue=  &  ?date=
// Returns: 200 [...]            — matching events (currently an empty stub)
//          401 { error }        — wrong / missing bearer token
//          405 { error }        — non-GET
//          500 { error }        — server not configured
//
// Env vars required:
//   HUB_API_KEY  — shared secret set in Vercel -> Settings -> Env Vars (6+ chars)

import crypto from "node:crypto";

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

  // TODO: replace with a real lookup for ?venue= & ?date=
  // const { venue, date } = req.query;
  return res.status(200).json([]);
}
