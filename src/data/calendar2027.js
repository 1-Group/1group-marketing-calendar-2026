// src/data/calendar2027.js
// ─────────────────────────────────────────────────────────────────────────
// BLANK 2027 calendar dataset — identical SHAPE and exports to calendar2026.js,
// ready to be populated from the 2027 data-collection template (public holidays,
// school holidays, SG & MICE events, visitor intensity, campaigns, and each
// venue's hot/cold demand). Year-independent constants (month names, colours,
// venue keys & sub-brands) are re-exported from calendar2026.js so the two years
// never drift apart. Public and school holidays are filled in; the rest of the
// year-specific data starts empty here.
//
// To populate: fill the arrays/Sets/VENUE_HC_RAW[venue].data below (or import via
// the app's "Import Venue Calendar" tool once the template comes back).

import {
  MONTH_NAMES, MONTH_SHORT,
  VENUE_KEYS, VENUE_SUBBRANDS,
  DATE_CODE_COLORS, LAYER_COLORS, SALES_SQUARE_COLORS, INTENSITY_COLORS,
  isInRange, getMonthIndex,
  VENUE_HC_RAW as HC_2026,
} from "./calendar2026.js";

const YEAR = 2027;

// Venue registry: same venues and labels as 2026, but with blank 2027 demand data.
const VENUE_HC_RAW = Object.fromEntries(
  Object.entries(HC_2026).map(([key, v]) => [key, {
    ...v,
    summary: { hh: 0, h: 0, c: 0, cc: 0 },
    data: {}, // fill "2027-MM": "day:count:rating,..." when hot/cold data is ready
  }])
);

// Parse compact daily data into {YYYY-MM-DD: {count, rating}} (empty until populated).
function parseVenueData(venueKey) {
  const venue = VENUE_HC_RAW[venueKey];
  if (!venue) return {};
  const result = {};
  for (const [month, raw] of Object.entries(venue.data)) {
    const mi = parseInt(month.split("-")[1]) - 1;
    raw.split(",").forEach((item) => {
      const [d, c, r] = item.split(":");
      const key = `${YEAR}-${String(mi + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
      const ratingMap = { hh: "hot-hot", h: "hot", c: "cold", cc: "cold-cold" };
      result[key] = { count: parseInt(c), rating: ratingMap[r] || "cold" };
    });
  }
  return result;
}

// ─── YEAR-SPECIFIC DATA (2027: holidays filled; events, visitors, campaigns blank) ───
const MICE_EVENTS = [];
const SG_EVENTS_RAW = [];
const SG_EVENTS = [];
const VISITOR_DATA = [];          // [{market, arrivals, data:{Jan:"Peak",...}}]
// MOE school terms and holidays for 2027 (MOE, 14 July 2026).
const SCHOOL_HOLIDAYS = [
  {name:"Term 1 Break",start:"2027-03-13",end:"2027-03-21"},
  {name:"Mid-Year Holidays",start:"2027-05-29",end:"2027-06-27"},
  {name:"Term 3 Break",start:"2027-09-04",end:"2027-09-12"},
  {name:"Year-End Holidays",start:"2027-11-20",end:"2027-12-31"},
];
// Gazetted by MOM ("Public Holidays for 2027", press release of 18 June
// 2026). Chinese New Year's second day is a Sunday, so the Monday after is a
// holiday. Labour Day and Christmas fall on Saturdays: no Monday holiday
// follows those (employees get a day off or pay in lieu instead).
const PUBLIC_HOLIDAYS = [
  {name:"New Year's Day",date:"2027-01-01"},
  {name:"Chinese New Year",date:"2027-02-06"},
  {name:"Chinese New Year (Day 2)",date:"2027-02-07"},
  {name:"Chinese New Year (observed)",date:"2027-02-08"},
  {name:"Hari Raya Puasa",date:"2027-03-10"},
  {name:"Good Friday",date:"2027-03-26"},
  {name:"Labour Day",date:"2027-05-01"},
  {name:"Hari Raya Haji",date:"2027-05-17"},
  {name:"Vesak Day",date:"2027-05-20"},
  {name:"National Day",date:"2027-08-09"},
  {name:"Deepavali",date:"2027-10-28"},
  {name:"Christmas Day",date:"2027-12-25"},
];
const CAMPAIGNS = [];             // [{id, name, month, endMonth?, tagline, layer:"campaign"}]
const SEED_VENUE_EVENTS = [];     // venue activities arrive via the import tool

const CONFERENCE_DATES = new Set();
const DOUBLE_DIGIT_DATES = new Set([
  "2027-01-01", "2027-02-02", "2027-03-03", "2027-04-04", "2027-05-05", "2027-06-06",
  "2027-07-07", "2027-08-08", "2027-09-09", "2027-10-10", "2027-11-11", "2027-12-12",
]);

// ─── HELPERS (year-aware) ───
function isSchoolHoliday(dateStr) { return SCHOOL_HOLIDAYS.some((h) => isInRange(dateStr, h.start, h.end)); }
function isPublicHoliday(dateStr) { return PUBLIC_HOLIDAYS.find((h) => h.date === dateStr); }
function daysInMonth(mi) { return new Date(YEAR, mi + 1, 0).getDate(); }
function firstDayOfMonth(mi) { return new Date(YEAR, mi, 1).getDay(); }
function dateStr(mi, d) { return `${YEAR}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function getVisitorPeaks(mi) {
  const monthKey = MONTH_SHORT[mi];
  return VISITOR_DATA.filter((v) => v.data[monthKey] === "Peak").map((v) => v.market);
}

export {
  MONTH_NAMES, MONTH_SHORT,
  VENUE_HC_RAW, VENUE_KEYS, parseVenueData,
  MICE_EVENTS, SG_EVENTS_RAW, SG_EVENTS, VISITOR_DATA,
  SCHOOL_HOLIDAYS, PUBLIC_HOLIDAYS, CAMPAIGNS,
  VENUE_SUBBRANDS, SEED_VENUE_EVENTS,
  CONFERENCE_DATES, DOUBLE_DIGIT_DATES, DATE_CODE_COLORS,
  LAYER_COLORS, SALES_SQUARE_COLORS, INTENSITY_COLORS,
  isInRange, isSchoolHoliday, isPublicHoliday, getMonthIndex,
  daysInMonth, firstDayOfMonth, dateStr, getVisitorPeaks,
};
