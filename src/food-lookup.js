import { NUTRIENTS, FALLBACK_FOODS, PIECE_WEIGHTS } from './constants.js';
import { num, foodKey } from './utils.js';
import { hashDistance, isSimilarPhoto } from './image-hash.js';
import { fetchFoodBankEntry } from './firebase-sync.js';
import { FOOD_DB } from './food-db.js';

/**
 * Reads a nutrition table out of OCR text (e.g. a screenshot of a nutrition
 * label or an AI food breakdown). Handles ranges like "35–40 kcal" (averaged)
 * and detects the serving weight if the text states one. Returns
 * { values: {calories, protein, carbs, fat, fibre, sugar}, servingG }.
 */
export function parseNutritionFromText(text) {
  const t = text.replace(/\s+/g, ' ');
  const lower = t.toLowerCase();

  // A single number, or a tight range "a–b" which we average. OCR often drops
  // the decimal point (reading "3.5" as "35"), which would turn "3–3.5" into a
  // nonsense average of 19 — so if the upper bound is implausibly larger than
  // the lower, recover the decimal (35→3.5) or fall back to the lower bound.
  const grab = keywordPattern => {
    const re = new RegExp(`(?:${keywordPattern})[^0-9\\n]{0,18}(\\d+(?:\\.\\d+)?)(?:\\s*[–—-]\\s*(\\d+(?:\\.\\d+)?))?`, 'i');
    const m = lower.match(re);
    if (!m || m[1] === undefined) return null;
    const a = parseFloat(m[1]);
    if (m[2] === undefined) return a;
    let b = parseFloat(m[2]);
    if (b > a * 2) {
      const recovered = b / 10;
      b = recovered >= a * 0.5 && recovered <= a * 2 ? recovered : a;
    }
    return Math.round(((a + b) / 2) * 10) / 10;
  };

  const values = {
    calories: grab('calor|energy'),
    protein: grab('protein'),
    carbs: grab('carbo|carbs'),
    fat: grab('(?<!saturated )(?<!trans )fat'),
    fibre: grab('fib(?:re|er)'),
    sugar: grab('sugar'),
  };

  // Serving weight: "(50 g)", "(about 50 g)", "per 100 g", "serving 30 g".
  let servingG = null;
  const paren = t.match(/\(?\s*(?:about\s*)?(\d+(?:\.\d+)?)\s*(?:g|gram|grams|ml)\s*\)/i);
  const per = lower.match(/per\s*(\d+(?:\.\d+)?)\s*(?:g|gram|grams|ml)/i);
  const serv = lower.match(/serving[^0-9]{0,15}(\d+(?:\.\d+)?)\s*(?:g|gram|grams|ml)/i);
  if (per) servingG = parseFloat(per[1]);
  else if (serv) servingG = parseFloat(serv[1]);
  else if (paren) servingG = parseFloat(paren[1]);

  return { values, servingG };
}

/** Exact-name (or whole-word alias) match in the built-in database. */
export function findInFoodDb(key) {
  return FOOD_DB.find(item =>
    item.n.toLowerCase() === key ||
    (item.a && (` ${item.a.toLowerCase()} `).includes(` ${key} `))
  ) || null;
}

/** Scales a compact FOOD_DB row (per-100g short keys) to full nutrient values. */
export function scaleFoodDbItem(item, factor) {
  return {
    calories: Number((item.k * factor).toFixed(1)),
    protein: Number((item.p * factor).toFixed(1)),
    carbs: Number((item.cb * factor).toFixed(1)),
    fat: Number((item.f * factor).toFixed(1)),
    fibre: Number((item.fb * factor).toFixed(1)),
    sugar: Number((item.s * factor).toFixed(1)),
  };
}

/** Search-as-you-type over the built-in database, optionally vegetarian-only. */
export function searchFoods(query, vegOnly = false, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const item of FOOD_DB) {
    if (vegOnly && item.v !== 1) continue;
    const name = item.n.toLowerCase();
    const aliases = (item.a || '').toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (aliases.includes(q)) score = 1;
    if (score) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.n.length - b.item.n.length);
  return scored.slice(0, limit).map(entry => entry.item);
}

export function comparableQuantity(name, quantity, unit) {
  const key = foodKey(name);
  return unit === 'pieces' && PIECE_WEIGHTS[key] ? quantity * PIECE_WEIGHTS[key] : quantity;
}

/** Finds the saved custom food whose photo is the closest match, if any is within similarity range. */
export function findFoodByPhotoHash(hash, customFoods) {
  let best = null;
  let bestScore = Infinity;
  Object.values(customFoods).forEach(food => {
    (food.photoHashes || []).forEach(saved => {
      if (!isSimilarPhoto(hash, saved)) return;
      const { structDist, colorDist } = hashDistance(hash, saved);
      const score = structDist + colorDist / 3;
      if (score < bestScore) {
        bestScore = score;
        best = food;
      }
    });
  });
  return best;
}

function scaleNutrients(source, factor, decimals = 1) {
  return Object.fromEntries(NUTRIENTS.map(n => [n, Number((num(source[n]) * factor).toFixed(decimals))]));
}

function nutritionFromOpenFoodFactsProduct(product, quantityGrams) {
  const n = product.nutriments || {};
  const per100 = (...keys) => keys.map(k => Number(n[k])).find(Number.isFinite) || 0;
  const factor = quantityGrams / 100;
  return {
    calories: Number((per100('energy-kcal_100g', 'energy-kcal') * factor).toFixed(1)),
    protein: Number((per100('proteins_100g', 'proteins') * factor).toFixed(1)),
    carbs: Number((per100('carbohydrates_100g', 'carbohydrates') * factor).toFixed(1)),
    fat: Number((per100('fat_100g', 'fat') * factor).toFixed(1)),
    fibre: Number((per100('fiber_100g', 'fiber') * factor).toFixed(1)),
    sugar: Number((per100('sugars_100g', 'sugars') * factor).toFixed(1)),
  };
}

/**
 * Resolves nutrition for a food entry, in priority order: the user's own saved
 * manual values for that food name, a small built-in reference list, then a live
 * OpenFoodFacts lookup. Returns { values, status, manualMode } — values is null
 * when nothing could be resolved and the caller should prompt for manual entry.
 */
export async function calculateFood(name, quantity, unit, customFoods) {
  if (!name || quantity <= 0) return { values: null, status: 'Enter a food name and quantity first.', manualMode: false };

  const key = foodKey(name);
  const quantityGrams = comparableQuantity(name, quantity, unit);
  const saved = customFoods[key];
  if (saved && saved.baseQuantity > 0) {
    const factor = quantityGrams / saved.baseQuantity;
    const values = Object.fromEntries(NUTRIENTS.map(n => [n, saved[n] == null ? null : Number((num(saved[n]) * factor).toFixed(1))]));
    return { values, status: `Calculated from your saved values for ${saved.name}. Please review and save.`, manualMode: true };
  }

  if (unit === 'pieces' && !PIECE_WEIGHTS[key]) {
    return { values: null, status: 'No saved manual values were found for this food. For new foods in pieces, use grams or enter nutrition manually.', manualMode: false };
  }

  const fallback = FALLBACK_FOODS[key];
  if (fallback) {
    const values = scaleNutrients(fallback, quantityGrams / 100);
    const note = unit === 'ml' ? ' (using 1 ml ≈ 1 g).' : unit === 'pieces' ? ` (using ~${PIECE_WEIGHTS[key]} g per piece).` : '';
    return { values, status: `Calculated from the basic food list${note}`, manualMode: false };
  }

  const dbItem = findInFoodDb(key);
  if (dbItem) {
    const values = scaleFoodDbItem(dbItem, quantityGrams / 100);
    return { values, status: `Calculated from the Indian food database (${dbItem.n}).`, manualMode: false };
  }

  const shared = await fetchFoodBankEntry(key);
  if (shared && shared.baseQuantity > 0) {
    const factor = quantityGrams / shared.baseQuantity;
    const values = Object.fromEntries(NUTRIENTS.map(n => [n, shared[n] == null ? null : Number((num(shared[n]) * factor).toFixed(1))]));
    return { values, status: `Calculated from the shared food bank (${shared.name}). Review the values, then save.`, manualMode: true };
  }

  try {
    const endpoint = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,nutriments`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Lookup failed');
    const data = await response.json();
    // Rank candidates by how well the product name matches what was typed,
    // rather than trusting the API's ordering — otherwise "paneer" can return
    // some unrelated packaged item that merely mentions it.
    const query = name.toLowerCase();
    const queryWords = query.split(/\s+/).filter(Boolean);
    const candidates = (data.products || [])
      .filter(item => item.nutriments && Number(item.nutriments['energy-kcal_100g']) > 0)
      .map(item => {
        const productName = (item.product_name || '').toLowerCase();
        let score = 0;
        if (productName === query) score = 3;
        else if (productName.includes(query)) score = 2;
        else if (queryWords.some(word => productName.includes(word))) score = 1;
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);
    const product = candidates.length ? candidates[0].item : null;
    if (!product) throw new Error('No match');
    const values = nutritionFromOpenFoodFactsProduct(product, quantityGrams);
    const note = unit === 'ml' ? ' (using 1 ml ≈ 1 g).' : '';
    return { values, status: `Calculated from ${product.product_name || 'a matching product'}${note}. Review values before saving.`, manualMode: false };
  } catch {
    return { values: null, status: 'No match found. Select "Enter nutrition manually" to type the values.', manualMode: false };
  }
}
