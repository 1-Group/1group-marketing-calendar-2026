// Vercel Serverless Function: POST /api/activity/heartbeat
// ---------------------------------------------------------
// Once a minute while a signed-in member has the calendar in front of them and
// has used it in the last five minutes (src/App-updated.jsx), and at once when
// they change view, come back to the tab or sign out. Feeds Session Logs
// (api/_lib/activity.js). Counts and times only.
//
// Body: { view, opened?, signout? }   Header: Authorization: Bearer <session token>
// Identity comes from the signed session token, never from the body, so a
// heartbeat cannot be sent for somebody else. Always 204: the log must never
// get in the way of the calendar.
//
// Env: OTP_SECRET (verifies the token), Upstash Redis (as the rest of the app).

import { verifySessionToken, redisCreds, normaliseEmail, ALLOWED_DOMAIN } from "../_lib/members.js";
import { heartbeatCommands, pipeline } from "../_lib/activity.js";

const device = (ua) => (/Mobi|Android|iPhone|iPad/i.test(String(ua || "")) ? "mobile" : "desktop");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const auth = String(req.headers.authorization || "");
    const session = verifySessionToken(auth.startsWith("Bearer ") ? auth.slice(7) : "");
    const email = normaliseEmail(session?.email);
    const creds = redisCreds();
    if (email.endsWith(ALLOWED_DOMAIN) && creds) {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      await pipeline(creds, heartbeatCommands({
        email, view: body.view, device: device(req.headers["user-agent"]),
        opened: body.opened === true, signout: body.signout === true,
      }));
    }
  } catch (err) {
    console.error("[activity/heartbeat]", err && err.message);
  }
  return res.status(204).end();
}
