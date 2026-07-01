// api/_lib/members.js
// ─────────────────────────────────────────────────────────────────────────
// Shared access-control library for the 1-Group Marketing Calendar.
//
// The member allowlist (who may sign in, and at what level) lives in Upstash
// Redis under the key `cal:members`, so master admins can grant/revoke access
// from inside the app WITHOUT a code change or redeploy. On first use, the list
// is seeded from SEED_MEMBERS (the approved list supplied by 1-Group). If Redis
// is unavailable, callers fall back to SEED_MEMBERS so sign-in still works.
//
// Tiers (stored per member):
//   master  — full control + the member-settings panel + access log + venue codes
//   editor  — full group view, can add/edit events        (frontend role "admin")
//   viewer  — full group view, read-only                  (frontend role "user")
//   outlet  — scoped to one or more venues, can add their venue's activities
//                                                          (frontend role "venue")
//
// Used by: api/auth/send-otp.js, api/auth/verify-otp.js, api/admin/members.js

import crypto from "node:crypto";

export const MEMBERS_KEY = "cal:members";
export const ALLOWED_DOMAIN = "@1-group.sg";
export const VALID_TIERS = ["master", "editor", "viewer", "outlet"];
export const VALID_VENUES = [
  "summerhouse", "garage", "altitude", "arden", "alkaff",
  "alfaro", "atico", "riverhouse", "flowerhill", "monti",
];

// Map a stored member tier → the role the frontend already understands.
const TIER_TO_ROLE = { master: "master", editor: "admin", viewer: "user", outlet: "venue" };
export function tierToRole(tier) { return TIER_TO_ROLE[tier] || "user"; }

// Derive a friendly display name from the local part of an email.
export function niceName(email) {
  const lp = String(email || "").split("@")[0];
  return lp.split(/[._-]/).filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || lp;
}

export function normaliseEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}
export function isValidEmail(email) {
  return /^[a-z0-9._+-]+@1-group\.sg$/i.test(email);
}

// ─── SEED (approved access list supplied by 1-Group) ─────────────────────
// Editable here for the initial seed only; day-to-day changes happen in-app.
function buildSeed() {
  const m = {};
  const add = (local, tier, extra = {}) => {
    const email = `${local}@1-group.sg`;
    m[email] = {
      tier,
      name: extra.name || niceName(email),
      dept: extra.dept || "",
      venues: extra.venues || [],
      addedBy: "seed",
      addedAt: 0,
      updatedAt: 0,
    };
  };

  // Master admins
  add("chris.millar", "master", { name: "Chris Millar", dept: "Leadership" });
  add("immelia.izalena", "master", { name: "Immelia Izalena", dept: "Marketing" });

  // Full group access — editors (Marketing / Sales: keep current edit rights)
  ["guiying.chua", "praveena.gunasegaran", "jessie.tan", "audrey.ng"].forEach(u => add(u, "editor", { dept: "Marketing" }));
  ["eileen.tan", "janet.sim", "alvin.chua"].forEach(u => add(u, "editor", { dept: "Sales" }));

  // Full group access — viewers (Operations / Culinary / other: read-only today)
  add("joseph.ong", "viewer", { dept: "Operations" });
  add("tom.kung", "viewer", { dept: "Culinary" });
  add("felix.chong", "viewer", { dept: "Culinary" });
  ["xiaochyi.tan", "benjamin.zhou", "shirley.gan"].forEach(u => add(u, "viewer", { dept: "Group" }));

  // Outlet-level — scoped to one or more venues (aggregated across the list)
  const outlet = {
    "daryl.xie": ["arden"], "shaughn.scully": ["arden"], "fletcher.khor": ["arden"],
    "keisha.tay": ["arden"], "leona.dutt": ["arden"],
    "joyi.ang": ["altitude", "flowerhill"], "jolene.mudaliar": ["altitude", "flowerhill"],
    "mimi": ["altitude", "flowerhill"], "kumar.k": ["altitude", "riverhouse"],
    "dhanik.niroshan": ["altitude"], "kokseng.ng": ["altitude"],
    "massimo.aquaro": ["alfaro", "atico", "monti", "alkaff"], "isaac.wong": ["alfaro", "monti"],
    "nurul.amin": ["alfaro"], "nur.syahirah": ["alfaro"], "andrea.chetta": ["alfaro", "monti"],
    "alessandro.rosa": ["atico", "garage"], "emil.kotrri": ["atico"], "joshiah.black": ["atico"],
    "watt.desiree": ["atico"], "heydel.usman": ["atico"],
    "davide.carella": ["monti"], "aska.chen": ["monti"], "don.lim": ["monti"],
    "chinyi.ng": ["alkaff"], "weixin.low": ["alkaff"], "hari.prasad": ["alkaff"], "ruzaini.hashim": ["alkaff"],
    "sebastian.chua": ["riverhouse"], "sammy.lee": ["riverhouse"], "mayer.tay": ["riverhouse"],
    "wendy.leemei": ["riverhouse"], "kerina.lou": ["riverhouse"], "tricia.lim": ["riverhouse"],
    "udhaya.nair": ["summerhouse"], "cheryl.chia": ["summerhouse"], "narresh.permalu": ["summerhouse"],
    "nasrudin.jalil": ["summerhouse"], "safrizan.m": ["summerhouse"], "edward.morada": ["summerhouse"],
    "wendy.kuek": ["summerhouse", "garage"],
    "chloe.chua": ["garage"], "kay.yang": ["garage"], "rada.nakwong": ["garage"],
  };
  for (const [local, venues] of Object.entries(outlet)) add(local, "outlet", { venues });

  return m;
}
export const SEED_MEMBERS = buildSeed();

// ─── Redis (Upstash REST) ────────────────────────────────────────────────
export function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}
export async function redis(creds, command) {
  const resp = await fetch(creds.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  return resp.json();
}

// Load the member map. Seeds Redis on first use. Falls back to SEED_MEMBERS if
// Redis is not configured or unreachable (so sign-in never hard-fails).
export async function getMembers() {
  const creds = redisCreds();
  if (!creds) return { members: { ...SEED_MEMBERS }, source: "seed-no-redis" };
  try {
    const r = await redis(creds, ["GET", MEMBERS_KEY]);
    if (r && typeof r.result === "string" && r.result.length) {
      const parsed = JSON.parse(r.result);
      if (parsed && typeof parsed === "object") return { members: parsed, source: "redis" };
    }
    // First run — seed it.
    await redis(creds, ["SET", MEMBERS_KEY, JSON.stringify(SEED_MEMBERS)]);
    return { members: { ...SEED_MEMBERS }, source: "seeded" };
  } catch (err) {
    console.error("[members] getMembers redis error:", err && err.message);
    return { members: { ...SEED_MEMBERS }, source: "seed-fallback" };
  }
}

export async function saveMembers(members) {
  const creds = redisCreds();
  if (!creds) throw new Error("Storage not configured");
  await redis(creds, ["SET", MEMBERS_KEY, JSON.stringify(members)]);
}

// Sanitise/validate a member record coming from the admin panel.
export function sanitiseMember(input) {
  const tier = VALID_TIERS.includes(input.tier) ? input.tier : null;
  if (!tier) return { error: "Invalid access level." };
  let venues = Array.isArray(input.venues) ? input.venues.filter(v => VALID_VENUES.includes(v)) : [];
  if (tier === "outlet" && venues.length === 0) return { error: "Outlet members need at least one venue." };
  if (tier !== "outlet") venues = [];
  const name = String(input.name || "").trim().slice(0, 80);
  const dept = String(input.dept || "").trim().slice(0, 48);
  return { member: { tier, name, dept, venues } };
}

// ─── Session tokens (HMAC via OTP_SECRET) ────────────────────────────────
export function verifySessionToken(token) {
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
