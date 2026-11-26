// Vercel Serverless Function: GET /api/adoption/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// -------------------------------------------------------------------------------
// sessionlogs.1-group.ai asking for the calendar's figures for a period of
// Singapore days (Chris Millar, 26 Nov 2026). Answered only when signed:
//   x-sessionlogs-timestamp:  unix seconds, at most two minutes old
//   x-sessionlogs-signature:  v1=HMAC-SHA256(SESSIONLOGS_SECRET, `${timestamp}.${from}.${to}`)
// the same as the work agent (1-Group/1group-work-agent api/_lib/adoption-export.js).
// At most 35 days a request. Version 1: people, sessions, features, screens.
//
// Env: SESSIONLOGS_SECRET (32+ characters; the same value is SECRET_MARKETING_CALENDAR
// in the Session Logs project), Upstash Redis.

import { getMembers, redisCreds } from "../_lib/members.js";
import { SESSIONLOGS, exportPeriod, verifyExport, readPeriod, buildExport } from "../_lib/activity.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.SESSIONLOGS_SECRET || "";
  if (secret.length < SESSIONLOGS.minSecret) return res.status(503).json({ error: "not_configured" });
  const from = String(req.query?.from || ""), to = String(req.query?.to || "");
  const ok = verifyExport({
    secret, from, to,
    timestamp: req.headers["x-sessionlogs-timestamp"],
    signature: req.headers["x-sessionlogs-signature"],
  });
  if (!ok) return res.status(401).json({ error: "unauthorised" });
  const period = exportPeriod(from, to);
  if (!period) return res.status(400).json({ error: "bad_period", message: `Ask for at most ${SESSIONLOGS.maxDays} days, from and to as YYYY-MM-DD.` });
  const creds = redisCreds();
  if (!creds) return res.status(503).json({ error: "no_storage" });
  try {
    const [{ members }, rows] = await Promise.all([getMembers(), readPeriod(creds, period)]);
    const answer = buildExport({ ...period, ...rows, members });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(answer);
  } catch (err) {
    console.error("[adoption/export]", err && err.message);
    return res.status(500).json({ error: "export_failed" });
  }
}
