// src/data/calendar2027.js
// ─────────────────────────────────────────────────────────────────────────
// BLANK 2027 calendar dataset — identical SHAPE and exports to calendar2026.js,
// ready to be populated from the 2027 data-collection template (public holidays,
// school holidays, SG & MICE events, visitor intensity, campaigns, and each
// venue's hot/cold demand). Year-independent constants (month names, colours,
// venue keys & sub-brands) are re-exported from calendar2026.js so the two years
// never drift apart. Public and school holidays, visitor intensity, MICE and SG
// events are filled in; campaigns and venue demand start empty here.
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

// ─── YEAR-SPECIFIC DATA (2027: holidays, visitor intensity, MICE and SG events filled; campaigns blank) ───
// MICE events in Singapore, 2027 (researched 27 Oct 2026 from STB/SECB, the
// venues' calendars and the organisers' own pages). Dates are the organiser's
// published 2027 dates. "(dates TBC)" marks a big annual event whose 2027
// dates are not out yet: it is placed on the same weekdays as its 2026
// edition and should be corrected once the organiser publishes.
// Not in Singapore in 2027: Singapore Airshow, IDEM, Asia Pacific Maritime,
// SIWW and World Cities Summit (all next in 2028); Money20/20 Asia (Bangkok).
// Announced with no dates yet: the ASEAN Summits (Singapore chairs ASEAN in
// 2027) and WindEnergy Asia-Pacific.
const MICE_EVENTS = [
  {id:"mice-1",name:"SIOHEC 2027 (Oral Health Congress)",start:"2027-01-14",end:"2027-01-17",cat:"Dental/Medical",layer:"mice"},
  {id:"mice-2",name:"ASEAN Tourism Forum 2027",start:"2027-01-18",end:"2027-01-22",cat:"Travel & Tourism",layer:"mice"},
  {id:"mice-3",name:"WCA Worldwide Conference 2027",start:"2027-02-21",end:"2027-02-25",cat:"Trade Conferences",layer:"mice"},
  {id:"mice-4",name:"Black Hat Asia 2027",start:"2027-02-28",end:"2027-03-03",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-5",name:"Asia Photonics Expo 2027",start:"2027-03-03",end:"2027-03-05",cat:"Advanced Manufacturing",layer:"mice"},
  {id:"mice-6",name:"Geo Connect & Digital Construction Asia 2027",start:"2027-03-17",end:"2027-03-18",cat:"Exhibitions",layer:"mice"},
  {id:"mice-7",name:"TyreXpo Asia 2027",start:"2027-03-17",end:"2027-03-19",cat:"Exhibitions",layer:"mice"},
  {id:"mice-8",name:"APAO 2027 (Asia-Pacific Ophthalmology)",start:"2027-03-18",end:"2027-03-21",cat:"Association Conventions",layer:"mice"},
  {id:"mice-9",name:"inter airport Southeast Asia 2027",start:"2027-03-23",end:"2027-03-25",cat:"Exhibitions",layer:"mice"},
  {id:"mice-10",name:"eCommerce Expo Asia 2027",start:"2027-04-07",end:"2027-04-08",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-11",name:"IDF World Diabetes Congress 2027",start:"2027-04-10",end:"2027-04-12",cat:"Association Conventions",layer:"mice"},
  {id:"mice-12",name:"Singapore Maritime Week 2027",start:"2027-04-12",end:"2027-04-16",cat:"Maritime",layer:"mice"},
  {id:"mice-13",name:"Sea Asia & OSEA 2027",start:"2027-04-13",end:"2027-04-15",cat:"Maritime",layer:"mice"},
  {id:"mice-14",name:"PCMA Convening APAC 2027",start:"2027-04-18",end:"2027-04-20",cat:"Meeting & Incentive Travel",layer:"mice"},
  {id:"mice-15",name:"Food & Hospitality Asia 2027",start:"2027-04-20",end:"2027-04-23",cat:"Exhibitions, Lifestyle",layer:"mice"},
  {id:"mice-16",name:"GITEX AI Asia 2027",start:"2027-04-29",end:"2027-04-30",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-17",name:"IMDEX Asia 2027 (dates TBC)",start:"2027-05-04",end:"2027-05-06",cat:"Exhibitions",layer:"mice"},
  {id:"mice-18",name:"TFWA Asia Pacific 2027",start:"2027-05-09",end:"2027-05-13",cat:"Exhibitions",layer:"mice"},
  {id:"mice-19",name:"HR Tech Asia 2027",start:"2027-05-10",end:"2027-05-13",cat:"Trade Conferences",layer:"mice"},
  {id:"mice-20",name:"Ecosperity Week 2027",start:"2027-05-11",end:"2027-05-14",cat:"Exhibitions",layer:"mice"},
  {id:"mice-21",name:"Asia Tech x Singapore (ATxSG) 2027",start:"2027-05-26",end:"2027-05-28",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-22",name:"NRF Retail's Big Show Asia Pacific 2027",start:"2027-06-01",end:"2027-06-03",cat:"Exhibitions",layer:"mice"},
  {id:"mice-23",name:"Asia Pacific Energy Assembly 2027",start:"2027-06-09",end:"2027-06-10",cat:"Energy",layer:"mice"},
  {id:"mice-24",name:"TIACA Executive Summit 2027",start:"2027-06-21",end:"2027-06-23",cat:"Trade Conferences",layer:"mice"},
  {id:"mice-25",name:"IEEE EMBC 2027 (Biomedical Engineering)",start:"2027-07-11",end:"2027-07-15",cat:"Association Conventions",layer:"mice"},
  {id:"mice-26",name:"SIGEP Asia & Restaurant Asia 2027",start:"2027-07-14",end:"2027-07-16",cat:"Exhibitions, Lifestyle",layer:"mice"},
  {id:"mice-27",name:"ITAP & CeMAT Southeast Asia 2027",start:"2027-07-20",end:"2027-07-22",cat:"Advanced Manufacturing",layer:"mice"},
  {id:"mice-28",name:"The Business Show Asia 2027",start:"2027-09-01",end:"2027-09-02",cat:"Exhibitions",layer:"mice"},
  {id:"mice-29",name:"InnoTrans Asia 2027",start:"2027-09-07",end:"2027-09-09",cat:"Exhibitions",layer:"mice"},
  {id:"mice-30",name:"SuperAI Singapore 2027",start:"2027-09-08",end:"2027-09-09",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-31",name:"Seafood Expo Asia 2027",start:"2027-09-08",end:"2027-09-10",cat:"Exhibitions",layer:"mice"},
  {id:"mice-32",name:"Sibos 2027",start:"2027-09-20",end:"2027-09-23",cat:"Financial Services",layer:"mice"},
  {id:"mice-33",name:"MRO Asia-Pacific 2027",start:"2027-09-21",end:"2027-09-23",cat:"Exhibitions",layer:"mice"},
  {id:"mice-34",name:"Valve World Expo Southeast Asia 2027",start:"2027-09-23",end:"2027-09-24",cat:"Exhibitions",layer:"mice"},
  {id:"mice-35",name:"TOKEN2049 Singapore 2027 (dates TBC)",start:"2027-10-06",end:"2027-10-07",cat:"Financial Services",layer:"mice"},
  {id:"mice-36",name:"Milken Institute Asia Summit 2027 (dates TBC)",start:"2027-10-06",end:"2027-10-08",cat:"Financial Services",layer:"mice"},
  {id:"mice-37",name:"Tech Week Singapore 2027",start:"2027-10-13",end:"2027-10-14",cat:"Exhibitions, Tech",layer:"mice"},
  {id:"mice-38",name:"ITB Asia 2027 (dates TBC)",start:"2027-10-20",end:"2027-10-22",cat:"Travel & Tourism",layer:"mice"},
  {id:"mice-39",name:"transport logistic Southeast Asia 2027",start:"2027-10-25",end:"2027-10-27",cat:"Exhibitions",layer:"mice"},
  {id:"mice-40",name:"Singapore Intl Energy Week 2027 (dates TBC)",start:"2027-10-25",end:"2027-10-29",cat:"Energy",layer:"mice"},
  {id:"mice-41",name:"Singapore FinTech Festival 2027 (dates TBC)",start:"2027-11-17",end:"2027-11-19",cat:"Financial Services",layer:"mice"},
  {id:"mice-42",name:"IEEE ICIP 2027 (Image Processing)",start:"2027-11-29",end:"2027-12-03",cat:"Association Conventions",layer:"mice"},
  {id:"mice-43",name:"ESMO Asia Congress 2027 (dates TBC)",start:"2027-12-03",end:"2027-12-05",cat:"Dental/Medical",layer:"mice"},
];
// Big public events in Singapore, 2027, that fill hotels without being MICE
// (researched 27 Oct 2026; MICE events are in MICE_EVENTS above). "TBC"
// marks an event placed on its 2026 weekdays, or known only by month.
const SG_EVENTS_RAW = [
  {m:1,sd:15,ed:17,ds:"15–17 Jan",n:"EVO Singapore 2027 (with TEKKEN World Tour Finals)",v:"Marina Bay Sands Expo",i:"Esports / Fighting games",o:"Evo",c:"",w:"",em:[],p:"Fighting-game players and fans, many flying in from across Asia",no:"",why:"",tier:"",s:null,st:""},
  {m:2,sd:12,ed:null,ds:"12 Feb",n:"Maroon 5 in concert",v:"National Stadium",i:"Concert / Entertainment",o:"Concert Promoters",c:"",w:"",em:[],p:"General public, regional fans",no:"",why:"",tier:"",s:null,st:""},
  {m:2,sd:20,ed:null,ds:"20 Feb",n:"YOASOBI Super Planet Tour",v:"National Stadium",i:"Concert / J-pop",o:"Concert Promoters",c:"",w:"",em:[],p:"J-pop fans; the tour's only Southeast Asia stop, so it draws regional travellers",no:"",why:"",tier:"",s:null,st:""},
  {m:2,sd:25,ed:28,ds:"25–28 Feb (TBC)",n:"HSBC Women's World Championship 2027 (dates TBC)",v:"Sentosa Golf Club",i:"Sport / Golf",o:"HSBC / LPGA",c:"",w:"",em:[],p:"Golf fans, corporate hospitality guests",no:"Placed on the 2026 edition's weekdays (26 Feb–1 Mar 2026)",why:"",tier:"",s:null,st:""},
  {m:3,sd:15,ed:28,ds:"15–28 Mar",n:"BLAST Premier Open Singapore 2027 (Counter-Strike)",v:"TBD – Singapore",i:"Esports / Counter-Strike",o:"BLAST",c:"",w:"",em:[],p:"Esports teams, fans and media",no:"Arena not yet announced",why:"",tier:"",s:null,st:""},
  {m:4,sd:13,ed:14,ds:"13–14 Apr",n:"Bruno Mars – The Romantic Tour (shows 1–2)",v:"National Stadium",i:"Concert / Entertainment",o:"Concert Promoters",c:"",w:"",em:[],p:"Fans from across the region; four stadium nights",no:"Same week as Singapore Maritime Week and Sea Asia",why:"Four stadium shows in one week on top of Maritime Week and FHA",tier:"⭐ HIGH",s:null,st:""},
  {m:4,sd:17,ed:18,ds:"17–18 Apr",n:"Bruno Mars – The Romantic Tour (shows 3–4)",v:"National Stadium",i:"Concert / Entertainment",o:"Concert Promoters",c:"",w:"",em:[],p:"Fans from across the region; four stadium nights",no:"",why:"Four stadium shows in one week on top of Maritime Week and FHA",tier:"⭐ HIGH",s:null,st:""},
  {m:6,sd:null,ed:null,ds:"TBC Jun",n:"FIBA 3x3 World Cup 2027",v:"TBD – Singapore",i:"Sport / Basketball",o:"FIBA / Sport Singapore",c:"",w:"",em:[],p:"40 national teams over seven days, officials and fans",no:"Month confirmed, dates not yet published",why:"",tier:"",s:null,st:""},
  {m:10,sd:8,ed:10,ds:"8–10 Oct",n:"Formula 1 Singapore Grand Prix 2027 ⭐⭐",v:"Marina Bay Street Circuit",i:"Sport / Motorsport",o:"Singapore GP Pte Ltd",c:"",w:"www.singaporegp.sg",em:[],p:"Race fans and corporate hospitality from around the world",no:"Race week usually brings the Milken Asia Summit and TOKEN2049 alongside",why:"Singapore's busiest visitor week of the year for Marina Bay",tier:"⭐⭐ VERY HIGH",s:null,st:"⭐⭐"},
  {m:12,sd:4,ed:5,ds:"4–5 Dec (TBC)",n:"Standard Chartered Singapore Marathon 2027 (dates TBC)",v:"City-wide",i:"Sport / Running",o:"Standard Chartered (title sponsor)",c:"",w:"",em:[],p:"Runners, many from overseas",no:"Placed on the 2026 edition's weekdays (5–6 Dec 2026)",why:"",tier:"",s:null,st:""},
];
const SG_EVENTS = SG_EVENTS_RAW.map((e, i) => {
  const sd = e.sd || 1;
  const ed = e.ed || sd;
  return {
    id: `sg-${i}`,
    name: e.n,
    month: e.m - 1,
    dateStr: e.ds,
    venue: e.v,
    type: e.i,
    industry: e.i,
    organiser: e.o,
    contact: e.c,
    website: e.w,
    emails: e.em || [],
    participants: e.p,
    notes: e.no,
    why: e.why,
    tier: e.tier,
    sales: e.s,
    star: e.st,
    layer: "sg",
    start: `${YEAR}-${String(e.m).padStart(2, "0")}-${String(sd).padStart(2, "0")}`,
    end: `${YEAR}-${String(e.m).padStart(2, "0")}-${String(ed).padStart(2, "0")}`,
  };
});
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

// The heaviest delegate days, from confirmed dates only: APAO (7,000+),
// Maritime Week with Sea Asia, FHA (~60,000), ATxSG, Sibos and Tech Week.
const CONFERENCE_DATES = new Set([
  "2027-03-18","2027-03-19","2027-03-20","2027-03-21",
  "2027-04-12","2027-04-13","2027-04-14","2027-04-15","2027-04-16",
  "2027-04-20","2027-04-21","2027-04-22","2027-04-23",
  "2027-05-26","2027-05-27","2027-05-28",
  "2027-09-20","2027-09-21","2027-09-22","2027-09-23",
  "2027-10-13","2027-10-14",
]);
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
