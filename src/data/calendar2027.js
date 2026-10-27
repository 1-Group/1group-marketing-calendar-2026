// src/data/calendar2027.js
// ─────────────────────────────────────────────────────────────────────────
// BLANK 2027 calendar dataset — identical SHAPE and exports to calendar2026.js,
// ready to be populated from the 2027 data-collection template (public holidays,
// school holidays, SG & MICE events, visitor intensity, campaigns, and each
// venue's hot/cold demand). Year-independent constants (month names, colours,
// venue keys & sub-brands) are re-exported from calendar2026.js so the two years
// never drift apart. Public and school holidays and visitor intensity are filled
// in; the rest of the year-specific data starts empty here.
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

// ─── YEAR-SPECIFIC DATA (2027: holidays and visitor intensity filled; events and campaigns blank) ───
const MICE_EVENTS = [];
const SG_EVENTS_RAW = [];
const SG_EVENTS = [];
// Visitor intensity by source market, 2027 (researched 27 Oct 2026).
// Each market starts from its 2026 month pattern, then moves where that
// market's own 2027 holidays move:
//   - Malaysia: Hari Raya Puasa falls on 10 Mar 2027 → Mar High.
//   - Australia: Easter (26–29 Mar) and the Vic/Qld autumn break start in
//     March; NSW, WA and SA autumn breaks run 10–25 Apr; spring breaks start
//     18 and 25 Sep → Mar High, Apr Mod, Sep High.
//   - India: Diwali is 29 Oct 2027 (8 Nov in 2026); May is the summer-holiday
//     peak → May High, Oct Peak, Nov High.
//   - Japan: Golden Week 29 Apr–5 May; no Silver Week in 2027 → Sep Mod.
//   - Philippines: Holy Week is 25–28 Mar 2027 (Proclamation 1427) → Mar High,
//     Apr Mod.
//   - South Korea: Seollal 6–9 Feb; Chuseok 14–16 Sep (late Sep in 2026) →
//     Sep High.
//   - United Kingdom: Easter Sunday is 28 Mar, so the Easter school break
//     starts in March → Mar High.
//   - Unchanged: Mainland China (Spring Festival 6–12 Feb, Golden Week
//     1–7 Oct, both in the same months as 2026), Indonesia (Lebaran 6–15 Mar,
//     school break about 21 Jun–10 Jul), USA.
// Arrivals: 2025 full year (STB) and the 2026 Jan–Sep change (STB), where
// published; otherwise the 2026 figure is kept.
const VISITOR_DATA = [
  {market:"Mainland China",arrivals:"3.1M · 2026 +5%",data:{Jan:"Mod",Feb:"Peak",Mar:"Mod",Apr:"Low",May:"Low",Jun:"Mod",Jul:"Mod",Aug:"Mod",Sep:"Low",Oct:"Peak",Nov:"High",Dec:"Mod"}},
  {market:"Indonesia",arrivals:"2.4M · 2026 −10%",data:{Jan:"High",Feb:"High",Mar:"Peak",Apr:"Mod",May:"Mod",Jun:"High",Jul:"Peak",Aug:"High",Sep:"Mod",Oct:"Mod",Nov:"High",Dec:"High"}},
  {market:"Malaysia",arrivals:"1.3M · 2026 flat",data:{Jan:"High",Feb:"Peak",Mar:"High",Apr:"Mod",May:"Mod",Jun:"High",Jul:"Peak",Aug:"High",Sep:"Mod",Oct:"Mod",Nov:"High",Dec:"Peak"}},
  {market:"Australia",arrivals:"1.3M · 2026 +1%",data:{Jan:"Peak",Feb:"High",Mar:"High",Apr:"Mod",May:"Low",Jun:"Mod",Jul:"Peak",Aug:"Peak",Sep:"High",Oct:"Mod",Nov:"Mod",Dec:"High"}},
  {market:"India",arrivals:"1.2M · 2026 −6%",data:{Jan:"Mod",Feb:"Mod",Mar:"Mod",Apr:"Mod",May:"High",Jun:"High",Jul:"Peak",Aug:"Peak",Sep:"Mod",Oct:"Peak",Nov:"High",Dec:"High"}},
  {market:"Japan",arrivals:"~630K +10%",data:{Jan:"Mod",Feb:"Mod",Mar:"High",Apr:"Mod",May:"Peak",Jun:"Mod",Jul:"Peak",Aug:"High",Sep:"Mod",Oct:"Mod",Nov:"Mod",Dec:"Mod"}},
  {market:"Philippines",arrivals:"726K -7%",data:{Jan:"Mod",Feb:"Mod",Mar:"High",Apr:"Mod",May:"Mod",Jun:"High",Jul:"Peak",Aug:"Peak",Sep:"Mod",Oct:"Mod",Nov:"High",Dec:"High"}},
  {market:"USA",arrivals:"~720K +4%",data:{Jan:"Mod",Feb:"Low",Mar:"Low",Apr:"Mod",May:"Mod",Jun:"High",Jul:"Peak",Aug:"Peak",Sep:"Mod",Oct:"Mod",Nov:"Mod",Dec:"High"}},
  {market:"South Korea",arrivals:"~610K stable",data:{Jan:"Mod",Feb:"Peak",Mar:"Low",Apr:"Mod",May:"Mod",Jun:"Mod",Jul:"Peak",Aug:"High",Sep:"High",Oct:"High",Nov:"Mod",Dec:"Mod"}},
  {market:"United Kingdom",arrivals:"~590K stable",data:{Jan:"Low",Feb:"Low",Mar:"High",Apr:"High",May:"Mod",Jun:"High",Jul:"Peak",Aug:"Peak",Sep:"Mod",Oct:"Mod",Nov:"Low",Dec:"High"}},
];
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
