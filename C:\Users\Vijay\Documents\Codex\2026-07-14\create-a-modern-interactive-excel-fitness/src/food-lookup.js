import { NUTRIENTS, FALLBACK_FOODS, PIECE_WEIGHTS } from './constants.js';
import { num, foodKey } from './utils.js';

export function comparableQuantity(name, quantity, unit) {
  const key = foodKey(name);
  return unit === 'pieces' && PIECE_WEIGHTS[key] ? quantity * PIECE_WEIGHTS[key] : quantity;
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

  try {
    const endpoint = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Lookup failed');
    const data = await response.json();
    const product = (data.products || []).find(item => item.nutriments && Number(item.nutriments['energy-kcal_100g']) > 0);
    if (!product) throw new Error('No match');
    const values = nutritionFromOpenFoodFactsProduct(product, quantityGrams);
    const note = unit === 'ml' ? ' (using 1 ml ≈ 1 g).' : '';
    return { values, status: `Calculated from ${product.product_name || 'a matching product'}${note}. Review values before saving.`, manualMode: false };
  } catch {
    return { values: null, status: 'No match found. Select "Enter nutrition manually" to type the values.', manualMode: false };
  }
}
