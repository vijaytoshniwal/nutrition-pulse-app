export const $ = id => document.getElementById(id);

export const num = value => Number(value) || 0;

export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const displayDate = (dateKey, opts = { day: 'numeric', month: 'short' }) =>
  new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, opts);

export const weekdayLabel = dateKey =>
  new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

export const dayOfYear = date => Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);

// Normalize dash variants (en/em dash, minus sign) to a plain hyphen and give
// hyphens consistent spacing, so "Salad-Cooked", "Salad - Cooked" and
// "Salad – Cooked" all resolve to the same food.
export const foodKey = name =>
  name
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ');

// A consistent display name for manually entered foods: dash variants
// normalized and evenly spaced, sentence case (first letter capitalized), to
// match the built-in database's convention.
export const standardName = name => {
  const clean = name
    .trim()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
};

export const round1 = value => Math.round(num(value) * 10) / 10;

export const clampPercent = value => Math.max(0, Math.min(100, Math.round(value)));

export function createElement(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') el.className = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) el.setAttribute(key, value);
  });
  children.forEach(child => el.append(child instanceof Node ? child : document.createTextNode(child)));
  return el;
}
