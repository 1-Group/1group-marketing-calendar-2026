// Session Logs: the calendar's activity log and its answer to sessionlogs.1-group.ai.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SESSIONLOGS, viewOf, sgDayMinute, mondayOf, daysBetween, isoAt, exportPeriod,
  exportSignature, verifyExport, buildExport, heartbeatCommands, keys,
} from "../api/_lib/activity.js";
import { VIEWS } from "../src/lib/views.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("signed like the work agent and the Directors Dashboard, recently, for exactly this period", () => {
  const KEY = "k".repeat(40), ts = "1793152800", now = 1793152800 * 1000;
  const sig = exportSignature(KEY, ts, "2026-10-01", "2026-10-28");
  // The work agent's own exportSignature gives this for the same inputs.
  assert.equal(sig, "v1=438e2790e81d24bfc437728be709e45b28c9171cf13856783c18037184774d9c");
  const ok = (o) => verifyExport({ secret: KEY, timestamp: ts, signature: sig, from: "2026-10-01", to: "2026-10-28", now, ...o });
  assert.equal(ok({}), true);
  assert.equal(ok({ now: now + 121_000 }), false, "older than two minutes");
  assert.equal(ok({ to: "2026-10-29" }), false, "another period");
  assert.equal(ok({ signature: exportSignature("x".repeat(40), ts, "2026-10-01", "2026-10-28") }), false, "another secret");
  assert.equal(ok({ secret: "short" }), false, "a secret under 32 characters");
  assert.equal(ok({ timestamp: "abc" }), false);
});

test("the period is real days, in order, at most 35", () => {
  assert.deepEqual(exportPeriod("2026-11-01", "2026-11-26"), { from: "2026-11-01", to: "2026-11-26" });
  assert.equal(exportPeriod("2026-10-01", "2026-11-26"), null);
  assert.equal(exportPeriod("2026-11-26", "2026-11-01"), null);
  assert.equal(exportPeriod("2026-02-30", "2026-03-01"), null);
  assert.equal(exportPeriod("26-11-01", "2026-11-26"), null);
  assert.equal(daysBetween("2026-11-29", "2026-12-02").length, 4);
});

test("Singapore days and weeks", () => {
  // 23:30 UTC on 25 Nov is 07:30 on 26 Nov in Singapore.
  assert.deepEqual(sgDayMinute(Date.parse("2026-11-25T23:30:00Z")), { day: "2026-11-26", minute: 450 });
  assert.equal(mondayOf("2026-11-26"), "2026-11-23");
  assert.equal(mondayOf("2026-11-23"), "2026-11-23");
  assert.equal(isoAt("2026-11-26", 450), "2026-11-25T23:30:00.000Z");
});

test("only views on the list are recorded, and the buttons are drawn from that list", () => {
  assert.deepEqual(VIEWS.map((v) => v.id), ["board", "month", "heatmap"]);
  assert.equal(viewOf("board"), "board");
  assert.deepEqual([viewOf("admin"), viewOf("__proto__"), viewOf(undefined), viewOf({})], [null, null, null, null]);
  const app = read("../src/App-updated.jsx");
  assert.match(app, /import \{ VIEWS \} from "\.\/lib\/views\.js"/);
  assert.match(app, /\{VIEWS\.map\(\(\{ id: v, label \}\)/);
  for (const v of VIEWS) assert.match(app, new RegExp(`view === "${v.id}" &&`), `${v.id} is drawn`);
});

test("a heartbeat writes the minute, the day, and an opening only when one happened", () => {
  const now = Date.parse("2026-11-26T01:05:30Z"); // 09:05 in Singapore
  const plain = heartbeatCommands({ email: "a@1-group.sg", view: "month", device: "desktop", now });
  assert.deepEqual(plain[0], ["HSET", keys.minutes("2026-11-26", "a@1-group.sg"), "545", "month|desktop"]);
  assert.ok(plain.some((c) => c[0] === "SADD" && c[2] === "a@1-group.sg"));
  assert.ok(!plain.some((c) => c[0] === "HINCRBY"));
  const opened = heartbeatCommands({ email: "a@1-group.sg", view: "month", device: "desktop", opened: true, now });
  assert.ok(opened.some((c) => c[0] === "HINCRBY" && c[1] === keys.opens("2026-11-23", "a@1-group.sg") && c[2] === "month"));
  const out = heartbeatCommands({ email: "a@1-group.sg", view: "x", device: "mobile", signout: true, now });
  assert.equal(out[0][3], "|mobile", "an unknown view is time without a view");
  assert.ok(out.some((c) => c[0] === "SET" && c[1] === keys.out("2026-11-26", "a@1-group.sg") && c[2] === "545"));
  assert.ok(plain.every((c) => c[0] !== "EXPIRE" || c[2] === String(SESSIONLOGS.keepDays * 86400)));
});

test("the answer: sessions split by a 15-minute gap, minutes by view, openings by week", () => {
  const minutes = { 540: "board|desktop", 541: "board|desktop", 542: "month|desktop", 600: "heatmap|mobile", 601: "|mobile" };
  const a = buildExport({
    from: "2026-11-26", to: "2026-11-26",
    minutes: [{ day: "2026-11-26", email: "a@1-group.sg", minutes, signedOut: 601 }],
    opens: [{ week: "2026-11-23", email: "a@1-group.sg", views: { board: "2", month: "1", nope: "9" } }],
    members: { "a@1-group.sg": { name: "Ann", dept: "Marketing" }, "b@1-group.sg": { name: "Ben", dept: "" } },
    now: Date.parse("2026-11-27T00:00:00Z"),
  });
  assert.equal(a.version, 1);
  assert.deepEqual([a.from, a.to], ["2026-11-26", "2026-11-26"]);
  assert.deepEqual(a.people.map((p) => [p.upn, p.name, p.department, p.hasAccess]), [["a@1-group.sg", "Ann", "Marketing", true], ["b@1-group.sg", "Ben", "", true]]);
  assert.equal(a.sessions.length, 2);
  assert.deepEqual(a.sessions.map((s) => [s.seconds, s.state, s.device]), [[180, "idle", "desktop"], [120, "signed-out", "mobile"]]);
  assert.equal(a.sessions[0].startedAt, isoAt("2026-11-26", 540));
  assert.equal(a.sessions[0].lastSeenAt, isoAt("2026-11-26", 543));
  assert.deepEqual(a.screens.map((s) => [s.screen, s.label, s.minutes]).sort(), [["board", "Board", 2], ["heatmap", "Heatmap", 1], ["month", "Month", 1]]);
  assert.deepEqual(a.features.map((f) => [f.week, f.feature, f.uses]), [["2026-11-23", "board", 2], ["2026-11-23", "month", 1]]);
  for (const s of a.sessions) assert.deepEqual(Object.keys(s).sort(), ["department", "device", "id", "lastSeenAt", "seconds", "source", "startedAt", "state", "upn"]);
});

test("the endpoints: signed export, token-only heartbeat, sign-out logged", () => {
  const exp = read("../api/adoption/export.js");
  assert.match(exp, /verifyExport\(/);
  assert.match(exp, /status\(401\)/);
  assert.match(exp, /status\(400\)/);
  const hb = read("../api/activity/heartbeat.js");
  assert.match(hb, /verifySessionToken\(/);
  assert.doesNotMatch(hb, /body\.email/, "identity never comes from the body");
  const app = read("../src/App-updated.jsx");
  assert.match(app, /sendHeartbeat\(\{ view: viewRef\.current, signout: true \}\)/);
  assert.match(app, /document\.visibilityState !== "visible"/);
  assert.match(app, /5 \* 60_000/);
});
