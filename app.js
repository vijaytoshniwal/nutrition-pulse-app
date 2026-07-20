import { NUTRIENTS, QUOTES, FOOD_PICKS, NAV_ITEMS, MORE_TABS, APP_VERSION } from './src/constants.js';
import { $, num, dayKey, displayDate, dayOfYear, foodKey, standardName } from './src/utils.js';
import {
  loadLocalState, saveLocalState, normalizeState, totalsFor, rolloverIfNewDay,
  archiveCurrentDay, exportBackupFile, readBackupFile, saveIndexedBackup, recoverIndexedBackup, userCacheKey,
} from './src/state.js';
import {
  computeStreak, weeklyData, weeklyScoreParts, gradeForScore, sparklineData,
  latestWeight, idealWeightRange, computeBMI, computeTargetsFromProfile, weightBarData, weightJourney, computeWeightForecast,
} from './src/calculations.js';
import { comparableQuantity, calculateFood, findFoodByPhotoHash, searchFoods, scaleFoodDbItem, parseNutritionFromText } from './src/food-lookup.js';
import { computeImageHash, isSimilarPhoto } from './src/image-hash.js';
import { checkPaceAlerts, notificationsSupported, requestNotificationPermission, fireNotification } from './src/alerts.js';
import { isBarcodeScanSupported, scanBarcodeFromCamera, lookupBarcode } from './src/barcode.js';
import { watchAuthState, signIn, signUp, signOutUser, resetPassword, loadCloudState, saveCloudState, submitFoodForReview, fetchActivitySync, isAdmin, fetchPendingFoods, approvePendingFood, rejectPendingFood, fetchFoodBank, deleteFoodBankEntry, FIREBASE_PROJECT_ID } from './src/firebase-sync.js';
import { recognizeTextInImage, parseActivityFromText } from './src/activity-ocr.js';
import { generateWeekPlan, swapDay, planTotals, weekAverages, groceryList, weekStartKey } from './src/diet-plan.js';

/** Mobile browsers report 100vh as if the address bar were hidden, so measure the
 * real visible height in JS instead of trusting CSS vh units alone. */
function syncViewportHeightVar() {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
syncViewportHeightVar();
window.addEventListener('resize', syncViewportHeightVar);
window.addEventListener('orientationchange', syncViewportHeightVar);
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewportHeightVar);

let state = loadLocalState();
let currentUser = null;
// The shared food bank, fetched once after sign-in so approved foods can show
// up in search suggestions (see loadFoodBankCache / suggestExtras).
let foodBankCache = [];

async function loadFoodBankCache() {
  foodBankCache = await fetchFoodBank();
}

/** Turns a saved/bank food ({name, baseQuantity, per-portion nutrients}) into a FOOD_DB-shaped suggestion item. */
function toSuggestItem(food, source) {
  const base = num(food.baseQuantity) > 0 ? num(food.baseQuantity) : 100;
  const per100 = n => (food[n] == null ? 0 : Math.round((num(food[n]) * 100 / base) * 10) / 10);
  return { n: food.name, a: '', k: per100('calories'), sg: Math.round(base), sl: `${Math.round(base)} g`, v: 1, source };
}

/** The user's own saved foods and the shared bank, deduped (own wins), for the suggestion list. */
function suggestExtras() {
  const items = [];
  const seen = new Set();
  Object.values(state.customFoods || {}).forEach(food => {
    if (!food || !food.name) return;
    seen.add(foodKey(food.name));
    items.push(toSuggestItem(food, 'custom'));
  });
  foodBankCache.forEach(food => {
    if (!food || !food.name) return;
    const key = foodKey(food.name);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(toSuggestItem(food, 'bank'));
  });
  return items;
}

// 'auto' theme follows the device's light/dark preference live.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  return state.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.theme;
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedTheme());
}
darkQuery.addEventListener('change', () => { if (state.theme === 'auto') { applyTheme(); render(); } });
applyTheme();

const ui = {
  tab: 'today',
  form: freshForm(),
  presetDraft: [],
  presetItemManual: false,
  plansView: 'hub',
  selectedDay: null,
};

function freshForm() {
  return {
    name: '', quantity: 100, unit: 'g',
    calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '',
    manualMode: false, editingIndex: null, lookupStatus: '',
    photoDataUrl: '', photoStatus: '', photoHash: null,
  };
}

function greetingName() {
  if (state.displayName) return state.displayName;
  return currentUser && currentUser.email ? currentUser.email.split('@')[0] : 'there';
}

async function save() {
  saveLocalState(state, currentUser && currentUser.uid);
  saveIndexedBackup(state);
  if (currentUser) await saveCloudState(currentUser.uid, state);
  render();
}

// ---------- Auth screen ----------

function renderAuthScreen() {
  const grid = $('foodPickGrid');
  grid.replaceChildren();
  const dayIndex = dayOfYear(new Date());
  for (let i = 0; i < 4; i++) {
    const pick = FOOD_PICKS[(dayIndex * 4 + i) % FOOD_PICKS.length];
    const el = document.createElement('div');
    el.className = 'food-pick';
    el.innerHTML = `
      <div class="food-pick-icon" style="animation-delay:${i * 0.4}s">${pick.icon}</div>
      <span class="food-pick-name">${pick.name}</span>
      <span class="food-pick-stat">${pick.stat}</span>`;
    grid.appendChild(el);
  }
}

const REMEMBER_EMAIL_KEY = 'nutrition-pulse-remembered-email';

// The remember-me checkbox is optional UI; guard every access so a missing
// element can never throw and block sign-in (e.g. after a partial update).
const rememberedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);
if (rememberedEmail) {
  $('authEmail').value = rememberedEmail;
  if ($('rememberMe')) $('rememberMe').checked = true;
}

function applyRememberMe(email) {
  const remember = $('rememberMe');
  if (!remember || remember.checked) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  else localStorage.removeItem(REMEMBER_EMAIL_KEY);
}

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authMessage').textContent = 'Signing in…';
  try {
    await signIn(email, password);
    applyRememberMe(email);
    $('authMessage').textContent = '';
  } catch (error) {
    $('authMessage').textContent = error.message.replace('Firebase: ', '');
  }
});

$('signupButton').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) { $('authMessage').textContent = 'Enter your email address and password first.'; return; }
  $('authMessage').textContent = 'Creating account…';
  try {
    await signUp(email, password);
    applyRememberMe(email);
    $('authMessage').textContent = '';
  } catch (error) {
    $('authMessage').textContent = error.message.replace('Firebase: ', '');
  }
});

$('signOutButton').addEventListener('click', () => signOutUser());

$('togglePassword').addEventListener('click', () => {
  const field = $('authPassword');
  const showing = field.type === 'text';
  field.type = showing ? 'password' : 'text';
  $('passwordEyeSlash').hidden = showing;
  $('togglePassword').setAttribute('aria-pressed', String(!showing));
  $('togglePassword').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

$('forgotPassword').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if (!email) { $('authMessage').textContent = 'Enter your email address above first, then tap "Forgot password?" again.'; return; }
  $('authMessage').textContent = 'Sending password reset email…';
  try {
    await resetPassword(email);
    $('authMessage').textContent = `Password reset email sent to ${email}. Check your inbox.`;
  } catch (error) {
    $('authMessage').textContent = error.message.replace('Firebase: ', '');
  }
});

// ---------- Header ----------

function renderHeader(derived) {
  $('todayLabel').textContent = `${derived.todayLabel} · ${derived.streak}d streak`;
  $('greeting').textContent = `Hi, ${derived.firstName}`;

  const hasAvatar = !!state.avatar;
  $('avatarImg').hidden = !hasAvatar;
  $('avatarPlaceholder').hidden = hasAvatar;
  if (hasAvatar) $('avatarImg').src = state.avatar;

  $('scoreButton').style.setProperty('--score', `${derived.weeklyScore}%`);
  $('scoreValue').textContent = derived.weeklyScore;
}

$('avatarButton').addEventListener('click', () => showTab('profile'));
$('scoreButton').addEventListener('click', () => showTab('trends'));

// ---------- Tabs & nav ----------

function showTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.dataset.tab !== tab; });
  // The + button only makes sense on the Today tab, where it opens the food
  // log. It's hidden everywhere else (Profile, Weight, Trends, etc.).
  $('fabLog').hidden = tab !== 'today';
  renderNav();
  const scroller = document.querySelector('.tab-scroll');
  if (scroller) scroller.scrollTop = 0;
}

function renderNav() {
  const nav = $('bottomNav');
  nav.replaceChildren();
  NAV_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    // Activity, Meals and Profile live behind the More menu, so More stays lit while they're open.
    const active = ui.tab === item.id || (item.id === 'more' && MORE_TABS.includes(ui.tab));
    btn.className = `nav-item${active ? ' active' : ''}`;
    btn.innerHTML = `<span class="nav-icon">${item.icon}</span><span class="nav-label">${item.label}</span>`;
    btn.addEventListener('click', () => showTab(item.id));
    nav.appendChild(btn);
  });
}

$('fabLog').addEventListener('click', () => showTab('log'));

// ---------- Today tab ----------

function renderToday(derived) {
  $('dailyQuote').textContent = QUOTES[dayOfYear(new Date()) % QUOTES.length];

  $('calorieRing').style.setProperty('--progress', `${derived.caloriePercent}%`);
  $('calorieValue').textContent = derived.calories;
  $('calorieGoalLabel').textContent = `of ${derived.calorieGoal.toLocaleString()} kcal`;

  $('proteinRing').style.setProperty('--progress', `${derived.proteinPercent}%`);
  $('proteinRing').style.setProperty('--ring-color', 'var(--accent2)');
  $('proteinValue').textContent = derived.proteinValue;
  $('proteinGoalLabel').textContent = `of ${derived.proteinGoal}g`;

  $('caloriesRemainingLabel').textContent = derived.caloriesRemainingLabel;
  $('proteinRemainingLabel').textContent = derived.proteinRemainingLabel;

  // Quick add offers today's still-unlogged planned meals first, then recents.
  const planMeals = todaysPlanMeals().slice(0, 2);
  const quickAdds = state.recents.slice(0, 4 - planMeals.length);
  $('noRecentsNote').hidden = planMeals.length > 0 || quickAdds.length > 0;
  if ($('quickAddTag')) $('quickAddTag').textContent = planMeals.length ? 'from your plan' : 'recent foods';
  const list = $('quickAddList');
  list.replaceChildren();
  const quickRow = (labelText, kcalText, onAdd) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = labelText;
    const right = document.createElement('div');
    right.className = 'qty';
    const kcal = document.createElement('span');
    kcal.textContent = kcalText;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'round-add';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', onAdd);
    right.append(kcal, addBtn);
    li.append(label, right);
    list.appendChild(li);
  };
  planMeals.forEach(meal => {
    const t = totalsFor(meal.items);
    const names = meal.items.slice(0, 2).map(i => i.name).join(' + ') + (meal.items.length > 2 ? ' +' : '');
    quickRow(`${meal.name} · ${names}`, `+ ${Math.round(t.calories)}`, () => {
      addPlanMealFoods(meal);
      save();
    });
  });
  quickAdds.forEach(recent => {
    quickRow(`${recent.name} · ${recent.quantity}${recent.unit}`, `${Math.round(num(recent.calories))} kcal`, () => quickAddFood(recent));
  });

  const macroDefs = [
    ['carbs', 'Carbs', 'g', 'var(--accent)'],
    ['fat', 'Fat', 'g', 'var(--fat)'],
    ['fibre', 'Fibre', 'g', 'var(--accent2)'],
    ['sugar', 'Sugar', 'g', 'var(--sugar-c)'],
  ];
  const macroGrid = $('macroGrid');
  macroGrid.replaceChildren();
  macroDefs.forEach(([key, label, unit, color]) => {
    const goal = Math.max(1, num(state.targets[key]));
    const value = derived.todayTotals[key];
    const percent = Math.min(100, Math.round((value / goal) * 100));
    const item = document.createElement('div');
    item.className = 'macro-item';
    item.innerHTML = `
      <div class="ring" style="--progress:${percent}%;--ring-color:${color}">
        <div class="ring-hole"><strong>${Math.round(value * 10) / 10}${unit}</strong><span>of ${goal}${unit}</span></div>
      </div>
      <span class="macro-label">${label}</span>`;
    macroGrid.appendChild(item);
  });

  $('waterLabel').textContent = `${derived.waterMl} / ${derived.waterGoalMl.toLocaleString()} ml`;
  $('waterBar').style.width = `${derived.waterPercent}%`;
}

function quickAddFood(recent) {
  const food = { name: recent.name, quantity: recent.quantity, unit: recent.unit, ...Object.fromEntries(NUTRIENTS.map(n => [n, num(recent[n])])) };
  state.foods.push(food);
  pushRecent(food);
  save();
}

$('addWater50').addEventListener('click', () => { state.water = Number((state.water + 0.05).toFixed(2)); save(); });
$('addWater250').addEventListener('click', () => { state.water = Number((state.water + 0.25).toFixed(2)); save(); });

// ---------- Log tab ----------

function setNutrientEditing(enabled) {
  NUTRIENTS.forEach(n => { $(`food${n[0].toUpperCase()}${n.slice(1)}`).readOnly = !enabled; });
}

function setFoodValues(values) {
  NUTRIENTS.forEach(n => {
    const amount = values[n];
    $(`food${n[0].toUpperCase()}${n.slice(1)}`).value = amount === null || amount === undefined ? '' : Number(num(amount).toFixed(1));
  });
}

function pushRecent(food) {
  state.recents = [
    { name: food.name, quantity: food.quantity, unit: food.unit, ...Object.fromEntries(NUTRIENTS.map(n => [n, food[n]])) },
    ...state.recents.filter(r => foodKey(r.name) !== foodKey(food.name)),
  ].slice(0, 6);
}

function resetFoodForm() {
  ui.form = freshForm();
  $('foodForm').reset();
  $('foodQuantity').value = 100;
  $('foodUnit').value = 'g';
  setNutrientEditing(false);
  $('formTitle').textContent = 'Add food';
  $('saveFood').textContent = 'Add to today';
  $('cancelEdit').hidden = true;
  $('lookupStatus').textContent = '';
  $('photoStatus').textContent = 'Attach a photo for your own reference — enter the food name below to calculate nutrition.';
  $('photoPreview').hidden = true;
  $('photoPlaceholder').hidden = false;
  $('photoInput').value = '';
}

function startEditFood(index) {
  const food = state.foods[index];
  ui.form.editingIndex = index;
  ui.form.manualMode = true;
  $('foodName').value = food.name;
  $('foodQuantity').value = food.quantity || 100;
  $('foodUnit').value = food.unit || 'g';
  setFoodValues(food);
  setNutrientEditing(true);
  $('formTitle').textContent = 'Edit food';
  $('lookupStatus').textContent = 'Editing saved entry. Unknown nutrient values may stay blank; blanks are not included in totals.';
  $('saveFood').textContent = 'Update food';
  $('cancelEdit').hidden = false;
  showTab('log');
}

function removeFood(index) {
  state.foods.splice(index, 1);
  save();
}

function renderLog(derived) {
  const foods = state.foods;
  $('noFoodsNote').hidden = foods.length > 0;
  const list = $('foodList');
  list.replaceChildren();
  foods.forEach((food, index) => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.innerHTML = `<strong>${food.name}</strong><p>${food.quantity}${food.unit} · ${Math.round(num(food.calories))} kcal · ${Math.round(num(food.protein) * 10) / 10}g protein</p>`;
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'edit-btn'; editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEditFood(index));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button'; deleteBtn.className = 'delete-btn'; deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeFood(index));
    actions.append(editBtn, deleteBtn);
    li.append(meta, actions);
    list.appendChild(li);
  });
}

$('photoInput').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    $('photoPreview').src = reader.result;
    $('photoPreview').hidden = false;
    $('photoPlaceholder').hidden = true;
    $('photoStatus').textContent = 'Reading photo…';
    try {
      const hash = await computeImageHash(reader.result);
      ui.form.photoHash = hash;
      const match = findFoodByPhotoHash(hash, state.customFoods);
      if (match) {
        $('foodName').value = match.name;
        $('photoStatus').textContent = `Recognized from your saved foods: ${match.name}.`;
        const quantity = num($('foodQuantity').value) || match.baseQuantity || 100;
        const result = await calculateFood(match.name, quantity, $('foodUnit').value, state.customFoods);
        if (result.values) {
          setFoodValues(result.values);
          ui.form.manualMode = result.manualMode;
          setNutrientEditing(result.manualMode);
        }
        $('lookupStatus').textContent = result.status;
      } else {
        $('photoStatus').textContent = 'New photo — enter the food name and tap Calculate. We’ll remember this photo so you don’t have to type the name next time.';
      }
    } catch {
      $('photoStatus').textContent = 'Photo attached for your reference. Enter the food name and tap Calculate.';
    }
  };
  reader.readAsDataURL(file);
});
$('photoThumb').addEventListener('click', () => $('photoInput').click());

// ---------- Barcode scanning ----------

let activeScanner = null;

$('scanBarcode').hidden = !isBarcodeScanSupported();

$('scanBarcode').addEventListener('click', async () => {
  $('scannerOverlay').hidden = false;
  activeScanner = scanBarcodeFromCamera($('scannerVideo'), $('scannerFallback'), message => {
    $('scannerStatus').textContent = message;
  });
  try {
    const code = await activeScanner.promise;
    $('scannerStatus').textContent = `Found ${code} — looking it up…`;
    const product = await lookupBarcode(code);
    activeScanner.stop();
    activeScanner = null;
    $('scannerOverlay').hidden = true;
    if (!product) {
      $('lookupStatus').textContent = 'This barcode is not in the food database yet. Enter the nutrition manually — it will be remembered.';
      return;
    }
    const quantity = product.servingG || num($('foodQuantity').value) || 100;
    $('foodName').value = product.name;
    $('foodQuantity').value = quantity;
    $('foodUnit').value = 'g';
    const factor = quantity / 100;
    setFoodValues(Object.fromEntries(NUTRIENTS.map(n => [n, num(product.per100[n]) * factor])));
    ui.form.manualMode = false;
    setNutrientEditing(false);
    $('lookupStatus').textContent = `Scanned: ${product.name}. Adjust the quantity if you ate more or less — then tap Calculate to rescale, or save as is.`;
  } catch (error) {
    if (activeScanner) { activeScanner.stop(); activeScanner = null; }
    $('scannerOverlay').hidden = true;
    if (!error || error.message !== 'cancelled') {
      $('lookupStatus').textContent = 'Could not start the camera. Allow camera access for this site and try again.';
    }
  }
});

$('scannerCancel').addEventListener('click', () => {
  if (activeScanner) { activeScanner.stop(); activeScanner = null; }
  $('scannerOverlay').hidden = true;
});

// ---------- Search-as-you-type food suggestions ----------

/**
 * Wires live suggestions from the built-in Indian food database onto a text
 * input. onPick(item) fires when the user taps a suggestion. Respects the
 * vegetarian-only preference.
 */
function attachFoodSuggest(inputId, listId, onPick) {
  const input = $(inputId);
  const list = $(listId);
  let items = [];

  function close() { list.hidden = true; list.replaceChildren(); }

  function render() {
    items = searchFoods(input.value, state.vegOnly, 8, suggestExtras());
    if (!items.length) { close(); return; }
    list.replaceChildren();
    items.forEach(item => {
      const tag = item.source === 'custom' ? ' · your food' : item.source === 'bank' ? ' · shared' : '';
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="suggest-name"><span class="suggest-veg ${item.v ? 'veg' : 'nonveg'}"></span>${item.n}</span>
        <span class="suggest-meta">${item.k} kcal · ${item.sl}${tag}</span>`;
      li.addEventListener('mousedown', event => { event.preventDefault(); onPick(item); close(); });
      list.appendChild(li);
    });
    list.hidden = false;
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) render(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

attachFoodSuggest('foodName', 'foodSuggestions', item => {
  $('foodName').value = item.n;
  $('foodQuantity').value = item.sg;
  $('foodUnit').value = 'g';
  // Your own / shared-bank foods resolve through the normal lookup so their
  // saved per-portion values (and any blank nutrients) are used correctly.
  if (item.source) { $('calculateFood').click(); return; }
  setFoodValues(scaleFoodDbItem(item, item.sg / 100));
  ui.form.manualMode = false;
  setNutrientEditing(false);
  $('lookupStatus').textContent = `Filled from the Indian food database (${item.n}, ${item.sl}). Change the quantity and tap Calculate to rescale.`;
});

$('calculateFood').addEventListener('click', async () => {
  const name = $('foodName').value.trim();
  const quantity = num($('foodQuantity').value);
  const unit = $('foodUnit').value;
  $('lookupStatus').textContent = quantity > 0 && name ? 'Finding nutrition values…' : '';
  const result = await calculateFood(name, quantity, unit, state.customFoods);
  $('lookupStatus').textContent = result.status;
  if (result.values) {
    setFoodValues(result.values);
    ui.form.manualMode = result.manualMode;
    setNutrientEditing(result.manualMode);
  }
});

$('manualNutrition').addEventListener('click', () => {
  ui.form.manualMode = true;
  setNutrientEditing(true);
  $('lookupStatus').textContent = 'Enter known nutrition values manually. Leave unknown values blank; blanks are not included in totals.';
});

// Read a nutrition table off a screenshot (label, or an AI food breakdown).
$('nutritionShotInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  $('lookupStatus').textContent = 'Reading the screenshot… the first time downloads the reader, which can take a minute.';
  const url = URL.createObjectURL(file);
  try {
    const text = await recognizeTextInImage(url, percent => {
      $('lookupStatus').textContent = `Reading the screenshot… ${percent}%`;
    });
    const parsed = parseNutritionFromText(text);
    const found = NUTRIENTS.filter(n => parsed.values[n] !== null);
    if (!found.length) {
      $('lookupStatus').textContent = 'Couldn’t read nutrition numbers from this image. Try a clearer screenshot, or use Enter manually.';
      return;
    }
    setFoodValues(parsed.values);
    if (parsed.servingG) { $('foodQuantity').value = parsed.servingG; $('foodUnit').value = 'g'; }
    ui.form.manualMode = true;
    setNutrientEditing(true);
    if (!$('foodName').value.trim()) $('foodName').focus();
    $('lookupStatus').textContent = `Read ${found.length} value(s) from the screenshot${parsed.servingG ? ` for ${parsed.servingG}g` : ''}. Add a food name, check the numbers, then Add to today.`;
  } catch (error) {
    $('lookupStatus').textContent = error.message || 'Could not read this image.';
  } finally {
    URL.revokeObjectURL(url);
  }
});

$('cancelEdit').addEventListener('click', resetFoodForm);

$('foodForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = standardName($('foodName').value);
  const quantity = num($('foodQuantity').value);
  const unit = $('foodUnit').value;
  const food = { name, quantity, unit };
  const hasAllValues = NUTRIENTS.every(n => {
    const field = $(`food${n[0].toUpperCase()}${n.slice(1)}`);
    food[n] = field.value === '' ? null : num(field.value);
    return field.value !== '';
  });
  if (!name || quantity <= 0 || (!ui.form.manualMode && !hasAllValues)) {
    $('lookupStatus').textContent = 'Calculate nutrition or use Enter nutrition manually before saving.';
    return;
  }
  if (ui.form.manualMode || ui.form.photoHash) {
    const baseQuantity = comparableQuantity(name, quantity, unit);
    const existing = state.customFoods[foodKey(name)];
    const photoHashes = existing && existing.photoHashes ? [...existing.photoHashes] : [];
    if (ui.form.photoHash && !photoHashes.some(saved => isSimilarPhoto(ui.form.photoHash, saved))) {
      photoHashes.push(ui.form.photoHash);
      if (photoHashes.length > 5) photoHashes.shift();
    }
    const nutrients = Object.fromEntries(NUTRIENTS.map(n => [n, food[n]]));
    state.customFoods[foodKey(name)] = { name, baseQuantity, photoHashes, ...nutrients };
    if (ui.form.manualMode) submitFoodForReview(foodKey(name), { name, baseQuantity, ...nutrients });
  }
  if (ui.form.editingIndex !== null) state.foods[ui.form.editingIndex] = food;
  else state.foods.push(food);
  pushRecent(food);
  save();
  resetFoodForm();
});

$('completeToday').addEventListener('click', () => {
  if (!state.foods.length && state.water === 0) {
    $('completeTodayMessage').textContent = 'Log some food or water first.';
    setTimeout(() => { $('completeTodayMessage').textContent = ''; }, 2500);
    return;
  }
  archiveCurrentDay(state);
  save();
  $('completeTodayMessage').textContent = 'Today saved to history.';
  setTimeout(() => { $('completeTodayMessage').textContent = ''; }, 2500);
});

// ---------- Trends tab ----------

function renderTrends(derived) {
  $('weekRange').textContent = derived.weekRangeLabel;
  $('weeklyGrade').textContent = derived.weeklyGrade;
  $('weeklyScoreLabel').textContent = `${derived.weeklyScore}/100`;

  // Score rows all measure "how well you're doing", so they stay in the
  // green/teal family — a red bar at 100/100 reads like a problem.
  const scoreDefs = [
    ['Calories on target', derived.weekScore.cal, 'var(--accent)'],
    ['Protein', derived.weekScore.protein, 'var(--accent2)'],
    ['Fibre', derived.weekScore.fibre, 'var(--accent2)'],
    ['Hydration', derived.weekScore.hyd, 'var(--water)'],
    ['Sugar control', derived.weekScore.sugar, 'var(--accent2)'],
  ];
  renderScoreRows('scoreRows', scoreDefs.map(([label, value, color]) => ({ label, value: `${value}/100`, percent: value, color })));

  const spark = $('sparkline');
  spark.classList.add('with-values');
  spark.replaceChildren();
  derived.sparkline.forEach(point => {
    const bar = document.createElement('div');
    const status = point.overLimit ? 'over' : 'under';
    bar.className = `spark-bar${point.isToday ? ' today' : ''}`;
    bar.innerHTML = `
      <span class="spark-value ${status}">${point.calories}</span>
      <div class="bar ${status}" style="height:${point.heightPercent}%"></div>
      <span>${point.label}</span>`;
    spark.appendChild(bar);
  });

  const weeklyDefs = [
    ['calories', 'Calories', 'kcal', 'var(--accent)'],
    ['protein', 'Protein', 'g', 'var(--accent2)'],
    ['carbs', 'Carbs', 'g', 'var(--accent)'],
    ['fat', 'Fat', 'g', 'var(--fat)'],
    ['fibre', 'Fibre', 'g', 'var(--accent2)'],
    ['sugar', 'Sugar', 'g', 'var(--sugar-c)'],
    ['water', 'Water', 'L', 'var(--water)'],
  ];
  const weeklyRows = weeklyDefs.map(([key, label, unit, color]) => {
    const perDayTarget = num(state.targets[key]);
    const target = Math.max(1, perDayTarget * 7);
    const achieved = derived.weekly.weekly[key];
    return {
      label,
      value: `${Math.round(achieved * 10) / 10}${unit === 'kcal' ? ' kcal' : ` ${unit}`}`,
      target: `${Math.round(target * 10) / 10} ${unit}`,
      percent: Math.min(100, Math.round((achieved / target) * 100)),
      color,
    };
  });
  renderScoreRows('weeklyRows', weeklyRows.map(r => ({ label: r.label, value: `${r.value} / ${r.target}`, percent: r.percent, color: r.color })));

  $('noHistoryNote').hidden = state.history.length > 0;
  const from = $('historyFrom').value;
  const to = $('historyTo').value;
  let entries = state.history;
  if (from) entries = entries.filter(h => h.id >= from);
  if (to) entries = entries.filter(h => h.id <= to);
  if (!from && !to) {
    entries = entries.slice(0, 2);
    $('historyRangeNote').textContent = state.history.length > 2 ? `Showing the latest 2 of ${state.history.length} days — pick a date range above to see more.` : '';
  } else {
    $('historyRangeNote').textContent = `${entries.length} day${entries.length === 1 ? '' : 's'} in this range.`;
  }
  const historyList = $('historyList');
  historyList.replaceChildren();
  entries.forEach(h => {
    const div = document.createElement('div');
    const nutrientDefs = [
      ['Protein', `${Math.round(num(h.protein) * 10) / 10}g`],
      ['Carbs', `${Math.round(num(h.carbs) * 10) / 10}g`],
      ['Fat', `${Math.round(num(h.fat) * 10) / 10}g`],
      ['Fibre', `${Math.round(num(h.fibre) * 10) / 10}g`],
      ['Sugar', `${Math.round(num(h.sugar) * 10) / 10}g`],
      ['Water', `${Math.round(num(h.water) * 1000)}ml`],
    ];
    div.innerHTML = `
      <div class="history-top"><strong>${h.id ? displayDate(h.id) : h.date}</strong><strong>${Math.round(num(h.calories))} kcal</strong></div>
      <div class="history-grid">${nutrientDefs.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
    historyList.appendChild(div);
  });
}

$('historyFrom').addEventListener('change', render);
$('historyTo').addEventListener('change', render);

function renderScoreRows(containerId, rows) {
  const container = $(containerId);
  container.replaceChildren();
  rows.forEach(row => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="score-row-label"><span>${row.label}</span><span class="value">${row.value}</span></div>
      <div class="score-row-track"><div class="score-row-fill" style="width:${row.percent}%;background:${row.color}"></div></div>`;
    container.appendChild(div);
  });
}

// ---------- Weight tab ----------

$('logWeight').addEventListener('click', () => {
  const kg = num($('weightInput').value);
  if (kg <= 0 || kg > 500) {
    $('weightMessage').textContent = 'Enter a valid weight in kg.';
    return;
  }
  const id = state.currentDate;
  state.weights = [...state.weights.filter(w => w.id !== id), { id, kg }].sort((a, b) => (a.id < b.id ? -1 : 1));
  const canRecalc = num(state.profile.heightCm) > 0 && num(state.profile.age) > 0;
  save();
  $('weightInput').value = '';
  $('weightMessage').textContent = canRecalc ? 'Weigh-in saved. Tap "Retune targets" to adjust your nutrition to the new weight.' : 'Weigh-in saved.';
  setTimeout(() => { $('weightMessage').textContent = ''; }, 4000);
});

$('retuneTargets').addEventListener('click', applyComputedTargets);

function applyComputedTargets() {
  const targets = computeTargetsFromProfile(state.profile, latestWeight(state));
  if (!targets) {
    const msg = num(state.profile.heightCm) > 0 ? 'weightMessage' : 'profileMessage';
    $(msg).textContent = 'Fill height, age and log at least one weigh-in first.';
    setTimeout(() => { $(msg).textContent = ''; }, 3000);
    return;
  }
  state.targets = targets;
  save();
  $('profileMessage').textContent = `Targets set for ${latestWeight(state)} kg. Recalculate anytime as your weight changes.`;
  setTimeout(() => { $('profileMessage').textContent = ''; }, 4000);
}

function removeWeight(id) {
  state.weights = state.weights.filter(w => w.id !== id);
  save();
}

function renderWeight(derived) {
  const hasWeights = state.weights.length > 0;
  const canRetune = num(state.profile.heightCm) > 0 && num(state.profile.age) > 0 && hasWeights;
  $('retuneTargets').hidden = !canRetune;

  $('journeyCard').hidden = !derived.journey.active;
  if (derived.journey.active) {
    $('journeyLostLabel').textContent = derived.journey.lostLabel;
    $('journeyBar').style.width = `${derived.journey.percent}%`;
    $('journeyStartLabel').textContent = `Start ${derived.journey.startLabel}`;
    $('journeyLeftLabel').textContent = derived.journey.leftLabel;
    $('journeyGoalLabel').textContent = `Goal ${derived.journey.goalLabel}`;
    $('journeyEtaLabel').textContent = derived.journey.etaLabel;
    $('journeyEtaLabel').hidden = !derived.journey.etaLabel;
  }

  const idealRange = derived.idealRange;
  $('idealWeightBlock').hidden = !idealRange;
  $('noIdealNote').hidden = !!idealRange;
  if (idealRange) {
    $('idealRangeLabel').textContent = `${idealRange.min} – ${idealRange.max} kg`;
    $('idealTargetLabel').textContent = `${idealRange.target} kg`;
    $('idealScaleWrap').hidden = !hasWeights;
    if (hasWeights) {
      const current = latestWeight(state);
      const percent = Math.max(0, Math.min(100, Math.round(((current - idealRange.min) / Math.max(0.1, idealRange.max - idealRange.min)) * 100)));
      $('idealMarker').style.left = `${percent}%`;
      const diff = Math.round((current - idealRange.target) * 10) / 10;
      $('idealToGoLabel').textContent = `You're ${diff > 0 ? `${diff} kg above target` : diff < 0 ? `${Math.abs(diff)} kg below target` : 'right at your target'} (${current} kg now).`;
    }
  }

  $('weightChartCard').hidden = !hasWeights;
  $('weightEntriesSection').hidden = !hasWeights;
  $('noWeightsNote').hidden = hasWeights;

  const forecast = computeWeightForecast(state.weights, num(state.profile.goalWeight));
  $('forecastCard').hidden = !forecast;
  if (forecast) {
    $('forecastEtaLabel').textContent = forecast.etaLabel || `Trend: ${forecast.weeklyRate >= 0 ? '+' : ''}${forecast.weeklyRate} kg/week based on your weigh-ins.`;
    const row = $('forecastRow');
    row.replaceChildren();
    forecast.projected.forEach(point => {
      const chip = document.createElement('div');
      chip.className = 'forecast-chip';
      chip.innerHTML = `<span>+${point.weeksOut}w</span><strong>${point.kg} kg</strong>`;
      row.appendChild(chip);
    });
  }

  if (hasWeights) {
    const current = latestWeight(state);
    $('currentWeightValue').textContent = current;
    $('weightDeltaLabel').textContent = derived.weightDeltaLabel;

    const bars = weightBarData(state.weights, 7);
    const chart = $('weightChart');
    chart.replaceChildren();
    bars.forEach(bar => {
      const div = document.createElement('div');
      div.className = `spark-bar${bar.isLatest ? ' today' : ''}`;
      div.innerHTML = `<div class="bar" style="height:${bar.heightPercent}%"></div><span>${bar.label}</span>`;
      chart.appendChild(div);
    });

    const list = $('weightList');
    list.replaceChildren();
    [...state.weights].reverse().forEach(w => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = w.id ? displayDate(w.id) : '';
      const right = document.createElement('div');
      right.className = 'qty';
      const kg = document.createElement('strong');
      kg.textContent = `${w.kg} kg`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button'; removeBtn.className = 'round-add'; removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeWeight(w.id));
      right.append(kg, removeBtn);
      li.append(label, right);
      list.appendChild(li);
    });
  }
}

// ---------- Activity tab ----------

async function applyActivitySync({ silent } = {}) {
  if (!currentUser) return;
  const sync = await fetchActivitySync(state.healthSyncToken);
  if (!sync || sync.date !== state.currentDate) {
    if (!silent) {
      $('syncMessage').textContent = 'No synced data for today yet. Set it up once in Profile → Apple Watch / Health sync, or add from a screenshot below.';
      setTimeout(() => { $('syncMessage').textContent = ''; }, 7000);
    }
    return;
  }
  // Take the higher of synced vs manual per field so a manual top-up is never lost.
  const merged = {
    steps: Math.max(num(state.activityToday.steps), num(sync.steps)),
    burnKcal: Math.max(num(state.activityToday.burnKcal), num(sync.burnKcal)),
    exMin: Math.max(num(state.activityToday.exMin), num(sync.exMin)),
  };
  const changed = merged.steps !== num(state.activityToday.steps)
    || merged.burnKcal !== num(state.activityToday.burnKcal)
    || merged.exMin !== num(state.activityToday.exMin);
  state.activityToday = merged;
  if (!silent) {
    $('syncMessage').textContent = changed ? 'Synced from your phone’s health data.' : 'Already up to date with your phone’s health data.';
    setTimeout(() => { $('syncMessage').textContent = ''; }, 5000);
  }
  if (changed) save();
}

$('syncDevice').addEventListener('click', () => {
  $('syncMessage').textContent = 'Checking for synced health data…';
  applyActivitySync();
});

// ---------- Activity from a screenshot ----------

$('activityPhotoInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  $('activityPhotoResult').hidden = true;
  $('activityPhotoStatus').textContent = 'Reading the screenshot… the first time downloads the reader, which can take a minute.';
  const url = URL.createObjectURL(file);
  try {
    const text = await recognizeTextInImage(url, percent => {
      $('activityPhotoStatus').textContent = `Reading the screenshot… ${percent}%`;
    });
    const parsed = parseActivityFromText(text);
    $('ocrSteps').value = parsed.steps === null ? '' : parsed.steps;
    $('ocrBurn').value = parsed.burnKcal === null ? '' : parsed.burnKcal;
    $('ocrExMin').value = parsed.exMin === null ? '' : parsed.exMin;
    $('activityPhotoResult').hidden = false;
    const foundAny = parsed.steps !== null || parsed.burnKcal !== null || parsed.exMin !== null;
    $('activityPhotoStatus').textContent = foundAny
      ? 'Check the numbers read from the screenshot, correct anything, then tap Apply.'
      : 'Couldn’t confidently read numbers from this image — type them below and tap Apply.';
  } catch (error) {
    $('activityPhotoStatus').textContent = error.message || 'Could not read this image.';
  } finally {
    URL.revokeObjectURL(url);
  }
});

$('applyOcr').addEventListener('click', () => {
  state.activityToday = {
    steps: Math.max(num(state.activityToday.steps), num($('ocrSteps').value)),
    burnKcal: Math.max(num(state.activityToday.burnKcal), num($('ocrBurn').value)),
    exMin: Math.max(num(state.activityToday.exMin), num($('ocrExMin').value)),
  };
  $('activityPhotoResult').hidden = true;
  $('activityPhotoStatus').textContent = 'Applied to today.';
  setTimeout(() => { $('activityPhotoStatus').textContent = ''; }, 3000);
  save();
});

function bumpActivity(key, amount) {
  state.activityToday[key] = Math.max(0, num(state.activityToday[key]) + amount);
  save();
}

function renderActivity(derived) {
  const activityDefs = [
    ['steps', 'Steps', 'var(--accent)', v => v.toLocaleString()],
    ['burnKcal', 'Calories burned', 'var(--fat)', v => `${v} kcal`],
    ['exMin', 'Exercise', 'var(--accent2)', v => `${v} min`],
  ];
  const rows = activityDefs.map(([key, label, color, fmt]) => {
    const value = num(state.activityToday[key]);
    const goal = Math.max(1, num(state.activityTargets[key]));
    return { label, value: `${fmt(value)} / ${fmt(goal)}`, percent: Math.min(100, Math.round((value / goal) * 100)), color };
  });
  renderScoreRows('activityRows', rows);

  const bumps = $('activityBumps');
  bumps.replaceChildren();
  [['steps', 1000, '+1,000 steps'], ['burnKcal', 50, '+50 kcal'], ['exMin', 10, '+10 min']].forEach(([key, amount, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip-button flex1'; btn.textContent = label;
    btn.addEventListener('click', () => bumpActivity(key, amount));
    bumps.appendChild(btn);
  });

  const fields = $('activityFields');
  fields.replaceChildren();
  [['steps', 'Steps'], ['burnKcal', 'Calories burned'], ['exMin', 'Exercise (min)']].forEach(([key, label]) => {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.value = state.activityToday[key];
    input.addEventListener('change', () => { state.activityToday[key] = num(input.value); save(); });
    wrap.append(label, input);
    fields.appendChild(wrap);
  });

  const goalFields = $('activityGoalFields');
  goalFields.replaceChildren();
  [['steps', 'Steps / day'], ['burnKcal', 'Burn (kcal)'], ['exMin', 'Exercise (min)']].forEach(([key, label]) => {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.value = state.activityTargets[key];
    input.addEventListener('change', () => { state.activityTargets[key] = num(input.value); save(); });
    wrap.append(label, input);
    goalFields.appendChild(wrap);
  });

  const historyRows = state.history.filter(h => h.steps != null || h.burnKcal != null || h.exMin != null);
  $('noActivityHistoryNote').hidden = historyRows.length > 0;
  const list = $('activityHistoryList');
  list.replaceChildren();
  historyRows.forEach(h => {
    const div = document.createElement('div');
    div.innerHTML = `<strong>${h.id ? displayDate(h.id) : h.date}</strong>
      <div style="display:flex;gap:12px">
        <span class="muted small">${num(h.steps).toLocaleString()} steps</span>
        <span class="muted small">${num(h.burnKcal)} kcal</span>
        <span class="muted small">${num(h.exMin)} min</span>
      </div>`;
    list.appendChild(div);
  });
}

// ---------- Meals (presets) tab ----------

attachFoodSuggest('presetItemName', 'presetSuggestions', item => {
  $('presetItemName').value = item.n;
  $('presetItemQuantity').value = item.sg;
  $('presetItemUnit').value = 'g';
  // Your own / shared-bank foods resolve through the normal lookup so their
  // saved per-portion values (and any blank nutrients) are used correctly.
  if (item.source) { $('presetCalculate').click(); return; }
  setPresetGridValues(scaleFoodDbItem(item, item.sg / 100));
  ui.presetItemManual = false;
  showPresetGrid();
  $('presetItemStatus').textContent = `${item.n} (${item.sl}) — review the nutrition and tap Add this item.`;
});

const PRESET_NUTRIENT_IDS = { calories: 'presetCalories', protein: 'presetProtein', carbs: 'presetCarbs', fat: 'presetFat', fibre: 'presetFibre', sugar: 'presetSugar' };

// ui.presetItemManual tracks whether the currently-shown values were typed by
// hand (so they should be remembered app-wide) or came from a lookup.
function readPresetGridValues() {
  return Object.fromEntries(Object.entries(PRESET_NUTRIENT_IDS).map(([key, id]) => [key, $(id).value === '' ? null : num($(id).value)]));
}

function setPresetGridValues(values) {
  Object.entries(PRESET_NUTRIENT_IDS).forEach(([key, id]) => {
    const v = values[key];
    $(id).value = v === null || v === undefined ? '' : Number(num(v).toFixed(1));
  });
}

/** Reveals the nutrition grid + "Add this item" button for the current food. */
function showPresetGrid() {
  $('presetNutrientGrid').hidden = false;
  $('addPresetItem').hidden = false;
}

function clearPresetItemEntry() {
  $('presetItemName').value = '';
  $('presetItemQuantity').value = 100;
  $('presetItemUnit').value = 'g';
  setPresetGridValues({ calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '' });
  $('presetNutrientGrid').hidden = true;
  $('addPresetItem').hidden = true;
  ui.presetItemManual = false;
}

$('presetCalculate').addEventListener('click', async () => {
  const name = $('presetItemName').value.trim();
  const quantity = num($('presetItemQuantity').value);
  const unit = $('presetItemUnit').value;
  if (!name || quantity <= 0) { $('presetItemStatus').textContent = 'Enter a food name and quantity first.'; return; }
  $('presetItemStatus').textContent = 'Finding nutrition values…';
  const result = await calculateFood(name, quantity, unit, state.customFoods);
  if (!result.values) {
    setPresetGridValues({ calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '' });
    ui.presetItemManual = true;
    showPresetGrid();
    $('presetItemStatus').textContent = `Couldn't find "${name}". Type its nutrition below, then tap Add this item — it'll be remembered for next time.`;
    return;
  }
  setPresetGridValues(result.values);
  ui.presetItemManual = result.manualMode;
  showPresetGrid();
  $('presetItemStatus').textContent = `${result.status} Review, then tap Add this item.`;
});

$('presetManualToggle').addEventListener('click', () => {
  setPresetGridValues({ calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '' });
  ui.presetItemManual = true;
  showPresetGrid();
  $('presetItemStatus').textContent = 'Type the nutrition for this quantity of the food, then tap Add this item.';
});

$('presetShotInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  $('presetItemStatus').textContent = 'Reading the screenshot… the first time downloads the reader, which can take a minute.';
  const url = URL.createObjectURL(file);
  try {
    const text = await recognizeTextInImage(url, percent => { $('presetItemStatus').textContent = `Reading the screenshot… ${percent}%`; });
    const parsed = parseNutritionFromText(text);
    const found = NUTRIENTS.filter(n => parsed.values[n] !== null);
    if (!found.length) {
      $('presetItemStatus').textContent = 'Couldn’t read nutrition from this image. Type it in, or try a clearer screenshot.';
      setPresetGridValues({ calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '' });
    } else {
      setPresetGridValues(parsed.values);
      if (parsed.servingG) { $('presetItemQuantity').value = parsed.servingG; $('presetItemUnit').value = 'g'; }
      $('presetItemStatus').textContent = `Read ${found.length} value(s)${parsed.servingG ? ` for ${parsed.servingG}g` : ''}. Add a food name, check the numbers, then Add this item.`;
    }
    ui.presetItemManual = true;
    showPresetGrid();
  } catch (error) {
    $('presetItemStatus').textContent = error.message || 'Could not read this image.';
  } finally {
    URL.revokeObjectURL(url);
  }
});

$('addPresetItem').addEventListener('click', () => {
  const name = standardName($('presetItemName').value);
  const quantity = num($('presetItemQuantity').value);
  const unit = $('presetItemUnit').value;
  if (!name || quantity <= 0) { $('presetItemStatus').textContent = 'Enter a food name and quantity first.'; return; }
  const values = readPresetGridValues();
  if (values.calories === null && values.protein === null) {
    $('presetItemStatus').textContent = 'Calculate, read a screenshot, or type the nutrition before adding.';
    return;
  }
  if (ui.presetItemManual) {
    // Remember typed values app-wide (and queue for the shared bank) so future lookups find this food.
    const baseQuantity = comparableQuantity(name, quantity, unit);
    const clean = Object.fromEntries(NUTRIENTS.map(n => [n, num(values[n])]));
    state.customFoods[foodKey(name)] = { name, baseQuantity, ...clean };
    submitFoodForReview(foodKey(name), { name, baseQuantity, ...clean });
  }
  ui.presetDraft.push({ name, quantity, unit, ...Object.fromEntries(NUTRIENTS.map(n => [n, num(values[n])])) });
  clearPresetItemEntry();
  $('presetItemStatus').textContent = '';
  renderMeals();   // reflect the new draft item immediately, before any async save
  save();
});

$('presetForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('presetName').value;
  if (!ui.presetDraft.length) { $('presetItemStatus').textContent = 'Add at least one food item first.'; return; }
  // Multiple combinations per meal type are allowed (Breakfast: Poha + Tea,
  // Breakfast: Milk + Cornflakes, ...), so saving always adds a new preset.
  state.mealPresets = [
    { id: Date.now().toString(36), name, items: ui.presetDraft },
    ...state.mealPresets,
  ];
  const label = `${name}: ${ui.presetDraft.map(i => i.name).join(' + ')}`;
  ui.presetDraft = [];
  $('presetItemStatus').textContent = `Saved "${label}". Log it any time from here or the Add food page.`;
  setTimeout(() => { $('presetItemStatus').textContent = ''; }, 4000);
  save();
});

$('resetPreset').addEventListener('click', () => {
  ui.presetDraft = [];
  $('presetForm').reset();
  clearPresetItemEntry();
  $('presetItemStatus').textContent = '';
  renderMeals();
});

function logPreset(preset) {
  preset.items.forEach(item => {
    state.foods.push({ ...item });
    pushRecent(item);
  });
  save();
  showTab('log');
  $('completeTodayMessage').textContent = `Logged "${preset.name}" (${preset.items.length} item${preset.items.length > 1 ? 's' : ''}).`;
  setTimeout(() => { $('completeTodayMessage').textContent = ''; }, 3000);
}

function removePreset(id) {
  state.mealPresets = state.mealPresets.filter(p => p.id !== id);
  save();
}

function presetLabel(preset) {
  return `${preset.name}: ${preset.items.map(i => i.name).join(' + ')}`;
}

function renderMeals() {
  const draftList = $('presetItemsList');
  draftList.replaceChildren();
  ui.presetDraft.forEach((item, index) => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.innerHTML = `<strong>${item.name}</strong><p>${item.quantity}${item.unit} · ${Math.round(num(item.calories))} kcal · ${Math.round(num(item.protein) * 10) / 10}g protein</p>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'round-add'; removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => { ui.presetDraft.splice(index, 1); renderMeals(); });
    li.append(meta, removeBtn);
    draftList.appendChild(li);
  });
  if (ui.presetDraft.length) {
    const t = totalsFor(ui.presetDraft);
    $('presetTotalsLabel').textContent = `Total: ${Math.round(t.calories)} kcal · ${Math.round(t.protein * 10) / 10}g protein · ${Math.round(t.carbs * 10) / 10}g carbs · ${Math.round(t.fat * 10) / 10}g fat · ${Math.round(t.fibre * 10) / 10}g fibre · ${Math.round(t.sugar * 10) / 10}g sugar`;
  } else {
    $('presetTotalsLabel').textContent = '';
  }

  $('noPresetsNote').hidden = state.mealPresets.length > 0;
  const list = $('presetList');
  list.replaceChildren();
  state.mealPresets.forEach(preset => {
    const t = totalsFor(preset.items);
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.innerHTML = `<strong>${preset.name}</strong><p>${preset.items.map(i => i.name).join(' + ')} · ${Math.round(t.calories)} kcal · ${Math.round(t.protein * 10) / 10}g protein</p>`;
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const logBtn = document.createElement('button');
    logBtn.type = 'button'; logBtn.className = 'edit-btn'; logBtn.textContent = 'Log now';
    logBtn.addEventListener('click', () => logPreset(preset));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button'; deleteBtn.className = 'delete-btn'; deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removePreset(preset.id));
    actions.append(logBtn, deleteBtn);
    li.append(meta, actions);
    list.appendChild(li);
  });

  renderPresetSelect();
}

/** The Add food form offers saved preset meals in a dropdown for quick logging. */
function renderPresetSelect() {
  const select = $('logPresetSelect');
  select.hidden = false;
  select.replaceChildren();
  if (!state.mealPresets.length) {
    select.appendChild(new Option('No preset meals yet — save one in the Meals tab', ''));
    select.value = '';
    return;
  }
  select.appendChild(new Option('Or log a preset meal…', ''));
  state.mealPresets.forEach(preset => {
    const t = totalsFor(preset.items);
    select.appendChild(new Option(`${presetLabel(preset)} · ${Math.round(t.calories)} kcal`, preset.id));
  });
  select.value = '';
}

$('logPresetSelect').addEventListener('change', () => {
  const preset = state.mealPresets.find(p => p.id === $('logPresetSelect').value);
  $('logPresetSelect').value = '';
  if (!preset) return;
  const t = totalsFor(preset.items);
  if (!confirm(`Add "${presetLabel(preset)}" (${Math.round(t.calories)} kcal) to today?`)) return;
  logPreset(preset);
});

// ---------- Profile tab ----------

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleAvatarInput(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  state.avatar = await resizeAvatar(file);
  save();
}

$('avatarCameraInput').addEventListener('change', handleAvatarInput);
$('avatarGalleryInput').addEventListener('change', handleAvatarInput);
$('removeAvatar').addEventListener('click', () => { state.avatar = ''; save(); });

$('profileNameInput').addEventListener('change', () => {
  state.displayName = $('profileNameInput').value.trim();
  save();
});

const PROFILE_FIELD_IDS = { heightCm: 'profileHeight', age: 'profileAge', sex: 'profileSex', activity: 'profileActivity', goal: 'profileGoal', goalWeight: 'profileGoalWeight', pace: 'profilePace' };
Object.entries(PROFILE_FIELD_IDS).forEach(([key, id]) => {
  $(id).addEventListener('change', () => {
    state.profile[key] = $(id).value;
    save();
  });
});

$('applyComputedTargets').addEventListener('click', applyComputedTargets);

const TARGET_FIELD_DEFS = [
  ['calories', 'Calories'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'],
  ['fat', 'Fat (g)'], ['fibre', 'Fibre (g)'], ['sugar', 'Sugar (g)'], ['water', 'Water (L)'],
];

$('targetsForm').addEventListener('submit', event => {
  event.preventDefault();
  save();
});

$('downloadBackup').addEventListener('click', () => exportBackupFile(state));
$('restoreFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('Replace the current entries with this backup?')) return;
  try {
    state = await readBackupFile(file);
    save();
    alert('Your backup has been restored.');
  } catch {
    alert('This backup file could not be read. Please choose a Nutrition Pulse backup file.');
  }
});

$('alertsToggle').addEventListener('click', async () => {
  if (!state.alertsEnabled) {
    // Alerts always work as in-app banners; system notifications are a bonus
    // where the browser supports and permits them (iOS Safari has no
    // Notification API in the browser at all, for example).
    state.alertsEnabled = true;
    if (notificationsSupported()) {
      const granted = await requestNotificationPermission();
      $('alertsMessage').textContent = granted
        ? 'Pace alerts are on — shown in the app and as notifications.'
        : 'Pace alerts are on — shown inside the app. (System notifications are blocked; allow them in browser settings if you also want those.)';
    } else {
      $('alertsMessage').textContent = 'Pace alerts are on — shown inside the app while it’s open.';
    }
  } else {
    state.alertsEnabled = false;
    $('alertsMessage').textContent = '';
  }
  save();
});

// ---------- Admin: food bank moderation ----------

$('refreshPending').addEventListener('click', renderPendingFoods);
$('refreshFoodBank').addEventListener('click', renderFoodBank);
$('foodBankSearch').addEventListener('input', renderFoodBankResults);

let adminFoodBankEntries = [];

/** Admin-only: loads the approved shared foods so they can be searched and deleted. */
async function renderFoodBank() {
  if (!isAdmin()) { $('adminFoodBankCard').hidden = true; return; }
  $('adminFoodBankCard').hidden = false;
  adminFoodBankEntries = (await fetchFoodBank()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  renderFoodBankResults();
}

/** Renders only the approved foods matching the admin's search box, each with Delete. */
function renderFoodBankResults() {
  const q = $('foodBankSearch').value.trim().toLowerCase();
  const list = $('foodBankList');
  const hint = $('foodBankHint');
  list.replaceChildren();
  if (!q) {
    hint.textContent = `Type a food name to find it (${adminFoodBankEntries.length} approved).`;
    hint.hidden = false;
    return;
  }
  const matches = adminFoodBankEntries.filter(entry => (entry.name || '').toLowerCase().includes(q));
  if (!matches.length) {
    hint.textContent = `No approved foods match “${q}”.`;
    hint.hidden = false;
    return;
  }
  hint.hidden = true;
  matches.slice(0, 20).forEach(entry => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.innerHTML = `<strong>${entry.name}</strong><p>${Math.round(num(entry.calories))} kcal · ${Math.round(num(entry.protein) * 10) / 10}g protein · per ${entry.baseQuantity || 100}g${entry.approvedBy ? ` · approved by ${entry.approvedBy}` : ''}</p>`;
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button'; deleteBtn.className = 'delete-btn'; deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${entry.name}" from the shared food bank? This removes it for everyone.`)) return;
      await deleteFoodBankEntry(entry.key);
      adminFoodBankEntries = adminFoodBankEntries.filter(item => item.key !== entry.key);
      await loadFoodBankCache();
      renderFoodBankResults();
    });
    actions.append(deleteBtn);
    li.append(meta, actions);
    list.appendChild(li);
  });
  if (matches.length > 20) {
    const more = document.createElement('li');
    more.className = 'muted small';
    more.textContent = `Showing first 20 of ${matches.length}. Refine your search.`;
    list.appendChild(more);
  }
}

async function renderPendingFoods() {
  if (!isAdmin()) { $('adminCard').hidden = true; return; }
  $('adminCard').hidden = false;
  const pending = await fetchPendingFoods();
  $('noPendingNote').hidden = pending.length > 0;
  const list = $('pendingList');
  list.replaceChildren();
  pending.forEach(entry => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.innerHTML = `<strong>${entry.name}</strong><p>${Math.round(num(entry.calories))} kcal · ${Math.round(num(entry.protein) * 10) / 10}g protein · per ${entry.baseQuantity || 100}g${entry.submittedBy ? ` · by ${entry.submittedBy}` : ''}</p>`;
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button'; approveBtn.className = 'edit-btn'; approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', async () => { await approvePendingFood(entry.key, entry); renderPendingFoods(); loadFoodBankCache(); renderFoodBank(); });
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button'; rejectBtn.className = 'delete-btn'; rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', async () => { await rejectPendingFood(entry.key); renderPendingFoods(); });
    actions.append(approveBtn, rejectBtn);
    li.append(meta, actions);
    list.appendChild(li);
  });
}

let alertBannerTimer = null;
function showInAppAlert(title, body) {
  $('alertBannerTitle').textContent = title;
  $('alertBannerBody').textContent = body;
  $('alertBanner').hidden = false;
  clearTimeout(alertBannerTimer);
  alertBannerTimer = setTimeout(() => { $('alertBanner').hidden = true; }, 7000);
}
$('alertBanner').addEventListener('click', () => { $('alertBanner').hidden = true; });

/** Fires each pace alert at most once per day, only while alerts are enabled. */
function checkAndFireAlerts(derived) {
  if (!state.alertsEnabled) return;
  const today = state.currentDate;
  const alerts = checkPaceAlerts(state, derived.todayTotals, derived.waterMl);
  let dirty = false;
  alerts.forEach(alert => {
    if (state.lastAlertDate[alert.key] === today) return;
    state.lastAlertDate[alert.key] = today;
    dirty = true;
    showInAppAlert(alert.title, alert.body);
    fireNotification(alert.title, alert.body);
  });
  if (dirty) saveLocalState(state, currentUser && currentUser.uid);
}

function renderProfile() {
  const hasAvatar = !!state.avatar;
  $('profileAvatarImg').hidden = !hasAvatar;
  $('profileAvatarPlaceholder').hidden = hasAvatar;
  if (hasAvatar) $('profileAvatarImg').src = state.avatar;
  $('removeAvatar').hidden = !hasAvatar;
  if (document.activeElement !== $('profileNameInput')) $('profileNameInput').value = state.displayName;

  Object.entries(PROFILE_FIELD_IDS).forEach(([key, id]) => { $(id).value = state.profile[key]; });

  const fields = $('targetFields');
  fields.replaceChildren();
  TARGET_FIELD_DEFS.forEach(([key, label]) => {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = key === 'water' ? '0.1' : '1'; input.value = state.targets[key];
    input.addEventListener('change', () => { state.targets[key] = num(input.value); save(); });
    wrap.append(label, input);
    fields.appendChild(wrap);
  });

  renderBMI();

  applyTheme();
  $('alertsToggle').classList.toggle('on', !!state.alertsEnabled);
  renderWatchSyncInstructions();
  $('adminCard').hidden = !isAdmin();
  $('adminFoodBankCard').hidden = !isAdmin();
}

function renderBMI() {
  const bmi = computeBMI(state.profile, latestWeight(state));
  const card = $('bmiCard');
  if (!bmi) {
    card.hidden = false;
    $('bmiValue').textContent = '—';
    $('bmiCategory').textContent = 'Add height & weight';
    $('bmiCategory').dataset.tone = '';
    $('bmiAdvice').textContent = 'Enter your height above and log a weigh-in on the Weight tab to see your BMI.';
    return;
  }
  card.hidden = false;
  $('bmiValue').textContent = bmi.value;
  $('bmiCategory').textContent = bmi.category;
  $('bmiCategory').dataset.tone = bmi.tone;

  const range = idealWeightRange(state.profile);
  let advice = 'A healthy BMI is between 18.5 and 24.9.';
  if (range) {
    advice = `A healthy BMI is 18.5–24.9, which for your height is about ${range.min}–${range.max} kg (ideal around ${range.target} kg).`;
    const current = latestWeight(state);
    if (bmi.tone === 'high') {
      advice += ` You're about ${Math.round((current - range.max) * 10) / 10} kg above the healthy range.`;
    } else if (bmi.tone === 'low') {
      advice += ` You're about ${Math.round((range.min - current) * 10) / 10} kg below the healthy range.`;
    } else {
      advice += ` You're within the healthy range — nice work.`;
    }
  }
  $('bmiAdvice').textContent = advice;
}

function renderWatchSyncInstructions() {
  const container = $('watchSyncInstructions');
  if (!currentUser || !state.healthSyncToken) { container.textContent = ''; return; }
  const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/activityInbox/${state.healthSyncToken}`;
  const bodyTemplate = '{"fields":{"date":{"stringValue":"DayKey"},"steps":{"doubleValue":StepsToday},"burnKcal":{"doubleValue":BurnToday},"exMin":{"doubleValue":ExerciseToday}}}';
  container.innerHTML = `
    <p><strong>One-time setup on your iPhone (about 5 minutes).</strong> Apple doesn't allow websites to create Shortcuts for you, but every long value below has a Copy button — open this page on the iPhone itself so you can paste directly. In the <em>Shortcuts</em> app tap + for a new shortcut, then add these actions in order:</p>
    <ol style="padding-left:18px;display:flex;flex-direction:column;gap:8px;margin:10px 0">
      <li><strong>Find Health Samples</strong> — type <em>Steps</em>, where Date is Today, Calculate <em>Sum</em>. Tap the result variable → Rename → <em>StepsToday</em>.</li>
      <li><strong>Find Health Samples</strong> — type <em>Active Energy</em>, Today, Sum → rename <em>BurnToday</em>.</li>
      <li><strong>Find Health Samples</strong> — type <em>Exercise Minutes</em>, Today, Sum → rename <em>ExerciseToday</em>.</li>
      <li><strong>Format Date</strong> — Date: Current Date, Format <em>Custom</em>: <code>yyyy-MM-dd</code> <button type="button" class="chip-button" data-copy="yyyy-MM-dd">Copy</button>. Rename the result <em>DayKey</em>.</li>
      <li><strong>Text</strong> — paste this <button type="button" class="chip-button" data-copy='${bodyTemplate}'>Copy</button>, then tap each placeholder word (DayKey, StepsToday, BurnToday, ExerciseToday) and replace it with the matching variable from the earlier steps:<br><code style="word-break:break-all">${bodyTemplate}</code></li>
      <li><strong>Get Contents of URL</strong> — paste this URL <button type="button" class="chip-button" data-copy="${docUrl}">Copy</button>:<br><code style="word-break:break-all">${docUrl}</code><br>Method <em>PATCH</em> · Header: <em>Content-Type</em> = <code>application/json</code> · Request Body <em>File</em> → pick the Text from step 5.</li>
    </ol>
    <p>Run it once — you should see today's numbers appear after tapping <em>Sync now</em> on the Activity tab. Then in Shortcuts → <em>Automation</em> → + → <em>Time of Day</em> (e.g. 9:00 PM, Daily, <em>Run Immediately</em>) choose this shortcut, and your activity arrives every evening on its own.</p>
    <p>No password goes into the Shortcut — the web address above contains a private code unique to your account. Don't share it.</p>`;
}

$('watchSyncInstructions').addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 1500);
  } catch { /* clipboard unavailable — user can select the text manually */ }
});

// ---------- Plans tab (weekly diet plan) ----------

const MEAL_DOTS = { breakfast: 'var(--accent2)', lunch: 'var(--accent)', snack: 'var(--fat)', dinner: 'var(--water)' };
const GOALS = [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']];
const goalLabelFor = goal => (GOALS.find(g => g[0] === goal) || ['', 'Maintain'])[1];

/** Goal-specific targets from the body profile; null when it's incomplete. */
function targetsForGoal(goal) {
  return computeTargetsFromProfile({ ...state.profile, goal }, latestWeight(state));
}

function buildWeekPlan({ goal, variant } = {}) {
  const chosenGoal = goal || (state.weekPlan && state.weekPlan.goal) || state.profile.goal || 'maintain';
  const targets = targetsForGoal(chosenGoal) || state.targets;
  const v = variant !== undefined ? variant
    : state.weekPlan ? state.weekPlan.variant + 1
    : Math.floor(Math.random() * 10000);
  state.weekPlan = generateWeekPlan(targets, state.vegOnly, v, chosenGoal, weekStartKey(state.currentDate));
  save();
}

/** The plan follows the calendar and the veg preference — a new week (or a toggled preference) rebuilds it. */
function ensureCurrentWeekPlan() {
  const start = weekStartKey(state.currentDate);
  if (!state.weekPlan || state.weekPlan.weekStart !== start || state.weekPlan.vegOnly !== !!state.vegOnly) {
    buildWeekPlan({});
  }
}

function selectedDayIndex(plan) {
  if (ui.selectedDay === null) {
    const todayIndex = plan.days.findIndex(d => d.date === state.currentDate);
    return todayIndex >= 0 ? todayIndex : 0;
  }
  return Math.max(0, Math.min(plan.days.length - 1, ui.selectedDay));
}

function todaysPlanMeals() {
  const plan = state.weekPlan;
  if (!plan) return [];
  const day = plan.days.find(d => d.date === state.currentDate);
  if (!day) return [];
  return day.meals.filter(meal => meal.loggedOn !== state.currentDate);
}

/** Pushes one planned meal's foods into today's log (no save — callers batch it). */
function addPlanMealFoods(meal) {
  meal.items.forEach(item => {
    // A plan item carries display-only extras; the food log stores the standard shape.
    const { serving, booster, ...food } = item;
    state.foods.push(food);
    pushRecent(food);
  });
  meal.loggedOn = state.currentDate;
}

function showPlansView(view) {
  ui.plansView = view;
  render();
  const scroller = document.querySelector('.tab-scroll');
  if (scroller) scroller.scrollTop = 0;
}

$('newWeekBtn').addEventListener('click', () => buildWeekPlan({ variant: state.weekPlan ? state.weekPlan.variant + 1 : 0 }));
$('tileGrocery').addEventListener('click', () => showPlansView('grocery'));
$('tileAdvice').addEventListener('click', () => showPlansView('advice'));
$('dayBack').addEventListener('click', () => showPlansView('hub'));
$('groceryBack').addEventListener('click', () => showPlansView('hub'));
$('adviceBack').addEventListener('click', () => showPlansView('hub'));

$('swapDayBtn').addEventListener('click', () => {
  const plan = state.weekPlan;
  if (!plan) return;
  const index = selectedDayIndex(plan);
  const next = swapDay(plan, index);
  if (next) { plan.days[index] = next; save(); }
});

$('logWholeDay').addEventListener('click', () => {
  const plan = state.weekPlan;
  if (!plan) return;
  const day = plan.days[selectedDayIndex(plan)];
  day.meals.forEach(addPlanMealFoods);
  day.loggedOn = state.currentDate;
  save();
  $('logDayMessage').textContent = `${day.name}'s meals are in Today — rings, score and Trends all count them.`;
  setTimeout(() => { $('logDayMessage').textContent = ''; }, 4000);
});

function renderPlans() {
  ensureCurrentWeekPlan();
  const plan = state.weekPlan;
  const views = { hub: 'planViewHub', day: 'planViewDay', grocery: 'planViewGrocery', advice: 'planViewAdvice' };
  Object.values(views).forEach(id => { $(id).hidden = true; });
  const view = views[ui.plansView] || views.hub;
  $(view).hidden = false;
  if (view === 'planViewHub') renderPlanHub(plan);
  else if (view === 'planViewDay') renderPlanDay(plan);
  else if (view === 'planViewGrocery') renderGrocery(plan);
  else renderAdvice(plan);
}

function renderPlanHub(plan) {
  $('plansEyebrow').textContent = `Personalised${state.vegOnly ? ' · Vegetarian' : ''}`;

  const current = latestWeight(state);
  const goalW = num(state.profile.goalWeight);
  const pace = num(state.profile.pace);
  $('planHero').innerHTML = `
    <div class="hero-top"><span class="goal-tag">Your goal · ${goalLabelFor(plan.goal)}</span><span class="journey">${current && goalW ? `${current} → ${goalW} kg` : ''}</span></div>
    <div class="kcal">${plan.targetCalories.toLocaleString()} <small>kcal / day</small></div>
    <p>${plan.goal !== 'maintain' && pace ? `${pace} kg/week · ` : ''}${plan.targetProtein} g protein target · built from your body profile</p>`;

  const seg = $('goalSeg');
  seg.replaceChildren();
  GOALS.forEach(([goal, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = plan.goal === goal ? 'on' : '';
    btn.textContent = label;
    btn.addEventListener('click', () => { if (plan.goal !== goal) buildWeekPlan({ goal, variant: plan.variant }); });
    seg.appendChild(btn);
  });
  const profileReady = !!targetsForGoal(plan.goal);
  $('goalSegNote').hidden = profileReady;
  if (!profileReady) {
    $('goalSegNote').textContent = 'Built from your saved daily targets for now — add height & age (More → Profile & body) and a weigh-in to unlock goal-based plans.';
  }

  $('weekRangeTag').textContent = `${displayDate(plan.weekStart)} – ${displayDate(plan.days[6].date)}`;
  const strip = $('weekStrip');
  strip.replaceChildren();
  const selected = selectedDayIndex(plan);
  plan.days.forEach((day, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `week-day${i === selected ? ' on' : ''}`;
    el.innerHTML = `<span>${day.name.slice(0, 3)}</span><strong>${Number(day.date.slice(8))}</strong>`;
    el.addEventListener('click', () => { ui.selectedDay = i; render(); });
    strip.appendChild(el);
  });

  const day = plan.days[selected];
  const dayTotals = planTotals(day.meals);
  const first = day.meals[0];
  const firstTotals = totalsFor(first.items);
  const preview = $('dayPreviewCard');
  preview.innerHTML = `
    <div class="section-head"><span class="card-title">${day.name}</span><span class="highlight small">${Math.round(dayTotals.calories).toLocaleString()} kcal · ${Math.round(dayTotals.protein)} g P</span></div>
    <div class="meal-card">
      <div class="meal-top"><div class="l"><span class="meal-dot" style="background:${MEAL_DOTS[first.slotId]}"></span><h3>${first.name}</h3></div><span class="meal-kc">${Math.round(firstTotals.calories)} kcal</span></div>
      ${first.items.map(i => `<div class="food-row"><span>${i.name}</span><span class="q">${i.quantity}${i.unit}</span></div>`).join('')}
    </div>`;
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'chip-button';
  openBtn.style.alignSelf = 'flex-start';
  openBtn.textContent = 'Open full day ↓';
  openBtn.addEventListener('click', () => showPlansView('day'));
  preview.appendChild(openBtn);

  const avg = weekAverages(plan);
  $('tileAdviceSub').textContent = avg.protein < plan.targetProtein * 0.9 ? 'close your protein gap' : 'for your goal';
}

function renderPlanDay(plan) {
  const day = plan.days[selectedDayIndex(plan)];
  $('dayEyebrow').textContent = `Weekly plan · ${goalLabelFor(plan.goal)}`;
  $('dayTitle').textContent = day.name;
  $('dayTargetTag').textContent = `of ${plan.targetCalories.toLocaleString()} kcal`;

  const t = planTotals(day.meals);
  $('dayRings').innerHTML = `
    <div class="ring-preview"><div class="ring" style="--progress:${Math.min(100, Math.round((t.calories / plan.targetCalories) * 100))}%;--ring-color:var(--accent)"><div class="ring-hole"><strong>${Math.round(t.calories).toLocaleString()}</strong><span>kcal</span></div></div><span class="ring-caption">Calories</span></div>
    <div class="ring-preview"><div class="ring" style="--progress:${Math.min(100, Math.round((t.protein / plan.targetProtein) * 100))}%;--ring-color:var(--accent2)"><div class="ring-hole"><strong>${Math.round(t.protein)}g</strong><span>protein</span></div></div><span class="ring-caption">Protein</span></div>`;
  $('dayMacbar').innerHTML = [['carbs', 'Carbs'], ['fat', 'Fat'], ['fibre', 'Fibre']]
    .map(([key, label]) => `<div class="mac"><strong>${Math.round(t[key])}g</strong><span>${label}</span></div>`).join('');

  const wrap = $('dayMeals');
  wrap.replaceChildren();
  day.meals.forEach(meal => {
    const mealTotals = totalsFor(meal.items);
    const card = document.createElement('div');
    card.className = 'card meal-card';
    card.innerHTML = `
      <div class="meal-top"><div class="l"><span class="meal-dot" style="background:${MEAL_DOTS[meal.slotId]}"></span><h3>${meal.name}</h3><span class="meal-time">${meal.time}</span></div><span class="meal-kc">${Math.round(mealTotals.calories)} · ${Math.round(mealTotals.protein)}g P</span></div>
      ${meal.items.map(i => `<div class="food-row"><span>${i.name}${i.booster ? '<span class="tp">protein top-up</span>' : ''}</span><span class="q">${i.quantity}${i.unit}${i.serving ? ` (${i.serving})` : ''}</span></div>`).join('')}`;
    wrap.appendChild(card);
  });

  const logged = day.loggedOn === state.currentDate;
  const btn = $('logWholeDay');
  btn.disabled = logged;
  btn.className = logged ? 'btn-outline' : 'btn-primary';
  btn.textContent = logged ? 'Logged into Today ✓' : 'Log this whole day ✓';
}

function renderGrocery(plan) {
  $('groceryEyebrow').textContent = `Auto-built · ${displayDate(plan.weekStart)} – ${displayDate(plan.days[6].date)}`;
  const groups = groceryList(plan);
  const itemCount = groups.reduce((total, group) => total + group.items.length, 0);
  $('grocerySummary').innerHTML = `
    <div class="b"><strong>${itemCount}</strong><span>Items</span></div>
    <div class="b"><strong>1</strong><span>Person</span></div>
    <div class="b"><strong>7</strong><span>Days</span></div>`;

  const wrap = $('groceryCats');
  wrap.replaceChildren();
  groups.forEach(group => {
    const head = document.createElement('div');
    head.className = 'gcat-head';
    head.textContent = `${group.emoji} ${group.label}`;
    wrap.appendChild(head);
    group.items.forEach(item => {
      const row = document.createElement('div');
      row.className = `grocery-item${state.pantry[item.key] ? ' done' : ''}`;
      row.innerHTML = `<span class="gbox"></span><span class="nm">${item.name}</span><span class="q">${item.display}</span>`;
      row.addEventListener('click', () => {
        if (state.pantry[item.key]) delete state.pantry[item.key];
        else state.pantry[item.key] = true;
        save();
      });
      wrap.appendChild(row);
    });
  });
}

$('copyGrocery').addEventListener('click', async () => {
  const plan = state.weekPlan;
  if (!plan) return;
  const lines = [`Grocery list · ${displayDate(plan.weekStart)} – ${displayDate(plan.days[6].date)}`, ''];
  groceryList(plan).forEach(group => {
    lines.push(`${group.label}:`);
    group.items.forEach(item => lines.push(`${state.pantry[item.key] ? '✓' : '•'} ${item.name} — ${item.display}`));
    lines.push('');
  });
  try {
    await navigator.clipboard.writeText(lines.join('\n').trim());
    $('copyMessage').textContent = 'Copied — paste it anywhere.';
  } catch {
    $('copyMessage').textContent = 'Copying is blocked in this browser — select the list and copy manually.';
  }
  setTimeout(() => { $('copyMessage').textContent = ''; }, 3000);
});

function renderAdvice(plan) {
  $('adviceEyebrow').textContent = `For your goal · ${goalLabelFor(plan.goal)}`;

  const current = latestWeight(state);
  const goalW = num(state.profile.goalWeight);
  const pace = Math.max(0.1, num(state.profile.pace));
  if (current && goalW && Math.abs(current - goalW) > 0.1) {
    const left = Math.round(Math.abs(current - goalW) * 10) / 10;
    $('adviceBanner').innerHTML = `<span class="banner-ic">🎯</span><div><strong>${left} kg from goal</strong><p>At ${pace} kg/week, ~${Math.round(left / pace)} weeks. These add-ons make it stick.</p></div>`;
  } else {
    $('adviceBanner').innerHTML = `<span class="banner-ic">🎯</span><div><strong>Consistency wins</strong><p>Set a goal weight in More → Profile & body to see your timeline here.</p></div>`;
  }

  const avg = weekAverages(plan);
  const cards = [];
  if (avg.protein < plan.targetProtein * 0.9) {
    cards.push(['🥜', 'Mind the protein gap', `The plan delivers ~${Math.round(avg.protein)} g vs a ${plan.targetProtein} g target. Add curd, soya chunks or a whey scoop to close it.`]);
  } else {
    cards.push(['🥜', 'Protein is on track', `The week averages ~${Math.round(avg.protein)} g against your ${plan.targetProtein} g target — nice.`]);
  }
  cards.push(['💧', 'Hydration first', `Aim ${num(state.targets.water)} L/day — ${plan.goal === 'lose' ? 'on a deficit, thirst often reads as hunger' : 'most hunger dips are really thirst'}.`]);
  cards.push(['🚶', 'Move to unlock food', `Hit ${num(state.activityTargets.steps).toLocaleString()} steps and there's room for a ~150 kcal snack on top of the plan.`]);
  $('adviceCards').innerHTML = cards
    .map(([icon, title, body]) => `<div class="card"><div class="adv-card"><div class="adv-ic">${icon}</div><div><h3>${title}</h3><p>${body}</p></div></div></div>`)
    .join('');
}

$('retuneFromWeighIn').addEventListener('click', () => {
  const goal = state.weekPlan ? state.weekPlan.goal : state.profile.goal;
  const computed = targetsForGoal(goal);
  if (!computed) {
    $('adviceMessage').textContent = 'Fill height & age (More → Profile & body) and log a weigh-in first.';
    setTimeout(() => { $('adviceMessage').textContent = ''; }, 4000);
    return;
  }
  // Aligns the daily targets (Today's rings) with the freshly-computed plan.
  state.targets = computed;
  buildWeekPlan({ goal });
  $('adviceMessage').textContent = `Targets retuned to ${latestWeight(state)} kg and the week rebuilt.`;
  setTimeout(() => { $('adviceMessage').textContent = ''; }, 4000);
});

// ---------- More tab ----------

function moreRow({ icon, title, sub, pill, danger, onTap }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `more-row${danger ? ' danger' : ''}`;
  row.innerHTML = `<span class="mic">${icon}</span><div class="mtx"><strong>${title}</strong><span>${sub}</span></div>${pill ? `<span class="pill${pill.on ? '' : ' off'}">${pill.label}</span>` : '<span class="chev">›</span>'}`;
  row.addEventListener('click', onTap);
  return row;
}

// The tabs that live behind More each carry a "‹ More" chip to step back to the menu.
['backMoreActivity', 'backMoreMeals', 'backMoreProfile'].forEach(id => {
  $(id).addEventListener('click', () => showTab('more'));
});

function renderMore() {
  $('moreEyebrow').textContent = state.displayName || (currentUser && currentUser.email) || '';
  const menu = $('moreMenu');
  menu.replaceChildren();
  const group = label => {
    const p = document.createElement('p');
    p.className = 'more-group';
    p.textContent = label;
    menu.appendChild(p);
  };

  group('Tracking');
  menu.appendChild(moreRow({ icon: '🔥', title: 'Activity', sub: 'Steps, burn & exercise', onTap: () => showTab('activity') }));
  menu.appendChild(moreRow({ icon: '🍲', title: 'Meals', sub: `Meal presets · ${state.mealPresets.length}`, onTap: () => showTab('meals') }));

  group('Setup');
  const current = latestWeight(state);
  const goalW = num(state.profile.goalWeight);
  menu.appendChild(moreRow({
    icon: '👤', title: 'Profile & body',
    sub: `Goal · ${goalLabelFor(state.profile.goal)}${current && goalW ? ` · ${current}→${goalW} kg` : ''}`,
    onTap: () => showTab('profile'),
  }));
  menu.appendChild(moreRow({
    icon: '🥗', title: 'Food preferences', sub: 'Vegetarian only',
    pill: { on: !!state.vegOnly, label: state.vegOnly ? 'On' : 'Off' },
    onTap: () => { state.vegOnly = !state.vegOnly; save(); },
  }));
  // Cycles Light → Dark → Auto; Auto follows the phone's light/dark setting live.
  menu.appendChild(moreRow({
    icon: '🎨', title: 'Appearance',
    sub: state.theme === 'auto' ? `Following your phone setting (${resolvedTheme()})` : 'Tap to switch — Light · Dark · Auto',
    pill: { on: state.theme !== 'auto', label: state.theme === 'auto' ? 'Auto' : state.theme === 'dark' ? 'Dark' : 'Light' },
    onTap: () => {
      state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
      state.themeChosen = state.theme !== 'auto';
      applyTheme();
      save();
    },
  }));
  menu.appendChild(moreRow({ icon: '⏻', title: 'Sign out', sub: (currentUser && currentUser.email) || '', danger: true, onTap: () => signOutUser() }));
}

// ---------- Derived data + full render ----------

function computeDerived() {
  const todayTotals = totalsFor(state.foods);
  const waterMl = Math.round(state.water * 1000);
  const waterGoalMl = Math.max(50, num(state.targets.water) * 1000);
  const waterPercent = Math.min(100, Math.round((waterMl / waterGoalMl) * 100));

  const calorieGoal = Math.max(1, num(state.targets.calories));
  const caloriePercent = Math.min(100, Math.round((todayTotals.calories / calorieGoal) * 100));
  const remaining = Math.max(0, Math.round(calorieGoal - todayTotals.calories));

  const proteinGoal = Math.max(1, num(state.targets.protein));
  const proteinPercent = Math.min(100, Math.round((todayTotals.protein / proteinGoal) * 100));
  const proteinRemaining = Math.max(0, Math.round((proteinGoal - todayTotals.protein) * 10) / 10);

  const streak = computeStreak(state);
  const weekScore = weeklyScoreParts(state, todayTotals);
  const weeklyScore = weekScore.total;
  const weeklyGrade = gradeForScore(weeklyScore);
  const sparkline = sparklineData(state, todayTotals);
  const weekly = weeklyData(state, todayTotals);

  let weightDeltaLabel = 'first entry';
  if (state.weights.length > 1) {
    const latest = state.weights[state.weights.length - 1];
    const cutoff = new Date(`${latest.id}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutKey = dayKey(cutoff);
    const ref = [...state.weights].reverse().find(w => w.id <= cutKey) || state.weights[0];
    const delta = Math.round((latest.kg - ref.kg) * 10) / 10;
    weightDeltaLabel = delta < 0 ? `▾ ${Math.abs(delta)} kg this week` : delta > 0 ? `▴ ${delta} kg this week` : '— steady this week';
  }

  return {
    todayTotals, waterMl, waterGoalMl, waterPercent,
    calorieGoal, caloriePercent, calories: Math.round(todayTotals.calories),
    caloriesRemainingLabel: remaining > 0 ? `${remaining} kcal left` : 'Calorie goal reached',
    proteinGoal, proteinPercent, proteinValue: Math.round(todayTotals.protein * 10) / 10,
    proteinRemainingLabel: proteinRemaining > 0 ? `${proteinRemaining}g protein left` : 'Protein goal reached',
    streak,
    todayLabel: new Date(`${state.currentDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
    firstName: greetingName(),
    weeklyScore, weeklyGrade, weekScore, sparkline, weekly,
    weekRangeLabel: `${displayDate(dayKey(weekly.start))} – ${displayDate(dayKey(weekly.end))}`,
    weightDeltaLabel,
    idealRange: idealWeightRange(state.profile),
    journey: weightJourney(state),
  };
}

function render() {
  rolloverIfNewDay(state);
  const derived = computeDerived();
  renderHeader(derived);
  renderToday(derived);
  renderLog(derived);
  renderTrends(derived);
  renderWeight(derived);
  renderActivity(derived);
  renderMeals();
  renderPlans();
  renderMore();
  renderProfile();
  renderNav();
  checkAndFireAlerts(derived);
}

// ---------- Bootstrap ----------

function scheduleMidnightCheck() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { if (currentUser) render(); scheduleMidnightCheck(); }, midnight - now + 1000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) {
    render();
    applyActivitySync({ silent: true });
  }
});

// Pace alerts depend on the time of day, so re-check periodically while the app stays open.
setInterval(() => {
  if (currentUser && state.alertsEnabled) checkAndFireAlerts(computeDerived());
}, 30 * 60 * 1000);

watchAuthState(async user => {
  currentUser = user;
  if (!user) {
    $('mainApp').hidden = true;
    $('authScreen').hidden = false;
    $('authPassword').value = '';
    renderAuthScreen();
    return;
  }
  $('authScreen').hidden = true;
  $('mainApp').hidden = false;
  try {
    const cloudState = await loadCloudState(user.uid);
    if (cloudState) {
      state = normalizeState(cloudState);
    } else {
      const cached = localStorage.getItem(userCacheKey(user.uid));
      if (cached) state = normalizeState(JSON.parse(cached));
    }
    if (!state.healthSyncToken) {
      state.healthSyncToken = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      saveCloudState(user.uid, state);
    }
    saveLocalState(state, user.uid);
  } catch {
    const recovered = await recoverIndexedBackup();
    if (recovered) state = normalizeState(recovered);
  }
  // A brand-new account starts on Profile so they set up their name, body
  // details and targets before logging anything.
  const firstTime = !state.onboarded;
  if (firstTime) {
    state.onboarded = true;
    saveLocalState(state, user.uid);
    if (currentUser) saveCloudState(user.uid, state);
  }
  showTab(firstTime ? 'profile' : 'today');
  render();
  if (firstTime) {
    $('profileMessage').textContent = 'Welcome! Add your name and body details here to personalise your targets, then start logging.';
    setTimeout(() => { $('profileMessage').textContent = ''; }, 8000);
  }
  applyActivitySync({ silent: true });
  loadFoodBankCache();
  if (isAdmin()) { renderPendingFoods(); renderFoodBank(); }
});

$('appVersion').textContent = `Version ${APP_VERSION}`;
renderAuthScreen();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
  // When a new service worker takes control (a new version was deployed),
  // reload once so the fresh code is used instead of the old cached version.
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
}
scheduleMidnightCheck();
