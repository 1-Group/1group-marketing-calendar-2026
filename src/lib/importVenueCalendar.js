// ─── VENUE MARKETING-CALENDAR IMPORT ───
// Parses a venue's own marketing-calendar workbook (the month × sub-brand matrix
// that outlets plan in — e.g. "2026 TAM Marketing Calendar.xlsx") and turns each
// planned activation into a venue-event record the app understands:
//
//   { id, name, venue, subBrand, start/end | month+undated, hook, layer:"venue" }
//
// The source layout is a grid:
//   • one COLUMN per month (Jan … Dec) under a month header row
//   • one ROW per sub-brand / planning lane (UNA, Wildseed Cafe, 1918 Heritage
//     Bar, the venue itself, plus internal lanes like Memo / Media / Ad hoc)
//   • each CELL is free text — often several activities separated by blank lines,
//     with dates, pricing and internal status notes mixed in.
//
// Parsing is deliberately CONSERVATIVE and TRANSPARENT: it returns not just the
// events it is confident about, but also every block it flagged (ambiguous date,
// placeholder price, stripped internal note, group-campaign link) and every lane
// it skipped. The UI shows all three so a human confirms before anything is
// written to the calendar. This mirrors the curated draft-mapping we reviewed.
//
// PURE + TESTABLE: importVenueCalendar takes an ArrayBuffer and returns plain data,
// callable from Node or the browser. No side effects, no calendar writes.

import ExcelJS from "exceljs";

const YEAR = 2026;

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
// month word (full or short) → 0-11
function monthIndex(word) {
  if (!word) return -1;
  const w = word.trim().toLowerCase().slice(0, 3);
  return MONTHS.indexOf(w);
}

// ─── lane → sub-brand resolution ───
// Rules are matched top-down against the lowercased lane label. `subBrand: null`
// means "the venue itself" (a venue-wide activity, not a sub-brand).
const SUBBRAND_RULES = [
  { re: /\buna\b/,                       subBrand: "UNA" },
  { re: /wildseed|wsca?|\bwsc\b|cafe/,   subBrand: "Wildseed Cafe" },
  { re: /1918|heritage bar/,             subBrand: "1918 Heritage Bar" },
  { re: /alkaff|mansion/,                subBrand: "The Alkaff Mansion" },
];
// Lanes that are internal planning, not customer-facing activities.
const SKIP_LANE_RE = /\b(memo|media|ad[-\s]?hoc)\b/i;
// A lane that carries seasonal/holiday context rather than owned activations.
const CONTEXT_LANE_RE = /festive|^event/i;

// ─── internal / non-public content ───
// Lines that are internal notes rather than guest-facing copy. Stripped from the
// hook; their presence is recorded so the UI can flag "internal note removed".
const INTERNAL_LINE_RE = /^(status|target|objective|theme|marketing|sources?|note\*?|pending|ordered|measure|create|development)\b|check with ops|revenue generated|e-menu|concierge menu|\b[A-Z]{2,4}:\s*\d+\b/i;
// Public-holiday / pure-context lines we don't turn into venue activities.
const HOLIDAY_LINE_RE = /new year'?s day|valentine|chinese new year|hari raya|good fri|labour day|vesak|deepavali|christmas day|national day|halloween|easter\b|father'?s day|mother'?s day|children'?s day|international .*day|world .*day|school holidays?|\(ph\)/i;
const PLACEHOLDER_PRICE_RE = /\$x+\b/i;

// ─── group-campaign linkage ───
// If a block matches one of these, we keep it AND note the group campaign it rolls
// up to (so the venue detail enriches the campaign rather than duplicating it).
const CAMPAIGN_RULES = [
  { re: /sip\s*&?\s*savou?r/i,                       campaign: "Sip & Savour" },
  { re: /she unfolds|iwd|women'?s day/i,             campaign: "She Unfolds" },
  { re: /summertime|summer goals/i,                  campaign: "Summertime Madness" },
  { re: /let'?s go local|born\s*&?\s*bred|sg\s?60/i, campaign: "Let's Go Local / Born & Bred" },
  { re: /oktoberfest/i,                              campaign: "Oktoberfest" },
  { re: /feliz navidad|christmas|santa|festive|nochebuena/i, campaign: "Festive Season Launch" },
  { re: /new year'?s eve|nye|countdown/i,            campaign: "New Year's Eve Countdown" },
];

// Normalise smart typography so a single set of straight-quote / hyphen regexes
// match regardless of how the source was typed ("Let's" vs "Let’s", "–" vs "-").
function normText(s) {
  return String(s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

// ─── cell value → plain multiline string ───
function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return normText(value);
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return normText(value.richText.map((r) => r.text).join(""));
    if (typeof value.text === "string") return normText(value.text);
    if (value.result != null) return normText(String(value.result));
  }
  return "";
}

// ─── date extraction ───
// Returns { start, end } (YYYY-MM-DD) OR { month, undated:true } OR null-with-flag.
// `colMonth` is the 0-11 month of the source column, used when a block names a day
// but not a month, or names no date at all.
function isoDate(y, mIdx, day) {
  const last = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(day, 1), last);
  return `${y}-${String(mIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function lastDayIso(y, mIdx) {
  const last = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
  return isoDate(y, mIdx, last);
}

function parseWhen(text, colMonth) {
  const t = text.replace(/–|—/g, "-"); // en/em dash → hyphen

  // 1. Numeric range across two named months: "24 Feb - 27 Mar", "19 Sep - 4 Oct"
  let m = t.match(/(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*-\s*(\d{1,2})\s*([A-Za-z]{3,9})/);
  if (m) {
    const m1 = monthIndex(m[2]), m2 = monthIndex(m[4]);
    if (m1 >= 0 && m2 >= 0) return { start: isoDate(YEAR, m1, +m[1]), end: isoDate(YEAR, m2, +m[3]) };
  }
  // 1b. Word-month → day-month range: "Jan - 3 Mar"
  m = t.match(/\b([A-Za-z]{3,9})\s*-\s*(\d{1,2})\s*([A-Za-z]{3,9})/);
  if (m) {
    const m1 = monthIndex(m[1]), m2 = monthIndex(m[3]);
    if (m1 >= 0 && m2 >= 0) return { start: isoDate(YEAR, m1, 1), end: isoDate(YEAR, m2, +m[2]) };
  }
  // 2. Numeric range within one named month: "4 - 17 May", "1 - 31 May", "3 - 26 Apr"
  m = t.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*([A-Za-z]{3,9})/);
  if (m) {
    const mi = monthIndex(m[3]);
    if (mi >= 0) return { start: isoDate(YEAR, mi, +m[1]), end: isoDate(YEAR, mi, +m[2]) };
  }
  // 3. Single day + named month: "14 Feb", "19 July", "8 Mar", "4 Oct"
  m = t.match(/(\d{1,2})\s*([A-Za-z]{3,9})/);
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi >= 0 && +m[1] >= 1 && +m[1] <= 31) return { start: isoDate(YEAR, mi, +m[1]), end: isoDate(YEAR, mi, +m[1]) };
  }
  // 4. Word-only month range: "Jan - Apr", "June - July"
  m = t.match(/\b([A-Za-z]{3,9})\s*-\s*([A-Za-z]{3,9})\b/);
  if (m) {
    const m1 = monthIndex(m[1]), m2 = monthIndex(m[2]);
    if (m1 >= 0 && m2 >= 0) return { start: isoDate(YEAR, m1, 1), end: lastDayIso(YEAR, m2) };
  }
  // 5. Leading numeric-only range at block start → use column month: "21 - 27"
  m = t.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\b/);
  if (m && +m[2] <= 31 && !/pax|pp\b|\+\+|\$/.test(t.slice(0, m[0].length + 4))) {
    return { start: isoDate(YEAR, colMonth, +m[1]), end: isoDate(YEAR, colMonth, +m[2]) };
  }
  // 6. Leading single day at block start → use column month: "21 June" handled by (3);
  //    bare "5 Apr" without month also handled by (3) only if month present, else here:
  m = t.match(/^\s*(\d{1,2})\b(?!\s*(?:pax|pp|\+\+|:|am|pm|%|\/|\.))/i);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    return { start: isoDate(YEAR, colMonth, +m[1]), end: isoDate(YEAR, colMonth, +m[1]) };
  }
  // Nothing dated → month-long.
  return { month: colMonth, undated: true };
}

// ─── activity extraction (one activity per cell) ───
// Strip a leading date fragment from a line so a date-prefixed title reads cleanly.
const LEADING_DATE_RE = /^\s*(?:\d{1,2}\s*[A-Za-z]{0,9}\.?\s*-\s*\d{1,2}\s*[A-Za-z]{0,9}|\d{1,2}\s*-\s*\d{1,2}\s*[A-Za-z]{0,9}|[A-Za-z]{3,9}\s*-\s*\d{1,2}\s*[A-Za-z]{3,9}|\d{1,2}\s*[A-Za-z]{3,9}|[A-Za-z]{3,9}\s*-\s*[A-Za-z]{3,9})[:,)\s]*/;
// A line that is essentially just a date (little else once the date is removed).
function isDateOnly(line) {
  const stripped = line.replace(LEADING_DATE_RE, "").replace(/[^A-Za-z]/g, "");
  return stripped.length < 3;
}
// A line that is essentially just a price / quantity.
function isPriceOnly(line) {
  return /^\$?\s*\d[\d,.]*\s*(\+\+|nett|pp|per pax|\/.*)?$/i.test(line.trim()) || /^\$\d/.test(line.trim());
}

function extractActivity(cellRaw) {
  const rawLines = cellRaw.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const kept = [];
  let strippedInternal = false;
  for (const line of rawLines) {
    if (INTERNAL_LINE_RE.test(line)) { strippedInternal = true; continue; }
    kept.push(line);
  }
  if (!kept.length) return null;

  // Title = first kept line that is a real name (not a bare date, not a bare price).
  let titleIdx = kept.findIndex((l) => !isDateOnly(l) && !isPriceOnly(l) && /[A-Za-z]{3,}/.test(l));
  if (titleIdx < 0) titleIdx = 0;
  let name = kept[titleIdx].replace(LEADING_DATE_RE, "").trim();
  if (!name) name = kept[titleIdx];
  if (name.length > 90) name = name.slice(0, 87) + "…";

  // Hook = the other kept lines, condensed.
  const rest = kept.filter((_, i) => i !== titleIdx);
  let hook = rest.join(" · ");
  if (hook.length > 240) hook = hook.slice(0, 237) + "…";
  return { name, hook, strippedInternal };
}

// ─── merge the same activity repeated across consecutive months ───
// Matrix calendars restate a running promotion in each month's column; collapse
// identical (subBrand + name) records into a single spanning date range.
function monthSpan(evt) {
  if (evt.start && evt.end) return [Number(evt.start.slice(5, 7)) - 1, Number(evt.end.slice(5, 7)) - 1];
  if (evt.month != null) return [evt.month, evt.month];
  return [null, null];
}
function mergeConsecutive(records) {
  const groups = new Map();
  const order = [];
  for (const r of records) {
    const key = `${r.venue}|${r.subBrand || ""}|${r.name.toLowerCase()}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(r);
  }
  const out = [];
  for (const key of order) {
    const grp = groups.get(key);
    if (grp.length === 1) { out.push(grp[0]); continue; }
    // Merge: earliest start → latest end, union of flags/hook, keep campaign.
    let minM = 99, maxM = -1, minStart = null, maxEnd = null, anyDated = false;
    const flags = new Set(), hooks = new Set();
    let campaign = null;
    for (const r of grp) {
      const [a, b] = monthSpan(r);
      if (a != null) { minM = Math.min(minM, a); maxM = Math.max(maxM, b); }
      if (r.start) { anyDated = true; if (!minStart || r.start < minStart) minStart = r.start; if (!maxEnd || r.end > maxEnd) maxEnd = r.end; }
      (r._flags || []).forEach((f) => flags.add(f));
      if (r.hook) hooks.add(r.hook);
      if (r.campaign) campaign = r.campaign;
    }
    const base = { ...grp[0] };
    delete base.start; delete base.end; delete base.month; delete base.undated;
    if (anyDated) {
      base.start = minStart || isoDate(YEAR, minM, 1);
      base.end = maxEnd || lastDayIso(YEAR, maxM);
    } else {
      base.start = isoDate(YEAR, minM, 1);
      base.end = lastDayIso(YEAR, maxM);
    }
    const mergedFlags = [...flags];
    if (grp.length > 1) mergedFlags.push(`Merged from ${grp.length} monthly cells`);
    base.hook = [...hooks][0] || base.hook;
    if (campaign) base.campaign = campaign;
    base._flags = mergedFlags;
    out.push(base);
  }
  return out;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

// ─── detect the matrix layout ───
function detectMatrix(ws) {
  const maxRow = Math.min(ws.rowCount || 0, 100);
  const maxCol = Math.min(ws.columnCount || 1, 40);
  let headerRow = 0, best = 0;
  const monthCols = {}; // col -> monthIndex
  for (let r = 1; r <= maxRow; r++) {
    const found = {};
    for (let c = 1; c <= maxCol; c++) {
      const mi = monthIndex(cellText(ws.getRow(r).getCell(c).value).trim());
      // require an exact-ish month word (short label) to avoid false hits
      const txt = cellText(ws.getRow(r).getCell(c).value).trim().toLowerCase();
      if (mi >= 0 && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(txt) && txt.length <= 10) {
        found[c] = mi;
      }
    }
    const count = Object.keys(found).length;
    if (count > best) { best = count; headerRow = r; Object.assign(monthCols, {}); Object.keys(monthCols).forEach(k => delete monthCols[k]); Object.assign(monthCols, found); }
  }
  if (best < 6) return null; // not a 12-month matrix
  // Lane-label column = the left-most column that has text but is not a month column.
  const monthColNums = Object.keys(monthCols).map(Number).sort((a, b) => a - b);
  let labelCol = 1;
  for (let c = 1; c < monthColNums[0]; c++) {
    // pick the last non-month column before the first month column
    labelCol = c;
  }
  return { headerRow, monthCols, labelCol, firstMonthCol: monthColNums[0] };
}

// Main entry point. arrayBuffer of a venue marketing-calendar .xlsx → structured
// import preview. Nothing is written anywhere; the caller decides what to load.
export async function importVenueCalendar(arrayBuffer, { venue, venueName } = {}) {
  if (!venue) throw new Error("A target venue is required to import activities.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  // Use the first sheet that looks like a month matrix.
  let ws = null, matrix = null;
  wb.eachSheet((sheet) => {
    if (matrix) return;
    const m = detectMatrix(sheet);
    if (m) { ws = sheet; matrix = m; }
  });
  if (!matrix) {
    throw new Error(
      "Could not find a month grid in this workbook. Expected a sheet with a row of month headers (Jan … Dec) and one row per sub-brand."
    );
  }

  const { headerRow, monthCols, labelCol } = matrix;
  const raw = [];       // all parsed records before merge
  const skipped = [];   // { lane, reason }
  const maxRow = Math.min(ws.rowCount || 0, 200);
  const seenLanes = new Set();
  let seq = 0;

  const mkRecord = ({ subBrand, cellRaw, mIdx, laneLabel }) => {
    const flags = [];
    const activity = extractActivity(cellRaw);
    if (!activity || !activity.name || activity.name.replace(/[^A-Za-z]/g, "").length < 2) return null;
    if (activity.strippedInternal) flags.push("Internal note stripped");

    const when = parseWhen(cellRaw, mIdx);
    if (PLACEHOLDER_PRICE_RE.test(cellRaw)) flags.push("Placeholder price ($xx) — confirm");

    let campaign = null;
    for (const rule of CAMPAIGN_RULES) { if (rule.re.test(cellRaw)) { campaign = rule.campaign; break; } }
    if (campaign) flags.push(`Rolls up to group campaign: ${campaign}`);

    if (when.undated && /^\s*\d/.test(cellRaw)) flags.push("Date unclear — defaulted to whole month");

    return {
      id: `vn-${venue}-imp-${slugify(subBrand)}-${++seq}`,
      name: activity.name,
      venue,
      layer: "venue",
      ...(subBrand ? { subBrand } : {}),
      ...(when.start ? { start: when.start, end: when.end } : { month: when.month, undated: true }),
      ...(activity.hook ? { hook: activity.hook } : {}),
      ...(campaign ? { campaign } : {}),
      _flags: flags,
      _source: `${laneLabel} · ${MONTHS[mIdx].replace(/^\w/, (c) => c.toUpperCase())}`,
    };
  };

  for (let r = headerRow + 1; r <= maxRow; r++) {
    const laneLabel = cellText(ws.getRow(r).getCell(labelCol).value).trim();
    if (!laneLabel) continue;
    const laneKey = laneLabel.toLowerCase();

    if (SKIP_LANE_RE.test(laneKey)) {
      if (!seenLanes.has(laneKey)) { skipped.push({ lane: laneLabel, reason: "Internal planning lane (Memo / Media / Ad-hoc) — review manually" }); seenLanes.add(laneKey); }
      continue;
    }

    const isContext = CONTEXT_LANE_RE.test(laneKey);
    let subBrand = null;
    for (const rule of SUBBRAND_RULES) { if (rule.re.test(laneKey)) { subBrand = rule.subBrand; break; } }
    if (!subBrand) subBrand = venueName || (isContext ? null : laneLabel);

    for (const [colStr, mIdx] of Object.entries(monthCols)) {
      const cellRaw = cellText(ws.getRow(r).getCell(Number(colStr)).value).trim();
      if (!cellRaw) continue;

      if (isContext) {
        // Context / festive lane is mostly public holidays and int'l food days. Keep
        // only genuine venue happenings (anniversaries, wedding fairs); skip the rest.
        const lines = cellRaw.split(/\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!/anniversary|wedding fair/i.test(line)) continue;
          const rec = mkRecord({ subBrand, cellRaw: line, mIdx, laneLabel });
          if (rec) raw.push(rec);
        }
        continue;
      }

      const rec = mkRecord({ subBrand, cellRaw, mIdx, laneLabel });
      if (rec) raw.push(rec);
    }
  }

  // Collapse the same activity repeated across consecutive months, then split into
  // confident vs. needs-a-look based on whether any flags remain.
  const merged = mergeConsecutive(raw);
  const events = [];
  const flagged = [];
  for (const rec of merged) {
    if (rec.campaign) rec._enrich = true;
    if (rec._flags && rec._flags.length) flagged.push(rec); else events.push(rec);
  }

  return {
    venue,
    sheet: ws.name,
    events,     // confidently parsed, no flags
    flagged,    // parsed but need a human decision
    skipped,    // lanes not imported
    summary: {
      total: events.length + flagged.length,
      clean: events.length,
      flagged: flagged.length,
      skippedLanes: skipped.length,
    },
  };
}

// Strip the preview-only helper fields before an event is written to the calendar.
export function toVenueEvent(record) {
  const { _flags, _source, _enrich, campaign, ...evt } = record;
  // Fold the campaign link into the hook so it survives in the calendar model.
  if (campaign) {
    const tag = `Campaign: ${campaign}`;
    evt.hook = evt.hook ? `${evt.hook} · ${tag}` : tag;
  }
  return evt;
}
