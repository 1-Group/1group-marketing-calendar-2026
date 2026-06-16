// Vercel Serverless Function: POST /api/auth/send-otp
// ----------------------------------------------------
// Two flows are supported, distinguished by the optional `outlet` flag:
//
// FLOW A — Group-level OTP (default, when `outlet` is not true):
//   Body:    { email: "firstname.lastname@1-group.sg" }
//   Returns: 200 { challenge, expiresAt }   — challenge is HMAC-signed
//            403 { error }                  — email not on GROUP_ALLOWLIST
//            400 { error }                  — invalid email / not @1-group.sg
//            500/502 { error }              — server / Resend issue
//
// FLOW B — Outlet OTP (when `outlet: true` is in the body):
//   Body:    { email: "...@1-group.sg", outlet: true }
//   Returns: 200 { challenge, expiresAt }   — challenge encodes the venues array from OUTLET_ALLOWLIST
//            403 { error }                  — email not on OUTLET_ALLOWLIST
//            (other status codes same as Flow A)
//
// Env vars required:
//   RESEND_API_KEY    — your Resend API key
//   OTP_SECRET        — 32+ char HMAC signing key (must match verify-otp.js)
//   OTP_FROM_EMAIL    — verified Resend sender (e.g. noreply@1group.marketing)
//
// Allowlist maintenance: all access lists live below as constants.
// To add or remove a user, edit, commit, merge — auto-deploys via GitHub Actions.

import crypto from "node:crypto";

// ─── GROUP-LEVEL ACCESS ALLOWLIST ────────────────────────────────────────
// Approved @1-group.sg emails for full group-view OTP sign-in.
// These users get role: "user" with read access to ALL venues.
// Maintained by 1-Group Marketing operations.
const GROUP_ALLOWLIST = new Set([
  "joseph.ong@1-group.sg",
  "janet.sim@1-group.sg",
  "xiaochyi.tan@1-group.sg",
  "immelia.izalena@1-group.sg",
  "praveena.gunasegaran@1-group.sg",
  "audrey.ng@1-group.sg",
  "guiying.chua@1-group.sg",
  "alvin.chua@1-group.sg",
  "benjamin.zhou@1-group.sg",
  "eileen.tan@1-group.sg",
  "shirley.gan@1-group.sg",
  "jessie.tan@1-group.sg",
  "tom.kung@1-group.sg",
  "felix.chong@1-group.sg",
  "niesa.osman@1-group.sg",
  "chloe.chua@1-group.sg",
]);

// ─── OUTLET-LEVEL ACCESS ALLOWLIST ───────────────────────────────────────
// Maps email → array of venue keys the user can view.
// Single-venue users get an array with one element. Multi-venue users (e.g.
// roving Operations or shared management) get the venues they oversee — the
// frontend will show them a filtered zone selector with only their venues.
//
// Valid venue keys (must match VENUE_HC_RAW in src/App-updated.jsx):
//   summerhouse, garage, altitude, arden, alkaff, alfaro,
//   atico, riverhouse, flowerhill, monti
//
// To add a new outlet user: add a line in lowercase. To grant access to multiple
// venues: provide an array with multiple keys. To revoke: delete the line.
const OUTLET_ALLOWLIST = {
  // 1-Arden
  "daryl.xie@1-group.sg":         ["arden"],   // also Marketing admin via Admin tab
  "shaughn.scully@1-group.sg":    ["arden"],
  "fletcher.khor@1-group.sg":     ["arden"],
  "keisha.tay@1-group.sg":        ["arden"],
  "leona.dutt@1-group.sg":        ["arden"],

  // 1-Altitude Coast
  "joyi.ang@1-group.sg":          ["altitude", "flowerhill"],
  "jolene.mudaliar@1-group.sg":   ["altitude", "flowerhill"],
  "mimi@1-group.sg":              ["altitude", "flowerhill"],
  "kumar.k@1-group.sg":           ["altitude", "riverhouse"],   // also staff via Admin tab
  "dhanik.niroshan@1-group.sg":   ["altitude"],
  "kokseng.ng@1-group.sg":        ["altitude"],

  // 1-Alfaro
  "massimo.aquaro@1-group.sg":    ["alfaro", "atico", "monti", "alkaff"], // also staff via Admin tab
  "isaac.wong@1-group.sg":        ["alfaro", "monti"],
  "nurul.amin@1-group.sg":        ["alfaro"],
  "nur.syahirah@1-group.sg":      ["alfaro"],
  "andrea.chetta@1-group.sg":     ["alfaro", "monti"],

  // 1-Atico
  "alessandro.rosa@1-group.sg":   ["atico", "garage"],          // also staff via Admin tab
  "emil.kotrri@1-group.sg":       ["atico"],
  "joshiah.black@1-group.sg":     ["atico"],
  "watt.desiree@1-group.sg":      ["atico"],
  "heydel.usman@1-group.sg":      ["atico"],

  // Monti
  "davide.carella@1-group.sg":    ["monti"],                    // also staff via Admin tab
  "aska.chen@1-group.sg":         ["monti"],
  "don.lim@1-group.sg":           ["monti"],

  // The Alkaff Mansion
  "chinyi.ng@1-group.sg":         ["alkaff"],
  "weixin.low@1-group.sg":        ["alkaff"],
  "hari.prasad@1-group.sg":       ["alkaff"],
  "ruzaini.hashim@1-group.sg":    ["alkaff"],                   // also staff via Admin tab

  // The River House
  "sebastian.chua@1-group.sg":    ["riverhouse"],
  "sammy.lee@1-group.sg":         ["riverhouse"],
  "mayer.tay@1-group.sg":         ["riverhouse"],
  "wendy.leemei@1-group.sg":      ["riverhouse"],
  "kerina.lou@1-group.sg":        ["riverhouse"],
  "tricia.lim@1-group.sg":        ["riverhouse"],

  // The Summer House
  "udhaya.nair@1-group.sg":       ["summerhouse"],
  "cheryl.chia@1-group.sg":       ["summerhouse"],
  "narresh.permalu@1-group.sg":   ["summerhouse"],
  "nasrudin.jalil@1-group.sg":    ["summerhouse"],
  "safrizan.m@1-group.sg":        ["summerhouse"],
  "wendy.kuek@1-group.sg":        ["summerhouse", "garage"],
  "edward.morada@1-group.sg":     ["summerhouse"],

  // The Garage
  "chloe.chua@1-group.sg":        ["garage"],
  "kay.yang@1-group.sg":          ["garage"],
  "rada.nakwong@1-group.sg":      ["garage"],
};

const ALLOWED_DOMAIN = "@1-group.sg";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FROM_NAME = "1-Group Marketing Calendar";

export default async function handler(req, res) {
  // CORS / preflight (same-origin in production, useful for local dev)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse body
  const body = typeof req.body === "string" ? safeParseJSON(req.body) : (req.body || {});
  const email = String(body.email || "").trim().toLowerCase();
  const isOutletFlow = body.outlet === true;

  // Validate email shape
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }
  if (!/^[a-z0-9._+-]+@1-group\.sg$/i.test(email)) {
    return res.status(400).json({ error: "Only @1-group.sg email addresses are accepted." });
  }

  // Flow-specific allowlist gate
  let outletVenues = null;
  if (isOutletFlow) {
    outletVenues = OUTLET_ALLOWLIST[email];
    if (!outletVenues || !Array.isArray(outletVenues) || outletVenues.length === 0) {
      return res.status(403).json({
        error: "This email isn't on the outlet access list. Contact the 1-Group Marketing team to be added.",
      });
    }
  } else {
    if (!GROUP_ALLOWLIST.has(email)) {
      return res.status(403).json({
        error: "This email isn't on the group-access list. If you're outlet staff, use the Outlet tab. Otherwise contact a Marketing admin.",
      });
    }
  }

  // Check env config
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

  // Generate 6-digit numeric OTP (cryptographically random)
  const otpBuf = crypto.randomBytes(4);
  const otp = String((otpBuf.readUInt32BE(0) % 900000) + 100000); // 100000-999999

  // Build challenge: hash the OTP+email so the raw OTP never appears in the token.
  // For outlet flow, also encode the venues array so verify-otp grants venue-scoped access.
  const codeHash = crypto.createHash("sha256").update(`${otp}:${email}`).digest("hex");
  const expiresAt = Date.now() + OTP_TTL_MS;
  const payloadObj = { email, codeHash, expiresAt };
  if (outletVenues) payloadObj.venues = outletVenues;
  const payload = JSON.stringify(payloadObj);
  const sig = crypto.createHmac("sha256", otpSecret).update(payload).digest("hex");
  const challenge = Buffer.from(payload).toString("base64url") + "." + sig;

  // Send via Resend
  try {
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${fromEmail}>`,
        to: [email],
        subject: `Your 1-Group Marketing Calendar code: ${otp}`,
        html: buildEmailHtml(otp, outletVenues),
        text: buildEmailText(otp, outletVenues),
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

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function buildEmailHtml(otp, outletVenues) {
  const subtitle = outletVenues && outletVenues.length
    ? `Use this code to sign in to your outlet calendar view. It expires in 10 minutes.`
    : `Use this code to sign in. It expires in 10 minutes.`;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
      <h1 style="font-size:20px;margin:0 0 8px;color:#0f172a;font-weight:700;">1-Group Marketing Calendar</h1>
      <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.5;">${subtitle}</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;padding:20px 16px;background:linear-gradient(135deg,#faf5ff 0%,#eef2ff 100%);border:1px solid #e9d5ff;border-radius:8px;text-align:center;color:#0f172a;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">${otp}</div>
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">If you didn't request this code, you can safely ignore this email — no one can sign in without it.</p>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:16px 0 0;">1-Group Singapore · Internal tool</p>
  </div>
</body>
</html>`;
}

function buildEmailText(otp, outletVenues) {
  const subtitle = outletVenues && outletVenues.length ? "Use this code to sign in to your outlet calendar view." : "";
  return `1-Group Marketing Calendar
${subtitle ? "\n" + subtitle + "\n" : ""}
Your sign-in code: ${otp}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

1-Group Singapore · Internal tool`;
}
