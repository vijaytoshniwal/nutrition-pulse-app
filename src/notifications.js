// Notification Center: preferences schema + a pure engine that decides which
// alerts are "due" right now. No DOM, no state mutation, no side effects — the
// caller (app.js) fires them, records history and updates the dedupe log.
//
// Delivery reality: these fire while the app is open or backgrounded-but-alive.
// True push while the app is fully closed needs a push server (FCM/VAPID) — see
// the permission card and admin diagnostics in the UI, which say so plainly.

import { num, dayKey } from './utils.js';
import { minutesOf, nowHM, daySummary, formatHM } from './meal-timing.js';

// Nutrients that carry a daily target and are tracked on foods. Each is either a
// "limit" (bad to exceed) or a "goal" (good to reach); calories is both.
export const NUTRIENT_ALERT_META = [
  { id: 'calories', label: 'Calories', unit: 'kcal', kind: 'both' },
  { id: 'protein', label: 'Protein', unit: 'g', kind: 'goal' },
  { id: 'carbs', label: 'Carbohydrates', unit: 'g', kind: 'limit' },
  { id: 'fat', label: 'Fat', unit: 'g', kind: 'limit' },
  { id: 'fibre', label: 'Fibre', unit: 'g', kind: 'goal' },
  { id: 'sugar', label: 'Sugar', unit: 'g', kind: 'limit' },
];

export const CATEGORY_META = {
  meal: { icon: '🍽', label: 'Meal reminder' },
  water: { icon: '💧', label: 'Water reminder' },
  nutrient: { icon: '🥗', label: 'Nutrient alert' },
  goal: { icon: '🏆', label: 'Goal achieved' },
  daily: { icon: '🌙', label: 'Daily summary' },
  weekly: { icon: '📊', label: 'Weekly summary' },
  test: { icon: '🔔', label: 'Test' },
  system: { icon: 'ℹ️', label: 'System' },
};

export const ADVANCE_OPTIONS = [5, 10, 15, 30];
export const WATER_FREQ_OPTIONS = [30, 60, 90, 120];
export const THRESHOLD_OPTIONS = [80, 90, 100];

/** Full default preferences. Every category has its own enable flag under a shared master. */
export function defaultNotifPrefs() {
  return {
    enabled: false,
    meal: {
      enabled: true,
      beforeStart: true,
      atStart: true,
      duringNoFood: true,
      missedAfter: true,
      stopWhenLogged: true,
      advanceMin: 10,
    },
    water: {
      enabled: true,
      everyMin: 90,
      startHM: '07:00',
      endHM: '22:00',
      stopWhenMet: true,
    },
    nutrient: {
      enabled: true,
      threshold: 90,
      items: { calories: true, protein: true, carbs: true, fat: true, fibre: true, sugar: true },
    },
    goals: {
      enabled: true,
      water: true, protein: true, fibre: true, calories: true, allGoals: true, scoreMilestone: true,
    },
    daily: { enabled: false, timeHM: '21:00' },
    weekly: { enabled: false, dow: 0, timeHM: '09:00' },
    prefs: {
      sound: true,
      vibrate: true,
      quietEnabled: true,
      quietStartHM: '22:00',
      quietEndHM: '07:00',
      lockPreview: true,
      maxPerDay: 12,
    },
  };
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const timeStr = (v, d) => (/^\d{2}:\d{2}$/.test(v) ? v : d);
const intIn = (v, opts, d) => (opts.includes(num(v)) ? num(v) : (num(v) > 0 ? num(v) : d));

/** Rebuilds a valid prefs object from saved data, backfilling any missing field. */
export function normalizeNotifPrefs(saved, legacyEnabled = false) {
  const d = defaultNotifPrefs();
  const s = saved && typeof saved === 'object' ? saved : {};
  const items = (s.nutrient && s.nutrient.items) || {};
  return {
    enabled: bool(s.enabled, legacyEnabled),
    meal: {
      enabled: bool(s.meal && s.meal.enabled, d.meal.enabled),
      beforeStart: bool(s.meal && s.meal.beforeStart, d.meal.beforeStart),
      atStart: bool(s.meal && s.meal.atStart, d.meal.atStart),
      duringNoFood: bool(s.meal && s.meal.duringNoFood, d.meal.duringNoFood),
      missedAfter: bool(s.meal && s.meal.missedAfter, d.meal.missedAfter),
      stopWhenLogged: bool(s.meal && s.meal.stopWhenLogged, d.meal.stopWhenLogged),
      advanceMin: s.meal && num(s.meal.advanceMin) > 0 ? num(s.meal.advanceMin) : d.meal.advanceMin,
    },
    water: {
      enabled: bool(s.water && s.water.enabled, d.water.enabled),
      everyMin: s.water && num(s.water.everyMin) > 0 ? num(s.water.everyMin) : d.water.everyMin,
      startHM: timeStr(s.water && s.water.startHM, d.water.startHM),
      endHM: timeStr(s.water && s.water.endHM, d.water.endHM),
      stopWhenMet: bool(s.water && s.water.stopWhenMet, d.water.stopWhenMet),
    },
    nutrient: {
      enabled: bool(s.nutrient && s.nutrient.enabled, d.nutrient.enabled),
      threshold: s.nutrient && num(s.nutrient.threshold) > 0 ? num(s.nutrient.threshold) : d.nutrient.threshold,
      items: NUTRIENT_ALERT_META.reduce((acc, n) => {
        acc[n.id] = bool(items[n.id], true);
        return acc;
      }, {}),
    },
    goals: {
      enabled: bool(s.goals && s.goals.enabled, d.goals.enabled),
      water: bool(s.goals && s.goals.water, d.goals.water),
      protein: bool(s.goals && s.goals.protein, d.goals.protein),
      fibre: bool(s.goals && s.goals.fibre, d.goals.fibre),
      calories: bool(s.goals && s.goals.calories, d.goals.calories),
      allGoals: bool(s.goals && s.goals.allGoals, d.goals.allGoals),
      scoreMilestone: bool(s.goals && s.goals.scoreMilestone, d.goals.scoreMilestone),
    },
    daily: {
      enabled: bool(s.daily && s.daily.enabled, d.daily.enabled),
      timeHM: timeStr(s.daily && s.daily.timeHM, d.daily.timeHM),
    },
    weekly: {
      enabled: bool(s.weekly && s.weekly.enabled, d.weekly.enabled),
      dow: s.weekly && Number.isInteger(num(s.weekly.dow)) && num(s.weekly.dow) >= 0 && num(s.weekly.dow) <= 6 ? num(s.weekly.dow) : d.weekly.dow,
      timeHM: timeStr(s.weekly && s.weekly.timeHM, d.weekly.timeHM),
    },
    prefs: {
      sound: bool(s.prefs && s.prefs.sound, d.prefs.sound),
      vibrate: bool(s.prefs && s.prefs.vibrate, d.prefs.vibrate),
      quietEnabled: bool(s.prefs && s.prefs.quietEnabled, d.prefs.quietEnabled),
      quietStartHM: timeStr(s.prefs && s.prefs.quietStartHM, d.prefs.quietStartHM),
      quietEndHM: timeStr(s.prefs && s.prefs.quietEndHM, d.prefs.quietEndHM),
      lockPreview: bool(s.prefs && s.prefs.lockPreview, d.prefs.lockPreview),
      maxPerDay: s.prefs && num(s.prefs.maxPerDay) > 0 ? num(s.prefs.maxPerDay) : d.prefs.maxPerDay,
    },
  };
}

// ---------- Notification history ----------

export const HISTORY_CAP = 60;

let idSeq = 0;
function makeId() {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/** Returns a new, capped history array with the entry prepended (newest first). */
export function addHistory(list, { category, title, body, tone = 'info', at = new Date() }) {
  const entry = {
    id: makeId(),
    category,
    title,
    body,
    tone,
    at: (at instanceof Date ? at : new Date(at)).toISOString(),
    read: false,
  };
  return [entry, ...(Array.isArray(list) ? list : [])].slice(0, HISTORY_CAP);
}

export function unreadCount(list) {
  return Array.isArray(list) ? list.filter(n => !n.read).length : 0;
}

// ---------- Time helpers ----------

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

/** 0..1 through the eating window — used to judge whether a goal pace is "behind". */
function dayProgress(nowMin) {
  const hour = nowMin / 60;
  return Math.max(0, Math.min(1, (hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)));
}

/** True when nowMin falls inside [startMin, endMin], correctly handling windows that wrap past midnight. */
export function withinWindow(nowMin, startMin, endMin) {
  if (startMin <= endMin) return nowMin >= startMin && nowMin <= endMin;
  return nowMin >= startMin || nowMin <= endMin; // wraps midnight (e.g. 22:00–07:00)
}

export function isQuietNow(prefs, nowMin) {
  if (!prefs.prefs.quietEnabled) return false;
  return withinWindow(nowMin, minutesOf(prefs.prefs.quietStartHM), minutesOf(prefs.prefs.quietEndHM));
}

/** Maps the Notification API + platform into one of four UI states plus a hint. */
export function permissionInfo() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    const iOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
    const standalone = typeof navigator !== 'undefined' && (navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    return {
      state: 'unavailable',
      label: iOS && !standalone ? 'Background Notifications Restricted' : 'Permission Required',
      detail: iOS && !standalone
        ? 'On iPhone/iPad, notifications work only after you add this app to your Home Screen (Share → Add to Home Screen), then open it from there.'
        : 'This browser does not expose notifications. In-app alerts still work while the app is open.',
      canRequest: false,
    };
  }
  const p = Notification.permission;
  if (p === 'granted') return { state: 'granted', label: 'Notifications Allowed', detail: 'System notifications are allowed on this device.', canRequest: false };
  if (p === 'denied') return { state: 'denied', label: 'Notifications Blocked', detail: 'Notifications are blocked. Open your browser or device settings for this site to allow them.', canRequest: false };
  return { state: 'default', label: 'Permission Required', detail: 'Allow notifications so alerts can reach you as system notifications, not just in-app.', canRequest: true };
}

// ---------- The engine ----------

const firedToday = (log, key, today) => log && log[key] && dayKey(new Date(log[key])) === today;
const minsSince = (log, key, now) => (log && log[key] ? (now - new Date(log[key]).getTime()) / 60000 : Infinity);
const pctLabel = pct => `${Math.round(pct * 100)}%`;

/**
 * Returns the notifications that should fire *now*, each with a stable `key`
 * (for dedupe), `category` and `tone`. Applies every intelligent rule: master
 * + per-category switches, quiet hours, dedupe via `log`, stop-when-logged,
 * stop-when-target-met, behind-vs-achieved, active hours and reminder spacing.
 * Pure: reads state/prefs/log, mutates nothing. The daily-cap is applied by the
 * caller (it needs the fired-history count).
 */
export function dueNotifications(ctx) {
  const { state, now = new Date(), todayTotals, waterMl, waterGoalMl } = ctx;
  const prefs = ctx.prefs;
  const log = ctx.log || {};
  if (!prefs.enabled) return [];

  const nowMin = minutesOf(nowHM(now));
  const today = dayKey(now);
  const quiet = isQuietNow(prefs, nowMin);
  const out = [];
  const add = item => { if (!firedToday(log, item.key, today)) out.push(item); };

  // ---- Meal reminders (today only; suppressed once food is logged for a window) ----
  if (prefs.meal.enabled && !quiet) {
    const m = prefs.meal;
    state.mealWindows.forEach(w => {
      const start = minutesOf(w.start);
      const end = minutesOf(w.end);
      const mid = start + Math.round((end - start) / 2);
      const logged = state.foods.some(f => f.meal === w.id);
      if (m.stopWhenLogged && logged) return;
      const time = `${formatHM(w.start)}–${formatHM(w.end)}`;
      if (m.beforeStart && nowMin >= start - m.advanceMin && nowMin < start) {
        add({ key: `meal-before-${w.id}`, category: 'meal', tone: 'info', title: `${w.name} soon`, body: `${w.name} starts at ${formatHM(w.start)} (in about ${Math.max(1, start - nowMin)} min). Get ready to log it.` });
      }
      if (m.atStart && nowMin >= start && nowMin < end) {
        add({ key: `meal-start-${w.id}`, category: 'meal', tone: 'info', title: `${w.name} time`, body: `Your ${w.name.toLowerCase()} window is open (${time}). Log what you eat to stay on track.` });
      }
      if (m.duringNoFood && nowMin >= mid && nowMin <= end && !logged) {
        add({ key: `meal-during-${w.id}`, category: 'meal', tone: 'warn', title: `${w.name} not logged`, body: `Nothing recorded for ${w.name.toLowerCase()} yet (${time}). Add it while you remember.` });
      }
      if (m.missedAfter && nowMin > end && !logged) {
        add({ key: `meal-missed-${w.id}`, category: 'meal', tone: 'bad', title: `${w.name} missed?`, body: `The ${w.name.toLowerCase()} window (${time}) has passed with nothing logged. If you ate, add it with the actual time.` });
      }
    });
  }

  // ---- Water reminders (active hours; stop when target met; space out after logging) ----
  if (prefs.water.enabled && !quiet) {
    const wr = prefs.water;
    const met = waterMl >= waterGoalMl;
    const active = withinWindow(nowMin, minutesOf(wr.startHM), minutesOf(wr.endHM));
    const sinceReminder = minsSince(log, 'water-remind', now.getTime());
    const sinceLog = minsSince({ 'water-log': state.lastWaterAt }, 'water-log', now.getTime());
    if (active && !(wr.stopWhenMet && met) && sinceReminder >= wr.everyMin && sinceLog >= wr.everyMin) {
      const remainingMl = Math.max(0, waterGoalMl - waterMl);
      const remainingL = Math.round(remainingMl / 100) / 10;
      out.push({ key: 'water-remind', category: 'water', tone: 'info', interval: true, title: 'Time for water', body: `${remainingL} L to go to hit your ${Math.round(waterGoalMl / 100) / 10} L goal today. Take a few sips.` });
    }
  }

  // ---- Nutrient alerts (limit vs goal; recompute on every food change) ----
  if (prefs.nutrient.enabled && !quiet) {
    const thr = Math.max(1, num(prefs.nutrient.threshold)) / 100;
    const progress = dayProgress(nowMin);
    NUTRIENT_ALERT_META.forEach(n => {
      if (!prefs.nutrient.items[n.id]) return;
      const target = num(state.targets[n.id]);
      if (target <= 0) return;
      const pct = num(todayTotals[n.id]) / target;
      const isLimit = n.kind === 'limit' || n.kind === 'both';
      const isGoal = n.kind === 'goal';
      if (isLimit) {
        if (pct >= thr && pct < 1) {
          add({ key: `nutr-near-${n.id}`, category: 'nutrient', tone: 'warn', title: `${n.label} nearing limit`, body: `You've reached ${pctLabel(pct)} of your ${n.label.toLowerCase()} ${n.id === 'calories' ? 'goal' : 'limit'} for today.` });
        } else if (pct >= 1 && n.id !== 'calories') {
          add({ key: `nutr-over-${n.id}`, category: 'nutrient', tone: 'bad', title: `${n.label} over limit`, body: `Your ${n.label.toLowerCase()} intake has crossed today's limit (${pctLabel(pct)}).` });
        } else if (pct >= 1.05 && n.id === 'calories') {
          add({ key: `nutr-over-${n.id}`, category: 'nutrient', tone: 'bad', title: `Over your calorie goal`, body: `You're at ${pctLabel(pct)} of your calorie goal for today.` });
        }
      }
      if (isGoal) {
        if (pct >= 1) {
          add({ key: `nutr-achieved-${n.id}`, category: 'nutrient', tone: 'good', title: `${n.label} target reached`, body: `You've achieved your ${n.label.toLowerCase()} target for today. Nice work.` });
        } else if (progress > 0.7 && pct < 0.6) {
          add({ key: `nutr-behind-${n.id}`, category: 'nutrient', tone: 'warn', title: `Behind on ${n.label.toLowerCase()}`, body: `You're at ${pctLabel(pct)} of your ${n.label.toLowerCase()} target with the day winding down — a top-up would help.` });
        }
      }
    });
  }

  // ---- Goal achievement (once per goal per day) ----
  if (prefs.goals.enabled && !quiet) {
    const g = prefs.goals;
    const calPct = num(todayTotals.calories) / Math.max(1, num(state.targets.calories));
    const proPct = num(todayTotals.protein) / Math.max(1, num(state.targets.protein));
    const fibPct = num(todayTotals.fibre) / Math.max(1, num(state.targets.fibre));
    const waterMet = waterMl >= waterGoalMl;
    if (g.water && waterMet) add({ key: 'goal-water', category: 'goal', tone: 'good', title: 'Water goal reached 💧', body: 'You hit your water target for today. Well done!' });
    if (g.protein && proPct >= 1) add({ key: 'goal-protein', category: 'goal', tone: 'good', title: 'Protein goal reached 💪', body: 'You reached your protein target for today.' });
    if (g.fibre && fibPct >= 1) add({ key: 'goal-fibre', category: 'goal', tone: 'good', title: 'Fibre goal reached 🌾', body: 'You reached your fibre target for today.' });
    if (g.calories && calPct >= 1) add({ key: 'goal-calories', category: 'goal', tone: 'good', title: 'Calorie goal complete', body: 'You reached your calorie goal for today.' });
    if (g.allGoals && waterMet && proPct >= 1 && fibPct >= 1 && calPct >= 1) {
      add({ key: 'goal-all', category: 'goal', tone: 'good', title: 'All daily goals met 🎉', body: 'Calories, protein, fibre and water — every major goal hit today. Outstanding.' });
    }
    if (g.scoreMilestone && num(ctx.score) >= 90) {
      add({ key: 'goal-score', category: 'goal', tone: 'good', title: 'Nutrition score milestone', body: `Your nutrition score reached ${Math.round(num(ctx.score))}. Keep the streak going.` });
    }
  }

  // ---- Daily summary (at or after the chosen time; not before) ----
  if (prefs.daily.enabled && nowMin >= minutesOf(prefs.daily.timeHM)) {
    add({ key: 'daily-summary', category: 'daily', tone: 'info', title: 'Your day in nutrition', body: buildDailySummary(ctx) });
  }

  // ---- Weekly summary (chosen weekday, at or after the chosen time) ----
  if (prefs.weekly.enabled && now.getDay() === prefs.weekly.dow && nowMin >= minutesOf(prefs.weekly.timeHM)) {
    const weekKey = `weekly-summary-${today}`;
    if (!firedToday(log, weekKey, today)) out.push({ key: weekKey, category: 'weekly', tone: 'info', title: 'Your week in nutrition', body: buildWeeklySummary(ctx) });
  }

  return out;
}

// ---------- Summary composers ----------

export function buildDailySummary(ctx) {
  const { state, now = new Date(), todayTotals, waterMl } = ctx;
  const nowMin = minutesOf(nowHM(now));
  const meals = daySummary(state.foods, state.mealWindows, nowMin);
  const onTime = meals.filter(m => m.status === 'ontime').length;
  const late = meals.filter(m => m.status === 'late').length;
  const missed = meals.filter(m => m.status === 'missed').length;
  const cal = Math.round(num(todayTotals.calories));
  const pro = Math.round(num(todayTotals.protein));
  const waterL = Math.round(waterMl / 100) / 10;
  const parts = [
    `${cal} kcal · ${pro} g protein · ${waterL} L water.`,
    `Meals: ${onTime} on time, ${late} late, ${missed} missed.`,
  ];
  if (ctx.score != null) parts.push(`Nutrition score ${Math.round(num(ctx.score))}.`);
  parts.push(nextDaySuggestion(ctx));
  return parts.join(' ');
}

function nextDaySuggestion(ctx) {
  const { state, todayTotals, waterMl, waterGoalMl } = ctx;
  const proPct = num(todayTotals.protein) / Math.max(1, num(state.targets.protein));
  const fibPct = num(todayTotals.fibre) / Math.max(1, num(state.targets.fibre));
  if (waterMl < waterGoalMl * 0.8) return 'Tomorrow: aim to sip water more steadily through the day.';
  if (proPct < 0.8) return 'Tomorrow: add a protein source to one more meal.';
  if (fibPct < 0.8) return 'Tomorrow: a little more fruit, veg or dal would lift your fibre.';
  return 'Tomorrow: keep doing what worked today.';
}

export function buildWeeklySummary(ctx) {
  const { state } = ctx;
  const days = (state.history || []).slice(0, 7);
  if (!days.length) return 'Not enough logged days yet for a weekly summary — keep tracking!';
  const avg = key => Math.round(days.reduce((s, d) => s + num(d[key]), 0) / days.length);
  const avgWaterL = Math.round((days.reduce((s, d) => s + num(d.water), 0) / days.length) * 10) / 10;
  let missed = 0;
  let onTime = 0;
  let recorded = 0;
  days.forEach(d => {
    if (!Array.isArray(d.meals)) return;
    d.meals.forEach(m => {
      if (m.status === 'missed') missed += 1;
      if (m.status === 'ontime' || m.status === 'late') recorded += 1;
      if (m.status === 'ontime') onTime += 1;
    });
  });
  const adherence = recorded ? Math.round((onTime / recorded) * 100) : 0;
  return `Averages over ${days.length} day${days.length > 1 ? 's' : ''}: ${avg('calories')} kcal, ${avg('protein')} g protein, ${avgWaterL} L water. Meals on time: ${adherence}%. ${missed} missed meal${missed === 1 ? '' : 's'} this week.`;
}
