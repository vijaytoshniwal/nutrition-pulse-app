import { FOOD_DB } from './food-db.js';
import { num, round1, dayKey } from './utils.js';

/**
 * Weekly diet plan engine (the Plans tab). Builds Monday–Sunday, four meals a
 * day — Breakfast 25% · Lunch 32% · Snack 13% · Dinner 30% of the day's
 * calorie target — from hand-picked combinations of built-in foods. Portions
 * of the main items scale in 5 g steps to hit each meal's calorie slot
 * (drinks, chutneys and side salads stay at their normal serving). If a day
 * runs short on protein, snack/breakfast get a "protein top-up" item while
 * the day stays within ~107% of its calorie target. Deterministic for a given
 * (targets, vegOnly, variant): a synced plan renders identically everywhere,
 * and "Swap day" simply steps that day to its next combination.
 */

const byName = new Map(FOOD_DB.map(item => [item.n.toLowerCase(), item]));

/** Template component: a FOOD_DB item name and how many typical servings of it. */
const c = (n, servings, opts = {}) => ({ n, servings, fixed: !!opts.fixed });

export const MEAL_SLOTS = [
  {
    id: 'breakfast', name: 'Breakfast', time: '8:00 – 9:30 am', share: 0.25,
    options: [
      [c('Poha', 1), c('Sprouts salad', 1), c('Milk toned', 1, { fixed: true })],
      [c('Poha', 1), c('Curd', 1), c('Masala chai', 1, { fixed: true })],
      [c('Oats porridge', 1), c('Banana', 1, { fixed: true }), c('Almonds', 1, { fixed: true })],
      [c('Besan chilla', 2), c('Green chutney', 1, { fixed: true }), c('Curd', 1)],
      [c('Idli', 3), c('Sambar', 1), c('Filter coffee', 1, { fixed: true })],
      [c('Moong dal chilla', 2), c('Curd', 1), c('Masala chai', 1, { fixed: true })],
      [c('Upma', 1), c('Curd', 1), c('Filter coffee', 1, { fixed: true })],
      [c('Daliya', 1), c('Boiled moong sprouts', 1)],
      [c('Peanut butter toast', 1), c('Milk toned', 1, { fixed: true })],
      [c('Boiled egg', 2), c('Brown bread', 2), c('Masala chai', 1, { fixed: true })],
      [c('Omelette', 1), c('Brown bread', 2)],
    ],
  },
  {
    id: 'lunch', name: 'Lunch', time: '1:00 – 2:00 pm', share: 0.32,
    options: [
      [c('Chapati', 2), c('Moong dal', 1), c('Bhindi fry', 1), c('Curd', 1)],
      [c('Chapati', 2), c('Dal tadka', 1), c('Mix veg sabzi', 1), c('Green salad', 1, { fixed: true })],
      [c('Steamed rice', 1), c('Rajma', 1), c('Curd', 1), c('Green salad', 1, { fixed: true })],
      [c('Chapati', 2), c('Palak paneer', 1), c('Cucumber raita', 1)],
      [c('Veg pulao', 1), c('Kadhi', 1), c('Green salad', 1, { fixed: true })],
      [c('Chapati', 2), c('Chole', 1), c('Onion tomato salad', 1, { fixed: true }), c('Buttermilk', 1, { fixed: true })],
      [c('Brown rice', 1), c('Dal palak', 1), c('Beans sabzi', 1), c('Curd', 1)],
      [c('Chapati', 2), c('Chicken curry', 1), c('Green salad', 1, { fixed: true })],
      [c('Steamed rice', 1), c('Fish curry', 1), c('Green salad', 1, { fixed: true })],
    ],
  },
  {
    id: 'snack', name: 'Snack', time: '4:30 – 5:30 pm', share: 0.13,
    options: [
      [c('Roasted chana', 1), c('Apple', 1, { fixed: true })],
      [c('Roasted chana', 1), c('Masala chai', 1, { fixed: true })],
      [c('Makhana roasted', 1), c('Green tea', 1, { fixed: true })],
      [c('Sattu drink', 1)],
      [c('Dhokla', 1), c('Green tea', 1, { fixed: true })],
      [c('Fruit chaat', 1)],
      [c('Sprouts salad', 1), c('Masala chai', 1, { fixed: true })],
      [c('Banana', 1), c('Buttermilk', 1, { fixed: true })],
      [c('Guava', 1), c('Green tea', 1, { fixed: true })],
      [c('Papaya', 1), c('Coconut water', 1, { fixed: true })],
      [c('Orange', 1), c('Almonds', 1, { fixed: true })],
      [c('Pomegranate', 1)],
      [c('Boiled egg', 1), c('Green tea', 1, { fixed: true })],
    ],
  },
  {
    id: 'dinner', name: 'Dinner', time: '7:30 – 9:00 pm', share: 0.3,
    options: [
      [c('Paneer bhurji', 1), c('Jowar roti', 2), c('Grilled vegetables', 1)],
      [c('Chapati', 2), c('Lauki sabzi', 1), c('Moong dal', 1)],
      [c('Khichdi', 1), c('Curd', 1), c('Green salad', 1, { fixed: true })],
      [c('Veg soup', 1, { fixed: true }), c('Grilled paneer', 1), c('Green salad', 1)],
      [c('Millet khichdi', 1), c('Cucumber raita', 1)],
      [c('Jowar roti', 2), c('Palak sabzi', 1), c('Dal tadka', 1)],
      [c('Chapati', 2), c('Matar paneer', 1), c('Green salad', 1, { fixed: true })],
      [c('Grilled chicken breast', 1), c('Green salad', 1), c('Chapati', 1)],
      [c('Chapati', 2), c('Egg curry', 1)],
    ],
  },
];

/** Highest-protein-first snack additions used when a day runs short. */
const VEG_BOOSTERS = [c('Low fat paneer', 1.2), c('Greek yogurt', 1), c('Tofu', 1), c('Sattu drink', 1), c('Roasted chana', 1)];
const NONVEG_BOOSTERS = [c('Boiled egg', 2), c('Egg white boiled', 3), ...VEG_BOOSTERS];

/** Deterministic PRNG so the same variant always yields the same week. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function availableOptions(slot, vegOnly) {
  if (!vegOnly) return slot.options;
  return slot.options.filter(option =>
    option.every(comp => {
      const item = byName.get(comp.n.toLowerCase());
      return item && item.v === 1;
    })
  );
}

/** Deterministic per-slot shuffle; day d takes shuffled[(d + swaps) % len], so a week never repeats a menu until the pool runs out. */
function shuffledIndices(length, rand) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** 'roti' from '1 roti' — only for true piece foods, not measures like '1 katori'. */
const MEASURE_WORDS = /katori|bowl|plate|cup|glass|handful|packet|serving/;
function pieceUnit(item) {
  const match = item.sl && item.sl.match(/^1 (.+)$/);
  if (!match || MEASURE_WORDS.test(match[1])) return null;
  return match[1];
}

const LIQUID_NAMES = new Set(['milk toned', 'milk full fat', 'milk skimmed', 'buttermilk']);
function itemUnit(item) {
  return item.c === 'bev' || LIQUID_NAMES.has(item.n.toLowerCase()) ? 'ml' : 'g';
}

/** Rounds a scaled quantity to something you'd serve: whole pieces, else 5 g steps. */
function roundQuantity(item, grams) {
  const piece = pieceUnit(item);
  if (piece) {
    const count = Math.max(1, Math.round(grams / item.sg));
    return count * item.sg;
  }
  return Math.max(20, Math.round(grams / 5) * 5);
}

/** Human portion hint: '2 roti', '1 katori', '1.5 bowl' — or '' when grams say it best. */
function servingLabel(item, quantity) {
  const piece = pieceUnit(item);
  if (piece) return `${Math.round(quantity / item.sg)} ${piece}`;
  const ratio = quantity / item.sg;
  if (Math.abs(ratio - 1) < 0.13) return item.sl;
  const measure = item.sl && item.sl.match(/^1 (katori|bowl|plate|cup|glass)$/);
  if (measure) {
    const half = Math.round(ratio * 2) / 2;
    if (Math.abs(ratio - half) < 0.13 && half !== 1) return `${half} ${measure[1]}`;
  }
  return '';
}

function toPlanItem(item, quantity) {
  const factor = quantity / 100;
  return {
    name: item.n,
    quantity,
    unit: itemUnit(item),
    serving: servingLabel(item, quantity),
    calories: Math.round(item.k * factor),
    protein: round1(item.p * factor),
    carbs: round1(item.cb * factor),
    fat: round1(item.f * factor),
    fibre: round1(item.fb * factor),
    sugar: round1(item.s * factor),
  };
}

function buildMeal(slot, vegOnly, optionIndex, budgetKcal) {
  const options = availableOptions(slot, vegOnly);
  const index = ((optionIndex % options.length) + options.length) % options.length;
  const parts = options[index]
    .map(comp => ({ comp, item: byName.get(comp.n.toLowerCase()) }))
    .filter(part => part.item)
    .map(part => ({ ...part, grams: part.item.sg * part.comp.servings }));

  const kcalOf = part => (part.item.k * part.grams) / 100;
  const fixedKcal = parts.filter(p => p.comp.fixed).reduce((a, p) => a + kcalOf(p), 0);
  const flexKcal = parts.filter(p => !p.comp.fixed).reduce((a, p) => a + kcalOf(p), 0);
  const scale = flexKcal > 0 ? Math.min(1.6, Math.max(0.6, (budgetKcal - fixedKcal) / flexKcal)) : 1;

  const items = parts.map(part => {
    const grams = part.comp.fixed ? part.grams : part.grams * scale;
    return toPlanItem(part.item, part.comp.fixed ? Math.round(grams) : roundQuantity(part.item, grams));
  });

  return { slotId: slot.id, name: slot.name, time: slot.time, items, loggedOn: null };
}

export function planTotals(meals) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 };
  meals.forEach(meal => meal.items.forEach(item => {
    Object.keys(totals).forEach(key => (totals[key] += num(item[key])));
  }));
  Object.keys(totals).forEach(key => (totals[key] = Math.round(totals[key] * 10) / 10));
  return totals;
}

/** Average per-day totals across the week, for the hub bars and advice. */
export function weekAverages(plan) {
  const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 };
  plan.days.forEach(day => {
    const t = planTotals(day.meals);
    Object.keys(sum).forEach(key => (sum[key] += t[key]));
  });
  Object.keys(sum).forEach(key => (sum[key] = Math.round((sum[key] / plan.days.length) * 10) / 10));
  return sum;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function buildDay(dayIndex, swapCount, orders, vegOnly, targetCalories, targetProtein, date) {
  const meals = MEAL_SLOTS.map((slot, s) => {
    const order = orders[s];
    return buildMeal(slot, vegOnly, order[(dayIndex + swapCount) % order.length], targetCalories * slot.share);
  });

  // Protein top-up in the snack (then breakfast) while calories still allow —
  // the day may run to ~107% of target, matching the designed behaviour.
  const boosters = vegOnly ? VEG_BOOSTERS : NONVEG_BOOSTERS;
  const boosterSlots = ['snack', 'breakfast'];
  let added = 0;
  for (const booster of boosters) {
    if (added >= boosterSlots.length) break;
    const totals = planTotals(meals);
    if (targetProtein - totals.protein <= 8) break;
    const item = byName.get(booster.n.toLowerCase());
    if (!item) continue;
    if (meals.some(meal => meal.items.some(existing => existing.name === item.n))) continue;
    const planItem = toPlanItem(item, Math.round(item.sg * booster.servings));
    if (totals.calories + planItem.calories > targetCalories * 1.07) continue;
    planItem.booster = true;
    meals.find(meal => meal.slotId === boosterSlots[added]).items.push(planItem);
    added++;
  }

  return { name: DAY_NAMES[dayIndex], date, swapCount, meals, loggedOn: null };
}

/** Monday of the week containing the given day key. */
export function weekStartKey(fromKey) {
  const d = new Date(`${fromKey}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

function shuffleOrders(vegOnly, variant) {
  const rand = mulberry32(variant * 1013904223 + 71);
  return MEAL_SLOTS.map(slot => shuffledIndices(availableOptions(slot, vegOnly).length, rand));
}

/**
 * The full week. `goal` is recorded for display ('lose' | 'maintain' | 'gain');
 * targets must already reflect it (computeTargetsFromProfile with that goal).
 */
export function generateWeekPlan(targets, vegOnly, variant, goal, startKey) {
  const targetCalories = Math.max(1000, num(targets.calories) || 2000);
  const targetProtein = Math.max(30, num(targets.protein) || 100);
  const orders = shuffleOrders(vegOnly, variant);
  const start = new Date(`${startKey}T00:00:00`);

  const days = DAY_NAMES.map((_, dayIndex) => {
    const date = new Date(start);
    date.setDate(start.getDate() + dayIndex);
    return buildDay(dayIndex, 0, orders, vegOnly, targetCalories, targetProtein, dayKey(date));
  });

  return {
    createdOn: dayKey(), variant, vegOnly: !!vegOnly, goal: goal || 'maintain',
    targetCalories, targetProtein,
    targets: { ...targets },
    weekStart: startKey,
    days,
  };
}

/** Rebuilds one day with its next set of menus; the other six days stay put. */
export function swapDay(plan, dayIndex) {
  const day = plan.days[dayIndex];
  if (!day) return null;
  const orders = shuffleOrders(plan.vegOnly, plan.variant);
  return buildDay(dayIndex, day.swapCount + 1, orders, plan.vegOnly, plan.targetCalories, plan.targetProtein, day.date);
}

// ---------- Grocery list ----------

const GROCERY_GROUPS = [
  { id: 'protein', emoji: '🫘', label: 'Pulses & protein', cats: ['dal'] },
  { id: 'nonveg', emoji: '🍳', label: 'Eggs, meat & fish', cats: ['nonveg'] },
  { id: 'dairy', emoji: '🥛', label: 'Dairy & paneer', cats: ['dairy'] },
  { id: 'grains', emoji: '🌾', label: 'Grains & flours', cats: ['grain', 'south', 'meal'] },
  { id: 'veg', emoji: '🥬', label: 'Vegetables', cats: ['veg', 'salad'] },
  { id: 'fruit', emoji: '🍎', label: 'Fruit', cats: ['fruit'] },
  { id: 'extras', emoji: '🥜', label: 'Snacks & extras', cats: ['nuts', 'snack', 'bev', 'cond', 'sweet'] },
];

function displayQuantity(item, total, unit) {
  const piece = pieceUnit(item);
  if (piece && item.c === 'fruit') return `${Math.max(1, Math.round(total / item.sg))} pcs`;
  if (unit === 'ml' && total >= 500) return `${Math.round(total / 100) / 10} L`;
  return `${Math.round(total)} ${unit}`;
}

/** Every plan item summed across the 7 days, grouped for shopping. */
export function groceryList(plan) {
  const sums = new Map();
  plan.days.forEach(day => day.meals.forEach(meal => meal.items.forEach(entry => {
    const key = entry.name.toLowerCase();
    const agg = sums.get(key) || { total: 0, name: entry.name, unit: entry.unit || 'g' };
    agg.total += num(entry.quantity);
    sums.set(key, agg);
  })));

  const groups = GROCERY_GROUPS.map(group => ({ ...group, items: [] }));
  const fallback = groups[groups.length - 1];
  [...sums.entries()].forEach(([key, agg]) => {
    const item = byName.get(key);
    if (item) {
      const group = groups.find(g => g.cats.includes(item.c)) || fallback;
      group.items.push({ name: item.n, key, display: displayQuantity(item, agg.total, itemUnit(item)) });
    } else {
      // A custom food from "My plan" that isn't in the built-in database — still
      // list it (under Snacks & extras) using its own unit, so nothing is dropped.
      const unit = agg.unit === 'pieces' ? 'pcs' : agg.unit;
      fallback.items.push({ name: agg.name, key, display: `${Math.round(agg.total)} ${unit}` });
    }
  });
  groups.forEach(group => group.items.sort((a, b) => a.name.localeCompare(b.name)));
  return groups.filter(group => group.items.length);
}
