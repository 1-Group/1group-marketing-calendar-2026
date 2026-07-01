// Vercel Serverless Function: POST /api/admin/members
// ----------------------------------------------------
// Master-admins-only management of the sign-in allowlist. The caller proves they
// are a master by sending their signed session token (issued by verify-otp); the
// token's role must be "master".
//
// Body: { action, token, ... }
//   action: "list"    → { members: [ { email, tier, name, dept, venues }, ... ] }
//   action: "upsert"  → { email, member: { tier, name, dept, venues } }  → { ok, members }
//   action: "remove"  → { email }                                        → { ok, members }
//
// Returns: 200 on success · 401 not a master / bad token · 400 bad input ·
//          500 storage/misconfig.
//
// Env vars: OTP_SECRET (token verify) + KV_REST_API_URL / KV_REST_API_TOKEN.

import {
  getMembers, saveMembers, verifySessionToken, sanitiseMember,
  normaliseEmail, isValidEmail, redisCreds,
} from "../_lib/members.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  const action = String(body.action || "list");

  // Auth: valid session token whose role is master.
  const session = verifySessionToken(body.token);
  if (!session || session.role !== "master") {
    return res.status(401).json({ error: "Master admin access required." });
  }

  if (!redisCreds()) {
    return res.status(500).json({ error: "Member storage not connected. Add Upstash Redis in Vercel → Storage." });
  }

  let membersMap;
  try {
    membersMap = (await getMembers()).members;
  } catch {
    return res.status(500).json({ error: "Could not read the member list." });
  }

  const toList = (map) => Object.entries(map)
    .map(([email, m]) => ({ email, tier: m.tier, name: m.name || "", dept: m.dept || "", venues: m.venues || [] }))
    .sort((a, b) => a.email.localeCompare(b.email));

  if (action === "list") {
    return res.status(200).json({ members: toList(membersMap) });
  }

  if (action === "upsert") {
    const email = normaliseEmail(body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid @1-group.sg email address." });
    }
    const { member, error } = sanitiseMember(body.member || {});
    if (error) return res.status(400).json({ error });

    const existing = membersMap[email];
    // Don't let a master silently strip the last master's own access.
    if (existing && existing.tier === "master" && member.tier !== "master" && countMasters(membersMap) <= 1) {
      return res.status(400).json({ error: "Can't change the last master admin's level. Add another master first." });
    }

    membersMap[email] = {
      tier: member.tier,
      name: member.name || existing?.name || "",
      dept: member.dept || existing?.dept || "",
      venues: member.venues,
      addedBy: existing?.addedBy || session.email || "master",
      addedAt: existing?.addedAt || Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await saveMembers(membersMap);
    } catch {
      return res.status(500).json({ error: "Could not save. Please try again." });
    }
    return res.status(200).json({ ok: true, members: toList(membersMap) });
  }

  if (action === "remove") {
    const email = normaliseEmail(body.email);
    if (!membersMap[email]) {
      return res.status(200).json({ ok: true, members: toList(membersMap) }); // already gone
    }
    if (email === normaliseEmail(session.email)) {
      return res.status(400).json({ error: "You can't remove your own access." });
    }
    if (membersMap[email].tier === "master" && countMasters(membersMap) <= 1) {
      return res.status(400).json({ error: "Can't remove the last master admin." });
    }
    delete membersMap[email];
    try {
      await saveMembers(membersMap);
    } catch {
      return res.status(500).json({ error: "Could not save. Please try again." });
    }
    return res.status(200).json({ ok: true, members: toList(membersMap) });
  }

  return res.status(400).json({ error: "Unknown action." });
}

function countMasters(map) {
  return Object.values(map).filter(m => m.tier === "master").length;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
