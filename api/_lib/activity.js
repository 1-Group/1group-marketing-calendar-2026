// Session Logs: who used the calendar, when, for how long, and in which view.
// ---------------------------------------------------------------------------
// Chris Millar, 26 Nov 2026: the Marketing Calendar reports to
// sessionlogs.1-group.ai like every other 1-Group app. COUNTS AND TIMES ONLY:
// a signed-in member's email, the minute they were active, which view (Board,
// Month or Heatmap) and a device label. Never a search, a filter, an event or
// anything typed.
//
// Kept in the same Upstash Redis as the rest of the calendar, for 400 days:
//   cal:act:m:<day>:<email>   hash   minute of the Singapore day -> "view|device"
//   cal:act:o:<week>:<email>  hash   view -> times opened that week (Monday)
//   cal:act:who:<day>         set    emails active that day
//   cal:act:out:<day>:<email> string minute they signed out (the last one)
//
// The pure parts (days, sessions, the answer, the signature) are exported for
// tests/adoption-export.test.mjs.

import crypto from "node:crypto";
import { VIEWS } from "../../src/lib/views.js";

export const SESSIONLOGS = { maxAgeSeconds: 120, minSecret: 32, maxDays: 35, gapMinutes: 15, keepDays: 400 };
const SG = 8 * 60 * 60 * 1000;
const DAY = 86_400_000;
const LABELS = Object.fromEntries(VIEWS.map((v) => [v.id, v.label]));

/** A view id on the list, or null. */
export const viewOf = (v) => (typeof v === "string" && Object.prototype.hasOwnProperty.call(LABELS, v) ? v : null);
export const viewLabel = (v) => LABELS[v] || v;

/** The Singapore day (YYYY-MM-DD) and minute of that day, for a time. */
export function sgDayMinute(ms) {
  const d = new Date(ms + SG);
  return { day: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/** The Monday of the week a day falls in. */
export function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}
/** Every day from..to, inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** A Singapore day and minute as an ISO time. */
export const isoAt = (day, minute) => new Date(Date.parse(`${day}T00:00:00Z`) - SG + minute * 60_000).toISOString();

// ─── The request from Session Logs ──────────────────────────────────────────
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** { from, to } when the period is good (real days, from <= to, at most 35 days), else null. */
export function exportPeriod(from, to) {
  if (!DATE.test(String(from)) || !DATE.test(String(to))) return null;
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return null;
  if (b < a || (b - a) / DAY + 1 > SESSIONLOGS.maxDays) return null;
  return { from, to };
}
export function exportSignature(secret, timestamp, from, to) {
  return `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${from}.${to}`).digest("hex")}`;
}
/** Is this request signed with the secret, recently, for exactly this period? */
export function verifyExport({ secret, timestamp, signature, from, to, now = Date.now() }) {
  if (!secret || secret.length < SESSIONLOGS.minSecret) return false;
  const ts = Number(timestamp);
  if (!/^\d+$/.test(String(timestamp)) || Math.abs(now / 1000 - ts) > SESSIONLOGS.maxAgeSeconds) return false;
  const want = Buffer.from(exportSignature(secret, String(timestamp), from, to));
  const got = Buffer.from(String(signature || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ─── The answer ─────────────────────────────────────────────────────────────
/**
 * Version 1, from what Redis holds for the period.
 *   minutes:  [{ day, email, minutes: { "540": "board|desktop", … }, signedOut: 600|null }]
 *   opens:    [{ week, email, views: { board: 3, … } }]
 *   members:  { email: { name, dept } }   everybody with access today
 */
export function buildExport({ from, to, minutes = [], opens = [], members = {}, now = Date.now() }) {
  const deptOf = (email) => members[email]?.dept || "";
  const people = Object.entries(members).map(([upn, m]) => ({ upn, name: m.name || upn, department: m.dept || "", hasAccess: true }));
  const sessions = [];
  const screens = [];
  for (const row of minutes) {
    const ms = Object.keys(row.minutes || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ms.length) continue;
    const perView = {};
    let start = ms[0], last = ms[0], device = "";
    const close = () => {
      const lastSeenAt = isoAt(row.day, last + 1);
      // A sign-out ends the session it falls in, not every session that day.
      const ended = row.signedOut != null && row.signedOut >= start && row.signedOut <= last + SESSIONLOGS.gapMinutes;
      const idle = now - Date.parse(lastSeenAt) > SESSIONLOGS.gapMinutes * 60_000;
      sessions.push({
        id: `${row.email}:${row.day}:${start}`, upn: row.email, department: deptOf(row.email),
        startedAt: isoAt(row.day, start), lastSeenAt, seconds: (last - start + 1) * 60,
        device: device || "desktop", state: ended ? "signed-out" : idle ? "idle" : "active", source: "web",
      });
    };
    for (const m of ms) {
      if (m - last > SESSIONLOGS.gapMinutes) { close(); start = m; }
      last = m;
      const [view, dev] = String(row.minutes[m]).split("|");
      if (dev) device = dev;
      if (viewOf(view)) perView[view] = (perView[view] || 0) + 1;
    }
    close();
    for (const [view, n] of Object.entries(perView)) screens.push({ day: row.day, upn: row.email, screen: view, label: viewLabel(view), minutes: n });
  }
  const features = [];
  for (const o of opens) {
    for (const [view, n] of Object.entries(o.views || {})) {
      if (viewOf(view)) features.push({ week: o.week, upn: o.email, department: deptOf(o.email), feature: view, label: viewLabel(view), uses: Number(n) || 0 });
    }
  }
  return { version: 1, from, to, people, sessions, features, screens };
}

// ─── Redis ──────────────────────────────────────────────────────────────────
const TTL = String(SESSIONLOGS.keepDays * 86400);
export const keys = {
  minutes: (day, email) => `cal:act:m:${day}:${email}`,
  opens: (week, email) => `cal:act:o:${week}:${email}`,
  who: (day) => `cal:act:who:${day}`,
  out: (day, email) => `cal:act:out:${day}:${email}`,
};

/** The commands one heartbeat writes. Pure, so it is tested. */
export function heartbeatCommands({ email, view, device, opened, signout, now = Date.now() }) {
  const { day, minute } = sgDayMinute(now);
  const v = viewOf(view) || "";
  const cmds = [
    ["HSET", keys.minutes(day, email), String(minute), `${v}|${device}`],
    ["EXPIRE", keys.minutes(day, email), TTL],
    ["SADD", keys.who(day), email],
    ["EXPIRE", keys.who(day), TTL],
  ];
  if (opened && v) cmds.push(["HINCRBY", keys.opens(mondayOf(day), email), v, "1"], ["EXPIRE", keys.opens(mondayOf(day), email), TTL]);
  if (signout) cmds.push(["SET", keys.out(day, email), String(minute), "EX", TTL]);
  return cmds;
}

/** Several commands in one request (Upstash REST /pipeline). */
export async function pipeline(creds, commands) {
  if (!commands.length) return [];
  const resp = await fetch(`${creds.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  return (await resp.json()).map((r) => r.result);
}

const hashOf = (flat) => {
  const out = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  else if (flat && typeof flat === "object") Object.assign(out, flat);
  return out;
};

/** What Redis holds for the period, in the shape buildExport takes. */
export async function readPeriod(creds, { from, to }) {
  const days = daysBetween(from, to);
  const who = await pipeline(creds, days.map((d) => ["SMEMBERS", keys.who(d)]));
  const pairs = days.flatMap((day, i) => (who[i] || []).map((email) => ({ day, email })));
  const got = await pipeline(creds, pairs.flatMap(({ day, email }) => [["HGETALL", keys.minutes(day, email)], ["GET", keys.out(day, email)]]));
  const minutes = pairs.map((p, i) => ({ ...p, minutes: hashOf(got[i * 2]), signedOut: got[i * 2 + 1] == null ? null : Number(got[i * 2 + 1]) }));
  const weekPairs = [...new Map(pairs.map((p) => [`${mondayOf(p.day)}|${p.email}`, { week: mondayOf(p.day), email: p.email }])).values()];
  const opened = await pipeline(creds, weekPairs.map(({ week, email }) => ["HGETALL", keys.opens(week, email)]));
  const opens = weekPairs.map((p, i) => ({ ...p, views: hashOf(opened[i]) }));
  return { minutes, opens };
}
