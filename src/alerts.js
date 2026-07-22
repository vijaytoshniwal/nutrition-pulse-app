import { num } from './utils.js';

/** Eating window used to judge whether a pace is "ahead" or "behind" for the time of day. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

function dayProgress(now = new Date()) {
  const hour = now.getHours() + now.getMinutes() / 60;
  return Math.max(0, Math.min(1, (hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)));
}

/**
 * Checks today's totals against targets and the time of day, returning any
 * newly-triggered alerts (each with a stable `key` used to dedupe per day).
 * Pure and side-effect free — the caller decides what to do with the result
 * and which keys have already fired today.
 */
export function checkPaceAlerts(state, todayTotals, waterMl) {
  const progress = dayProgress();
  const alerts = [];

  const calGoal = Math.max(1, num(state.targets.calories));
  const calPct = todayTotals.calories / calGoal;
  if (calPct >= 0.9 && progress < 0.6) {
    alerts.push({ key: 'calorieHigh', title: 'Pace check', body: `You're already at ${Math.round(calPct * 100)}% of your calorie goal — you might want to ease up for the rest of the day.` });
  } else if (progress > 0.75 && calPct < 0.4) {
    alerts.push({ key: 'calorieLow', title: 'Pace check', body: `Only ${Math.round(calPct * 100)}% of your calorie goal logged with the day winding down — make sure you're eating enough.` });
  }

  const proteinGoal = Math.max(1, num(state.targets.protein));
  const proteinPct = todayTotals.protein / proteinGoal;
  if (progress > 0.7 && proteinPct < 0.5) {
    alerts.push({ key: 'proteinLow', title: 'Protein check', body: `You're under halfway to your protein goal with the day winding down.` });
  }

  const waterGoalMl = Math.max(50, num(state.targets.water) * 1000);
  const waterPct = waterMl / waterGoalMl;
  if (progress > 0.5 && waterPct < 0.3) {
    alerts.push({ key: 'waterLow', title: 'Hydration check', body: `Hydration is low for this time of day — grab some water.` });
  }

  return alerts;
}

export function notificationsSupported() {
  return 'Notification' in window;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Shows a system notification, returning `{ ok, reason }` so callers can record
 * delivery status for diagnostics. `options` may carry { tag, silent, vibrate }.
 */
export async function fireNotification(title, body, options = {}) {
  if (!notificationsSupported()) return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { ok: false, reason: `permission-${Notification.permission}` };
  const opts = { body, icon: './icon.svg', badge: './icon.svg', ...options };
  // Android Chrome throws on `new Notification(...)` from a page — notifications
  // there must go through the service worker registration instead.
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration && registration.showNotification) {
      await registration.showNotification(title, opts);
      return { ok: true, reason: 'sw' };
    }
  } catch { /* fall through to the direct constructor */ }
  try {
    new Notification(title, opts);
    return { ok: true, reason: 'direct' };
  } catch (error) {
    return { ok: false, reason: `error:${error && error.name || 'unknown'}` };
  }
}
