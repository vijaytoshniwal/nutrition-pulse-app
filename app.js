import { NUTRIENTS, QUOTES, FOOD_PICKS, NAV_ITEMS } from './src/constants.js';
import { $, num, dayKey, displayDate, dayOfYear, foodKey } from './src/utils.js';
import {
  loadLocalState, saveLocalState, normalizeState, totalsFor, rolloverIfNewDay,
  archiveCurrentDay, exportBackupFile, readBackupFile, saveIndexedBackup, recoverIndexedBackup, userCacheKey,
} from './src/state.js';
import {
  computeStreak, weeklyData, weeklyScoreParts, gradeForScore, sparklineData,
  latestWeight, idealWeightRange, computeTargetsFromProfile, weightBarData, weightJourney,
} from './src/calculations.js';
import { comparableQuantity, calculateFood, findFoodByPhotoHash } from './src/food-lookup.js';
import { computeImageHash, isSimilarPhoto } from './src/image-hash.js';
import { watchAuthState, signIn, signUp, signOutUser, resetPassword, loadCloudState, saveCloudState } from './src/firebase-sync.js';

let state = loadLocalState();
let currentUser = null;

const ui = {
  tab: 'today',
  form: freshForm(),
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

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authMessage').textContent = 'Signing in…';
  try {
    await signIn(email, password);
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
  $('fabLog').classList.toggle('active', tab === 'log');
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
    btn.className = `nav-item${ui.tab === item.id ? ' active' : ''}`;
    btn.innerHTML = `<span class="nav-icon"></span><span class="nav-label">${item.label}</span>`;
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

  const quickAdds = state.recents.slice(0, 4);
  $('noRecentsNote').hidden = quickAdds.length > 0;
  const list = $('quickAddList');
  list.replaceChildren();
  quickAdds.forEach(recent => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${recent.name} · ${recent.quantity}${recent.unit}`;
    const right = document.createElement('div');
    right.className = 'qty';
    const kcal = document.createElement('span');
    kcal.textContent = `${Math.round(num(recent.calories))} kcal`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'round-add';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => quickAddFood(recent));
    right.append(kcal, addBtn);
    li.append(label, right);
    list.appendChild(li);
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

$('cancelEdit').addEventListener('click', resetFoodForm);

$('foodForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('foodName').value.trim();
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
    state.customFoods[foodKey(name)] = { name, baseQuantity, photoHashes, ...Object.fromEntries(NUTRIENTS.map(n => [n, food[n]])) };
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

  const scoreDefs = [
    ['Calories on target', derived.weekScore.cal, 'var(--accent)'],
    ['Protein', derived.weekScore.protein, 'var(--accent2)'],
    ['Fibre', derived.weekScore.fibre, 'var(--accent2)'],
    ['Hydration', derived.weekScore.hyd, 'var(--water)'],
    ['Sugar control', derived.weekScore.sugar, 'var(--sugar-c)'],
  ];
  renderScoreRows('scoreRows', scoreDefs.map(([label, value, color]) => ({ label, value: `${value}/100`, percent: value, color })));

  const spark = $('sparkline');
  spark.replaceChildren();
  derived.sparkline.forEach(point => {
    const bar = document.createElement('div');
    bar.className = `spark-bar${point.isToday ? ' today' : ''}`;
    bar.innerHTML = `<div class="bar" style="height:${point.heightPercent}%"></div><span>${point.label}</span>`;
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
  const historyList = $('historyList');
  historyList.replaceChildren();
  state.history.forEach(h => {
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
      <div class="history-top"><strong>${h.date}</strong><strong>${Math.round(num(h.calories))} kcal</strong></div>
      <div class="history-grid">${nutrientDefs.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
    historyList.appendChild(div);
  });
}

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

$('syncDevice').addEventListener('click', () => {
  $('syncMessage').textContent = 'Looking for your phone or watch…';
  setTimeout(() => {
    $('syncMessage').textContent = 'No connected health service on this device yet — enter today’s numbers manually below, they save instantly.';
    setTimeout(() => { $('syncMessage').textContent = ''; }, 5000);
  }, 1000);
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
    div.innerHTML = `<strong>${h.date}</strong>
      <div style="display:flex;gap:12px">
        <span class="muted small">${num(h.steps).toLocaleString()} steps</span>
        <span class="muted small">${num(h.burnKcal)} kcal</span>
        <span class="muted small">${num(h.exMin)} min</span>
      </div>`;
    list.appendChild(div);
  });
}

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

$('themeToggle').addEventListener('click', () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  save();
});

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

  document.documentElement.setAttribute('data-theme', state.theme);
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
  renderProfile();
  renderNav();
}

// ---------- Bootstrap ----------

function scheduleMidnightCheck() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { if (currentUser) render(); scheduleMidnightCheck(); }, midnight - now + 1000);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser) render(); });

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
    saveLocalState(state, user.uid);
  } catch {
    const recovered = await recoverIndexedBackup();
    if (recovered) state = normalizeState(recovered);
  }
  showTab('today');
  render();
});

renderAuthScreen();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
scheduleMidnightCheck();
