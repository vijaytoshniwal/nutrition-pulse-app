// Meal-timing windows: classifying logged foods into the four daily meals and
// judging each meal as on time / late / missed against the user's configured
// time ranges. Pure helpers — no DOM, no state mutation.

/** Meal ids are fixed (they match the diet-plan slot ids); names and times are user-editable. */
export const DEFAULT_MEAL_WINDOWS = [
  { id: 'breakfast', name: 'Breakfast', start: '08:00', end: '09:30' },
  { id: 'lunch', name: 'Lunch', start: '13:30', end: '15:00' },
  { id: 'snack', name: 'Evening Snack', start: '17:00', end: '18:30' },
  { id: 'dinner', name: 'Dinner', start: '20:00', end: '21:30' },
];

/** Rebuilds a valid 4-window list from saved data, falling back to defaults per field. */
export function normalizeMealWindows(saved) {
  const time = /^\d{2}:\d{2}$/;
  return DEFAULT_MEAL_WINDOWS.map(def => {
    const s = Array.isArray(saved) ? saved.find(w => w && w.id === def.id) : null;
    return {
      id: def.id,
      name: s && typeof s.name === 'string' && s.name.trim() ? s.name.trim() : def.name,
      start: s && time.test(s.start) ? s.start : def.start,
      end: s && time.test(s.end) ? s.end : def.end,
    };
  });
}

export const minutesOf = hm => {
  const [h, m] = String(hm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Current time as 'HH:MM' (the value format of <input type="time">). */
export const nowHM = (date = new Date()) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** 'HH:MM' → the device's 12/24-hour clock format, e.g. '1:42 pm'. */
export function formatHM(hm) {
  if (!hm) return '';
  return new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const windowLabel = w => `${formatHM(w.start)} – ${formatHM(w.end)}`;

/** Which meal a clock time falls into: the containing window, else the nearest one. */
export function classifyMeal(hm, windows) {
  const t = minutesOf(hm);
  const within = windows.find(w => t >= minutesOf(w.start) && t <= minutesOf(w.end));
  if (within) return within.id;
  let best = windows[0];
  let bestDist = Infinity;
  windows.forEach(w => {
    const dist = Math.min(Math.abs(t - minutesOf(w.start)), Math.abs(t - minutesOf(w.end)));
    if (dist < bestDist) { bestDist = dist; best = w; }
  });
  return best.id;
}

/**
 * Judges one meal window against the day's food entries.
 * `nowMin` is minutes-since-midnight for a live (today) view, or null for a
 * finished/past day. Statuses: 'ontime' | 'late' | 'missed' | 'unrecorded'
 * (entries exist but carry no time) | 'pending' (today, window not over yet).
 * `diffMin` is minutes relative to the window: negative = early, 0 = within, positive = after it ended.
 */
export function mealStatus(foods, window, nowMin = null) {
  const entries = foods.filter(f => f.meal === window.id);
  const times = entries.map(f => f.time).filter(Boolean).map(minutesOf);
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (!entries.length) {
    if (nowMin !== null && nowMin <= end) return { status: 'pending', time: null, diffMin: null };
    return { status: 'missed', time: null, diffMin: null };
  }
  if (!times.length) return { status: 'unrecorded', time: null, diffMin: null };
  const first = Math.min(...times);
  const hm = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
  if (first > end) return { status: 'late', time: hm, diffMin: first - end };
  return { status: 'ontime', time: hm, diffMin: first < start ? first - start : 0 };
}

/** Per-meal timing summary for a whole day — the shape stored into history entries. */
export function daySummary(foods, windows, nowMin = null) {
  return windows.map(w => ({ id: w.id, name: w.name, start: w.start, end: w.end, ...mealStatus(foods, w, nowMin) }));
}

export const STATUS_LABELS = {
  ontime: 'On time',
  late: 'Taken late',
  missed: 'Missed',
  unrecorded: 'Not recorded',
  pending: 'Not recorded yet',
};

const fmtMins = mins => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/** Human label for diffMin: 'in window', '25m early', '1h 05m late'. */
export function diffLabel(diffMin) {
  if (diffMin === null || diffMin === undefined) return '';
  if (diffMin === 0) return 'in window';
  return diffMin < 0 ? `${fmtMins(-diffMin)} early` : `${fmtMins(diffMin)} late`;
}
