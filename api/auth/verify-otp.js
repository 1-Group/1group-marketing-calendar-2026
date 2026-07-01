// Vercel Serverless Function: POST /api/auth/verify-otp
// ------------------------------------------------------
// Body:    { email, code, challenge }
// Returns: 200 { user, sessionToken }
//          400 { error }   — invalid challenge / wrong code / expired
//          500 { error }   — server misconfigured
//
// The challenge (issued by send-otp) encodes the member's tier + venues, HMAC
// signed so the client can't forge it. We map the tier to the role the frontend
// already understands:
//   master → "master"   editor → "admin"   viewer → "user"   outlet → "venue"
//
// Env vars required:
//   OTP_SECRET   — must match the secret used by /api/auth/send-otp
//
// Security: constant-time comparisons, HMAC-verified challenge, hashed code,
// 12-hour signed session token.

import crypto from "node:crypto";
import { tierToRole, niceName, normaliseEmail, ALLOWED_DOMAIN } from "../_lib/members.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParseJSON(req.body) : (req.body || {});
  const email = normaliseEmail(body.email);
  const code = String(body.code || "").trim();
  const challenge = String(body.challenge || "");

  if (!email || !code || !challenge) {
    return res.status(400).json({ error: "Email, code, and challenge are all required." });
  }
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return res.status(400).json({ error: "Only @1-group.sg email addresses are accepted." });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Code must be 6 digits." });
  }

  const otpSecret = process.env.OTP_SECRET;
  if (!otpSecret) {
    console.error("[verify-otp] OTP_SECRET missing");
    return res.status(500).json({ error: "Server misconfigured." });
  }

  const dot = challenge.lastIndexOf(".");
  if (dot < 0) return res.status(400).json({ error: "Invalid challenge." });
  const b64 = challenge.slice(0, dot);
  const sig = challenge.slice(dot + 1);

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid challenge." });
  }

  const expectedSig = crypto.createHmac("sha256", otpSecret).update(JSON.stringify(payload)).digest("hex");
  if (sig.length !== expectedSig.length || !safeEqual(sig, expectedSig)) {
    return res.status(400).json({ error: "Invalid challenge." });
  }
  if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
    return res.status(400).json({ error: "Code expired. Please request a new one." });
  }
  if (String(payload.email).toLowerCase() !== email) {
    return res.status(400).json({ error: "Email mismatch — request a fresh code." });
  }

  const codeHash = crypto.createHash("sha256").update(`${code}:${email}`).digest("hex");
  if (codeHash.length !== payload.codeHash.length || !safeEqual(codeHash, payload.codeHash)) {
    return res.status(400).json({ error: "Incorrect code. Please try again." });
  }

  // Build the user object from the tier encoded in the (verified) challenge.
  const tier = payload.tier || "viewer";
  const role = tierToRole(tier);
  const name = payload.name || niceName(email);
  const venues = Array.isArray(payload.venues) ? payload.venues.filter(v => typeof v === "string") : [];

  const user = {
    email,
    role,                       // master | admin | user | venue
    tier,                       // master | editor | viewer | outlet
    name,
    dept: payload.dept || (tier === "outlet" ? "Outlet" : "Group"),
    auth: "otp",
  };
  if (role === "venue" && venues.length > 0) {
    user.venues = venues;
    user.venue = venues[0]; // primary venue (back-compat)
  }

  const sessionPayload = JSON.stringify({ ...user, expiresAt: Date.now() + SESSION_TTL_MS });
  const sessionSig = crypto.createHmac("sha256", otpSecret).update(sessionPayload).digest("hex");
  const sessionToken = Buffer.from(sessionPayload).toString("base64url") + "." + sessionSig;

  return res.status(200).json({ user, sessionToken });
}

function safeParseJSON(s) { try { return JSON.parse(s); } catch { return {}; } }
function safeEqual(a, b) {
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
