import { NUTRIENTS, DEFAULT_TARGETS, DEFAULT_PROFILE, DEFAULT_ACTIVITY_TARGETS } from './constants.js';
import { dayKey, num } from './utils.js';
import { normalizeMealWindows, daySummary } from './meal-timing.js';
import { normalizeNotifPrefs } from './notifications.js';

export const STORAGE_KEY = 'nutrition-pulse-data-v1';
export const BACKUP_KEY = 'nutrition-pulse-backup-v1';
export const userCacheKey = uid => `${STORAGE_KEY}-${uid}`;

export const MY_PLAN_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];

/** Seven empty days (Mon–Sun), four meal lists each, for the self-composed plan. */
export function emptyMyPlan() {
  return { days: Array.from({ length: 7 }, () => Object.fromEntries(MY_PLAN_SLOTS.map(slot => [slot, []]))) };
}

export function freshState() {
  return {
    theme: 'auto',
    themeChosen: false,
    targets: { ...DEFAULT_TARGETS },
    water: 0,
    foods: [],
    history: [],
    customFoods: {},
    recents: [],
    weights: [],
    currentDate: dayKey(),
    profile: { ...DEFAULT_PROFILE },
    activityToday: { steps: 0, burnKcal: 0, exMin: 0 },
    activityTargets: { ...DEFAULT_ACTIVITY_TARGETS },
    avatar: '',
    displayName: '',
    mealPresets: [],
    mealWindows: normalizeMealWindows(null),
    weekPlan: null,
    myPlan: emptyMyPlan(),
    activePlan: 'auto',
    foodFreq: {},
    myPlanLog: {},
    pantry: {},
    alertsEnabled: false,
    lastAlertDate: {},
    notifPrefs: normalizeNotifPrefs(null),
    notifications: [],
    notifLog: {},
    lastWaterAt: '',
    notifDiag: {},
    healthSyncToken: '',
    vegOnly: false,
    onboarded: false,
  };
}

/** Merges saved data onto fresh defaults so new fields introduced in later versions backfill automatically. */
export function normalizeState(data) {
  const fresh = freshState();
  const state = Object.assign(fresh, data || {});
  state.targets = Object.assign({ ...DEFAULT_TARGETS }, data && data.targets);
  state.profile = Object.assign({ ...DEFAULT_PROFILE }, data && data.profile);
  state.activityToday = Object.assign({ steps: 0, burnKcal: 0, exMin: 0 }, data && data.activityToday);
  state.activityTargets = Object.assign({ ...DEFAULT_ACTIVITY_TARGETS }, data && data.activityTargets);
  state.foods = Array.isArray(state.foods) ? state.foods : [];
  state.history = Array.isArray(state.history) ? state.history : [];
  state.recents = Array.isArray(state.recents) ? state.recents : [];
  state.weights = Array.isArray(state.weights) ? state.weights : [];
  state.customFoods = state.customFoods || {};
  state.mealPresets = Array.isArray(state.mealPresets) ? state.mealPresets : [];
  state.mealWindows = normalizeMealWindows(data && data.mealWindows);
  state.weekPlan = state.weekPlan && Array.isArray(state.weekPlan.days) ? state.weekPlan : null;
  // Self-composed plan: rebuild the 7×4 shape so every day/slot is always a valid array.
  const savedMyPlan = data && data.myPlan;
  state.myPlan = emptyMyPlan();
  if (savedMyPlan && Array.isArray(savedMyPlan.days)) {
    state.myPlan.days.forEach((day, i) => {
      const savedDay = savedMyPlan.days[i] || {};
      MY_PLAN_SLOTS.forEach(slot => { if (Array.isArray(savedDay[slot])) day[slot] = savedDay[slot]; });
    });
  }
  state.pantry = state.pantry || {};
  // Which plan drives Today's Quick Add and the grocery list: the generated
  // "Default" plan, the self-composed "My plan", or none (usual foods).
  state.activePlan = ['auto', 'mine', 'none'].includes(state.activePlan) ? state.activePlan : 'auto';
  state.foodFreq = state.foodFreq || {};       // name → times logged, for "frequently added"
  state.myPlanLog = state.myPlanLog || {};     // dateKey → { slot: true } quick-add logged markers
  delete state.dietPlan;   // superseded by the weekly Plans feature
  state.lastAlertDate = state.lastAlertDate || {};
  // Notification Center: the old single `alertsEnabled` toggle becomes the master
  // switch of the richer per-category preferences the first time we normalize.
  state.notifPrefs = normalizeNotifPrefs(data && data.notifPrefs, !!(data && data.alertsEnabled));
  state.alertsEnabled = state.notifPrefs.enabled; // kept in step for legacy call sites
  state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
  state.notifLog = state.notifLog || {};
  state.notifDiag = state.notifDiag || {};
  state.lastWaterAt = typeof state.lastWaterAt === 'string' ? state.lastWaterAt : '';
  state.currentDate = state.currentDate || dayKey();
  // Follow the device's light/dark setting unless the user explicitly picked a theme.
  if (!state.themeChosen) state.theme = 'auto';
  // Anyone who already has data is treated as onboarded, so only genuinely new
  // accounts get sent to the Profile tab to set themselves up first.
  if (!state.onboarded) {
    state.onboarded = state.weights.length > 0 || state.history.length > 0
      || state.foods.length > 0 || !!state.profile.heightCm || !!state.displayName;
  }
  return state;
}

export function totalsFor(foods) {
  return foods.reduce((total, food) => {
    NUTRIENTS.forEach(n => (total[n] += num(food[n])));
    return total;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 });
}

/** Archives the current day into history if it has data, then rolls currentDate forward to today. */
export function rolloverIfNewDay(state) {
  const today = dayKey();
  if (state.currentDate === today) return false;
  archiveCurrentDay(state);
  state.currentDate = today;
  state.foods = [];
  state.water = 0;
  state.activityToday = { steps: 0, burnKcal: 0, exMin: 0 };
  return true;
}

export function archiveCurrentDay(state) {
  const totals = totalsFor(state.foods);
  const act = state.activityToday;
  const hasData = state.foods.length > 0 || state.water > 0 || num(act.steps) > 0 || num(act.burnKcal) > 0 || num(act.exMin) > 0;
  if (!hasData) return false;
  const id = state.currentDate;
  // Meal-timing summary is frozen into the history entry so Daily History can
  // show on-time / late / missed even after the windows are later re-configured.
  const meals = state.foods.length ? daySummary(state.foods, state.mealWindows) : null;
  const entry = { id, ...totals, water: state.water, steps: num(act.steps), burnKcal: num(act.burnKcal), exMin: num(act.exMin), meals };
  state.history = [entry, ...state.history.filter(h => h.id !== id)];
  return true;
}

export function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(BACKUP_KEY);
  return normalizeState(JSON.parse(saved || 'null'));
}

export function saveLocalState(state, uid) {
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  localStorage.setItem(BACKUP_KEY, json);
  if (uid) localStorage.setItem(userCacheKey(uid), json);
}

export function exportBackupFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `nutrition-pulse-backup-${dayKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function readBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data.foods) || !data.targets) throw new Error('Not a Nutrition Pulse backup file.');
  return normalizeState(data);
}

const BACKUP_DB_NAME = 'nutrition-pulse-backups';

function openBackupDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Unavailable')); return; }
    const request = indexedDB.open(BACKUP_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveIndexedBackup(state) {
  try {
    const db = await openBackupDb();
    db.transaction('data', 'readwrite').objectStore('data').put(JSON.parse(JSON.stringify(state)), 'latest');
  } catch { /* best-effort local safety net only */ }
}

export async function recoverIndexedBackup() {
  try {
    const db = await openBackupDb();
    const request = db.transaction('data', 'readonly').objectStore('data').get('latest');
    return await new Promise(resolve => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
