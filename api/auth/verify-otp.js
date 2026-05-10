// Vercel Serverless Function: POST /api/auth/verify-otp
// ------------------------------------------------------
// Body:    { email, code, challenge }
// Returns: 200 { user, sessionToken }
//          - For Flow A (group OTP): user has role: "user", read-only, all-venues access.
//          - For Flow B (outlet OTP): user has role: "venue", venues: [...], scoped to those venues.
//          400 { error }                — invalid challenge / wrong code / expired
//          500 { error }                — server misconfigured
//
// Env vars required:
//   OTP_SECRET   — must match the secret used by /api/auth/send-otp
//
// Security notes:
//   - Constant-time comparison via crypto.timingSafeEqual
//   - Challenge HMAC verifies the server issued it (so client can't forge venues array)
//   - Code itself is hashed inside challenge (raw code never crosses verify request boundary)
//   - 12-hour session — re-OTP after that

import crypto from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_DOMAIN = "@1-group.sg";

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
  const email = String(body.email || "").trim().toLowerCase();
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

  // Parse and verify challenge
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

  // Verify signature (constant-time)
  const expectedSig = crypto.createHmac("sha256", otpSecret).update(JSON.stringify(payload)).digest("hex");
  if (sig.length !== expectedSig.length || !safeEqual(sig, expectedSig)) {
    return res.status(400).json({ error: "Invalid challenge." });
  }

  // Check expiry
  if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
    return res.status(400).json({ error: "Code expired. Please request a new one." });
  }

  // Email must match the one in the challenge (stops swap attacks)
  if (String(payload.email).toLowerCase() !== email) {
    return res.status(400).json({ error: "Email mismatch — request a fresh code." });
  }

  // Verify code by re-hashing
  const codeHash = crypto.createHash("sha256").update(`${code}:${email}`).digest("hex");
  if (codeHash.length !== payload.codeHash.length || !safeEqual(codeHash, payload.codeHash)) {
    return res.status(400).json({ error: "Incorrect code. Please try again." });
  }

  // Build user object — derive friendly name from local-part of email
  const localPart = email.split("@")[0];
  const name = localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ") || localPart;

  // Branch on whether challenge encoded a venues array (outlet flow) or not (group flow)
  const venues = Array.isArray(payload.venues) ? payload.venues.filter(v => typeof v === "string") : null;
  let user;
  if (venues && venues.length > 0) {
    // Flow B — outlet user, scoped to one or more venues
    user = {
      email,
      role: "venue",
      venues,                  // array of allowed venue keys
      venue: venues[0],        // primary venue (back-compat with existing client code)
      name,
      dept: "Outlet",
      auth: "otp",
    };
  } else {
    // Flow A — group access, all-venues read
    user = {
      email,
      role: "user",
      name,
      dept: "Staff",
      auth: "otp",
    };
  }

  // Sign session token
  const sessionPayload = JSON.stringify({ ...user, expiresAt: Date.now() + SESSION_TTL_MS });
  const sessionSig = crypto.createHmac("sha256", otpSecret).update(sessionPayload).digest("hex");
  const sessionToken = Buffer.from(sessionPayload).toString("base64url") + "." + sessionSig;

  return res.status(200).json({ user, sessionToken });
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
