// ─── TARGET SHEET ENRICHMENT ───
// Takes a team member's own target/forecast workbook (e.g. an outlet's 3-month
// daily target sheet with a Date column per tab) and appends the 1-Group 2026
// marketing-calendar context as extra columns to the right of their existing data:
//   Demand (Hot/Cold heat map) · Public Holiday · School Holiday · SG Events ·
//   MICE Events · Campaigns · Venue Activities · Visitor Peaks
//
// Design goals:
//   1. NON-DESTRUCTIVE — we only write to brand-new columns placed a full spacer
//      column clear of the sheet's used range. Existing values, formulas (incl.
//      shared formulas), merges and styles are round-tripped by ExcelJS untouched.
//   2. FORMAT-AGNOSTIC — we auto-detect the date column and the header row rather
//      than assuming fixed cell addresses, so it works across outlet templates.
//   3. PURE + TESTABLE — the workbook transform is a plain async function that
//      takes an ArrayBuffer and returns a Buffer, callable from Node or the browser.

import ExcelJS from "exceljs";
import {
  MONTH_SHORT,
  MICE_EVENTS, SG_EVENTS, VISITOR_DATA,
  SCHOOL_HOLIDAYS, PUBLIC_HOLIDAYS, CAMPAIGNS,
  SEED_VENUE_EVENTS, parseVenueData, LAYER_COLORS,
} from "../data/calendar2026.js";

// The calendar dataset only describes 2026. Rows outside this year are still
// scanned (so we can find the date column) but resolve to empty enrichment.
const CALENDAR_YEAR = 2026;

// Columns appended to each enriched sheet, in order.
export const ENRICHMENT_COLUMNS = [
  { key: "demand",    label: "Demand (Hot/Cold)", width: 14 },
  { key: "ph",        label: "Public Holiday",    width: 22 },
  { key: "school",    label: "School Holiday",    width: 20 },
  { key: "sg",        label: "SG Events",         width: 40 },
  { key: "mice",      label: "MICE Events",       width: 34 },
  { key: "campaign",  label: "1-Group Campaigns", width: 34 },
  { key: "venue",     label: "Venue Activities",  width: 40 },
  { key: "visitors",  label: "Visitor Peaks",     width: 34 },
];

// "#DC2626" → "FFDC2626"; "#fff" → "FFFFFFFF". ExcelJS wants 8-digit ARGB.
function hexToArgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (h.length !== 6) return "FF000000";
  return "FF" + h.toUpperCase();
}

// Normalise any cell value to a YYYY-MM-DD string, or null if it isn't a date.
// Excel stores dates as serials that ExcelJS surfaces as JS Date objects at UTC
// midnight — we read the UTC components so a date never slips a day via timezone.
export function cellToISODate(value) {
  if (value == null) return null;
  let d = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "object") {
    // ExcelJS may wrap formula/rich-text results: { result }, { text }, etc.
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

// Build a per-date calendar lookup for a given zone ("group" or a venue key).
// Venue activities are scoped to the chosen zone; "group" shows every outlet's.
export function buildCalendarLookup(zone) {
  const hcZone = zone && zone !== "group" ? zone : "group";
  const hc = parseVenueData(hcZone); // { "YYYY-MM-DD": { count, rating } }
  const venueEvents = zone && zone !== "group"
    ? SEED_VENUE_EVENTS.filter((e) => e.venue === zone)
    : SEED_VENUE_EVENTS;

  const venueLabel = (e) => (e.subBrand ? `${e.name} (${e.subBrand})` : e.name);

  return function forDate(iso) {
    const empty = ENRICHMENT_COLUMNS.reduce((acc, c) => ((acc[c.key] = ""), acc), {});
    empty.demandColor = null;
    empty.demandText = null;
    if (!iso || parseInt(iso.slice(0, 4), 10) !== CALENDAR_YEAR) return empty;

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
        if (e.month != null) return e.month === mi; // undated / month-wide
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
      ph: ph ? ph.name : "",
      school: school ? school.name : "",
      sg: sg.join("; "),
      mice: mice.join("; "),
      campaign: campaigns.join("; "),
      venue: venue.join("; "),
      visitors,
    };
  };
}

// Locate the date column + header row and append enrichment columns.
// Returns { rows } — the number of daily rows enriched (0 if this sheet has no
// recognisable date column, i.e. it's a summary / non-daily tab we skip).
function enrichSheet(ws, forDate) {
  const maxRow = Math.min(ws.rowCount || 0, 500);
  const maxCol = Math.min(ws.columnCount || 1, 80);
  if (maxRow < 2) return { rows: 0 };

  // 1. Detect the date column: the left-most column (scan first ~12) holding the
  //    most valid dates. Requires at least 3 to avoid false positives on stray cells.
  let dateCol = 0;
  let bestDates = [];
  for (let c = 1; c <= Math.min(maxCol, 12); c++) {
    const list = [];
    for (let r = 1; r <= maxRow; r++) {
      const iso = cellToISODate(ws.getRow(r).getCell(c).value);
      if (iso) list.push({ row: r, iso });
    }
    if (list.length > bestDates.length) {
      bestDates = list;
      dateCol = c;
    }
  }
  if (bestDates.length < 3) return { rows: 0 };

  const firstDataRow = bestDates[0].row;
  const lastDataRow = bestDates[bestDates.length - 1].row;

  // 2. Header row: search a few rows above the first date for a "Date" label in
  //    the date column; fall back to the row directly above the first date row.
  let headerRow = Math.max(1, firstDataRow - 1);
  for (let r = firstDataRow - 1; r >= Math.max(1, firstDataRow - 6); r--) {
    const v = ws.getRow(r).getCell(dateCol).value;
    if (typeof v === "string" && v.trim().toLowerCase() === "date") { headerRow = r; break; }
  }

  // 3. Insertion point: one blank spacer column clear of the used range. Scan the
  //    whole region (headers can extend further right than the daily rows).
  let usedCol = dateCol;
  for (let r = 1; r <= Math.min(ws.rowCount || 0, lastDataRow + 3); r++) {
    const row = ws.getRow(r);
    for (let c = maxCol; c > usedCol; c--) {
      const val = row.getCell(c).value;
      if (val !== null && val !== undefined && val !== "") { usedCol = c; break; }
    }
  }
  const startCol = usedCol + 2;

  // 4. Section banner above the header row (when there's room).
  if (headerRow > 1) {
    const bannerRow = headerRow - 1;
    const bc = ws.getRow(bannerRow).getCell(startCol);
    if (bc.value == null || bc.value === "") {
      bc.value = "1-GROUP MARKETING CALENDAR 2026";
      bc.font = { bold: true, size: 11, color: { argb: "FF4338CA" } };
      try {
        ws.mergeCells(bannerRow, startCol, bannerRow, startCol + ENRICHMENT_COLUMNS.length - 1);
      } catch { /* merge may collide with an existing merge; header row still labels each column */ }
    }
  }

  // 5. Header cells.
  ENRICHMENT_COLUMNS.forEach((col, i) => {
    const cell = ws.getRow(headerRow).getCell(startCol + i);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6366F1" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
    const column = ws.getColumn(startCol + i);
    if (!column.width || column.width < col.width) column.width = col.width;
  });

  // 6. Data cells, one row per detected date.
  bestDates.forEach(({ row, iso }) => {
    const info = forDate(iso);
    ENRICHMENT_COLUMNS.forEach((col, i) => {
      const cell = ws.getRow(row).getCell(startCol + i);
      cell.value = info[col.key] || "";
      cell.alignment = { vertical: "top", wrapText: true };
      if (col.key === "demand" && info.demandColor) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: info.demandColor } };
        cell.font = { bold: true, color: { argb: info.demandText || "FF000000" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
    });
  });

  return { rows: bestDates.length, sheet: ws.name, dateCol, headerRow, startCol };
}

// Main entry point. Accepts an ArrayBuffer/Buffer of an .xlsx workbook, appends
// the calendar columns to every date-based sheet, and returns the new workbook
// buffer plus a summary. Throws if no enrichable sheet is found.
export async function enrichTargetWorkbook(arrayBuffer, { zone = "group" } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  const forDate = buildCalendarLookup(zone);
  const sheets = [];
  let totalRows = 0;

  wb.eachSheet((ws) => {
    const res = enrichSheet(ws, forDate);
    if (res.rows > 0) {
      sheets.push({ name: ws.name, rows: res.rows });
      totalRows += res.rows;
    }
  });

  if (sheets.length === 0) {
    throw new Error(
      "No date-based monthly sheets were found in this workbook. " +
      "Each target tab needs a column of daily dates (e.g. a 'Date' column) for the calendar to attach to."
    );
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, sheets, totalRows, zone };
}
