// Vercel Serverless Function: POST /api/auth/send-otp
// ----------------------------------------------------
// Unified email→OTP sign-in for the 1-Group Marketing Calendar. Every user —
// master, editor, viewer or outlet — signs in the same way: enter your
// @1-group.sg email, we email a 6-digit code. The member's tier and (for outlet
// members) venues come from the Redis-backed allowlist, managed in-app by master
// admins (see api/_lib/members.js).
//
//   Body:    { email: "firstname.lastname@1-group.sg" }
//   Returns: 200 { challenge, expiresAt }   — challenge is HMAC-signed, encodes tier + venues
//            403 { error }                  — email not on the access list
//            400 { error }                  — invalid email / not @1-group.sg
//            500/502 { error }              — server / Resend issue
//
// Env vars required:
//   RESEND_API_KEY    — your Resend API key
//   OTP_SECRET        — 32+ char HMAC signing key (must match verify-otp.js)
//   OTP_FROM_EMAIL    — verified Resend sender (e.g. noreply@1-group.sg)
//   KV_REST_API_URL / KV_REST_API_TOKEN  — Upstash Redis (for the allowlist)

import crypto from "node:crypto";
import { getMembers, normaliseEmail, isValidEmail } from "../_lib/members.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FROM_NAME = "1-Group Marketing Calendar";

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

  if (!email) return res.status(400).json({ error: "Email is required." });
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Only @1-group.sg email addresses are accepted." });
  }

  // Look the member up in the allowlist.
  const { members } = await getMembers();
  const member = members[email];
  if (!member) {
    return res.status(403).json({
      error: "This email isn't on the access list. Ask a 1-Group Marketing admin to grant you access.",
    });
  }

  // Env config
  const otpSecret = process.env.OTP_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.OTP_FROM_EMAIL || "noreply@1-group.sg";
  if (!otpSecret || otpSecret.length < 16) {
    console.error("[send-otp] OTP_SECRET missing or too short");
    return res.status(500).json({ error: "Server misconfigured." });
  }
  if (!resendKey) {
    console.error("[send-otp] RESEND_API_KEY missing");
    return res.status(500).json({ error: "Email service not configured." });
  }

  // Generate a 6-digit numeric OTP (cryptographically random)
  const otpBuf = crypto.randomBytes(4);
  const otp = String((otpBuf.readUInt32BE(0) % 900000) + 100000); // 100000-999999

  // Build the challenge: hash the OTP+email (raw OTP never appears in the token),
  // and encode the tier + venues so verify-otp can build the right user object.
  const codeHash = crypto.createHash("sha256").update(`${otp}:${email}`).digest("hex");
  const expiresAt = Date.now() + OTP_TTL_MS;
  const venues = member.tier === "outlet" && Array.isArray(member.venues) ? member.venues : [];
  const payloadObj = { email, codeHash, expiresAt, tier: member.tier, venues, name: member.name || "", dept: member.dept || "" };
  const payload = JSON.stringify(payloadObj);
  const sig = crypto.createHmac("sha256", otpSecret).update(payload).digest("hex");
  const challenge = Buffer.from(payload).toString("base64url") + "." + sig;

  // Send via Resend
  try {
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${fromEmail}>`,
        to: [email],
        subject: `Your 1-Group Marketing Calendar code: ${otp}`,
        html: buildEmailHtml(otp),
        text: buildEmailText(otp),
      }),
    });
    if (!resendResp.ok) {
      const errBody = await resendResp.json().catch(() => ({}));
      console.error("[send-otp] Resend rejected:", resendResp.status, errBody);
      return res.status(502).json({
        error: resendResp.status === 422 ? "Email could not be delivered. Confirm your address." : "Email service unavailable. Please try again.",
      });
    }
  } catch (err) {
    console.error("[send-otp] Resend network error:", err);
    return res.status(502).json({ error: "Email service unreachable." });
  }

  return res.status(200).json({ challenge, expiresAt });
}

function safeParseJSON(s) { try { return JSON.parse(s); } catch { return {}; } }

function buildEmailHtml(otp) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
      <h1 style="font-size:20px;margin:0 0 8px;color:#0f172a;font-weight:700;">1-Group Marketing Calendar</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.5;">Use this code to sign in. It expires in 10 minutes.</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;padding:20px 16px;background:linear-gradient(135deg,#faf5ff 0%,#eef2ff 100%);border:1px solid #e9d5ff;border-radius:8px;text-align:center;color:#0f172a;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">${otp}</div>
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">If you didn't request this code, you can safely ignore this email — no one can sign in without it.</p>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:16px 0 0;">1-Group Singapore · Internal tool</p>
  </div>
</body>
</html>`;
}

function buildEmailText(otp) {
  return `1-Group Marketing Calendar

Your sign-in code: ${otp}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

1-Group Singapore · Internal tool`;
}
