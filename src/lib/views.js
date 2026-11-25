// The calendar's views, one list for the screen and for the activity log.
// ---------------------------------------------------------------------------
// The view buttons (src/App-updated.jsx) are drawn from this list, and the
// activity log (api/_lib/activity.js) only records an id that is on it, so a
// new view is logged under its own name the moment it is added here. Plain
// data, no imports: the server imports it too.

export const VIEWS = [
  { id: "board", label: "Board" },
  { id: "month", label: "Month" },
  { id: "heatmap", label: "Heatmap" },
];
