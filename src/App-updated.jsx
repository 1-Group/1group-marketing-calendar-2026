import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Calendar, Plus, Edit, Trash2, Flame, Snowflake, X, Search, Copy, RotateCcw, Eye, EyeOff, BarChart3, Grid3X3, MapPin, Users, GraduationCap, Megaphone, ChevronLeft, ChevronRight, Check, TrendingUp, Star, Building2, Thermometer, Lock, LogOut, Shield, KeyRound, User as UserIcon, AlertCircle, Briefcase, Utensils, Mail, Globe, Phone, ExternalLink, FileText, Download, Upload, FileSpreadsheet, Loader2 } from "lucide-react";

// ─── AUTH ───
// Sign-in is a single email→OTP flow (see SignIn below + /api/auth/*). The
// approved member allowlist lives server-side in Redis and is managed in-app by
// master admins via the Members panel (/api/admin/members). The frontend never
// gates access itself — it trusts the HMAC-signed user object returned by
// /api/auth/verify-otp, whose role is one of: master | admin | user | venue.

// Roles the server can assign (member tier → frontend role):
//   master (Master) · admin (Editor) · user (Viewer) · venue (Outlet, venue-scoped)
const ROLE_LABEL = { master: "Master admin", admin: "Editor", user: "Viewer", staff: "Viewer", venue: "Outlet" };

// Static per-venue access codes — legacy reference only (kept for the deprecated
// Venue Codes panel; no longer used for sign-in, which is now email→OTP).
const VENUE_ACCESS_CODES = {
  summerhouse: "SMH-2026-X7K2",
  garage: "GAR-2026-M9P4",
  altitude: "ALT-2026-R3N8",
  arden: "ARD-2026-J5T1",
  alkaff: "ALK-2026-H2W6",
  alfaro: "ALF-2026-B4Y9",
  atico: "ATI-2026-D6Q3",
  riverhouse: "RIV-2026-F8V5",
  flowerhill: "FLW-2026-L1K7",
  monti: "MON-2026-C3S2",
};

function canEdit(user) { return user && (user.role === "master" || user.role === "admin"); }
// canAdd: who can OPEN the Add Event form.
// - master + admin: can add any layer (SG / MICE / Campaign / Venue Activity)
// - venue (outlet): can add Venue Activity for their own venue(s) only — enforced in the form + addEvent guard
// - staff: still read-only (deliberately excluded)
function canAdd(user) { return user && (user.role === "master" || user.role === "admin" || user.role === "venue"); }
// Multi-venue OTP users (e.g. mimi @ altitude+flowerhill) need a filtered zone selector,
// so canSeeAllZones returns true for them; visibleVenueKeys later restricts what they see.
function canSeeAllZones(user) {
  if (!user) return false;
  if (user.role !== "venue") return true;
  return Array.isArray(user.venues) && user.venues.length > 1;
}
function canSeeVenueCodes(user) { return user && (user.role === "master" || user.role === "admin"); }

// Derive a hot/cold rating from a live confirmed-event count so the heatmap can
// colour dates fed by the Tripleseat weekly push. Thresholds are zone-aware:
// the "group" roll-up sums every venue so it runs much higher than a single
// venue. Heuristic — tune here if the colour bands feel off; it only affects
// shading, never the count shown.
function ratingFromCount(count, isGroup) {
  const n = Number(count) || 0;
  if (n <= 0) return "cold-cold";
  if (isGroup) {
    if (n >= 15) return "hot-hot";
    if (n >= 5) return "hot";
    return "cold";
  }
  if (n >= 5) return "hot-hot";
  if (n >= 2) return "hot";
  return "cold";
}

// ─── STORAGE WRAPPER (localStorage for Vercel) ───
const storage = {
  get: async (key) => {
    try { const v = localStorage.getItem(key); return v !== null ? { key, value: v } : null; }
    catch { return null; }
  },
  set: async (key, value) => {
    try { localStorage.setItem(key, value); return { key, value }; }
    catch { return null; }
  },
  delete: async (key) => {
    try { localStorage.removeItem(key); return { key, deleted: true }; }
    catch { return null; }
  },
};

// ─── CONSTANTS ───

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUARTERS = { q1:[0,1,2], q2:[3,4,5], q3:[6,7,8], q4:[9,10,11] };

// ─── THEME (Day only) ───

const T = {
  name: "day",
  page: "bg-slate-50 text-slate-800",
  panel: "bg-white border-slate-200",
  panelSoft: "bg-white/90",
  surface: "bg-slate-100",
  surfaceHover: "hover:bg-slate-200",
  surfaceStrong: "bg-slate-200",
  surfaceStrongHover: "hover:bg-slate-300",
  border: "border-slate-200",
  borderSoft: "border-slate-300",
  borderSubtle: "border-slate-200/70",
  borderHover: "hover:border-slate-400",
  borderHoverStrong: "hover:border-slate-500",
  textHead: "text-slate-900",
  textBody: "text-slate-700",
  textMuted: "text-slate-600",
  textDim: "text-slate-500",
  inactive: "bg-slate-100 text-slate-600 hover:bg-slate-200",
  input: "bg-white border-slate-300 text-slate-800",
  headerBg: "linear-gradient(135deg, #ffffff 0%, #eef2ff 50%, #ffffff 100%)",
  headerBorder: "border-slate-200",
  overlayBg: "bg-slate-900/30",
  modalBg: "bg-slate-900/40",
  emptyCell: "#F1F5F9",
  tooltipBg: "bg-white border-slate-200 shadow-lg text-slate-800",
  divide: "divide-slate-200",
  chipInactiveBorder: "border-slate-300",
  tagline: "text-slate-600",
  sub: "text-slate-500",
  tableBorder: "border-slate-200",
  gradient: "linear-gradient(90deg, #db2777, #7c3aed, #0284c7)",
  chipDimOpacity: "opacity-50",
};

// ─── 2026 CALENDAR DATASET (shared with /api/events) ───
// All hot/cold, MICE, SG-event, holiday, campaign and venue-activity data now
// lives in src/data/calendar2026.js so the UI and the hub API stay in sync.
import {
  VENUE_HC_RAW, VENUE_KEYS, parseVenueData,
  MICE_EVENTS, SG_EVENTS_RAW, SG_EVENTS, VISITOR_DATA,
  SCHOOL_HOLIDAYS, PUBLIC_HOLIDAYS, CAMPAIGNS,
  VENUE_SUBBRANDS, SEED_VENUE_EVENTS,
  CONFERENCE_DATES, DOUBLE_DIGIT_DATES, DATE_CODE_COLORS,
  LAYER_COLORS, SALES_SQUARE_COLORS, INTENSITY_COLORS,
  isInRange, isSchoolHoliday, isPublicHoliday, getMonthIndex,
  daysInMonth, firstDayOfMonth, dateStr, getVisitorPeaks,
} from "./data/calendar2026.js";

// ─── MAIN COMPONENT ───

export default function MarketingCalendar() {
  const [view, setView] = useState("board");
  const [quarter, setQuarter] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [search, setSearch] = useState("");
  const [layers, setLayers] = useState({
    hotcold: true, mice: true, sg: true, visitor: true, school: true, campaign: true, venue: true,
  });
  const [detailItem, setDetailItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [prefillEvent, setPrefillEvent] = useState(null); // pre-fill seed for Add form when opened from a detail panel
  const [customEvents, setCustomEvents] = useState([]);
  const [venueEvents, setVenueEvents] = useState(SEED_VENUE_EVENTS); // user-editable copy of venue activities
  const [editingEvent, setEditingEvent] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showVisitors, setShowVisitors] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [selectedZone, setSelectedZone] = useState("group"); // "group" or a venue key
  const [user, setUser] = useState(null); // { email?, role, name, dept, venue? }
  const [showVenueCodes, setShowVenueCodes] = useState(false);
  const [showAccessLog, setShowAccessLog] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Live "confirmed in Tripleseat" counts, pushed weekly by the 1HostHub app
  // and served from /api/confirmed. Shape: { venueKey: { "YYYY-MM-DD": count } }.
  // null until fetched; stays null (→ static snapshot) if the feed is empty.
  const [liveCounts, setLiveCounts] = useState(null);
  // Per-event detail (client, pax, type, status) for the day-detail panel. Only
  // returned to signed-in members (client names are PII). Shape:
  // { venueKey: { "YYYY-MM-DD": [ { client, pax, type, status }, ... ] } }.
  const [liveEvents, setLiveEvents] = useState(null);

  const t = T;

  // If a venue-only user is signed in, force selectedZone to one of their allowed venues
  useEffect(() => {
    if (user?.role !== "venue") return;
    const allowed = Array.isArray(user.venues) && user.venues.length > 0
      ? user.venues
      : (user.venue ? [user.venue] : []);
    if (allowed.length === 0) return;
    if (!allowed.includes(selectedZone)) {
      setSelectedZone(allowed[0]);
    }
  }, [user, selectedZone]);

  // Pull the live confirmed-event data once on load. Counts are non-sensitive;
  // the per-event detail (with client names) only comes back when we send a
  // valid session token, so members see detail and the endpoint stays private.
  // Degrades silently to the static snapshot on any error.
  useEffect(() => {
    let cancelled = false;
    let token = null;
    try { token = localStorage.getItem("calendar-otp-session"); } catch {}
    fetch("/api/confirmed", {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d || !d.counts || typeof d.counts !== "object") return;
        if (Object.keys(d.counts).length > 0) setLiveCounts(d.counts);
        if (d.events && typeof d.events === "object") setLiveEvents(d.events);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // Re-run when the signed-in user changes: the per-event detail needs the
    // session token, which may only be in localStorage AFTER sign-in — a bare
    // mount-time fetch would miss it and never show the detail.
  }, [user]);

  // Heatmap data for the selected zone. When the hub has pushed live counts for
  // this venue, they are AUTHORITATIVE for the whole year: each date's count is
  // the Tripleseat confirmed-event number and any date the hub didn't send is
  // treated as "nothing confirmed" (count 0 → cold) so cancellations/date-moves
  // self-correct. We seed a cell for EVERY day the static snapshot knew about so
  // the calendar grid stays fully rendered (0-event days are cold, not blank),
  // then overlay the live event-days on top. Venues the hub hasn't fed yet keep
  // the static 2026 snapshot untouched.
  const activeHC = useMemo(() => {
    const staticHC = parseVenueData(selectedZone);
    const live = liveCounts && liveCounts[selectedZone];
    if (!live || typeof live !== "object") return staticHC;
    const isGroup = selectedZone === "group";
    const merged = {};
    for (const date of Object.keys(staticHC)) {
      merged[date] = { count: 0, rating: "cold-cold", live: true };
    }
    for (const [date, raw] of Object.entries(live)) {
      const count = Number(raw) || 0;
      merged[date] = { count, rating: count > 0 ? ratingFromCount(count, isGroup) : "cold-cold", live: true };
    }
    return merged;
  }, [selectedZone, liveCounts]);
  const activeVenue = VENUE_HC_RAW[selectedZone];

  useEffect(() => {
    (async () => {
      try {
        // Restore session
        // Restore session — trust the user object stored at the last OTP sign-in.
        // (The session token is HMAC-verified server-side on any privileged call.)
        const sess = await storage.get("calendar-user");
        if (sess?.value) {
          const u = JSON.parse(sess.value);
          if (u && u.role) {
            setUser(u);
            logAccess(u);
            if (u.role === "venue" && u.venue && VENUE_HC_RAW[u.venue]) setSelectedZone(u.venue);
          }
        }
        const saved = await storage.get("calendar-events");
        if (saved?.value) setCustomEvents(JSON.parse(saved.value));
        // Venue events: load from storage, or seed from SEED_VENUE_EVENTS on first run.
        // Also handles: if seed events have been added to the code since the user last loaded,
        // automatically merge those missing seeds into the user's stored copy. User's edits to
        // other events are preserved. To intentionally remove a seed event, the user must delete
        // it AFTER this merge (which creates a user-version that persists).
        const savedVenueEvents = await storage.get("calendar-venue-events");
        // ─── ONE-TIME CLEANUP v2: remove all "Brunch of Roses" entries (by name OR by ID) ───
        // v2 supersedes v1: even if v1 already ran, this runs once. Catches edge cases where
        // entries had different names than the literal "Brunch of Roses" string. Diagnostic
        // console.log lets users open DevTools and verify what's in their storage.
        const cleanupFlag = await storage.get("venue-cleanup-v2");
        let parsedAfterCleanup = null;
        if (savedVenueEvents?.value && !cleanupFlag?.value) {
          try {
            const parsed = JSON.parse(savedVenueEvents.value);
            if (Array.isArray(parsed)) {
              const KILL_NAMES = ["Brunch of Roses"]; // case-sensitive substring match
              const KILL_IDS = new Set(["vn-fh-11", "vn-fh-17"]); // pre-removal seed IDs
              const before = parsed.length;
              const cleaned = parsed.filter(e => {
                if (KILL_IDS.has(e.id)) return false;
                if (e.name && KILL_NAMES.some(k => e.name.includes(k))) return false;
                return true;
              });
              const removed = before - cleaned.length;
              console.log(`[venue-cleanup-v2] storage had ${before} venue events; removed ${removed}; remaining ${cleaned.length}`);
              if (cleaned.length !== parsed.length) {
                try { await storage.set("calendar-venue-events", JSON.stringify(cleaned)); } catch {}
                parsedAfterCleanup = cleaned;
              }
            }
          } catch (err) {
            console.log("[venue-cleanup-v2] error parsing storage:", err);
          }
          try { await storage.set("venue-cleanup-v2", "done"); } catch {}
        }
        // ─── END CLEANUP ───
        if (savedVenueEvents?.value) {
          try {
            const parsed = parsedAfterCleanup || JSON.parse(savedVenueEvents.value);
            if (Array.isArray(parsed)) {
              // Detect missing seed events by ID (only vn-fh-* ids are seed-originated).
              const storedIds = new Set(parsed.map(e => e.id));
              const missingSeeds = SEED_VENUE_EVENTS.filter(s => !storedIds.has(s.id));
              if (missingSeeds.length > 0) {
                const merged = [...parsed, ...missingSeeds];
                setVenueEvents(merged);
                try { await storage.set("calendar-venue-events", JSON.stringify(merged)); } catch {}
              } else {
                setVenueEvents(parsed);
              }
            }
          } catch {}
        } else {
          // First-run seed: persist SEED_VENUE_EVENTS as the initial live copy.
          try { await storage.set("calendar-venue-events", JSON.stringify(SEED_VENUE_EVENTS)); } catch {}
        }
        const prefs = await storage.get("calendar-settings");
        if (prefs?.value) {
          const p = JSON.parse(prefs.value);
          if (p.layers) setLayers(prev => ({ ...prev, ...p.layers }));
          if (p.view) setView(p.view);
          if (p.quarter) setQuarter(p.quarter);
          if (p.zone && VENUE_HC_RAW[p.zone]) setSelectedZone(p.zone);
          else if (p.venue && VENUE_HC_RAW[p.venue]) setSelectedZone(p.venue); // legacy
        }
      } catch (e) { /* first load */ }
      setLoaded(true);
    })();
  }, []);

  // logAccess: fire-and-forget POST to /api/log/hit so the master admin can see
  // who has opened the calendar. Called on fresh sign-in AND on restored-session
  // load (the two are mutually exclusive per page load, so it fires exactly once).
  // Never throws, never blocks — logging must not affect the app.
  const logAccess = useCallback((u) => {
    if (!u) return;
    try {
      let sessionToken = null;
      try { sessionToken = localStorage.getItem("calendar-otp-session"); } catch {}
      const payload = {
        name: u.name || "Unknown",
        role: u.role || "unknown",
        dept: u.dept || "",
        venue: u.venue || "",
        email: u.email || "",
        auth: u.auth || "client",
      };
      if (sessionToken) payload.sessionToken = sessionToken;
      fetch("/api/log/hit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch { /* logging must never break the app */ }
  }, []);

  const handleSignIn = useCallback(async (u) => {
    setUser(u);
    logAccess(u);
    try { await storage.set("calendar-user", JSON.stringify(u)); } catch {}
    if (u.role === "venue") {
      const primary = (Array.isArray(u.venues) && u.venues[0]) || u.venue;
      if (primary) setSelectedZone(primary);
    }
  }, [logAccess]);

  const handleSignOut = useCallback(async () => {
    setUser(null);
    try { await storage.delete("calendar-user"); } catch {}
    // Also drop the signed session token so a stale/expired one never lingers
    // to confuse the next sign-in (its 12h expiry is independent of the profile).
    try { localStorage.removeItem("calendar-otp-session"); } catch {}
    setSelectedZone("group");
  }, []);

  const saveEvents = useCallback(async (evts) => {
    setCustomEvents(evts);
    try { await storage.set("calendar-events", JSON.stringify(evts)); } catch {}
  }, []);

  const saveVenueEvents = useCallback(async (evts) => {
    setVenueEvents(evts);
    try { await storage.set("calendar-venue-events", JSON.stringify(evts)); } catch {}
  }, []);

  const savePrefs = useCallback(async (l, v, q, z) => {
    try { await storage.set("calendar-settings", JSON.stringify({ layers: l, view: v, quarter: q, zone: z })); } catch {}
  }, []);

  const toggleLayer = (key) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    savePrefs(next, view, quarter, selectedZone);
  };

  const allEvents = useMemo(() => {
    const events = [];
    if (layers.mice) events.push(...MICE_EVENTS);
    if (layers.sg) events.push(...SG_EVENTS);
    if (layers.campaign) events.push(...CAMPAIGNS.map(c => {
      const endM = (c.endMonth != null) ? c.endMonth : c.month;
      const lastDay = new Date(2026, endM + 1, 0).getDate();
      return {
        ...c,
        start: `2026-${String(c.month + 1).padStart(2, "0")}-01`,
        end: `2026-${String(endM + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      };
    }));
    // Venue-specific activities (from venueEvents state — user-editable, seeded from SEED_VENUE_EVENTS).
    // Undated events get synthetic start/end spanning the whole month so views/filters work.
    if (layers.venue) events.push(...venueEvents.map(e => {
      if (e.start && e.end) return e;
      if (e.undated && e.month != null) {
        const lastDay = new Date(2026, e.month + 1, 0).getDate();
        return {
          ...e,
          start: `2026-${String(e.month + 1).padStart(2, "0")}-01`,
          end: `2026-${String(e.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        };
      }
      return e;
    }));
    events.push(...customEvents);
    return events;
  }, [layers, customEvents, venueEvents]);

  const filteredEvents = useMemo(() => {
    let evts = allEvents;
    // Zone filter: when a specific venue is selected, hide venue-layer events
    // (and custom events with a venue tag) that don't belong to that venue.
    // Group-level events (campaigns, MICE, SG, visitor peaks) always show — they're context.
    if (selectedZone !== "group") {
      evts = evts.filter(e => {
        if (e.layer === "venue") return e.venue === selectedZone;
        if (e.id?.startsWith("custom-") && e.venue) return e.venue === selectedZone;
        return true;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      evts = evts.filter(e =>
        e.name?.toLowerCase().includes(s) ||
        e.cat?.toLowerCase().includes(s) ||
        e.type?.toLowerCase().includes(s) ||
        e.industry?.toLowerCase().includes(s) ||
        e.organiser?.toLowerCase().includes(s) ||
        e.venue?.toLowerCase().includes(s) ||
        e.participants?.toLowerCase().includes(s) ||
        e.notes?.toLowerCase().includes(s) ||
        e.why?.toLowerCase().includes(s) ||
        (e.emails && e.emails.join(" ").toLowerCase().includes(s))
      );
    }
    if (quarter !== "all") {
      const months = QUARTERS[quarter];
      evts = evts.filter(e => {
        if (e.month !== undefined) {
          const endM = (e.endMonth != null) ? e.endMonth : e.month;
          // Multi-month item matches if any of its months is in the quarter
          for (let m = e.month; m <= endM; m++) if (months.includes(m)) return true;
          return false;
        }
        if (e.start) return months.includes(getMonthIndex(e.start));
        return true;
      });
    }
    return evts;
  }, [allEvents, search, quarter, selectedZone]);

  const eventsByMonth = useMemo(() => {
    const map = {};
    for (let i = 0; i < 12; i++) map[i] = [];
    filteredEvents.forEach(e => {
      // Multi-month campaigns: file under every month they span
      if (e.layer === "campaign" && e.month !== undefined) {
        const endM = (e.endMonth != null) ? e.endMonth : e.month;
        for (let m = e.month; m <= endM; m++) if (map[m]) map[m].push(e);
        return;
      }
      const mi = e.month ?? (e.start ? getMonthIndex(e.start) : 0);
      if (map[mi]) map[mi].push(e);
    });
    // Sort each month by layer priority so venue-specific activities surface first.
    // Without this, push order (MICE → SG → campaigns → venue) puts venue events
    // last, where the Board view's truncation cap can hide them in busy months.
    const layerOrder = { venue: 0, campaign: 1, mice: 2, sg: 3 };
    Object.keys(map).forEach(mi => {
      map[mi].sort((a, b) => (layerOrder[a.layer] ?? 4) - (layerOrder[b.layer] ?? 4));
    });
    return map;
  }, [filteredEvents]);

  const stats = useMemo(() => {
    const miceCount = MICE_EVENTS.length;
    const sgCount = SG_EVENTS.length;
    const campCount = CAMPAIGNS.length;
    const hhDays = Object.values(activeHC).filter(d => d.rating === "hot-hot").length;
    const ccDays = Object.values(activeHC).filter(d => d.rating === "cold-cold").length;
    let busiest = 0, quietest = 0, bMax = 0, qMin = 999;
    for (let i = 0; i < 12; i++) {
      const count = (eventsByMonth[i] || []).length;
      if (count > bMax) { bMax = count; busiest = i; }
      if (count < qMin) { qMin = count; quietest = i; }
    }
    return { miceCount, sgCount, campCount, hhDays, ccDays, busiest, quietest, custom: customEvents.length };
  }, [eventsByMonth, customEvents, activeHC]);

  const handleReset = async () => {
    if (!confirm("Reset will wipe all custom events, venue event edits, and preferences. This restores the default Flowerhill activities and removes any venue events you've added or edited. Continue?")) return;
    try {
      await storage.delete("calendar-events");
      await storage.delete("calendar-settings");
      await storage.delete("calendar-venue-events");
      // Re-seed venue events immediately so the next load starts clean.
      await storage.set("calendar-venue-events", JSON.stringify(SEED_VENUE_EVENTS));
    } catch {}
    setCustomEvents([]);
    setVenueEvents(SEED_VENUE_EVENTS);
    setLayers({ hotcold: true, mice: true, sg: true, visitor: true, school: true, campaign: true, venue: true });
    setView("board");
    setQuarter("all");
    setSelectedZone("group");
  };

  // canEditEvent: UI-level permission check. Returns true if the current user can edit/delete the given event.
  // - Any signed-in user with master/admin/staff role can edit/delete any event.
  // - Venue-role users can only edit/delete venue-layer events tagged to their assigned venue.
  //   (Client-side only; a determined user can bypass via DevTools. Real enforcement waits for backend.)
  // - Unsigned users can do nothing (sign-in gate blocks reaching this anyway).
  const canEditEvent = useCallback((item) => {
    if (!user) return false;
    if (user.role === "master" || user.role === "admin" || user.role === "staff") return true;
    if (user.role === "venue") {
      // Venue users can only touch venue-layer events whose venue is in their allowed set.
      if (item.layer !== "venue") return false;
      const allowed = Array.isArray(user.venues) && user.venues.length > 0
        ? user.venues
        : (user.venue ? [user.venue] : []);
      return allowed.includes(item.venue);
    }
    return false;
  }, [user]);

  // enforceVenueRole: if the current user is venue-role, force any incoming event payload
  // to be a venue-layer event scoped to one of their assigned venues. Client-side soft guard
  // mirroring canEditEvent's restrictions; a determined user can bypass via DevTools, but
  // this prevents accidental cross-venue writes from form-state manipulation.
  const enforceVenueRole = useCallback((evt) => {
    if (user?.role !== "venue") return evt;
    const allowed = Array.isArray(user.venues) && user.venues.length > 0
      ? user.venues
      : (user.venue ? [user.venue] : []);
    const safeVenue = allowed.includes(evt.venue) ? evt.venue : allowed[0];
    return { ...evt, layer: "venue", venue: safeVenue };
  }, [user]);

  const addEvent = (rawEvt) => {
    const evt = enforceVenueRole(rawEvt);
    // Venue-layer events go to venueEvents storage; everything else goes to customEvents.
    if (evt.layer === "venue") {
      const newEvt = { ...evt, id: `vn-user-${Date.now()}` };
      saveVenueEvents([...venueEvents, newEvt]);
    } else {
      const newEvt = { ...evt, id: `custom-${Date.now()}`, layer: evt.layer || "sg" };
      saveEvents([...customEvents, newEvt]);
    }
    setShowAddForm(false);
  };

  // Bulk-load activities parsed from a venue's own marketing-calendar workbook.
  // Incoming records already carry stable `vn-<venue>-imp-*` ids; re-importing
  // replaces any previously imported record with the same id (idempotent) and
  // leaves manually-added and seeded events untouched.
  const importVenueEvents = (incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    const incomingIds = new Set(incoming.map(e => e.id));
    saveVenueEvents([...venueEvents.filter(e => !incomingIds.has(e.id)), ...incoming]);
    setShowImport(false);
  };

  const updateEvent = (rawEvt) => {
    const evt = enforceVenueRole(rawEvt);
    if (evt.layer === "venue") {
      saveVenueEvents(venueEvents.map(e => e.id === evt.id ? evt : e));
    } else {
      saveEvents(customEvents.map(e => e.id === evt.id ? evt : e));
    }
    setEditingEvent(null);
  };

  const deleteEvent = (id) => {
    if (!confirm("Delete this event?")) return;
    // Check venueEvents first (IDs start with "vn-"), fall back to customEvents.
    if (venueEvents.some(e => e.id === id)) {
      saveVenueEvents(venueEvents.filter(e => e.id !== id));
    } else {
      saveEvents(customEvents.filter(e => e.id !== id));
    }
    setDetailItem(null);
  };

  const copySummary = () => {
    const qLabel = quarter === "all" ? "2026 Full Year" : quarter.toUpperCase();
    let text = `# 1-Group Marketing Calendar — ${qLabel}\n\n`;
    const months = quarter === "all" ? [...Array(12).keys()] : QUARTERS[quarter];
    months.forEach(mi => {
      const evts = eventsByMonth[mi] || [];
      if (evts.length === 0) return;
      text += `## ${MONTH_NAMES[mi]}\n`;
      evts.forEach(e => { text += `- ${e.name}${e.start ? ` (${e.start})` : ""}\n`; });
      text += "\n";
    });
    navigator.clipboard.writeText(text).catch(() => {});
    alert("Summary copied!");
  };

  // Outlet Excel export — venue-scoped, includes ONLY this outlet's relevant layers:
  //   Sheet 1: Venue Activities — all events tagged to this venue (from SEED_VENUE_EVENTS + venueEvents)
  //   Sheet 2: 1-Group Campaigns — group-wide campaigns for marketing alignment
  //   Sheet 3: Singapore Holidays — public + school holidays
  //   Sheet 4: International Visitor Intensity — 10 markets × 12 months
  // Deliberately excludes: MICE events, SG events (concerts/expos), Hot/Cold demand heatmap.
  const exportVenueExcel = async (venueKey) => {
    if (!venueKey || venueKey === "group") return;
    const venue = VENUE_HC_RAW[venueKey];
    if (!venue) return;

    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "1-Group Marketing Calendar";
      wb.created = new Date();

      // Style helpers
      const headerStyle = {
        font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF6366F1" } },
        alignment: { vertical: "middle", horizontal: "left" },
      };
      const titleStyle = {
        font: { bold: true, size: 14, color: { argb: "FF0F172A" } },
        alignment: { vertical: "middle" },
      };
      const subtitleStyle = {
        font: { italic: true, size: 10, color: { argb: "FF64748B" } },
        alignment: { vertical: "middle" },
      };
      const altRowFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      const thinBorder = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      const applyTableStyle = (ws, headerRow, dataStartRow, dataEndRow) => {
        ws.getRow(headerRow).eachCell(c => { c.style = headerStyle; c.border = thinBorder; });
        ws.getRow(headerRow).height = 22;
        for (let r = dataStartRow; r <= dataEndRow; r++) {
          const row = ws.getRow(r);
          row.eachCell(c => {
            c.border = thinBorder;
            c.alignment = { vertical: "middle", wrapText: true };
          });
          if ((r - dataStartRow) % 2 === 1) {
            row.eachCell(c => { c.fill = altRowFill; });
          }
        }
      };

      const fmtDateRange = (e) => {
        if (e.undated) return "Month-wide";
        if (e.start && e.end && e.start !== e.end) return `${e.start} → ${e.end}`;
        if (e.start) return e.start;
        if (typeof e.month === "number") return MONTH_NAMES[e.month];
        return "";
      };

      // ── Sheet 1: Venue Activities ────────────────────────────────────
      const ws1 = wb.addWorksheet(venue.shortName + " Activities", {
        properties: { tabColor: { argb: "FFEC4899" } },
        views: [{ state: "frozen", ySplit: 4 }],
      });
      ws1.columns = [
        { width: 12 }, { width: 18 }, { width: 40 }, { width: 18 }, { width: 50 },
      ];
      ws1.mergeCells("A1:E1");
      ws1.getCell("A1").value = `${venue.name} — Marketing Activities 2026`;
      ws1.getCell("A1").style = titleStyle;
      ws1.getRow(1).height = 26;
      ws1.mergeCells("A2:E2");
      ws1.getCell("A2").value = `Generated ${new Date().toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })} · Read-only · Outlet-scoped calendar`;
      ws1.getCell("A2").style = subtitleStyle;

      // Collect all venue activities for this venue, sorted by month then date
      const venueActivities = [...SEED_VENUE_EVENTS, ...venueEvents]
        .filter(e => e.venue === venueKey)
        .sort((a, b) => {
          const aMonth = a.start ? parseInt(a.start.split("-")[1]) - 1 : (a.month ?? 12);
          const bMonth = b.start ? parseInt(b.start.split("-")[1]) - 1 : (b.month ?? 12);
          if (aMonth !== bMonth) return aMonth - bMonth;
          const aDate = a.start || "";
          const bDate = b.start || "";
          return aDate.localeCompare(bDate);
        });

      const headers1 = ["Month", "Dates", "Activity", "Sub-brand", "Notes / Hook"];
      ws1.getRow(4).values = headers1;
      let row1 = 5;
      venueActivities.forEach(e => {
        const monthIdx = e.start ? parseInt(e.start.split("-")[1]) - 1 : e.month;
        const monthLabel = typeof monthIdx === "number" ? MONTH_NAMES[monthIdx] : "—";
        ws1.getRow(row1).values = [
          monthLabel,
          fmtDateRange(e),
          e.name || "",
          e.subBrand || "",
          e.hook || "",
        ];
        row1++;
      });
      if (venueActivities.length === 0) {
        ws1.mergeCells(`A5:E5`);
        ws1.getCell("A5").value = `No activities scheduled for ${venue.name} in 2026 yet.`;
        ws1.getCell("A5").style = subtitleStyle;
        row1 = 6;
      } else {
        applyTableStyle(ws1, 4, 5, row1 - 1);
      }

      // ── Sheet 2: 1-Group Campaigns ────────────────────────────────────
      const ws2 = wb.addWorksheet("1-Group Campaigns", {
        properties: { tabColor: { argb: "FF8B5CF6" } },
        views: [{ state: "frozen", ySplit: 4 }],
      });
      ws2.columns = [{ width: 12 }, { width: 36 }, { width: 50 }];
      ws2.mergeCells("A1:C1");
      ws2.getCell("A1").value = "1-Group Marketing Campaigns 2026";
      ws2.getCell("A1").style = titleStyle;
      ws2.getRow(1).height = 26;
      ws2.mergeCells("A2:C2");
      ws2.getCell("A2").value = "Group-wide campaigns to align your outlet activities with";
      ws2.getCell("A2").style = subtitleStyle;

      ws2.getRow(4).values = ["Month", "Campaign", "Tagline / Theme"];
      let row2 = 5;
      CAMPAIGNS.forEach(c => {
        ws2.getRow(row2).values = [MONTH_NAMES[c.month] || "", c.name || "", c.tagline || ""];
        row2++;
      });
      applyTableStyle(ws2, 4, 5, row2 - 1);

      // ── Sheet 3: Singapore Holidays ──────────────────────────────────
      const ws3 = wb.addWorksheet("Singapore Holidays", {
        properties: { tabColor: { argb: "FFEAB308" } },
        views: [{ state: "frozen", ySplit: 4 }],
      });
      ws3.columns = [{ width: 32 }, { width: 22 }, { width: 18 }];
      ws3.mergeCells("A1:C1");
      ws3.getCell("A1").value = "Singapore Public & School Holidays 2026";
      ws3.getCell("A1").style = titleStyle;
      ws3.getRow(1).height = 26;
      ws3.mergeCells("A2:C2");
      ws3.getCell("A2").value = "Demand drivers — peak family/leisure dining and gifting windows";
      ws3.getCell("A2").style = subtitleStyle;

      ws3.getRow(4).values = ["Holiday", "Date / Range", "Type"];
      let row3 = 5;
      PUBLIC_HOLIDAYS.forEach(h => {
        ws3.getRow(row3).values = [h.name || "", h.date || "", "Public holiday"];
        row3++;
      });
      SCHOOL_HOLIDAYS.forEach(h => {
        const range = h.start === h.end ? h.start : `${h.start} → ${h.end}`;
        ws3.getRow(row3).values = [h.name || "", range, "School holiday"];
        row3++;
      });
      applyTableStyle(ws3, 4, 5, row3 - 1);

      // ── Sheet 4: International Visitor Intensity ─────────────────────
      const ws4 = wb.addWorksheet("Visitor Intensity", {
        properties: { tabColor: { argb: "FF10B981" } },
        views: [{ state: "frozen", ySplit: 4, xSplit: 2 }],
      });
      ws4.columns = [
        { width: 22 }, { width: 18 },
        { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 },
        { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 },
      ];
      ws4.mergeCells("A1:N1");
      ws4.getCell("A1").value = "International Visitor Markets — 2026 Monthly Intensity";
      ws4.getCell("A1").style = titleStyle;
      ws4.getRow(1).height = 26;
      ws4.mergeCells("A2:N2");
      ws4.getCell("A2").value = "Peak / High / Moderate / Low classifications by Singapore Tourism patterns";
      ws4.getCell("A2").style = subtitleStyle;

      ws4.getRow(4).values = ["Market", "Total Arrivals", ...MONTH_SHORT];
      let row4 = 5;
      const intensityFills = {
        Peak: { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } },
        High: { type: "pattern", pattern: "solid", fgColor: { argb: "FF10B981" } },
        Mod: { type: "pattern", pattern: "solid", fgColor: { argb: "FF6EE7B7" } },
        Low: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } },
      };
      const intensityFontWhite = { color: { argb: "FFFFFFFF" }, bold: true };
      const intensityFontDark = { color: { argb: "FF065F46" }, bold: true };
      VISITOR_DATA.forEach(v => {
        const row = ws4.getRow(row4);
        row.values = [v.market, v.arrivals, ...MONTH_SHORT.map(m => v.data[m] || "")];
        // Colour-code intensity cells
        for (let c = 3; c <= 14; c++) {
          const cell = row.getCell(c);
          const val = cell.value;
          if (intensityFills[val]) {
            cell.fill = intensityFills[val];
            cell.font = (val === "Peak" || val === "High") ? intensityFontWhite : intensityFontDark;
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }
        }
        row4++;
      });
      // Style header row + borders
      ws4.getRow(4).eachCell(c => { c.style = headerStyle; c.border = thinBorder; });
      ws4.getRow(4).height = 22;
      for (let r = 5; r < row4; r++) {
        const row = ws4.getRow(r);
        row.eachCell(c => {
          if (!c.border) c.border = thinBorder;
          else c.border = thinBorder;
        });
      }

      // ── Save ─────────────────────────────────────────────────────────
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const filename = `1-Group_${venue.shortName.replace(/\s+/g, "_")}_Calendar_2026.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Could not generate the Excel file. Please try again or contact a Marketing admin.");
    }
  };

  if (!loaded) return <div className={`flex items-center justify-center h-screen ${t.page}`}><div className="animate-pulse text-lg">Loading calendar...</div></div>;

  if (!user) return <SignIn t={t} onSignIn={handleSignIn} />;

  const editOK = canEdit(user);
  const addOK = canAdd(user);
  const allZonesOK = canSeeAllZones(user);
  const codesOK = canSeeVenueCodes(user);
  // Access Log is master-only — Chris asked that only he can see who's been looking.
  const logOK = user.role === "master";
  // For venue-role users (single OR multi-venue), restrict the zone selector to ONLY their assigned venues.
  // For other roles, show all zones (group + every venue).
  const visibleVenueKeys = (() => {
    if (user.role !== "venue") return VENUE_KEYS;
    const allowed = Array.isArray(user.venues) && user.venues.length > 0
      ? user.venues
      : (user.venue ? [user.venue] : []);
    return allowed.length > 0 ? allowed : VENUE_KEYS;
  })();

  return (
    <div className={`min-h-screen ${t.page}`} style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className={`sticky top-0 z-40 border-b ${t.headerBorder}`} style={{ background: t.headerBg }}>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ background: t.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {selectedZone === "group" ? "1-Group Marketing Calendar 2026" : `${activeVenue.name} · Marketing Calendar 2026`}
              </h1>
              <p className={`text-xs ${t.tagline} mt-0.5`}>
                {selectedZone === "group"
                  ? "Zone 1 · Group-level calendar, demand & opportunities"
                  : `Zone 2 · Outlet view · demand overlaid with group events & visitors`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* User badge */}
              <div className={`flex items-center gap-1.5 ${t.surface} px-2.5 py-1 rounded-md text-xs ${t.textBody}`} title={user.email || user.venue}>
                {user.role === "master" ? <Shield className="w-3.5 h-3.5 text-purple-600" /> :
                 user.role === "admin" ? <Shield className="w-3.5 h-3.5 text-indigo-600" /> :
                 user.role === "venue" ? <Building2 className="w-3.5 h-3.5 text-amber-600" /> :
                 <UserIcon className="w-3.5 h-3.5 text-slate-500" />}
                <span className="font-medium">{user.name}</span>
                <span className={t.textDim}>· {user.dept}</span>
                {!addOK && <span className="text-xs px-1.5 py-0 rounded bg-slate-200 text-slate-700">Read-only</span>}
              </div>

              <div className="relative">
                <Search className={`absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${t.textDim}`} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events..." className={`${t.input} border rounded-md pl-7 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:border-purple-500`} />
              </div>
              {addOK && <button onClick={() => setShowAddForm(true)} className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-1.5 rounded-md"><Plus className="w-3.5 h-3.5" /> Add</button>}
              <button onClick={copySummary} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><Copy className="w-3.5 h-3.5" /> Copy</button>
              <button
                onClick={() => setShowUpload(true)}
                title="Upload your target sheet — the app adds the 2026 calendar (events, heat map, holidays…) as extra columns"
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-md"
              ><Upload className="w-3.5 h-3.5" /> Enrich Target Sheet</button>
              {addOK && (
                <button
                  onClick={() => setShowImport(true)}
                  title="Import a venue's own marketing-calendar workbook — the app reads each month's activations into the calendar for review"
                  className="flex items-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-1.5 rounded-md"
                ><FileSpreadsheet className="w-3.5 h-3.5" /> Import Venue Calendar</button>
              )}
              {selectedZone !== "group" && (
                <button
                  onClick={() => exportVenueExcel(selectedZone)}
                  title={`Download ${activeVenue.shortName} 2026 calendar (events, campaigns, holidays, visitors)`}
                  className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-md"
                ><Download className="w-3.5 h-3.5" /> {activeVenue.shortName} .xlsx</button>
              )}
              {codesOK && <button onClick={() => setShowVenueCodes(true)} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><KeyRound className="w-3.5 h-3.5" /> Venue Codes</button>}
              {logOK && <button onClick={() => setShowMembers(true)} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><Users className="w-3.5 h-3.5" /> Members</button>}
              {logOK && <button onClick={() => setShowAccessLog(true)} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><Eye className="w-3.5 h-3.5" /> Access Log</button>}
              {editOK && <button onClick={handleReset} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><RotateCcw className="w-3.5 h-3.5" /> Reset</button>}
              <button onClick={handleSignOut} className={`flex items-center gap-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-xs px-3 py-1.5 rounded-md`}><LogOut className="w-3.5 h-3.5" /> Sign out</button>
            </div>
          </div>

          {/* Zone selector: Group + outlet tabs (hidden for venue-only users) */}
          {allZonesOK && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <span className={`text-xs font-semibold uppercase tracking-wider ${t.textDim} mr-1`}>Zone:</span>
            {visibleVenueKeys.map(zkey => {
              const v = VENUE_HC_RAW[zkey];
              const isSel = selectedZone === zkey;
              const isGrp = zkey === "group";
              return (
                <button
                  key={zkey}
                  onClick={() => { setSelectedZone(zkey); savePrefs(layers, view, quarter, zkey); }}
                  className={`text-xs px-3 py-1 rounded-md transition-all flex items-center gap-1 ${
                    isSel
                      ? isGrp ? "bg-purple-600 text-white ring-2 ring-purple-400" : "bg-indigo-600 text-white ring-2 ring-indigo-400"
                      : t.inactive
                  }`}
                >
                  {isGrp ? <Thermometer className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                  {v.shortName}
                </button>
              );
            })}
          </div>
          )}

          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className="flex gap-1">
              {[["board", "Board", Grid3X3], ["month", "Month", Calendar], ["heatmap", "Heatmap", BarChart3]].map(([v, label, Icon]) => (
                <button key={v} onClick={() => { setView(v); savePrefs(layers, v, quarter, selectedZone); }} className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md ${view === v ? "bg-purple-600 text-white" : t.inactive}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {["all", "q1", "q2", "q3", "q4"].map(q => (
                <button key={q} onClick={() => { setQuarter(q); savePrefs(layers, view, q, selectedZone); }} className={`text-xs px-3 py-1.5 rounded-md ${quarter === q ? "bg-indigo-600 text-white" : t.inactive}`}>
                  {q === "all" ? "All" : q.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {[
              ["hotcold", "Hot/Cold", Flame, "#EF4444"],
              ["mice", "MICE", MapPin, "#8B5CF6"],
              ["sg", "SG Events", Star, "#F59E0B"],
              ["visitor", "Visitors", Users, "#10B981"],
              ["school", "Holidays", GraduationCap, "#14B8A6"],
              ["campaign", "Campaigns", Megaphone, "#EC4899"],
              ["venue", "Venue", Building2, "#0891B2"],
            ].map(([key, label, Icon, color]) => (
              <button key={key} onClick={() => toggleLayer(key)} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${layers[key] ? "border-opacity-100" : `${t.chipInactiveBorder} ${t.chipDimOpacity}`}`}
                style={{ borderColor: layers[key] ? color : undefined, background: layers[key] ? color + "15" : undefined }}>
                {layers[key] ? <Eye className="w-3 h-3" style={{ color }} /> : <EyeOff className="w-3 h-3" />}
                <span style={{ color: layers[key] ? color : undefined }}>{label}</span>
              </button>
            ))}
            <button onClick={() => setShowStats(!showStats)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${t.chipInactiveBorder} ${t.borderHoverStrong}`}>
              <TrendingUp className="w-3 h-3" /> Stats
            </button>
            <button onClick={() => setShowVisitors(!showVisitors)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${t.chipInactiveBorder} ${t.borderHoverStrong}`}>
              <Users className="w-3 h-3" /> Visitor Map
            </button>
            <button onClick={() => setShowLegend(!showLegend)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${showLegend ? "border-indigo-500 bg-indigo-50" : `${t.chipInactiveBorder} ${t.borderHoverStrong}`}`}>
              <FileText className={`w-3 h-3 ${showLegend ? "text-indigo-700" : ""}`} /> <span className={showLegend ? "text-indigo-700 font-medium" : ""}>Legend</span>
            </button>
          </div>
        </div>
      </div>

      {/* Zone selector: Group (Zone 1) vs individual outlets (Zone 2) */}
      <div className="px-4 pt-3">
        <div className={`${t.panel} border rounded-xl p-2 flex items-center gap-2 flex-wrap`}>
          <div className="flex items-center gap-1.5 pl-1 pr-2">
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span className={`text-xs font-semibold ${t.textMuted}`}>Zone</span>
          </div>
          {VENUE_KEYS.map(vkey => {
            const v = VENUE_HC_RAW[vkey];
            const isSel = selectedZone === vkey;
            const isGrp = vkey === "group";
            return (
              <button
                key={vkey}
                onClick={() => { setSelectedZone(vkey); savePrefs(layers, view, quarter, vkey); }}
                className={`text-xs px-2.5 py-1 rounded-md transition-all whitespace-nowrap ${
                  isSel
                    ? (isGrp ? "bg-purple-600 text-white" : "bg-indigo-600 text-white")
                    : t.inactive
                }`}
                title={v.name}
              >
                {isGrp && <Thermometer className="w-3 h-3 inline mr-1 -mt-0.5" />}
                {isGrp ? "1-Group" : v.shortName}
              </button>
            );
          })}
          {selectedZone !== "group" && (
            <span className={`ml-auto text-xs ${t.textDim} italic pr-2`}>
              Showing {activeVenue.name} demand · Events, visitors & holidays unchanged
            </span>
          )}
        </div>
      </div>

      {showLegend && (
        <div className={`mx-4 mt-3 p-4 ${t.panel} border rounded-lg space-y-4`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-bold ${t.textHead} flex items-center gap-2`}><FileText className="w-4 h-4" /> Calendar Index</h3>
            <button onClick={() => setShowLegend(false)} className={`p-1 rounded ${t.surfaceHover}`} title="Close legend"><X className="w-4 h-4" /></button>
          </div>

          {/* Day-number markers — the four new dots/squares */}
          <div>
            <h4 className={`text-xs font-bold uppercase tracking-wide ${t.textMuted} mb-2`}>Markers next to day numbers</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="flex items-start gap-2.5">
                <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
                  <span className={`text-xs font-medium ${t.textBody}`}>15</span>
                  <span className="rounded-full" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.doubledigit, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} />
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: DATE_CODE_COLORS.doubledigit }}>Green dot — Double-digit date</div>
                  <div className={`text-xs ${t.textDim}`}>1/1, 2/2 … 12/12. Promo-ready anchor dates (e.g. "11.11", "12.12 sale").</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
                  <span className={`text-xs font-medium ${t.textBody}`}>15</span>
                  <span className="rounded-full" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.conference, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} />
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: DATE_CODE_COLORS.conference }}>Purple dot — Conference date</div>
                  <div className={`text-xs ${t.textDim}`}>22 dates spanning the major MICE periods (e.g. ATX SG, Tech Week, F1/Milken/TOKEN2049 week, ITB Asia).</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
                  <span className={`text-xs font-medium ${t.textBody}`}>15</span>
                  <span className="rounded-sm" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.host, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: "#A16207" }}>Yellow square — Host Sales priority</div>
                  <div className={`text-xs ${t.textDim}`}>A 1-Host event-sales-priority conference falls on this date. Likely to drive event-booking enquiries — pursue actively.</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
                  <span className={`text-xs font-medium ${t.textBody}`}>15</span>
                  <span className="rounded-sm" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.dining, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: "#C2410C" }}>Orange square — Dining Sales priority</div>
                  <div className={`text-xs ${t.textDim}`}>An event predicted to drive big-group dining bookings. Prep ops capacity.</div>
                </div>
              </div>
            </div>
            <div className={`text-xs ${t.textDim} italic mt-2`}>Click a day to see which event(s) trigger the markers and read the full priority briefing.</div>
          </div>

          {/* Cell background — Hot/Cold rating */}
          <div className={`pt-3 border-t ${t.border}`}>
            <h4 className={`text-xs font-bold uppercase tracking-wide ${t.textMuted} mb-2`}>Day-cell background colour — 1-Host event demand</h4>
            <div className={`text-xs ${t.textDim} mb-2`}>Reflects confirmed 1-Host events in Tripleseat for that date — i.e. event-sales volume, not dining covers.</div>
            <div className="flex flex-wrap gap-3">
              {[["hot-hot","Hot-Hot — saturated, many confirmed events"], ["hot","Hot — strong demand"], ["cold","Cold — light demand"], ["cold-cold","Cold-Cold — open availability, actively pursue"]].map(([r,desc]) => (
                <div key={r} className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-sm" style={{ background: LAYER_COLORS[r].primary }} />
                  <span className={`text-xs ${t.textBody}`} title={desc}>{LAYER_COLORS[r].label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Day-cell icons */}
          <div className={`pt-3 border-t ${t.border}`}>
            <h4 className={`text-xs font-bold uppercase tracking-wide ${t.textMuted} mb-2`}>Other day-cell icons</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-current shrink-0" />
                <span className={`text-xs ${t.textBody}`}>Public Holiday (yellow border + name shown in cell)</span>
              </div>
              <div className="flex items-center gap-2">
                <GraduationCap className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span className={`text-xs ${t.textBody}`}>Singapore school break (teal border)</span>
              </div>
              <div className="flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-red-600 shrink-0" />
                <span className={`text-xs ${t.textBody}`}>Hot or Hot-Hot demand day</span>
              </div>
              <div className="flex items-center gap-2">
                <Snowflake className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className={`text-xs ${t.textBody}`}>Cold or Cold-Cold demand day</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5 shrink-0" style={{ color: LAYER_COLORS.host.primary }} />
                <span className={`text-xs ${t.textBody}`}>Inside an event chip — Host-priority event</span>
              </div>
              <div className="flex items-center gap-2">
                <Utensils className="w-3.5 h-3.5 shrink-0" style={{ color: LAYER_COLORS.dining.primary }} />
                <span className={`text-xs ${t.textBody}`}>Inside an event chip — Dining-priority event</span>
              </div>
            </div>
          </div>

          {/* Tier badges */}
          <div className={`pt-3 border-t ${t.border}`}>
            <h4 className={`text-xs font-bold uppercase tracking-wide ${t.textMuted} mb-2`}>Priority tier (in event detail panel + chip)</h4>
            <div className={`text-xs ${t.textDim} mb-2`}>Sourced from the Singapore 2026 Events Master "Priority Quick-Reference" sheet — 14 events flagged.</div>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5"><span className="text-amber-700 font-semibold">⭐⭐⭐</span><span className={`text-xs ${t.textBody}`}>Exceptional (full-week city impact)</span></div>
              <div className="flex items-center gap-1.5"><span className="text-amber-700 font-semibold">⭐⭐</span><span className={`text-xs ${t.textBody}`}>Very High (multi-night side events)</span></div>
              <div className="flex items-center gap-1.5"><span className="text-amber-700 font-semibold">⭐</span><span className={`text-xs ${t.textBody}`}>High (single major night/dinner)</span></div>
            </div>
          </div>

          <div className={`pt-3 border-t ${t.border} text-xs ${t.textDim} flex items-center gap-2`}>
            <Calendar className="w-3 h-3" />
            Numbers in cells = <span className={`${t.textHead} font-medium`}>1-Host events confirmed in Tripleseat</span> for that date.
          </div>
        </div>
      )}

      {showStats && (
        <div className={`mx-4 mt-3 p-3 ${t.panel} border rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-center`}>
          {[
            ["MICE Events", stats.miceCount, "#8B5CF6"],
            ["SG Events", stats.sgCount, "#F59E0B"],
            ["Campaigns", stats.campCount, "#EC4899"],
            ["Hot-Hot Days", stats.hhDays, "#DC2626"],
            ["Cold-Cold Days", stats.ccDays, "#2563EB"],
            ["Custom Events", stats.custom, "#6366F1"],
            ["Busiest", MONTH_SHORT[stats.busiest], "#10B981"],
            ["Quietest", MONTH_SHORT[stats.quietest], "#60A5FA"],
          ].map(([label, val, color]) => (
            <div key={label}>
              <div className="text-lg font-bold" style={{ color }}>{val}</div>
              <div className={`text-xs ${t.textDim}`}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {showVisitors && (
        <div className={`mx-4 mt-3 p-3 ${t.panel} border rounded-lg overflow-x-auto`}>
          <h3 className="text-sm font-bold mb-2 text-emerald-700">International Visitor Intensity</h3>
          <table className="w-full text-xs">
            <thead><tr>
              <th className={`text-left py-1 px-2 ${t.textDim}`}>Market</th>
              <th className={`text-left py-1 px-1 ${t.textDim}`}>Arrivals</th>
              {MONTH_SHORT.map(m => <th key={m} className={`py-1 px-1 ${t.textDim} text-center`}>{m}</th>)}
            </tr></thead>
            <tbody>
              {VISITOR_DATA.map(v => (
                <tr key={v.market} className={`border-t ${t.tableBorder}`}>
                  <td className={`py-1 px-2 font-medium ${t.textBody}`}>{v.market}</td>
                  <td className={`py-1 px-1 ${t.textDim}`}>{v.arrivals}</td>
                  {MONTH_SHORT.map(m => (
                    <td key={m} className="py-1 px-1 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: INTENSITY_COLORS[v.data[m]] || "#374151", color: v.data[m] === "Peak" ? "#fff" : v.data[m] === "High" ? "#fff" : "#065F46" }}>
                        {v.data[m]}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4">
        {view === "board" && <BoardView t={t} activeHC={activeHC} activeVenue={activeVenue} eventsByMonth={eventsByMonth} layers={layers} quarter={quarter} onDetail={setDetailItem} onMonthClick={(mi) => { setSelectedMonth(mi); setView("month"); }} />}
        {view === "month" && <MonthView t={t} activeHC={activeHC} month={selectedMonth} setMonth={setSelectedMonth} events={eventsByMonth[selectedMonth] || []} layers={layers} onDetail={setDetailItem} />}
        {view === "heatmap" && <HeatmapView t={t} activeHC={activeHC} activeVenue={activeVenue} layers={layers} quarter={quarter} onDetail={setDetailItem} />}
      </div>

      {detailItem && <DetailPanel t={t} activeHC={activeHC} hostEventsForZone={liveEvents && liveEvents[selectedZone]} item={detailItem} editOK={addOK} canEditEvent={canEditEvent} onClose={() => setDetailItem(null)} onEdit={(e) => { setDetailItem(null); setEditingEvent(e); }} onDelete={deleteEvent} onAddSimilar={(e) => {
        // Pre-fill Add form with the viewed event's context (venue, sub-brand, layer, dates) but clear Name.
        setDetailItem(null);
        setShowAddForm(true);
        setPrefillEvent({
          name: "",
          layer: e.layer || "venue",
          venue: e.venue || "",
          subBrand: e.subBrand || "",
          start: e.start || "2026-01-01",
          end: e.end || "2026-01-01",
          hook: "",
          type: e.type || "",
        });
      }} />}

      {addOK && (showAddForm || editingEvent) && (
        <EventFormModal
          t={t}
          user={user}
          event={editingEvent || prefillEvent}
          isPrefill={!editingEvent && !!prefillEvent}
          onSave={editingEvent ? updateEvent : addEvent}
          onClose={() => { setShowAddForm(false); setEditingEvent(null); setPrefillEvent(null); }}
        />
      )}

      {showVenueCodes && codesOK && <VenueCodesPanel t={t} onClose={() => setShowVenueCodes(false)} />}
      {showAccessLog && logOK && <AccessLogPanel t={t} onClose={() => setShowAccessLog(false)} />}
      {showMembers && logOK && <MemberSettingsPanel t={t} currentUser={user} onClose={() => setShowMembers(false)} onSignOut={handleSignOut} />}
      {showUpload && (
        <TargetSheetUpload
          t={t}
          defaultZone={selectedZone}
          venueKeys={visibleVenueKeys}
          onClose={() => setShowUpload(false)}
        />
      )}

      {showImport && (
        <VenueCalendarImport
          t={t}
          defaultZone={selectedZone}
          venueKeys={visibleVenueKeys}
          onImport={importVenueEvents}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ─── BOARD VIEW ───

function BoardView({ t, activeHC, activeVenue, eventsByMonth, layers, quarter, onDetail, onMonthClick }) {
  const quarters = quarter === "all" ? ["q1", "q2", "q3", "q4"] : [quarter];
  const isDay = t.name === "day";
  return (
    <div className={`grid gap-4 ${quarters.length === 4 ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4" : "grid-cols-1"}`}>
      {quarters.map(q => (
        <div key={q} className={`${t.panel} border rounded-xl overflow-hidden`}>
          <div className={`px-4 py-2 border-b ${t.border} ${t.panelSoft}`}>
            <h2 className={`font-bold text-sm ${isDay ? "text-purple-700" : "text-purple-400"}`}>{q.toUpperCase()}</h2>
          </div>
          <div className={`divide-y ${t.divide}`}>
            {QUARTERS[q].map(mi => {
              const evts = eventsByMonth[mi] || [];
              const hc = activeHC;
              const days = daysInMonth(mi);
              let hhCount = 0, hCount = 0, cCount = 0, ccCount = 0;
              for (let d = 1; d <= days; d++) {
                const key = dateStr(mi, d);
                const r = hc[key]?.rating;
                if (r === "hot-hot") hhCount++;
                else if (r === "hot") hCount++;
                else if (r === "cold") cCount++;
                else ccCount++;
              }
              const peaks = getVisitorPeaks(mi);
              const hasPH = PUBLIC_HOLIDAYS.some(h => getMonthIndex(h.date) === mi);
              const isSchool = SCHOOL_HOLIDAYS.some(h => getMonthIndex(h.start) === mi || getMonthIndex(h.end) === mi);

              return (
                <div key={mi} className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => onMonthClick(mi)} className={`font-semibold text-sm ${t.textBody} hover:${t.textHead} flex items-center gap-1`}>
                      {MONTH_NAMES[mi]}
                      <span className={`text-xs ${t.textDim} font-normal`}>({evts.length})</span>
                    </button>
                    <div className="flex gap-0.5">
                      {hasPH && layers.school && <Star className={`w-3.5 h-3.5 ${isDay ? "text-amber-500" : "text-yellow-400"} fill-current`} />}
                      {isSchool && layers.school && <GraduationCap className={`w-3.5 h-3.5 ${isDay ? "text-teal-600" : "text-teal-400"}`} />}
                    </div>
                  </div>

                  {layers.hotcold && (
                    <div className="flex h-2 rounded-full overflow-hidden mb-1 gap-px">
                      {hhCount > 0 && <div style={{ width: `${(hhCount / days) * 100}%`, background: "#DC2626" }} title={`${hhCount} Hot-Hot days`} />}
                      {hCount > 0 && <div style={{ width: `${(hCount / days) * 100}%`, background: "#EF4444" }} title={`${hCount} Hot days`} />}
                      {cCount > 0 && <div style={{ width: `${(cCount / days) * 100}%`, background: "#60A5FA" }} title={`${cCount} Cold days`} />}
                      {ccCount > 0 && <div style={{ width: `${(ccCount / days) * 100}%`, background: "#2563EB" }} title={`${ccCount} Cold-Cold days`} />}
                    </div>
                  )}
                  {layers.hotcold && (
                    <div className={`flex gap-2 text-xs mb-2 ${t.textDim}`}>
                      {hhCount > 0 && <span className={`${isDay ? "text-red-700" : "text-red-400"} font-semibold`}>{hhCount} HH</span>}
                      {hCount > 0 && <span className={isDay ? "text-red-600" : "text-red-300"}>{hCount} H</span>}
                      {cCount > 0 && <span className={isDay ? "text-blue-600" : "text-blue-300"}>{cCount} C</span>}
                      {ccCount > 0 && <span className={`${isDay ? "text-blue-700" : "text-blue-400"} font-semibold`}>{ccCount} CC</span>}
                    </div>
                  )}

                  {layers.visitor && peaks.length > 0 && (
                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                      <Users className={`w-3 h-3 ${isDay ? "text-emerald-700" : "text-emerald-400"} shrink-0`} />
                      {peaks.map(p => <span key={p} className={`text-xs px-1.5 py-0.5 rounded ${isDay ? "bg-emerald-100 text-emerald-800" : "bg-emerald-900/50 text-emerald-300"}`}>{p}</span>)}
                    </div>
                  )}

                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {evts.slice(0, 20).map(e => (
                      <EventChip key={e.id} t={t} event={e} onClick={() => onDetail(e)} />
                    ))}
                    {evts.length > 20 && <div className={`text-xs ${t.textDim} text-center`}>+{evts.length - 20} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventChip({ t, event, onClick }) {
  const layer = event.layer || "sg";
  const baseColor = LAYER_COLORS[layer] || LAYER_COLORS.sg;
  const accent = event.sales === "host" ? LAYER_COLORS.host
                : event.sales === "dining" ? LAYER_COLORS.dining
                : baseColor;
  const isStarred = event.name?.includes("⭐") || (event.star && event.star.includes("⭐"));
  const isDay = t?.name === "day";
  const chipBg = isDay ? baseColor.bg : baseColor.bg + "40";
  const tierShort = event.tier ? event.tier.match(/⭐+/)?.[0] : null;
  return (
    <button onClick={onClick} className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:brightness-110 transition-all group" style={{ background: chipBg, borderLeft: `3px solid ${accent.primary}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {event.sales === "host" && <Briefcase className="w-3 h-3 shrink-0" style={{ color: LAYER_COLORS.host.primary }} />}
          {event.sales === "dining" && <Utensils className="w-3 h-3 shrink-0" style={{ color: LAYER_COLORS.dining.primary }} />}
          <div className="text-xs font-medium truncate" style={{ color: isStarred ? (isDay ? "#B45309" : "#FBBF24") : accent.primary }} title={event.name}>{event.name}</div>
          {tierShort && <span className="text-xs shrink-0" title={event.tier} style={{ color: "#B45309" }}>{tierShort}</span>}
        </div>
        {event.dateStr && <div className={`text-xs ${t?.textDim || "text-gray-500"}`}>{event.dateStr}</div>}
        {event.start && !event.dateStr && <div className={`text-xs ${t?.textDim || "text-gray-500"}`}>{event.start.slice(5)}</div>}
      </div>
      <div className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: baseColor.primary, color: baseColor.text }}>
        {layer === "mice" ? "MICE" : layer === "sg" ? event.type?.split("/")[0]?.slice(0, 8) || "Event" : layer === "campaign" ? "1-GRP" : layer}
      </div>
    </button>
  );
}

// ─── MONTH VIEW ───

function MonthView({ t, activeHC, month, setMonth, events, layers, onDetail }) {
  const days = daysInMonth(month);
  const startDay = firstDayOfMonth(month);
  const offset = startDay === 0 ? 6 : startDay - 1;
  const isDay = t.name === "day";

  // Split events into dated (placed on specific days) and undated (shown as a banner above the grid).
  // Undated events have e.undated === true OR e.month set with no e.start (synthetic start/end may have been added by allEvents).
  // Defensive: we ALSO treat any event whose start === month-day-1 AND end === month-last-day as undated, since
  // that's the synthetic range allEvents creates from undated source events.
  const undatedEvents = useMemo(() => {
    const lastDay = days;
    const monthStart = `2026-${String(month + 1).padStart(2, "0")}-01`;
    const monthEnd = `2026-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return events.filter(e => {
      if (e.undated) return true;
      if (e.start === monthStart && e.end === monthEnd) return true; // synthetic whole-month range
      return false;
    });
  }, [events, days, month]);

  const dayEvents = useMemo(() => {
    const map = {};
    for (let d = 1; d <= days; d++) map[d] = [];
    const undatedIds = new Set(undatedEvents.map(e => e.id));
    events.forEach(e => {
      // Skip undated events — they go in the banner, not on specific days.
      if (undatedIds.has(e.id)) return;
      if (e.dateStr) {
        const parts = e.dateStr.replace(/ *\(.*\)/, "").split("-");
        const startD = parseInt(parts[0]);
        const endD = parts.length > 1 ? parseInt(parts[1]) : startD;
        for (let d = startD; d <= Math.min(endD, days); d++) {
          if (map[d]) map[d].push(e);
        }
      } else if (e.start) {
        const sd = parseInt(e.start.split("-")[2]);
        const ed = e.end ? parseInt(e.end.split("-")[2]) : sd;
        for (let d = sd; d <= Math.min(ed, days); d++) {
          if (map[d]) map[d].push(e);
        }
      } else if (e.month !== undefined) {
        if (map[1]) map[1].push(e);
      }
    });
    return map;
  }, [events, days, undatedEvents]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setMonth(Math.max(0, month - 1))} className={`p-2 ${t.surface} rounded-lg ${t.surfaceHover}`}><ChevronLeft className="w-4 h-4" /></button>
        <h2 className={`text-lg font-bold ${t.textHead}`}>{MONTH_NAMES[month]} 2026</h2>
        <button onClick={() => setMonth(Math.min(11, month + 1))} className={`p-2 ${t.surface} rounded-lg ${t.surfaceHover}`}><ChevronRight className="w-4 h-4" /></button>
      </div>
      {undatedEvents.length > 0 && (
        <div className={`mb-3 p-2 rounded-lg ${t.panel} border`}>
          <div className={`text-xs font-medium ${t.textDim} mb-1`}>Month-wide (no specific date)</div>
          <div className="flex flex-wrap gap-1">
            {undatedEvents.map(e => {
              const c = LAYER_COLORS[e.layer || "sg"];
              return (
                <button key={e.id} onClick={() => onDetail(e)}
                  className="text-xs px-2 py-1 rounded cursor-pointer truncate"
                  style={{ background: c.bg || c.primary + "20", color: c.primary, maxWidth: "200px" }}
                  title={e.name}>
                  {e.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Visitor intensity banner — gives at-a-glance market context for the month. Always visible when there's relevant data (independent of layer toggles). */}
      {(() => {
        const monthPeaks = getVisitorPeaks(month);
        const monthHighs = VISITOR_DATA.filter(v => v.data[MONTH_SHORT[month]] === "High").map(v => v.market);
        if (monthPeaks.length === 0 && monthHighs.length === 0) return null;
        return (
          <div className={`mb-3 p-2.5 rounded-lg border ${isDay ? "bg-emerald-50 border-emerald-200" : "bg-emerald-950/30 border-emerald-800/50"}`}>
            <div className="flex items-start gap-2 flex-wrap">
              <Users className={`w-4 h-4 ${isDay ? "text-emerald-700" : "text-emerald-400"} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs ${isDay ? "text-emerald-800" : "text-emerald-300"} font-semibold mb-1`}>Visitor intensity in {MONTH_NAMES[month]}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {monthPeaks.length > 0 && <span className={`text-xs ${isDay ? "text-emerald-700" : "text-emerald-400"} font-medium`}>Peak:</span>}
                  {monthPeaks.map(p => (
                    <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-emerald-600 text-white font-medium">{p}</span>
                  ))}
                  {monthHighs.length > 0 && <span className={`text-xs ${isDay ? "text-emerald-700" : "text-emerald-300"} font-medium ml-2`}>High:</span>}
                  {monthHighs.map(p => (
                    <span key={p} className={`text-xs px-2 py-0.5 rounded-full ${isDay ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-emerald-900/50 text-emerald-200 border border-emerald-700"}`}>{p}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="grid grid-cols-7 gap-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className={`text-center text-xs ${t.textDim} py-1 font-medium`}>{d}</div>
        ))}
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }).map((_, i) => {
          const d = i + 1;
          const key = dateStr(month, d);
          const hc = activeHC[key];
          const ph = isPublicHoliday(key);
          const sh = isSchoolHoliday(key);
          const evts = dayEvents[d] || [];
          const ratingColor = hc && LAYER_COLORS[hc.rating] ? LAYER_COLORS[hc.rating].soft || LAYER_COLORS[hc.rating].primary + "30" : "transparent";

          return (
            <div key={d}
              className={`min-h-20 rounded-lg p-1 ${t.borderHover} transition-colors cursor-pointer relative ${ph ? "border-2" : sh ? "border-2" : "border"} ${!ph && !sh ? t.panel : ""}`}
              style={{
                background: layers.hotcold && hc ? ratingColor : (ph ? "#FFFFFF" : sh ? "#FFFFFF" : undefined),
                borderColor: ph && layers.school ? "#EAB308" : sh && layers.school ? "#14B8A6" : undefined,
                boxShadow: ph && layers.school ? "0 0 0 1px #FEF08A inset" : sh && layers.school ? "0 0 0 1px #99F6E4 inset" : undefined,
              }}
              onClick={() => {
                if (evts.length > 0) {
                  // Attach the clicked date so DetailPanel can surface PH/SH for that specific day,
                  // even when the event spans multiple days that cross a holiday.
                  onDetail({ ...evts[0], _clickDate: key });
                  return;
                }
                if (ph || sh || (hc && hc.count > 0)) {
                  onDetail({
                    id: `date-${key}`,
                    isDateAnchor: true,
                    name: ph ? ph.name : sh ? `School Holiday — ${MONTH_NAMES[month]} ${d}` : `${MONTH_NAMES[month]} ${d}, 2026`,
                    start: key,
                    end: key,
                    _clickDate: key,
                    layer: ph ? "ph" : "sg",
                    type: ph ? "Public Holiday" : sh ? "School Holiday" : "Date Overview",
                  });
                }
              }}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className={`text-xs font-medium ${ph ? (isDay ? "text-amber-700" : "text-yellow-400") : t.textMuted}`}>{d}</span>
                  {/* Date-code dots — large and distinct, sit right next to day number */}
                  {DOUBLE_DIGIT_DATES.has(key) && <span className="rounded-full shrink-0" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.doubledigit, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} title="Double-digit date — promo-ready" />}
                  {CONFERENCE_DATES.has(key) && <span className="rounded-full shrink-0" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.conference, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} title="Major conference date" />}
                  {/* Sales-priority squares — yellow = 1-Host events sales, orange = Dining big-group */}
                  {evts.some(e => e.sales === "host") && <span className="rounded-sm shrink-0" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.host, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} title="1-Host Event Sales priority on this date" />}
                  {evts.some(e => e.sales === "dining") && <span className="rounded-sm shrink-0" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.dining, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} title="Dining Sales (big-group) priority on this date" />}
                </div>
                <div className="flex gap-0.5">
                  {ph && layers.school && <Star className={`w-2.5 h-2.5 ${isDay ? "text-amber-500" : "text-yellow-400"} fill-current`} />}
                  {layers.hotcold && hc && (hc.rating === "hot-hot" || hc.rating === "hot") && <Flame className="w-2.5 h-2.5" style={{ color: LAYER_COLORS[hc.rating].primary }} />}
                  {layers.hotcold && hc && (hc.rating === "cold-cold" || hc.rating === "cold") && <Snowflake className="w-2.5 h-2.5" style={{ color: LAYER_COLORS[hc.rating].primary }} />}
                </div>
              </div>
              {/* Public Holiday name — shown inside the cell, not just as an icon. Always visible when there's a PH (independent of layer toggles). */}
              {ph && (
                <div
                  className={`px-1 py-0.5 mb-0.5 rounded truncate font-semibold leading-tight ${isDay ? "bg-amber-100 text-amber-800" : "bg-amber-900/40 text-amber-300"}`}
                  style={{ fontSize: "9px" }}
                  title={`Public Holiday: ${ph.name}`}
                >
                  ★ {ph.name}
                </div>
              )}
              {layers.hotcold && hc && hc.count > 0 && (
                <div className="text-xs mb-0.5" style={{ color: LAYER_COLORS[hc.rating].primary, fontSize: "10px" }} title="1-Host events confirmed in Tripleseat">{hc.count} 1-Host {hc.count === 1 ? "event" : "events"}</div>
              )}
              <div className="space-y-0.5">
                {evts.slice(0, 2).map(e => {
                  const c = LAYER_COLORS[e.layer || "sg"];
                  return <div key={e.id} className="text-xs truncate px-1 rounded" style={{ background: isDay ? c.bg : c.primary + "30", color: c.primary, fontSize: "9px" }} title={e.name}>{e.name}</div>;
                })}
                {evts.length > 2 && <div className={`text-xs ${t.textDim}`} style={{ fontSize: "9px" }}>+{evts.length - 2}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── HEATMAP VIEW ───

function HeatmapView({ t, activeHC, activeVenue, layers, quarter, onDetail }) {
  const months = quarter === "all" ? [...Array(12).keys()] : QUARTERS[quarter];
  const isDay = t.name === "day";

  const venueHC = activeHC;
  const venue = activeVenue;

  const legendRatings = ["hot-hot", "hot", "cold", "cold-cold"];

  // When live Tripleseat counts are overlaid for this venue, recompute the
  // hot/cold day totals from them so the summary strip matches the grid.
  // Otherwise keep the venue's authored static summary unchanged.
  const summary = useMemo(() => {
    const isLive = Object.values(venueHC).some(d => d && d.live);
    if (!isLive) return venue.summary;
    const s = { hh: 0, h: 0, c: 0, cc: 0 };
    const map = { "hot-hot": "hh", hot: "h", cold: "c", "cold-cold": "cc" };
    for (const d of Object.values(venueHC)) { const k = map[d?.rating]; if (k) s[k]++; }
    return s;
  }, [venueHC, venue.summary]);

  return (
    <div>
      {/* Zone summary strip */}
      <div className={`mb-4 p-3 ${t.panel} border rounded-xl`}>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-600" />
            <span className={`font-semibold ${t.textHead}`}>{venue.name}</span>
            {venue.description && venue.description !== venue.name && <span className={`${t.textDim}`}>· {venue.description}</span>}
          </div>
          <div className="flex gap-2 ml-auto flex-wrap">
            {summary.hh > 0 && <span className="px-2 py-0.5 rounded" style={{ background: "#DC2626", color: "#fff" }}>{summary.hh} Hot-Hot</span>}
            {summary.h > 0 && <span className="px-2 py-0.5 rounded" style={{ background: "#F59E0B", color: "#fff" }}>{summary.h} Hot</span>}
            {summary.c > 0 && <span className="px-2 py-0.5 rounded" style={{ background: "#60A5FA", color: "#fff" }}>{summary.c} Cold</span>}
            {summary.cc > 0 && <span className="px-2 py-0.5 rounded" style={{ background: "#1E40AF", color: "#fff" }}>{summary.cc} Cold-Cold</span>}
          </div>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className={`overflow-x-auto ${t.panel} border rounded-xl p-4`}>
        <div className="min-w-[800px]">
          <div className="grid gap-2" style={{ gridTemplateColumns: `80px repeat(${months.length}, minmax(60px, 1fr))` }}>
            <div className={`text-xs ${t.textDim} font-medium py-1`}>Day</div>
            {months.map(mi => <div key={mi} className={`text-xs ${t.textMuted} font-medium py-1 text-center`}>{MONTH_SHORT[mi]}</div>)}
            {Array.from({ length: 31 }).map((_, di) => {
              const d = di + 1;
              return (
                <React.Fragment key={d}>
                  <div className={`text-xs ${t.textDim} py-0.5 text-right pr-2`}>{d}</div>
                  {months.map(mi => {
                    if (d > daysInMonth(mi)) return <div key={mi} />;
                    const key = dateStr(mi, d);
                    const hc = venueHC[key];
                    const ph = isPublicHoliday(key);
                    const sh = isSchoolHoliday(key);
                    const bg = hc ? LAYER_COLORS[hc.rating]?.primary || t.emptyCell : t.emptyCell;
                    const ratingLabel = hc ? LAYER_COLORS[hc.rating]?.label : "—";
                    const isDD = DOUBLE_DIGIT_DATES.has(key);
                    const isConf = CONFERENCE_DATES.has(key);
                    return (
                      <div key={mi} className="h-6 rounded-sm relative group cursor-pointer flex items-center justify-center"
                        style={{ background: layers.hotcold ? bg : t.emptyCell, border: ph && layers.school ? "2px solid #EAB308" : sh && layers.school ? "2px solid #14B8A6" : "1px solid transparent" }}
                        onClick={() => {
                          if (!onDetail) return;
                          if (ph || sh || (hc && hc.count > 0)) {
                            onDetail({
                              id: `date-${key}`,
                              isDateAnchor: true,
                              name: ph ? ph.name : sh ? `School Holiday — ${MONTH_SHORT[mi]} ${d}` : `${MONTH_SHORT[mi]} ${d}, 2026`,
                              start: key,
                              end: key,
                              _clickDate: key,
                              layer: ph ? "ph" : "sg",
                              type: ph ? "Public Holiday" : sh ? "School Holiday" : "Date Overview",
                            });
                          }
                        }}>
                        {ph && layers.school && <Star className="w-2 h-2 text-yellow-400 fill-yellow-400" />}
                        {hc && hc.count > 0 && <span className="text-xs font-bold" style={{ fontSize: "9px", color: hc ? "#ffffffE6" : undefined }}>{hc.count}</span>}
                        {/* Date-code dots stacked top-left (5px wide) */}
                        {(isDD || isConf) && (
                          <span className="absolute top-0 left-0 flex gap-0.5 m-0.5">
                            {isDD && <span className="rounded-full" style={{ width: "5px", height: "5px", background: DATE_CODE_COLORS.doubledigit }} />}
                            {isConf && <span className="rounded-full" style={{ width: "5px", height: "5px", background: DATE_CODE_COLORS.conference }} />}
                          </span>
                        )}
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1 ${t.tooltipBg} border rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity shadow-xl`}>
                          <div className="font-bold">{MONTH_SHORT[mi]} {d}, 2026</div>
                          <div className={t.textMuted}>{venue.shortName}</div>
                          <div style={{ color: LAYER_COLORS[hc?.rating]?.primary || (isDay ? "#64748b" : "#888") }}>{ratingLabel} · {hc?.count || 0} 1-Host event{hc?.count === 1 ? "" : "s"}</div>
                          {isDD && <div style={{ color: DATE_CODE_COLORS.doubledigit }}>● Double-digit date</div>}
                          {isConf && <div style={{ color: DATE_CODE_COLORS.conference }}>● Conference date</div>}
                          {ph && <div className={isDay ? "text-amber-700" : "text-yellow-400"}>⭐ {ph.name}</div>}
                          {sh && <div className={isDay ? "text-teal-700" : "text-teal-400"}>🎓 School Holiday</div>}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className={`flex items-center gap-4 mt-4 flex-wrap pt-3 border-t ${t.border}`}>
          {legendRatings.map(r => (
            <div key={r} className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-sm" style={{ background: LAYER_COLORS[r].primary }} />
              <span className={`text-xs ${t.textMuted}`}>{LAYER_COLORS[r].label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <Star className={`w-3.5 h-3.5 ${isDay ? "text-amber-500" : "text-yellow-400"} fill-current`} />
            <span className={`text-xs ${t.textMuted}`}>Public Holiday</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm border border-teal-400" />
            <span className={`text-xs ${t.textMuted}`}>School Holiday</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.doubledigit, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} />
            <span className="text-xs" style={{ color: DATE_CODE_COLORS.doubledigit }} title="1/1, 2/2 … 12/12 — promo-ready">Double-Digit Date</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.conference, boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }} />
            <span className="text-xs" style={{ color: DATE_CODE_COLORS.conference }} title="Major MICE conference period">Conference Date</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-sm" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.host, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />
            <span className="text-xs" style={{ color: "#A16207" }} title="Conferences likely to drive event-booking enquiries">Host Sales Priority</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-sm" style={{ width: "10px", height: "10px", background: SALES_SQUARE_COLORS.dining, boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />
            <span className="text-xs" style={{ color: "#C2410C" }} title="Conferences predicted to drive big-group dining bookings">Dining Sales Priority</span>
          </div>
          <div className={`ml-auto text-xs ${t.textDim}`}>
            Numbers show <span className={`${t.textHead} font-medium`}>1-Host events</span> per day (Tripleseat)
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DETAIL PANEL ───

function DetailPanel({ t, activeHC, hostEventsForZone, item, editOK, canEditEvent, onClose, onEdit, onDelete, onAddSimilar }) {
  const layer = item.layer || "sg";
  const color = LAYER_COLORS[layer] || LAYER_COLORS.sg;
  const canEdit = canEditEvent ? canEditEvent(item) : item.id?.startsWith("custom-");
  const isDateAnchor = item.isDateAnchor === true;

  // Anchor date for PH/SH/HC lookups. Priority:
  //   1) _clickDate — the specific day the user clicked (most reliable)
  //   2) item.start — fallback for events passed with their own start date
  const anchorDate = item._clickDate || item.start || null;
  const mi = item.month ?? (anchorDate ? getMonthIndex(anchorDate) : 0);
  const peaks = getVisitorPeaks(mi);
  const hcInfo = anchorDate ? activeHC[anchorDate] : null;

  // PH/SH check on the anchor date — strict (no fallback to range).
  // The day the user clicked either IS or IS NOT a public/school holiday.
  const phOnDate = anchorDate ? isPublicHoliday(anchorDate) : null;
  const shOnDate = anchorDate ? isSchoolHoliday(anchorDate) : false;

  // For multi-day events, also list OTHER public holidays that fall within the range
  // as supplementary context (e.g. "This event crosses: CNY Day 1"). This is never
  // used to claim the clicked day is itself a holiday.
  const otherPHsInRange = [];
  if (item.start && item.end && item.end !== item.start) {
    let cur = item.start;
    const maxIter = 400; // safety cap for long ranges
    let n = 0;
    while (cur <= item.end && n < maxIter) {
      if (cur !== anchorDate) {
        const p = isPublicHoliday(cur);
        if (p) otherPHsInRange.push({ date: cur, ph: p });
      }
      // increment date by one day
      const [y, m, d] = cur.split("-").map(Number);
      const nd = new Date(Date.UTC(y, m - 1, d + 1));
      cur = `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
      n++;
    }
  }
  const isDay = t.name === "day";

  // Decide the panel header label based on what was clicked
  const headerLabel = isDateAnchor
    ? (phOnDate ? "Public Holiday" : shOnDate ? "School Holiday" : "Date Overview")
    : layer === "mice" ? "MICE Event"
    : layer === "campaign" ? "1-Group Campaign"
    : "Event Detail";

  // PH block colour tuning for day/night
  const phBlockBg = isDay ? "bg-amber-50 border-amber-300" : "bg-amber-950/40 border-amber-700/60";
  const phText = isDay ? "text-amber-800" : "text-amber-300";
  const phSub = isDay ? "text-amber-700" : "text-amber-400/80";
  const shBlockBg = isDay ? "bg-teal-50 border-teal-300" : "bg-teal-950/40 border-teal-700/60";
  const shText = isDay ? "text-teal-800" : "text-teal-300";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div className={`relative w-full max-w-md ${t.panel} border-l overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <h3 className="font-bold text-sm" style={{ color: isDateAnchor ? (phOnDate ? "#EAB308" : shOnDate ? "#14B8A6" : color.primary) : color.primary }}>{headerLabel}</h3>
          <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <h2 className={`text-lg font-bold ${t.textHead}`}>{item.name}</h2>
            {item.tagline && <p className={`text-sm ${t.textMuted} italic mt-1`}>{item.tagline}</p>}
          </div>

          {/* Public Holiday prominent block — only when the clicked/anchor date IS a PH */}
          {phOnDate && (
            <div className={`rounded-lg p-3 border ${phBlockBg}`}>
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5" style={{ color: "#EAB308", fill: "#EAB308" }} />
                <h4 className={`text-sm font-bold ${phText}`}>{phOnDate.name}</h4>
              </div>
              <p className={`text-xs ${phSub} mt-1 ml-7`}>Singapore Public Holiday · {anchorDate || item.start}</p>
              {otherPHsInRange.length > 0 && (
                <div className={`mt-2 ml-7 text-xs ${phSub}`}>
                  Also within this range: {otherPHsInRange.map(p => `${p.ph.name} (${p.date})`).join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Supplementary block: event crosses PH(s) but clicked day isn't one */}
          {!phOnDate && otherPHsInRange.length > 0 && (
            <div className={`text-xs flex items-start gap-1.5 ${isDay ? "text-amber-700" : "text-amber-400"}`}>
              <Star className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#EAB308", fill: "#EAB308" }} />
              <span>
                This event spans {otherPHsInRange.length === 1 ? "a public holiday" : "public holidays"}:{" "}
                {otherPHsInRange.map(p => `${p.ph.name} (${p.date})`).join(", ")}
              </span>
            </div>
          )}

          {/* School Holiday block */}
          {shOnDate && !phOnDate && (
            <div className={`rounded-lg p-3 border ${shBlockBg}`}>
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" style={{ color: "#14B8A6" }} />
                <h4 className={`text-sm font-bold ${shText}`}>School Holiday</h4>
              </div>
              <p className={`text-xs ${isDay ? "text-teal-700" : "text-teal-400/80"} mt-1 ml-7`}>Singapore school term break</p>
            </div>
          )}
          {shOnDate && phOnDate && (
            <div className={`text-xs ${isDay ? "text-teal-700" : "text-teal-400"} flex items-center gap-1.5`}>
              <GraduationCap className="w-3.5 h-3.5" /> Falls within school holidays
            </div>
          )}

          {/* Priority tier banner — if event has a ⭐ tier from the Quick-Reference sheet */}
          {item.tier && !isDateAnchor && (
            <div className={`rounded-lg p-2.5 border ${isDay ? "bg-amber-50 border-amber-300" : "bg-amber-950/40 border-amber-700/60"}`}>
              <div className={`text-xs font-bold ${isDay ? "text-amber-900" : "text-amber-300"}`}>{item.tier}</div>
              <div className={`text-xs ${isDay ? "text-amber-700" : "text-amber-400/80"}`}>From 1-Group Priority Quick-Reference</div>
            </div>
          )}

          {/* Sales priority banner */}
          {item.sales && !isDateAnchor && (
            <div className="rounded-lg p-2.5 flex items-center gap-2 border" style={{
              background: LAYER_COLORS[item.sales].primary + "15",
              borderColor: LAYER_COLORS[item.sales].primary + "55",
            }}>
              {item.sales === "host" ? <Briefcase className="w-4 h-4 shrink-0" style={{ color: LAYER_COLORS.host.primary }} /> : <Utensils className="w-4 h-4 shrink-0" style={{ color: LAYER_COLORS.dining.primary }} />}
              <div>
                <div className="text-xs font-bold" style={{ color: LAYER_COLORS[item.sales].primary }}>
                  {item.sales === "host" ? "1-HOST EVENT SALES PRIORITY" : "DINING SALES PRIORITY"}
                </div>
                <div className={`text-xs ${t.textMuted}`}>
                  {item.sales === "host"
                    ? "Likely to drive event-booking enquiries — pursue actively"
                    : "Likely to drive big-group dining bookings — prep ops"}
                </div>
              </div>
            </div>
          )}

          {!isDateAnchor && (
            <div className="space-y-2 text-sm">
              {item.start && <div className="flex justify-between"><span className={t.textDim}>Dates</span><span className={t.textBody}>{item.start}{item.end && item.end !== item.start ? ` → ${item.end}` : ""}</span></div>}
              {item.dateStr && <div className="flex justify-between"><span className={t.textDim}>Date</span><span className={t.textBody}>{MONTH_NAMES[mi]} {item.dateStr}</span></div>}
              {item.venue && <div className="flex justify-between"><span className={t.textDim}>Venue</span><span className={`text-right ${t.textBody}`}>{item.venue}</span></div>}
              {item.subBrand && <div className="flex justify-between"><span className={t.textDim}>Sub-brand</span><span className={`text-right ${t.textBody}`}>{item.subBrand}</span></div>}
              {item.hook && <div className="flex justify-between"><span className={t.textDim}>Anchor</span><span className={`text-right ${t.textBody}`}>{item.hook}</span></div>}
              {item.undated && <div className="flex justify-between"><span className={t.textDim}>Timing</span><span className={`text-right italic ${t.textDim}`}>Month-wide (no specific date)</span></div>}
              {item.industry && <div className="flex justify-between gap-2"><span className={`${t.textDim} shrink-0`}>Industry / Type</span><span className={`text-right ${t.textBody}`}>{item.industry}</span></div>}
              {!item.industry && item.type && <div className="flex justify-between"><span className={t.textDim}>Type</span><span className={t.textBody}>{item.type}</span></div>}
              {item.cat && <div className="flex justify-between"><span className={t.textDim}>Category</span><span className={`text-right ${t.textBody}`}>{item.cat}</span></div>}
              <div className="flex justify-between"><span className={t.textDim}>Layer</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: color.primary, color: color.text }}>
                  {layer === "mice" ? "MICE" : layer === "sg" ? "SG Event" : layer === "campaign" ? "Campaign" : layer === "venue" ? "Venue Activity" : layer}
                </span>
              </div>
            </div>
          )}

          {/* "Why it matters" — strategic rationale from Priority Quick-Reference */}
          {!isDateAnchor && item.why && (
            <div className="rounded-lg p-3 border" style={{ background: isDay ? "#FEF3C7" : "rgba(146,64,14,0.15)", borderColor: isDay ? "#FCD34D" : "#92400E" }}>
              <h4 className="text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: isDay ? "#92400E" : "#FCD34D" }}>Why it matters</h4>
              <p className={`text-sm ${t.textBody}`}>{item.why}</p>
            </div>
          )}

          {/* Organiser block */}
          {!isDateAnchor && (item.organiser || item.contact || item.website || (item.emails && item.emails.length > 0)) && (
            <div className={`${t.surface} rounded-lg p-3 space-y-2`}>
              <h4 className={`text-xs font-bold ${t.textMuted} uppercase tracking-wide`}>Organiser</h4>
              {item.organiser && (
                <div className="flex gap-2 text-sm"><Briefcase className={`w-3.5 h-3.5 ${t.textDim} shrink-0 mt-0.5`} /><span className={t.textBody}>{item.organiser}</span></div>
              )}
              {item.contact && (
                <div className="flex gap-2 text-sm"><Phone className={`w-3.5 h-3.5 ${t.textDim} shrink-0 mt-0.5`} />
                  <a href={`tel:${item.contact.replace(/\s+/g, "")}`} className={isDay ? "text-blue-700 hover:underline" : "text-blue-400 hover:text-blue-300"}>{item.contact}</a>
                </div>
              )}
              {item.emails && item.emails.length > 0 && item.emails.map((em, i) => (
                <div key={i} className="flex gap-2 text-sm"><Mail className={`w-3.5 h-3.5 ${t.textDim} shrink-0 mt-0.5`} />
                  <a href={`mailto:${em}`} className={`break-all ${isDay ? "text-blue-700 hover:underline" : "text-blue-400 hover:text-blue-300"}`}>{em}</a>
                </div>
              ))}
              {item.website && (
                <div className="flex gap-2 text-sm"><Globe className={`w-3.5 h-3.5 ${t.textDim} shrink-0 mt-0.5`} />
                  <a href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noopener noreferrer" className={`break-all flex items-center gap-1 ${isDay ? "text-blue-700 hover:underline" : "text-blue-400 hover:text-blue-300"}`}>
                    {item.website}<ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Audience block */}
          {!isDateAnchor && item.participants && (
            <div className={`${t.surface} rounded-lg p-3`}>
              <h4 className={`text-xs font-bold ${t.textMuted} uppercase tracking-wide mb-1`}>Key Participants / Audience</h4>
              <p className={`text-sm ${t.textBody}`}>{item.participants}</p>
            </div>
          )}

          {/* Notes block */}
          {!isDateAnchor && item.notes && (
            <div className={`${t.surface} rounded-lg p-3`}>
              <h4 className={`text-xs font-bold ${t.textMuted} uppercase tracking-wide mb-1 flex items-center gap-1`}>
                <FileText className="w-3 h-3" /> Notes
              </h4>
              <p className={`text-sm ${t.textBody} whitespace-pre-wrap`}>{item.notes}</p>
            </div>
          )}

          {/* Date code badge — when day falls on a coded date */}
          {(() => {
            const d = item._clickDate || item.start;
            if (!d) return null;
            const isDD = DOUBLE_DIGIT_DATES.has(d);
            const isConf = CONFERENCE_DATES.has(d);
            if (!isDD && !isConf) return null;
            return (
              <div className="space-y-1">
                {isDD && (
                  <div className="rounded-lg p-2.5 border flex items-center gap-2" style={{ background: DATE_CODE_COLORS.doubledigit + "15", borderColor: DATE_CODE_COLORS.doubledigit + "55" }}>
                    <span className="rounded-full shrink-0" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.doubledigit }} />
                    <div>
                      <div className="text-xs font-bold" style={{ color: DATE_CODE_COLORS.doubledigit }}>Double-Digit Date</div>
                      <div className={`text-xs ${t.textMuted}`}>1/1, 2/2 … 12/12 — natural promotional anchor</div>
                    </div>
                  </div>
                )}
                {isConf && (
                  <div className="rounded-lg p-2.5 border flex items-center gap-2" style={{ background: DATE_CODE_COLORS.conference + "15", borderColor: DATE_CODE_COLORS.conference + "55" }}>
                    <span className="rounded-full shrink-0" style={{ width: "10px", height: "10px", background: DATE_CODE_COLORS.conference }} />
                    <div>
                      <div className="text-xs font-bold" style={{ color: DATE_CODE_COLORS.conference }}>Major Conference Date</div>
                      <div className={`text-xs ${t.textMuted}`}>Significant MICE activity in town — high revenue potential</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {isDateAnchor && item.start && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className={t.textDim}>Date</span><span className={t.textBody}>{item.start}</span></div>
            </div>
          )}

          {hcInfo && (
            <div className={`${t.surface} rounded-lg p-3`}>
              <h4 className={`text-xs font-bold ${t.textMuted} mb-1`}>1-Host Event Demand on this Date (Tripleseat)</h4>
              <div className="flex items-center gap-2">
                {(hcInfo.rating === "hot-hot" || hcInfo.rating === "hot") ? <Flame className="w-4 h-4" style={{ color: LAYER_COLORS[hcInfo.rating].primary }} /> : <Snowflake className="w-4 h-4" style={{ color: LAYER_COLORS[hcInfo.rating].primary }} />}
                <span className="text-sm font-medium" style={{ color: LAYER_COLORS[hcInfo.rating].primary }}>{LAYER_COLORS[hcInfo.rating].label}</span>
                <span className={`text-xs ${t.textDim}`}>({hcInfo.count} 1-Host event{hcInfo.count === 1 ? "" : "s"})</span>
              </div>
              {/* Per-event detail from Tripleseat (signed-in members only). */}
              {(() => {
                const list = (anchorDate && hostEventsForZone && hostEventsForZone[anchorDate]) || [];
                if (list.length === 0) return null;
                return (
                  <div className="mt-2 space-y-1.5">
                    {list.map((ev, i) => (
                      <div key={i} className={`rounded-md border ${t.border} px-2 py-1.5`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-medium ${t.textHead} truncate`}>{ev.client || "Private booking"}</span>
                          {ev.pax != null && ev.pax > 0 && <span className={`text-[11px] ${t.textDim} shrink-0`}>{ev.pax} pax</span>}
                        </div>
                        {(ev.type || ev.meal || ev.status) && (
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {ev.type && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.surfaceStrong} ${t.textBody}`}>{ev.type}</span>}
                            {ev.meal && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: ev.meal === "Lunch" ? "#FEF3C7" : "#E0E7FF", color: ev.meal === "Lunch" ? "#92400E" : "#3730A3" }}>{ev.meal}</span>}
                            {ev.status && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#DCFCE7", color: "#166534" }}>{ev.status}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {peaks.length > 0 && (
            <div className={`${t.surface} rounded-lg p-3`}>
              <h4 className={`text-xs font-bold ${t.textMuted} mb-1`}>Peak Visitor Markets in {MONTH_NAMES[mi]}</h4>
              <div className="flex flex-wrap gap-1">
                {peaks.map(p => <span key={p} className={`text-xs px-2 py-0.5 rounded ${isDay ? "bg-emerald-100 text-emerald-800" : "bg-emerald-900/50 text-emerald-300"}`}>{p}</span>)}
              </div>
            </div>
          )}

          {editOK && onAddSimilar && (
            <div className="pt-2">
              <button onClick={() => onAddSimilar(item)} className="flex items-center justify-center gap-1 bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-2 rounded-md w-full"><Plus className="w-3.5 h-3.5" /> Add Event</button>
            </div>
          )}

          {canEdit && editOK && (
            <div className="flex gap-2 pt-2">
              <button onClick={() => onEdit(item)} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-2 rounded-md flex-1"><Edit className="w-3.5 h-3.5" /> Edit</button>
              <button onClick={() => onDelete(item.id)} className="flex items-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs px-3 py-2 rounded-md flex-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EVENT FORM MODAL ───

function EventFormModal({ t, user, event, isPrefill, onSave, onClose }) {
  // Backward compat: if editing a legacy custom event with a display-name venue
  // (e.g. "1-Flowerhill"), map it back to its slug ("flowerhill") on load.
  const DISPLAY_TO_SLUG = {
    "The Summerhouse": "summerhouse", "The Garage": "garage", "1-Altitude Coast": "altitude",
    "1-Arden": "arden", "The Alkaff Mansion": "alkaff", "1-Alfaro": "alfaro",
    "1-Atico": "atico", "The Riverhouse": "riverhouse", "1-Flowerhill": "flowerhill", "Monti": "monti",
  };
  const normaliseVenue = (v) => DISPLAY_TO_SLUG[v] || v || "";

  // Venue-role constraints: outlet users can only add Venue Activity for their own venue(s).
  // - Single-venue users: venue dropdown is locked to their venue.
  // - Multi-venue users (e.g. mimi at altitude+flowerhill): dropdown limited to their venues.
  // - Layer is forced to "venue" (no SG / MICE / Campaign adds).
  const isVenueUser = user?.role === "venue";
  const venueUserVenues = isVenueUser
    ? (Array.isArray(user.venues) && user.venues.length > 0
        ? user.venues
        : (user.venue ? [user.venue] : []))
    : null;

  // All available venue options (slug, display) — used for non-venue users + filtered for venue users.
  const VENUE_OPTIONS = [
    ["summerhouse", "The Summerhouse"],
    ["garage", "The Garage"],
    ["altitude", "1-Altitude Coast"],
    ["arden", "1-Arden"],
    ["alkaff", "The Alkaff Mansion"],
    ["alfaro", "1-Alfaro"],
    ["atico", "1-Atico"],
    ["riverhouse", "The Riverhouse"],
    ["flowerhill", "1-Flowerhill"],
    ["monti", "Monti"],
  ];
  const allowedVenueOptions = isVenueUser
    ? VENUE_OPTIONS.filter(([slug]) => venueUserVenues.includes(slug))
    : VENUE_OPTIONS;

  const [form, setForm] = useState(event ? { ...event, venue: normaliseVenue(event.venue) } : {
    name: "",
    layer: isVenueUser ? "venue" : "sg",
    start: "2026-01-01",
    end: "2026-01-01",
    type: "",
    venue: isVenueUser && venueUserVenues[0] ? venueUserVenues[0] : "",
    cat: "", dateStr: "",
    subBrand: "", hook: "",
  });

  const handleSubmit = () => {
    if (!form.name) return;
    // All events require start/end. Editing an existing undated event will convert it
    // to dated (start/end now populated, undated flag stripped).
    const payload = { ...form };
    payload.month = getMonthIndex(payload.start);
    delete payload.undated; // stripped: form no longer offers undated option
    // Clean: remove empty-string optionals so JSON stays tidy.
    if (!payload.subBrand) delete payload.subBrand;
    if (!payload.hook) delete payload.hook;
    onSave(payload);
  };

  const inputCls = `w-full ${t.input} border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-purple-500`;
  const isVenue = form.layer === "venue";
  // Sub-brand options for the selected venue (only Flowerhill currently).
  const subBrandOptions = isVenue && form.venue && VENUE_SUBBRANDS[form.venue] ? VENUE_SUBBRANDS[form.venue] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.modalBg}`} />
      <div className={`relative ${t.panel} border rounded-xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <h3 className={`font-bold text-sm ${t.textHead}`}>{event && !isPrefill ? "Edit Event" : "Add Event"}</h3>
        {isVenueUser && (
          <div className="text-xs px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
            <Building2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>You're signed in as an outlet user. Events you add are scoped to <strong>{allowedVenueOptions.map(([,n]) => n).join(", ") || "your venue"}</strong> and saved as Venue Activity.</span>
          </div>
        )}
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Event name *" className={inputCls} />
        {isVenueUser ? (
          <div className={`${inputCls} flex items-center gap-2 ${t.textDim}`} style={{ cursor: "not-allowed", opacity: 0.75 }} title="Outlet users can only add Venue Activity">
            <Building2 className="w-3.5 h-3.5" /> Venue Activity
          </div>
        ) : (
          <select value={form.layer} onChange={e => setForm({ ...form, layer: e.target.value })} className={inputCls}>
            <option value="sg">SG Event</option>
            <option value="mice">MICE</option>
            <option value="campaign">Campaign</option>
            <option value="venue">Venue Activity</option>
          </select>
        )}
        <select
          value={form.venue || ""}
          onChange={e => setForm({ ...form, venue: e.target.value, subBrand: "" })}
          className={inputCls}
          disabled={isVenueUser && allowedVenueOptions.length === 1}
          title={isVenueUser && allowedVenueOptions.length === 1 ? "Locked to your assigned venue" : undefined}
        >
          {!isVenueUser && <option value="">— No venue —</option>}
          {allowedVenueOptions.map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
        {isVenue && subBrandOptions && (
          <select value={form.subBrand || ""} onChange={e => setForm({ ...form, subBrand: e.target.value })} className={inputCls}>
            <option value="">— No sub-brand —</option>
            {subBrandOptions.map(sb => <option key={sb} value={sb}>{sb}</option>)}
          </select>
        )}
        {isVenue && (
          <input value={form.hook || ""} onChange={e => setForm({ ...form, hook: e.target.value })} placeholder="Anchor / Hook (e.g. Mother's Day · 1G20)" className={inputCls} />
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={`text-xs ${t.textDim}`}>Start</label>
            <input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={`text-xs ${t.textDim}`}>End</label>
            <input type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} className={inputCls} />
          </div>
        </div>
        {!isVenue && (
          <input value={form.type || ""} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="Type (Concert, Trade Show, etc.)" className={inputCls} />
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className={`flex-1 ${t.surfaceStrong} ${t.surfaceStrongHover} text-sm py-2 rounded-md`}>Cancel</button>
          <button onClick={handleSubmit} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-sm py-2 rounded-md flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" /> Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── SIGN-IN PAGE ───

function SignIn({ t, onSignIn }) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("email"); // 'email' (request code) | 'code' (enter code)
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [sentMsg, setSentMsg] = useState(null);

  // Step 1 — request a one-time code.
  const requestCode = async () => {
    setErr(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[a-z0-9._+-]+@1-group\.sg$/i.test(trimmed)) {
      setErr("Enter your @1-group.sg email address.");
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErr(data.error || "Could not send code. Please try again.");
        return;
      }
      setChallenge(data.challenge);
      setSentMsg(`Code sent to ${trimmed}. Check your inbox (and spam folder).`);
      setStep("code");
    } catch (e) {
      setErr("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  // Step 2 — verify the code.
  const verifyCode = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) { setErr("Code must be 6 digits."); return; }
    if (!challenge) { setErr("No active code request. Request a new code."); setStep("email"); return; }
    setBusy(true);
    try {
      const resp = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim(), challenge }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErr(data.error || "Verification failed. Please try again.");
        setBusy(false);
        return;
      }
      try { localStorage.setItem("calendar-otp-session", data.sessionToken); } catch {}
      onSignIn(data.user);
    } catch (e) {
      setErr("Network error. Please check your connection and try again.");
      setBusy(false);
    }
  };

  const reset = () => { setStep("email"); setCode(""); setChallenge(null); setSentMsg(null); setErr(null); };
  const onKey = (fn) => (e) => { if (e.key === "Enter") fn(); };

  return (
    <div className={`min-h-screen ${t.page} flex items-center justify-center p-4`} style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ background: t.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            1-Group Marketing Calendar
          </h1>
          <p className={`text-sm ${t.tagline}`}>2026 Edition · Demand · Events · Opportunities</p>
        </div>

        {/* Card */}
        <div className={`${t.panel} border rounded-xl p-6 shadow-sm`}>
          <div className="flex items-center gap-2 mb-4">
            <Lock className={`w-4 h-4 ${t.textMuted}`} />
            <h2 className={`text-sm font-semibold ${t.textHead}`}>Sign in with your 1-Group email</h2>
          </div>

          {step === "email" ? (
            <>
              <p className={`text-xs ${t.textMuted} mb-3 leading-relaxed`}>
                Enter your <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">@1-group.sg</code> email and we'll send a
                6-digit sign-in code. Access and your view are set by the Marketing team — if you're not on the list yet, ask a master admin to add you.
              </p>
              <label className={`text-xs ${t.textMuted} block mb-1`}>1-Group email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={onKey(requestCode)}
                placeholder="firstname.lastname@1-group.sg"
                autoFocus
                disabled={busy}
                className={`w-full ${t.input} border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-purple-500 mb-3`}
              />
              <button
                onClick={requestCode}
                disabled={busy || !email.trim()}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm py-2 rounded-md font-medium flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" /> {busy ? "Sending…" : "Send sign-in code"}
              </button>
            </>
          ) : (
            <>
              {sentMsg && (
                <div className="mb-3 flex items-start gap-2 p-2.5 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{sentMsg}</span>
                </div>
              )}
              <label className={`text-xs ${t.textMuted} block mb-1`}>6-digit code from your email</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={onKey(verifyCode)}
                placeholder="123456"
                autoFocus
                disabled={busy}
                className={`w-full ${t.input} border rounded-md px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:border-purple-500 mb-3`}
              />
              <button
                onClick={verifyCode}
                disabled={busy || code.length !== 6}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm py-2 rounded-md font-medium flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> {busy ? "Verifying…" : "Verify and sign in"}
              </button>
              <button
                onClick={reset}
                disabled={busy}
                className={`w-full text-xs ${t.textMuted} hover:${t.textBody} mt-2 underline-offset-2 hover:underline`}
              >
                Use a different email
              </button>
            </>
          )}

          {err && (
            <div className="mt-3 flex items-start gap-2 p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-800">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <p className={`text-xs ${t.textDim} text-center mt-6`}>
          Internal tool · 1-Group Singapore
        </p>
      </div>
    </div>
  );
}

// ─── VENUE CODES PANEL (admins only) ───

// ─── TARGET SHEET UPLOAD & ENRICHMENT ───
// A team member uploads their own target/forecast workbook (e.g. a 3-month daily
// target sheet). We attach the 2026 marketing-calendar context — demand heat map,
// holidays, SG/MICE events, campaigns, venue activities, visitor peaks — as extra
// columns to the right of each date-based tab, then hand back the enriched file.
// The transform is non-destructive: existing values/formulas/formatting are kept.
function TargetSheetUpload({ t, defaultZone, venueKeys, onClose }) {
  const [zone, setZone] = useState(defaultZone || "group");
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | working | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  // Kept in sync with FRONT_COLUMNS / TAIL_COLUMNS in src/lib/enrichTargetSheet.js.
  // Duplicated here (rather than imported) so the heavy ExcelJS-backed module
  // stays lazily loaded and out of the main bundle until the user actually runs it.
  // Inserted right after the Date column:
  const FRONT_ADDED = ["Demand (Hot/Cold)"];
  // Appended at the far right:
  const TAIL_ADDED = ["SG Events", "MICE Events", "Visitor Peaks", "1-Group Campaigns", "Venue Activities"];

  const zones = (Array.isArray(venueKeys) && venueKeys.length ? venueKeys : VENUE_KEYS);

  const pickFile = (f) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setError("Please choose an .xlsx file (Excel workbook).");
      setPhase("error");
      setFile(null);
      return;
    }
    setError("");
    setPhase("idle");
    setResult(null);
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setPhase("working");
    setError("");
    setResult(null);
    try {
      // Lazy import keeps ExcelJS + calendar data out of the initial page load.
      const { enrichTargetWorkbook } = await import("./lib/enrichTargetSheet.js");
      const arrayBuffer = await file.arrayBuffer();
      const { buffer, sheets, totalRows } = await enrichTargetWorkbook(arrayBuffer, { zone });

      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const base = file.name.replace(/\.xlsx$/i, "");
      const filename = `${base}__1Group_Calendar_2026.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setResult({ sheets, totalRows, filename });
      setPhase("done");
    } catch (e) {
      console.error("Target sheet enrichment failed:", e);
      setError(e?.message || "Could not process this file. Please check it is a valid .xlsx workbook.");
      setPhase("error");
    }
  };

  const zoneLabel = (z) => (z === "group" ? "1-Group (all venues)" : (VENUE_HC_RAW[z]?.name || z));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div className={`relative ${t.panel} border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
            <h3 className={`font-bold text-sm ${t.textHead}`}>Enrich Your Target Sheet</h3>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <p className={`text-xs ${t.textMuted}`}>
            Upload your Excel target sheet and the app folds the 2026 marketing calendar into every
            date-based tab, keyed off each daily date. Your existing numbers and formulas are
            preserved — the financial formulas are automatically re-pointed for the new columns, so
            every sum and total still works.
          </p>

          {/* Columns that will be added */}
          <div className={`rounded-lg border ${t.border} p-3 space-y-2`}>
            <div>
              <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>Inserted after the Date column</div>
              <div className="flex flex-wrap gap-1.5">
                {FRONT_ADDED.map(c => (
                  <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">{c}</span>
                ))}
              </div>
            </div>
            <div>
              <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>Appended at the far right</div>
              <div className="flex flex-wrap gap-1.5">
                {TAIL_ADDED.map(c => (
                  <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">{c}</span>
                ))}
              </div>
            </div>
            <p className={`text-[11px] ${t.textDim}`}>
              Public &amp; school holidays are merged into your existing <strong>Event</strong> column.
            </p>
          </div>

          {/* Zone selector */}
          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>
              Venue overlay (demand heat map &amp; venue activities)
            </label>
            <select
              value={zone}
              onChange={e => setZone(e.target.value)}
              className={`${t.input} border rounded-md px-2 py-1.5 text-xs w-full focus:outline-none focus:border-indigo-500`}
            >
              {zones.map(z => (
                <option key={z} value={z}>{zoneLabel(z)}</option>
              ))}
            </select>
            <p className={`text-[11px] ${t.textDim} mt-1`}>
              Holidays, SG &amp; MICE events, campaigns and visitor peaks are group-wide. The Hot/Cold demand
              heat map and venue activities follow the venue you pick here.
            </p>
          </div>

          {/* File picker */}
          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>Target workbook (.xlsx)</label>
            <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed ${t.borderSoft} ${t.surfaceHover} px-3 py-3 text-xs ${t.textBody}`}>
              <Upload className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose an .xlsx file to upload…"}</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={e => pickFile(e.target.files?.[0])}
              />
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border text-xs" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#991B1B" }}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {phase === "done" && result && (
            <div className="p-3 rounded-lg border text-xs" style={{ borderColor: "#6EE7B7", background: "#ECFDF5", color: "#065F46" }}>
              <div className="flex items-center gap-2 font-semibold mb-1">
                <Check className="w-4 h-4" /> Downloaded {result.filename}
              </div>
              <div>
                Enriched {result.sheets.length} tab{result.sheets.length === 1 ? "" : "s"} ({result.totalRows} day rows):{" "}
                {result.sheets.map(s => `${s.name} (${s.rows})`).join(", ")}.
              </div>
              <div className="mt-1 opacity-80">Only 2026 dates carry calendar data; any 2027 rows are left blank.</div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className={`text-xs px-3 py-1.5 rounded-md ${t.surfaceStrong} ${t.surfaceStrongHover}`}>
              {phase === "done" ? "Close" : "Cancel"}
            </button>
            <button
              onClick={run}
              disabled={!file || phase === "working"}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-white ${(!file || phase === "working") ? "bg-indigo-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500"}`}
            >
              {phase === "working"
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                : <><Download className="w-3.5 h-3.5" /> Add Calendar &amp; Download</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VENUE CALENDAR IMPORT ───
// Upload a venue's own month × sub-brand marketing-calendar workbook; the app
// parses each activation and shows a review list (confident vs. needs-a-look)
// BEFORE anything is written. The user picks the target venue, previews, then
// loads the selected activities into the venue-activity layer. Parsing lives in
// src/lib/importVenueCalendar.js (lazily imported to keep ExcelJS off the main bundle).
function VenueCalendarImport({ t, defaultZone, venueKeys, onImport, onClose }) {
  const initialVenue = defaultZone && defaultZone !== "group" ? defaultZone : null;
  const zones = (Array.isArray(venueKeys) && venueKeys.length ? venueKeys : VENUE_KEYS).filter(z => z !== "group");
  const [venue, setVenue] = useState(initialVenue || zones[0] || "");
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | working | preview | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState({}); // id -> bool (which records to load)

  const venueName = (z) => (VENUE_HC_RAW[z]?.name || z);

  const pickFile = (f) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setError("Please choose an .xlsx file (Excel workbook)."); setPhase("error"); setFile(null); return;
    }
    setError(""); setPhase("idle"); setResult(null); setFile(f);
  };

  const run = async () => {
    if (!file || !venue) return;
    setPhase("working"); setError(""); setResult(null);
    try {
      const { importVenueCalendar } = await import("./lib/importVenueCalendar.js");
      const arrayBuffer = await file.arrayBuffer();
      const res = await importVenueCalendar(arrayBuffer, { venue, venueName: venueName(venue) });
      // Pre-select clean events; leave flagged ones unchecked for a deliberate decision.
      const sel = {};
      res.events.forEach(e => { sel[e.id] = true; });
      res.flagged.forEach(e => { sel[e.id] = false; });
      setSelected(sel);
      setResult(res);
      setPhase("preview");
    } catch (e) {
      console.error("Venue calendar import failed:", e);
      setError(e?.message || "Could not read this workbook. Please check it is a valid .xlsx file.");
      setPhase("error");
    }
  };

  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const allRecords = result ? [...result.events, ...result.flagged] : [];
  const chosenCount = allRecords.filter(r => selected[r.id]).length;

  const loadSelected = async () => {
    if (!result) return;
    const { toVenueEvent } = await import("./lib/importVenueCalendar.js");
    const toLoad = allRecords.filter(r => selected[r.id]).map(toVenueEvent);
    onImport(toLoad);
  };

  const whenLabel = (r) => {
    if (r.start && r.end) return r.start === r.end ? r.start : `${r.start} → ${r.end}`;
    if (r.undated && r.month != null) return `${MONTH_NAMES?.[r.month] || "Month " + (r.month + 1)} (all month)`;
    return "—";
  };

  const Row = ({ r, flaggedRow }) => (
    <label className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer ${t.surfaceHover}`}>
      <input type="checkbox" checked={!!selected[r.id]} onChange={() => toggle(r.id)} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-medium ${t.textBody} truncate`}>
          {r.name} {r.subBrand && <span className={`${t.textDim} font-normal`}>· {r.subBrand}</span>}
        </div>
        <div className={`text-[11px] ${t.textDim}`}>{whenLabel(r)}{r.hook ? ` · ${r.hook}` : ""}</div>
        {flaggedRow && r._flags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {r._flags.map((f, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#FEF3C7", color: "#92400E" }}>⚑ {f}</span>
            ))}
          </div>
        )}
      </div>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div className={`relative ${t.panel} border rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-teal-600" />
            <h3 className={`font-bold text-sm ${t.textHead}`}>Import Venue Marketing Calendar</h3>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <p className={`text-xs ${t.textMuted}`}>
            Upload a venue's own marketing-calendar workbook (a month × sub-brand grid). The app reads
            each month's activations into venue activities for this venue. Nothing is saved until you
            review the list below and click <strong>Load</strong>. Internal lanes (Memo / Media / Ad-hoc)
            are skipped; items needing a human decision are flagged.
          </p>

          {phase !== "preview" && (
            <>
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>Target venue</label>
                <select value={venue} onChange={e => setVenue(e.target.value)} className={`${t.input} border rounded-md px-2 py-1.5 text-xs w-full focus:outline-none focus:border-teal-500`}>
                  {zones.map(z => <option key={z} value={z}>{venueName(z)}</option>)}
                </select>
              </div>

              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1.5`}>Marketing calendar (.xlsx)</label>
                <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed ${t.borderSoft} ${t.surfaceHover} px-3 py-3 text-xs ${t.textBody}`}>
                  <Upload className="w-4 h-4 text-teal-600 shrink-0" />
                  <span className="truncate">{file ? file.name : "Choose an .xlsx file to upload…"}</span>
                  <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border text-xs" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#991B1B" }}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {phase === "preview" && result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Ready", result.summary.clean, "#059669"], ["Needs review", result.summary.flagged, "#D97706"], ["Lanes skipped", result.summary.skippedLanes, "#64748B"]].map(([lab, val, col]) => (
                  <div key={lab} className={`rounded-lg border ${t.border} p-2`}>
                    <div className="text-lg font-bold" style={{ color: col }}>{val}</div>
                    <div className={`text-[10px] uppercase tracking-wider ${t.textDim}`}>{lab}</div>
                  </div>
                ))}
              </div>
              <div className={`text-[11px] ${t.textDim}`}>Importing into <strong>{venueName(result.venue)}</strong> from sheet “{result.sheet}”.</div>

              {result.events.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1`}>Ready to import ({result.events.length})</div>
                  <div className={`rounded-lg border ${t.border} divide-y ${t.divide} max-h-52 overflow-y-auto`}>
                    {result.events.map(r => <Row key={r.id} r={r} />)}
                  </div>
                </div>
              )}

              {result.flagged.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-1`}>Needs review — unchecked by default ({result.flagged.length})</div>
                  <div className={`rounded-lg border ${t.border} divide-y ${t.divide} max-h-52 overflow-y-auto`}>
                    {result.flagged.map(r => <Row key={r.id} r={r} flaggedRow />)}
                  </div>
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className={`text-[11px] ${t.textDim}`}>
                  Skipped lanes: {result.skipped.map(s => s.lane).join(", ")}.
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className={`text-xs px-3 py-1.5 rounded-md ${t.surfaceStrong} ${t.surfaceStrongHover}`}>Cancel</button>
            {phase === "preview"
              ? (
                <button onClick={loadSelected} disabled={!chosenCount}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-white ${!chosenCount ? "bg-teal-300 cursor-not-allowed" : "bg-teal-600 hover:bg-teal-500"}`}>
                  <Check className="w-3.5 h-3.5" /> Load {chosenCount} activit{chosenCount === 1 ? "y" : "ies"}
                </button>
              )
              : (
                <button onClick={run} disabled={!file || !venue || phase === "working"}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-white ${(!file || !venue || phase === "working") ? "bg-teal-300 cursor-not-allowed" : "bg-teal-600 hover:bg-teal-500"}`}>
                  {phase === "working" ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading…</> : <><Search className="w-3.5 h-3.5" /> Preview activities</>}
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Decode the (already server-signed) OTP session token client-side, purely to
// read its expiry. We DON'T trust this for auth — the server re-verifies the
// HMAC on every privileged call — we only use it to give the user a clear,
// actionable message when their token has expired, instead of a confusing
// "Master admin access required." (which really means "your token lapsed").
function decodeSessionToken(token) {
  try {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    let b64 = token.slice(0, token.lastIndexOf(".")).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(
      atob(b64).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch { return null; }
}

// A signed-in master whose secure token is missing/expired needs to re-verify.
const REAUTH_MSG = "Your secure admin session has expired — these last 12 hours for security. You're still a master admin; just sign in again to refresh it, then reopen this panel.";

// ─── MEMBER SETTINGS PANEL (master admins only) ───
// Master admins grant / revoke / re-tier access here. Reads and writes the
// server-side allowlist via /api/admin/members, authenticated by the caller's
// signed session token. Changes take effect at each member's next sign-in.
function MemberSettingsPanel({ t, currentUser, onClose, onSignOut }) {
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ email: "", tier: "viewer", name: "", dept: "", venues: [] });

  const TIERS = [
    { key: "master", label: "Master", desc: "Full control + this panel", color: "#7c3aed" },
    { key: "editor", label: "Editor", desc: "View all · add & edit events", color: "#4f46e5" },
    { key: "viewer", label: "Viewer", desc: "View all · read-only", color: "#0891b2" },
    { key: "outlet", label: "Outlet", desc: "Their venue(s) only", color: "#d97706" },
  ];
  const tierMeta = (k) => TIERS.find(x => x.key === k) || { label: k, color: "#64748b" };
  const venueKeys = VENUE_KEYS.filter(v => v !== "group");

  const [needsReauth, setNeedsReauth] = useState(false);
  const scrollRef = useRef(null);

  const token = (() => { try { return localStorage.getItem("calendar-otp-session"); } catch { return null; } })();
  // Is the secure token missing or already expired? If so, every privileged call
  // will 401 with "Master admin access required." even though the caller really
  // is a master — so we surface the real cause (a lapsed session) instead.
  const tokenPayload = decodeSessionToken(token);
  const tokenExpired = !token || !tokenPayload ||
    (typeof tokenPayload.expiresAt === "number" && Date.now() > tokenPayload.expiresAt);

  const call = async (action, payload = {}) => {
    const resp = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // A 401 for someone whose local profile is master means the token lapsed,
      // not that they lack permission — give the actionable re-verify message.
      if (resp.status === 401 && currentUser?.role === "master") {
        setNeedsReauth(true);
        const e = new Error(REAUTH_MSG); e.reauth = true; throw e;
      }
      throw new Error(data.error || "Request failed.");
    }
    return data;
  };

  const load = async () => {
    setLoading(true); setErr("");
    // Short-circuit if we already know the token is gone/expired: skip the
    // doomed request and tell the master to re-verify.
    if (tokenExpired && currentUser?.role === "master") {
      setNeedsReauth(true); setErr(REAUTH_MSG); setLoading(false); return;
    }
    try { const d = await call("list"); setMembers(d.members); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const upsert = async (member) => {
    setBusy(true); setErr("");
    try { const d = await call("upsert", { email: member.email, member }); setMembers(d.members); return true; }
    catch (e) { setErr(e.message); return false; }
    finally { setBusy(false); }
  };
  const remove = async (email) => {
    if (!confirm(`Remove ${email}?\n\nThey'll lose access the next time they try to sign in.`)) return;
    setBusy(true); setErr("");
    try { const d = await call("remove", { email }); setMembers(d.members); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const resetForm = () => setForm({ email: "", tier: "viewer", name: "", dept: "", venues: [] });
  const editRow = (m) => {
    setForm({ email: m.email, tier: m.tier, name: m.name || "", dept: m.dept || "", venues: [...(m.venues || [])] });
    setErr("");
    // The add/edit form sits at the top of the modal; when a master clicks Edit
    // from further down the member list, scroll it back into view so the click
    // has a visible effect (otherwise it looks like nothing happened).
    try { scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* older browsers */ }
  };
  const toggleVenue = (v) => setForm(f => ({ ...f, venues: f.venues.includes(v) ? f.venues.filter(x => x !== v) : [...f.venues, v] }));

  const save = async () => {
    const email = form.email.trim().toLowerCase();
    if (!/^[a-z0-9._+-]+@1-group\.sg$/i.test(email)) { setErr("Enter a valid @1-group.sg email address."); return; }
    if (form.tier === "outlet" && form.venues.length === 0) { setErr("Pick at least one venue for an Outlet member."); return; }
    const ok = await upsert({ email, tier: form.tier, name: form.name.trim(), dept: form.dept.trim(), venues: form.tier === "outlet" ? form.venues : [] });
    if (ok) resetForm();
  };

  const existingEmails = new Set((members || []).map(m => m.email));
  const isEditing = existingEmails.has(form.email.trim().toLowerCase());
  const q = search.trim().toLowerCase();
  const filtered = (members || []).filter(m => !q || m.email.includes(q) || (m.name || "").toLowerCase().includes(q));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div ref={scrollRef} className={`relative ${t.panel} border rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <h3 className={`font-bold text-sm ${t.textHead}`}>Members &amp; Access</h3>
            {members && <span className={`text-xs ${t.textDim}`}>· {members.length} people</span>}
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Add / edit form */}
          <div className={`rounded-lg border ${t.border} p-3`}>
            <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.textDim} mb-2`}>
              {isEditing ? "Update member" : "Add a team member"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="firstname.lastname@1-group.sg"
                className={`${t.input} border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 sm:col-span-2`}
              />
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Name (optional)"
                className={`${t.input} border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500`}
              />
              <input
                value={form.dept}
                onChange={e => setForm(f => ({ ...f, dept: e.target.value }))}
                placeholder="Department (optional)"
                className={`${t.input} border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500`}
              />
            </div>
            {/* Tier picker */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TIERS.map(tier => (
                <button
                  key={tier.key}
                  onClick={() => setForm(f => ({ ...f, tier: tier.key }))}
                  title={tier.desc}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${form.tier === tier.key ? "text-white" : `${t.textBody} ${t.chipInactiveBorder}`}`}
                  style={form.tier === tier.key ? { background: tier.color, borderColor: tier.color } : {}}
                >
                  {tier.label}
                </button>
              ))}
            </div>
            <p className={`text-[11px] ${t.textDim} mt-1`}>{tierMeta(form.tier).desc}</p>
            {/* Venue picker (outlet only) */}
            {form.tier === "outlet" && (
              <div className="mt-2">
                <div className={`text-[11px] ${t.textMuted} mb-1`}>Venues this person can see:</div>
                <div className="flex flex-wrap gap-1.5">
                  {venueKeys.map(v => (
                    <button
                      key={v}
                      onClick={() => toggleVenue(v)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${form.venues.includes(v) ? "bg-amber-100 border-amber-400 text-amber-800" : `${t.chipInactiveBorder} ${t.textDim}`}`}
                    >
                      {VENUE_HC_RAW[v]?.shortName || v}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={save}
                disabled={busy || !form.email.trim()}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md text-white ${busy || !form.email.trim() ? "bg-indigo-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500"}`}
              >
                {isEditing ? <><Check className="w-3.5 h-3.5" /> Update access</> : <><Plus className="w-3.5 h-3.5" /> Grant access</>}
              </button>
              {form.email && (
                <button onClick={resetForm} className={`text-xs px-3 py-1.5 rounded-md ${t.surfaceStrong} ${t.surfaceStrongHover}`}>Clear</button>
              )}
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 rounded-lg border text-xs" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#991B1B" }}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <span>{err}</span>
                {needsReauth && onSignOut && (
                  <div className="mt-2">
                    <button
                      onClick={() => { onClose?.(); onSignOut(); }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md text-white bg-red-600 hover:bg-red-500"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Sign in again
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className={`absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${t.textDim}`} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…" className={`${t.input} border rounded-md pl-7 pr-3 py-1.5 text-xs w-full focus:outline-none focus:border-indigo-500`} />
          </div>

          {/* Member list grouped by tier */}
          {loading ? (
            <div className={`text-sm ${t.textDim} py-6 text-center animate-pulse`}>Loading members…</div>
          ) : (
            TIERS.map(tier => {
              const rows = filtered.filter(m => m.tier === tier.key);
              if (rows.length === 0) return null;
              return (
                <div key={tier.key}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: tier.color + "22", color: tier.color }}>{tier.label}</span>
                    <span className={`text-[11px] ${t.textDim}`}>{rows.length}</span>
                  </div>
                  <div className={`rounded-lg border ${t.border} divide-y ${t.divide} mb-1`}>
                    {rows.map(m => (
                      <div key={m.email} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className={`text-xs font-medium ${t.textBody} truncate`}>
                            {m.name || m.email.split("@")[0]}
                            {m.email === currentUser.email && <span className={`ml-1 text-[10px] ${t.textDim}`}>(you)</span>}
                          </div>
                          <div className={`text-[11px] ${t.textDim} truncate`}>
                            {m.email}{m.dept ? ` · ${m.dept}` : ""}
                            {m.tier === "outlet" && m.venues?.length ? ` · ${m.venues.map(v => VENUE_HC_RAW[v]?.shortName || v).join(", ")}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => editRow(m)} disabled={busy} className={`text-[11px] px-2 py-1 rounded ${t.surfaceStrong} ${t.surfaceStrongHover} flex items-center gap-1`}><Edit className="w-3 h-3" /> Edit</button>
                          <button onClick={() => remove(m.email)} disabled={busy || m.email === currentUser.email} className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 ${m.email === currentUser.email ? "opacity-40 cursor-not-allowed" : "text-red-600 hover:bg-red-50"}`}><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          <p className={`text-[11px] ${t.textDim} leading-relaxed`}>
            Access changes take effect at the member's next sign-in. Everyone signs in with a one-time code sent to their
            <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded mx-1">@1-group.sg</code> email — there are no passwords to manage.
          </p>
        </div>
      </div>
    </div>
  );
}

function VenueCodesPanel({ t, onClose }) {
  const [copied, setCopied] = useState(null);
  const copyCode = (code) => {
    try { navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1200); } catch {}
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div className={`relative ${t.panel} border rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-600" />
            <h3 className={`font-bold text-sm ${t.textHead}`}>Outlet Access Codes</h3>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-2">
          <div className={`p-3 rounded-lg border mb-3`} style={{ borderColor: "#FBBF24", background: "#FEF3C7" }}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#B45309" }} />
              <div className={`text-xs ${t.textBody}`}>
                <strong style={{ color: "#92400E" }}>These codes no longer authenticate sign-in.</strong> Outlet access has moved to email-based OTP. To grant a new outlet user access, open the <strong>Members</strong> panel, add their <code className="text-[11px] bg-white px-1 py-0.5 rounded border">@1-group.sg</code> email, set their access level to <strong>Outlet</strong> and pick their venue(s) — no code change needed. The codes below remain only as historical reference and may be removed in a future release.
              </div>
            </div>
          </div>
          <p className={`text-xs ${t.textMuted} mb-3`}>
            Historical outlet access codes (deprecated, kept for reference only):
          </p>
          {Object.entries(VENUE_ACCESS_CODES).map(([vkey, code]) => {
            const v = VENUE_HC_RAW[vkey];
            return (
              <div key={vkey} className={`flex items-center justify-between p-3 rounded-lg border ${t.border}`}>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-500" />
                  <span className={`text-sm font-medium ${t.textBody}`}>{v?.name || vkey}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono bg-slate-100 px-2 py-1 rounded tracking-wider">{code}</code>
                  <button
                    onClick={() => copyCode(code)}
                    className={`text-xs px-2 py-1 rounded ${copied === code ? "bg-emerald-100 text-emerald-700" : `${t.surfaceStrong} ${t.surfaceStrongHover}`} flex items-center gap-1`}
                  >
                    {copied === code ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ACCESS LOG PANEL (master only) ───
// Shows who has opened the calendar. Reads /api/log/list, which is gated by a
// passphrase (CALENDAR_LOG_KEY env var) — master/admin sign in client-side and
// have no server token, so the passphrase is the read gate.
function AccessLogPanel({ t, onClose }) {
  const [logKey, setLogKey] = useState("");
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [range, setRange] = useState("all");

  const load = async (passphrase) => {
    if (!passphrase) return;
    setBusy(true); setErr(null);
    try {
      const resp = await fetch("/api/log/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: passphrase }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErr(data.error || "Could not load the access log.");
        setBusy(false);
        return;
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setTotal(data.total || 0);
      setAuthed(true);
    } catch {
      setErr("Network error — please try again.");
    }
    setBusy(false);
  };

  const fmt = (ts) => {
    try {
      return new Date(ts).toLocaleString("en-SG", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
      });
    } catch { return String(ts); }
  };
  const roleLabel = (r) => ({
    master: "Master", admin: "Admin", staff: "Staff", user: "Group", venue: "Outlet",
  }[r] || r || "—");

  // Time-range filtering. Entries already include `ts` (epoch ms); the full
  // set (up to the latest 1000) is fetched once, so filtering is client-side.
  const RANGES = [
    { k: "1d", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
    { k: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
    { k: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
    { k: "all", label: "All", ms: Infinity },
  ];
  const rangeMs = RANGES.find(r => r.k === range)?.ms ?? Infinity;
  const rangeLabel = RANGES.find(r => r.k === range)?.label ?? "All";
  const shown = (entries || []).filter(
    e => rangeMs === Infinity || (Date.now() - (e.ts || 0)) <= rangeMs
  );
  // "Who has logged in" = unique people (by email, falling back to name).
  const uniquePeople = new Set(
    shown.map(e => String(e.email || e.name || "").trim().toLowerCase()).filter(Boolean)
  ).size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`absolute inset-0 ${t.overlayBg}`} />
      <div className={`relative ${t.panel} border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${t.panel} border-b p-4 flex items-center justify-between z-10`}>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-600" />
            <h3 className={`font-bold text-sm ${t.textHead}`}>Calendar Access Log</h3>
          </div>
          <div className="flex items-center gap-2">
            {authed && (
              <button onClick={() => load(logKey)} disabled={busy} className={`text-xs px-2 py-1 rounded ${t.surfaceStrong} ${t.surfaceStrongHover} flex items-center gap-1`}>
                <RotateCcw className="w-3 h-3" /> Refresh
              </button>
            )}
            <button onClick={onClose} className={`p-1 rounded-lg ${t.surfaceHover}`}><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {!authed && (
            <div className="space-y-3">
              <div className={`p-3 rounded-lg border text-xs ${t.textBody}`} style={{ borderColor: "#C4B5FD", background: "#F5F3FF" }}>
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#7C3AED" }} />
                  <span>Enter the access-log passphrase — the <code className="text-[11px] bg-white px-1 py-0.5 rounded border">CALENDAR_LOG_KEY</code> set in Vercel, known only to you.</span>
                </div>
              </div>
              <input
                type="password"
                value={logKey}
                onChange={e => setLogKey(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") load(logKey); }}
                placeholder="Access-log passphrase"
                className={`w-full ${t.input} border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-purple-500`}
                autoFocus
              />
              {err && <div className="text-xs text-red-600">{err}</div>}
              <button onClick={() => load(logKey)} disabled={busy || !logKey} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm py-2 rounded-md flex items-center justify-center gap-1">
                {busy ? "Checking…" : <><Eye className="w-3.5 h-3.5" /> View access log</>}
              </button>
            </div>
          )}

          {authed && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {RANGES.map(r => (
                  <button
                    key={r.k}
                    onClick={() => setRange(r.k)}
                    className={`text-xs px-2.5 py-1 rounded-md border ${
                      range === r.k
                        ? "bg-purple-600 text-white border-purple-600"
                        : `${t.surfaceStrong} ${t.surfaceStrongHover} ${t.border}`
                    }`}
                  >
                    {r.k === "all" ? "All time" : `Last ${r.label}`}
                  </button>
                ))}
              </div>
              <p className={`text-xs ${t.textMuted}`}>
                {range === "all"
                  ? <><span className={`font-semibold ${t.textBody}`}>{uniquePeople}</span> {uniquePeople === 1 ? "person" : "people"} · {shown.length} calendar open{shown.length === 1 ? "" : "s"} · newest first · most recent 1000 kept</>
                  : <><span className={`font-semibold ${t.textBody}`}>{uniquePeople}</span> {uniquePeople === 1 ? "person" : "people"} · {shown.length} open{shown.length === 1 ? "" : "s"} in the last {rangeLabel} · newest first</>}
              </p>
              {err && <div className="text-xs text-red-600">{err}</div>}
              {entries && entries.length === 0 && (
                <div className={`text-xs ${t.textMuted} py-8 text-center`}>No calendar opens recorded yet.</div>
              )}
              {entries && entries.length > 0 && shown.length === 0 && (
                <div className={`text-xs ${t.textMuted} py-8 text-center`}>No calendar opens in the last {rangeLabel}.</div>
              )}
              {shown.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`text-left ${t.textMuted} border-b ${t.border}`}>
                        <th className="py-1.5 pr-3 font-semibold whitespace-nowrap">When</th>
                        <th className="py-1.5 pr-3 font-semibold">Name</th>
                        <th className="py-1.5 pr-3 font-semibold">Role</th>
                        <th className="py-1.5 pr-3 font-semibold">Venue / Dept</th>
                        <th className="py-1.5 pr-3 font-semibold whitespace-nowrap">Sign-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((e, i) => (
                        <tr key={i} className={`border-b ${t.border}`}>
                          <td className={`py-1.5 pr-3 whitespace-nowrap ${t.textBody}`}>{fmt(e.ts)}</td>
                          <td className={`py-1.5 pr-3 ${t.textBody} font-medium`}>{e.name || "—"}</td>
                          <td className={`py-1.5 pr-3 ${t.textMuted}`}>{roleLabel(e.role)}</td>
                          <td className={`py-1.5 pr-3 ${t.textMuted}`}>{e.venue ? (VENUE_HC_RAW[e.venue]?.name || e.venue) : (e.dept || "—")}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {e.verified
                              ? <span className="text-emerald-600 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> OTP verified</span>
                              : <span className={t.textMuted}>client</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className={`text-[11px] ${t.textMuted} pt-1`}>
                "OTP verified" = identity confirmed by a signed session token. "client" = master/admin sign-in (client-side allowlist, no token) — expected for your own and the Marketing team's logins.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
