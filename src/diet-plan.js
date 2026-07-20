import { FOOD_DB } from './food-db.js';
import { num, round1, dayKey } from './utils.js';

/**
 * Builds a full day's Indian diet plan from the built-in food database, fitted
 * to the user's calorie target and vegetarian preference. Every meal slot has
 * several hand-picked combinations; portions of the main items are scaled to
 * the slot's share of the day's calories (drinks/chutneys/salads stay at their
 * normal serving). If the day still falls short on protein, snack slots get a
 * "protein top-up" item. Generation is deterministic for a given (targets,
 * vegOnly, variant), so "New plan" (variant + 1) always changes the menu and a
 * synced plan renders identically on every device.
 */

const byName = new Map(FOOD_DB.map(item => [item.n.toLowerCase(), item]));

/** Template component: a FOOD_DB item name and how many typical servings of it. */
const c = (n, servings, opts = {}) => ({ n, servings, fixed: !!opts.fixed });

const SLOTS = [
  {
    id: 'breakfast', name: 'Breakfast', time: '8:00 – 9:30 am', share: 0.25,
    options: [
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
    id: 'midmorning', name: 'Mid-morning', time: '11:00 – 11:30 am', share: 0.1,
    options: [
      [c('Apple', 1), c('Green tea', 1, { fixed: true })],
      [c('Banana', 1)],
      [c('Papaya', 1), c('Coconut water', 1, { fixed: true })],
      [c('Guava', 1)],
      [c('Buttermilk', 1, { fixed: true }), c('Roasted chana', 1)],
      [c('Sprouts salad', 1)],
      [c('Pomegranate', 1)],
      [c('Orange', 1), c('Almonds', 1, { fixed: true })],
    ],
  },
  {
    id: 'lunch', name: 'Lunch', time: '1:00 – 2:00 pm', share: 0.3,
    options: [
      [c('Chapati', 2), c('Dal tadka', 1), c('Mix veg sabzi', 1), c('Green salad', 1, { fixed: true })],
      [c('Steamed rice', 1), c('Rajma', 1), c('Curd', 1), c('Green salad', 1, { fixed: true })],
      [c('Chapati', 2), c('Palak paneer', 1), c('Cucumber raita', 1)],
      [c('Veg pulao', 1), c('Kadhi', 1), c('Green salad', 1, { fixed: true })],
      [c('Chapati', 2), c('Chole', 1), c('Onion tomato salad', 1, { fixed: true }), c('Buttermilk', 1, { fixed: true })],
      [c('Brown rice', 1), c('Dal palak', 1), c('Bhindi fry', 1), c('Curd', 1)],
      [c('Chapati', 2), c('Chicken curry', 1), c('Green salad', 1, { fixed: true })],
      [c('Steamed rice', 1), c('Fish curry', 1), c('Green salad', 1, { fixed: true })],
    ],
  },
  {
    id: 'evening', name: 'Evening snack', time: '4:30 – 5:30 pm', share: 0.1,
    options: [
      [c('Roasted chana', 1), c('Masala chai', 1, { fixed: true })],
      [c('Makhana roasted', 1), c('Green tea', 1, { fixed: true })],
      [c('Sattu drink', 1)],
      [c('Dhokla', 1), c('Green tea', 1, { fixed: true })],
      [c('Fruit chaat', 1)],
      [c('Sprouts salad', 1), c('Masala chai', 1, { fixed: true })],
      [c('Boiled egg', 1), c('Green tea', 1, { fixed: true })],
    ],
  },
  {
    id: 'dinner', name: 'Dinner', time: '7:30 – 9:00 pm', share: 0.25,
    options: [
      [c('Chapati', 2), c('Lauki sabzi', 1), c('Moong dal', 1)],
      [c('Khichdi', 1), c('Curd', 1), c('Green salad', 1, { fixed: true })],
      [c('Chapati', 2), c('Paneer bhurji', 1), c('Green salad', 1, { fixed: true })],
      [c('Veg soup', 1, { fixed: true }), c('Grilled paneer', 1), c('Green salad', 1)],
      [c('Millet khichdi', 1), c('Cucumber raita', 1)],
      [c('Jowar roti', 2), c('Palak sabzi', 1), c('Dal tadka', 1)],
      [c('Grilled chicken breast', 1), c('Green salad', 1), c('Chapati', 1)],
      [c('Chapati', 2), c('Egg curry', 1)],
    ],
  },
];

/** Highest-protein-first snack additions used when the day's plan runs short. */
const VEG_BOOSTERS = [c('Low fat paneer', 1.5), c('Greek yogurt', 1), c('Sattu drink', 1), c('Roasted chana', 1)];
const NONVEG_BOOSTERS = [c('Boiled egg', 2), c('Egg white boiled', 3), ...VEG_BOOSTERS];

/** Deterministic PRNG so the same variant always yields the same plan. */
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

/** 'roti' from '1 roti' — only for true piece foods, not measures like '1 katori'. */
const MEASURE_WORDS = /katori|bowl|plate|cup|glass|handful|medium|fruit|breast|packet|serving/;
function pieceUnit(item) {
  const match = item.sl && item.sl.match(/^1 (.+)$/);
  if (!match || MEASURE_WORDS.test(match[1])) return null;
  return match[1];
}

const LIQUID_NAMES = new Set(['milk toned', 'milk full fat', 'milk skimmed', 'buttermilk']);
function itemUnit(item) {
  return item.c === 'bev' || LIQUID_NAMES.has(item.n.toLowerCase()) ? 'ml' : 'g';
}

/** Rounds a scaled quantity to something you'd actually serve. */
function roundQuantity(item, grams) {
  const piece = pieceUnit(item);
  if (piece) {
    const count = Math.max(1, Math.round(grams / item.sg));
    return count * item.sg;
  }
  const step = grams >= 100 ? 25 : 10;
  return Math.max(10, Math.round(grams / step) * step);
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

  return { slotId: slot.id, name: slot.name, time: slot.time, optionIndex: index, items, loggedOn: null };
}

export function planTotals(meals) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 };
  meals.forEach(meal => meal.items.forEach(item => {
    Object.keys(totals).forEach(key => (totals[key] += num(item[key])));
  }));
  Object.keys(totals).forEach(key => (totals[key] = Math.round(totals[key] * 10) / 10));
  return totals;
}

export function generateDietPlan(targets, vegOnly, variant) {
  const targetCalories = Math.max(1000, num(targets.calories) || 2000);
  const targetProtein = Math.max(30, num(targets.protein) || 100);
  const rand = mulberry32(variant * 1013904223 + 17);

  const indices = SLOTS.map(slot => Math.floor(rand() * availableOptions(slot, vegOnly).length));
  const build = budget => SLOTS.map((slot, i) => buildMeal(slot, vegOnly, indices[i], budget * slot.share));

  let meals = build(targetCalories);

  // If the day runs short on protein, pick top-up items — then rebuild the
  // meals with their calories reserved, so the total still lands on target
  // instead of the top-ups being piled on top of it.
  const deficit = targetProtein - planTotals(meals).protein;
  const boosterSlots = ['midmorning', 'evening', 'breakfast'];
  const chosen = [];
  if (deficit > 8) {
    let remaining = deficit;
    for (const booster of vegOnly ? VEG_BOOSTERS : NONVEG_BOOSTERS) {
      if (chosen.length >= boosterSlots.length || remaining <= 8) break;
      const item = byName.get(booster.n.toLowerCase());
      if (!item) continue;
      if (meals.some(meal => meal.items.some(existing => existing.name === item.n))) continue;
      const planItem = toPlanItem(item, Math.round(item.sg * booster.servings));
      planItem.booster = true;
      chosen.push(planItem);
      remaining -= planItem.protein;
    }
  }
  if (chosen.length) {
    const boosterKcal = chosen.reduce((total, item) => total + item.calories, 0);
    meals = build(Math.max(800, targetCalories - boosterKcal));
    chosen.forEach((item, i) => meals.find(meal => meal.slotId === boosterSlots[i]).items.push(item));
  }

  return { createdOn: dayKey(), variant, vegOnly: !!vegOnly, targetCalories, targetProtein, meals };
}

/** Replaces one meal with the next combination for that slot; the rest of the plan stays put. */
export function swapMeal(plan, slotId) {
  const slot = SLOTS.find(s => s.id === slotId);
  const meal = plan.meals.find(m => m.slotId === slotId);
  if (!slot || !meal) return null;
  return buildMeal(slot, plan.vegOnly, meal.optionIndex + 1, plan.targetCalories * slot.share);
}
