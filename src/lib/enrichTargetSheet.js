// ─── TARGET SHEET ENRICHMENT ───
// Takes a team member's own target/forecast workbook (e.g. an outlet's daily
// target sheet with a Date column per tab) and folds the 1-Group 2026 marketing
// calendar into it, matching the agreed layout:
//
//   [Date] │ Demand (Hot/Cold) │ SG Events │ MICE Events │ Visitor Peaks │ [Event]…
//   → Public + School holidays are merged INTO the existing Event column.
//   → 1-Group Campaigns and Venue Activities are appended at the far right.
//
// The four calendar columns are INSERTED immediately after the Date column, which
// pushes every existing column (and the financial TARGET/ACTUAL/VARIANCE/TO GO
// blocks) to the right. Excel reflows formulas automatically on a column insert;
// ExcelJS does not — so we reflow every formula reference ourselves before the
// splice: within-sheet ranges, shared-formula pointers/refs, cross-sheet
// references (e.g. the FORECAST tab's `'JUL 26'!C6`) and merged-cell ranges. The
// shift rule is uniform: any column reference at or after the insert point moves
// by the number of inserted columns; earlier columns stay put. A range whose left
// edge is before the insert and right edge is after simply expands, exactly as
// Excel would. The result keeps every sum, variance and cross-sheet total intact.
//
// PURE + TESTABLE: enrichTargetWorkbook takes an ArrayBuffer and returns a Buffer,
// callable from Node or the browser.

import ExcelJS from "exceljs";
import {
  MONTH_SHORT,
  MICE_EVENTS, SG_EVENTS, VISITOR_DATA,
  SCHOOL_HOLIDAYS, PUBLIC_HOLIDAYS, CAMPAIGNS,
  SEED_VENUE_EVENTS, parseVenueData, LAYER_COLORS,
} from "../data/calendar2026.js";

const CALENDAR_YEAR = 2026;

// Calendar columns inserted immediately after the Date column, in order.
export const FRONT_COLUMNS = [
  { key: "demand",   label: "Demand (Hot/Cold)", width: 14 },
  { key: "sg",       label: "SG Events",         width: 40 },
  { key: "mice",     label: "MICE Events",       width: 34 },
  { key: "visitors", label: "Visitor Peaks",     width: 34 },
];

// Calendar columns appended at the far right (after all existing data).
export const TAIL_COLUMNS = [
  { key: "campaign", label: "1-Group Campaigns", width: 34 },
  { key: "venue",    label: "Venue Activities",  width: 40 },
];

// Public + School holidays are merged into the existing Event column rather than
// getting their own columns.

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6366F1" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFE2E8F0" } },
  bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
};

// ─── column-letter helpers ───
function colToNum(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}
function numToCol(n) {
  let s = "";
  while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// "#DC2626" → "FFDC2626"; "#fff" → "FFFFFFFF".
function hexToArgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (h.length !== 6) return "FF000000";
  return "FF" + h.toUpperCase();
}

// Normalise any cell value to a YYYY-MM-DD string, or null if it isn't a date.
export function cellToISODate(value) {
  if (value == null) return null;
  let d = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "object") {
    if (value.result instanceof Date) d = value.result;
    else if (typeof value.result === "string") return cellToISODate(value.result);
    else if (typeof value.text === "string") return cellToISODate(value.text);
    else return null;
  } else if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// Per-date calendar lookup for a zone. Venue activities are scoped to the chosen
// zone; "group" shows every outlet's.
export function buildCalendarLookup(zone) {
  const hcZone = zone && zone !== "group" ? zone : "group";
  const hc = parseVenueData(hcZone);
  const venueEvents = zone && zone !== "group"
    ? SEED_VENUE_EVENTS.filter((e) => e.venue === zone)
    : SEED_VENUE_EVENTS;
  const venueLabel = (e) => (e.subBrand ? `${e.name} (${e.subBrand})` : e.name);

  return function forDate(iso) {
    const blank = {
      demand: "", demandColor: null, demandText: null,
      sg: "", mice: "", visitors: "", campaign: "", venue: "",
      ph: "", school: "",
    };
    if (!iso || parseInt(iso.slice(0, 4), 10) !== CALENDAR_YEAR) return blank;

    const mi = parseInt(iso.split("-")[1], 10) - 1;
    const monShort = MONTH_SHORT[mi];

    const rating = hc[iso]?.rating || null;
    const ph = PUBLIC_HOLIDAYS.find((h) => h.date === iso);
    const school = SCHOOL_HOLIDAYS.find((h) => iso >= h.start && iso <= h.end);
    const sg = SG_EVENTS.filter((e) => iso >= e.start && iso <= e.end).map((e) => e.name);
    const mice = MICE_EVENTS.filter((e) => iso >= e.start && iso <= e.end).map((e) => e.name);
    const campaigns = CAMPAIGNS
      .filter((c) => {
        const endM = c.endMonth != null ? c.endMonth : c.month;
        return mi >= c.month && mi <= endM;
      })
      .map((c) => (c.tagline ? `${c.name} — ${c.tagline}` : c.name));
    const venue = venueEvents
      .filter((e) => {
        if (e.start && e.end) return iso >= e.start && iso <= e.end;
        if (e.month != null) return e.month === mi;
        return false;
      })
      .map(venueLabel);
    const peaks = VISITOR_DATA.filter((v) => v.data[monShort] === "Peak").map((v) => v.market);
    const high = VISITOR_DATA.filter((v) => v.data[monShort] === "High").map((v) => v.market);

    let visitors = "";
    if (peaks.length) visitors = `Peak: ${peaks.join(", ")}`;
    if (high.length) visitors += (visitors ? " · " : "") + `High: ${high.join(", ")}`;

    return {
      demand: rating ? LAYER_COLORS[rating].label : "",
      demandColor: rating ? hexToArgb(LAYER_COLORS[rating].primary) : null,
      demandText: rating ? hexToArgb(LAYER_COLORS[rating].text) : null,
      sg: sg.join("; "),
      mice: mice.join("; "),
      visitors,
      campaign: campaigns.join("; "),
      venue: venue.join("; "),
      ph: ph ? ph.name : "",
      school: school ? school.name : "",
    };
  };
}

// ─── formula reflow ───

// Turn a sheet qualifier from a formula ("'JUL 26'" or "Sheet1") into the plain
// worksheet name (unescape doubled single-quotes).
function unquoteSheet(q) {
  if (q.startsWith("'") && q.endsWith("'")) return q.slice(1, -1).replace(/''/g, "'");
  return q;
}

// Shift a single column number for a given {insertAt, count} shift.
function shiftColNum(colNum, shift) {
  return colNum >= shift.insertAt ? colNum + shift.count : colNum;
}

// Rewrite one A1-style cell ref (e.g. "$C$6" or "AE37"), preserving $ anchors.
function shiftCellRefStr(ref, shift) {
  const m = ref.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/);
  if (!m) return ref;
  const newCol = numToCol(shiftColNum(colToNum(m[2].toUpperCase()), shift));
  return `${m[1]}${newCol}${m[3]}${m[4]}`;
}

// Rewrite a range or single ref ("E7:E37" / "E7") on a given sheet's shift.
function shiftRangeStr(range, shift) {
  return range.split(":").map((r) => shiftCellRefStr(r, shift)).join(":");
}

// Matches an optionally sheet-qualified reference, one or two endpoints.
//   group1 = sheet qualifier incl. "!"  (optional)
//   group2 = first endpoint
//   group3 = second endpoint            (optional, for ranges)
const REF_RE = /((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?(?!\s*\()/g;

// Reflow every reference in a formula string. `resolve(sheetName)` returns the
// shift for that sheet or null if it isn't being shifted. Skips quoted string
// literals so text like "To go $#,##0" is never touched.
function reflowFormula(formula, currentSheet, resolve) {
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (ch === '"') {
      out += ch; i++;
      while (i < n) {
        out += formula[i];
        if (formula[i] === '"') {
          if (formula[i + 1] === '"') { out += formula[i + 1]; i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    // Find the next non-string segment up to the next quote, and reflow refs in it.
    let j = i;
    while (j < n && formula[j] !== '"') j++;
    const segment = formula.slice(i, j);
    out += segment.replace(REF_RE, (full, qualifier, ep1, ep2) => {
      const targetSheet = qualifier ? unquoteSheet(qualifier.slice(0, -1)) : currentSheet;
      const shift = resolve(targetSheet);
      if (!shift) return full;
      const q = qualifier || "";
      const a = shiftCellRefStr(ep1, shift);
      const b = ep2 ? ":" + shiftCellRefStr(ep2, shift) : "";
      return `${q}${a}${b}`;
    });
    i = j;
  }
  return out;
}

// True when `cell` is a merged cell that is NOT the top-left master. Such cells
// alias their master's value (reading returns the master's value; writing writes
// through to the master), so processing them would apply an edit to the master a
// second time. We must skip them and only ever touch the master.
function isMergeSlave(cell) {
  return !!(cell.isMerged && cell.master && cell.master.address !== cell.address);
}

// Parse an A1 address ("AW8") into { col, row }.
function addrToRC(addr) {
  const m = addr.match(/^\$?([A-Za-z]{1,3})\$?(\d+)$/);
  if (!m) return { col: 1, row: 1 };
  return { col: colToNum(m[1].toUpperCase()), row: parseInt(m[2], 10) };
}

// Translate one ref for a shared-formula clone offset by (dRow, dCol). Only
// RELATIVE parts move; $-anchored parts stay. Qualified refs are handled by caller.
function translateRefStr(ref, dRow, dCol) {
  const m = ref.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/);
  if (!m) return ref;
  let col = colToNum(m[2].toUpperCase());
  let row = parseInt(m[4], 10);
  if (!m[1]) col = Math.max(1, col + dCol);
  if (!m[3]) row = Math.max(1, row + dRow);
  return `${m[1]}${numToCol(col)}${m[3]}${row}`;
}

// Translate a master's formula to a clone position, skipping quoted strings and
// leaving sheet-qualified references untouched (shared formulas here are local).
function translateFormula(formula, dRow, dCol) {
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    if (formula[i] === '"') {
      out += formula[i]; i++;
      while (i < n) {
        out += formula[i];
        if (formula[i] === '"') {
          if (formula[i + 1] === '"') { out += formula[i + 1]; i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    let j = i;
    while (j < n && formula[j] !== '"') j++;
    out += formula.slice(i, j).replace(REF_RE, (full, qualifier, ep1, ep2) => {
      if (qualifier) return full; // cross-sheet ref inside a shared formula — leave as-is
      const a = translateRefStr(ep1, dRow, dCol);
      const b = ep2 ? ":" + translateRefStr(ep2, dRow, dCol) : "";
      return `${a}${b}`;
    });
    i = j;
  }
  return out;
}

// Flatten all shared formulas in a sheet into independent plain formulas. This
// avoids ExcelJS's strict master-above-left shared-formula validation on write
// and makes the subsequent column reflow trivial (every cell owns its formula).
function flattenSharedFormulas(ws) {
  const masters = {}; // master address -> master formula text
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v && typeof v === "object" && typeof v.formula === "string" && v.shareType === "shared") {
        masters[cell.address] = v.formula;
      }
    });
  });
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (isMergeSlave(cell)) return; // a slave aliases its master — never process it directly
      const v = cell.value;
      if (!v || typeof v !== "object") return;
      if (typeof v.sharedFormula === "string") {
        const mf = masters[v.sharedFormula];
        if (mf) {
          const mp = addrToRC(v.sharedFormula);
          const fp = addrToRC(cell.address);
          cell.value = { formula: translateFormula(mf, fp.row - mp.row, fp.col - mp.col) };
        } else if (v.result != null) {
          cell.value = v.result; // orphaned clone with a cached value — keep the value
        } else if (typeof v.formula === "string") {
          cell.value = { formula: v.formula };
        } else {
          cell.value = null;
        }
      } else if (typeof v.formula === "string" && v.shareType === "shared") {
        cell.value = { formula: v.formula }; // demote master to a plain formula
      }
    });
  });
}

// Rewrite every formula in one worksheet in place, using the workbook-wide
// resolver so cross-sheet references land correctly.
function reflowSheetFormulas(ws, resolve) {
  const ownShift = resolve(ws.name);
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (isMergeSlave(cell)) return; // a slave aliases its master — never process it directly
      const v = cell.value;
      if (!v || typeof v !== "object") return;
      if (typeof v.formula !== "string" && typeof v.sharedFormula !== "string") return;
      const next = {};
      if (typeof v.formula === "string") next.formula = reflowFormula(v.formula, ws.name, resolve);
      if (typeof v.sharedFormula === "string") {
        next.sharedFormula = ownShift ? shiftCellRefStr(v.sharedFormula, ownShift) : v.sharedFormula;
      }
      if (typeof v.ref === "string") {
        next.ref = ownShift ? shiftRangeStr(v.ref, ownShift) : v.ref;
      }
      if (v.shareType) next.shareType = v.shareType;
      // Drop any cached `result` so Excel recalculates on open (no stale numbers).
      cell.value = next;
    });
  });
}

// ─── sheet detection ───

// Detect the date column + header row of a sheet. Returns null for non-daily tabs.
function detectDateLayout(ws) {
  const maxRow = Math.min(ws.rowCount || 0, 500);
  const maxCol = Math.min(ws.columnCount || 1, 80);
  if (maxRow < 2) return null;

  let dateCol = 0;
  let bestDates = [];
  for (let c = 1; c <= Math.min(maxCol, 12); c++) {
    const list = [];
    for (let r = 1; r <= maxRow; r++) {
      const iso = cellToISODate(ws.getRow(r).getCell(c).value);
      if (iso) list.push({ row: r, iso });
    }
    if (list.length > bestDates.length) { bestDates = list; dateCol = c; }
  }
  if (bestDates.length < 3) return null;

  const firstDataRow = bestDates[0].row;
  let headerRow = Math.max(1, firstDataRow - 1);
  for (let r = firstDataRow - 1; r >= Math.max(1, firstDataRow - 6); r--) {
    const v = ws.getRow(r).getCell(dateCol).value;
    if (typeof v === "string" && v.trim().toLowerCase() === "date") { headerRow = r; break; }
  }

  // The Event column: the header cell containing "event"; else the column right
  // after Date. Holidays get merged into this column (post-shift position).
  let eventCol = dateCol + 1;
  const hdr = ws.getRow(headerRow);
  for (let c = 1; c <= maxCol; c++) {
    const v = hdr.getCell(c).value;
    const s = typeof v === "string" ? v : (v && typeof v.text === "string" ? v.text : "");
    if (/event/i.test(s)) { eventCol = c; break; }
  }

  return { dateCol, headerRow, eventCol, dates: bestDates };
}

// Highest column that holds any value across the sheet's used region.
function lastUsedColumn(ws) {
  const maxCol = Math.min(ws.columnCount || 1, 200);
  const maxRow = Math.min(ws.rowCount || 0, 500);
  let used = 1;
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = maxCol; c > used; c--) {
      const val = row.getCell(c).value;
      if (val !== null && val !== undefined && val !== "") { used = c; break; }
    }
  }
  return used;
}

// ─── enrichment ───

function styleHeaderCell(cell) {
  cell.font = HEADER_FONT;
  cell.fill = HEADER_FILL;
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = THIN_BORDER;
}

function enrichSheet(ws, layout, forDate) {
  const count = FRONT_COLUMNS.length;
  const insertAt = layout.dateCol + 1;
  const { headerRow, dates } = layout;
  const newEventCol = shiftColNum(layout.eventCol, { insertAt, count });

  // 1. Re-point merges: capture, unmerge, then re-merge at shifted coordinates.
  const merges = [...(ws.model.merges || [])];
  merges.forEach((m) => { try { ws.unMergeCells(m); } catch { /* not merged */ } });

  // 2. Insert `count` blank columns right after the Date column. (Formulas were
  //    already reflowed workbook-wide before this, so shifted cells stay correct.)
  ws.spliceColumns(insertAt, 0, ...Array.from({ length: count }, () => []));

  // 3. Re-merge with shifted ranges.
  merges.forEach((m) => {
    const nm = shiftRangeStr(m, { insertAt, count });
    try { ws.mergeCells(nm); } catch { /* overlaps an existing merge — skip */ }
  });

  // 4. Front headers + widths.
  FRONT_COLUMNS.forEach((col, i) => {
    const c = insertAt + i;
    styleHeaderCell(ws.getRow(headerRow).getCell(c));
    ws.getRow(headerRow).getCell(c).value = col.label;
    const column = ws.getColumn(c);
    if (!column.width || column.width < col.width) column.width = col.width;
  });

  // 5. Tail headers (Campaigns, Venue Activities) at the far right, past a spacer.
  const tailStart = lastUsedColumn(ws) + 2;
  TAIL_COLUMNS.forEach((col, i) => {
    const c = tailStart + i;
    styleHeaderCell(ws.getRow(headerRow).getCell(c));
    ws.getRow(headerRow).getCell(c).value = col.label;
    const column = ws.getColumn(c);
    if (!column.width || column.width < col.width) column.width = col.width;
  });

  // 6. Per-day data.
  dates.forEach(({ row, iso }) => {
    const info = forDate(iso);

    FRONT_COLUMNS.forEach((col, i) => {
      const cell = ws.getRow(row).getCell(insertAt + i);
      cell.value = info[col.key] || "";
      cell.alignment = { vertical: "top", wrapText: true };
      if (col.key === "demand" && info.demandColor) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: info.demandColor } };
        cell.font = { bold: true, color: { argb: info.demandText || "FF000000" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
    });

    TAIL_COLUMNS.forEach((col, i) => {
      const cell = ws.getRow(row).getCell(tailStart + i);
      cell.value = info[col.key] || "";
      cell.alignment = { vertical: "top", wrapText: true };
    });

    // Merge Public + School holidays into the Event column, keeping any existing
    // event text. Never overwrite a formula in that cell.
    const holidayParts = [info.ph, info.school].filter(Boolean);
    if (holidayParts.length) {
      const cell = ws.getRow(row).getCell(newEventCol);
      const existing = cell.value;
      if (!existing || typeof existing !== "object") {
        const existingText = existing == null ? "" : String(existing).trim();
        const parts = [];
        if (existingText) parts.push(existingText);
        holidayParts.forEach((h) => {
          if (!parts.some((p) => p.toLowerCase().includes(h.toLowerCase()))) parts.push(h);
        });
        cell.value = parts.join(" · ");
        cell.alignment = { vertical: "top", wrapText: true };
      }
    }
  });

  return { rows: dates.length };
}

// Main entry point. Accepts an ArrayBuffer/Buffer of an .xlsx workbook, inserts
// the calendar columns into every date-based sheet (reflowing all formulas so the
// financial model stays intact), and returns the new workbook buffer + a summary.
export async function enrichTargetWorkbook(arrayBuffer, { zone = "group" } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  // 1. Detect every date-based sheet and its layout.
  const layouts = new Map(); // sheetName -> layout
  wb.eachSheet((ws) => {
    const layout = detectDateLayout(ws);
    if (layout) layouts.set(ws.name, layout);
  });

  if (layouts.size === 0) {
    throw new Error(
      "No date-based monthly sheets were found in this workbook. " +
      "Each target tab needs a column of daily dates (e.g. a 'Date' column) for the calendar to attach to."
    );
  }

  // 2. Workbook-wide shift resolver — a sheet shifts only if it's date-based.
  const count = FRONT_COLUMNS.length;
  const resolve = (sheetName) => {
    const layout = layouts.get(sheetName);
    return layout ? { insertAt: layout.dateCol + 1, count } : null;
  };

  // 3. Flatten shared formulas into independent plain formulas across the whole
  //    workbook, then reflow EVERY formula (cross-sheet refs included) BEFORE any
  //    columns move, so shifted cells keep referring to the right data.
  wb.eachSheet((ws) => flattenSharedFormulas(ws));
  wb.eachSheet((ws) => reflowSheetFormulas(ws, resolve));

  // 4. Insert + fill the calendar columns on each date-based sheet.
  const forDate = buildCalendarLookup(zone);
  const sheets = [];
  let totalRows = 0;
  wb.eachSheet((ws) => {
    const layout = layouts.get(ws.name);
    if (!layout) return;
    const res = enrichSheet(ws, layout, forDate);
    sheets.push({ name: ws.name, rows: res.rows });
    totalRows += res.rows;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, sheets, totalRows, zone };
}
