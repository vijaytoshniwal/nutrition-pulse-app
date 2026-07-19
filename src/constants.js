/** Shown on the sign-in screen; keep in step with the cache version in sw.js. */
export const APP_VERSION = '2.21';

export const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar'];

export const DEFAULT_TARGETS = { calories: 2000, protein: 120, carbs: 230, fat: 65, fibre: 30, sugar: 40, water: 2.5 };

export const DEFAULT_PROFILE = { heightCm: '', age: '', sex: 'female', activity: '1.4', goal: 'lose', goalWeight: '', pace: '0.5' };

export const DEFAULT_ACTIVITY_TARGETS = { steps: 8000, burnKcal: 400, exMin: 30 };

export const FALLBACK_FOODS = {
  apple: { calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2, fibre: 2.4, sugar: 10.4 },
  banana: { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fibre: 2.6, sugar: 12.2 },
  almonds: { calories: 579, protein: 21.2, carbs: 21.6, fat: 49.9, fibre: 12.5, sugar: 4.4 },
  mango: { calories: 60, protein: 0.8, carbs: 15, fat: 0.4, fibre: 1.6, sugar: 13.7 },
  papaya: { calories: 43, protein: 0.5, carbs: 10.8, fat: 0.3, fibre: 1.7, sugar: 7.8 },
  rice: { calories: 130, protein: 2.4, carbs: 28.2, fat: 0.3, fibre: 0.4, sugar: 0.1 },
  dal: { calories: 116, protein: 9, carbs: 20.1, fat: 0.4, fibre: 7.9, sugar: 1.8 },
  roti: { calories: 297, protein: 11.6, carbs: 55.3, fat: 2.5, fibre: 10.7, sugar: 0.4 },
  sattu: { calories: 400, protein: 22, carbs: 58, fat: 7, fibre: 12, sugar: 2 },
  paneer: { calories: 296, protein: 19.1, carbs: 4.5, fat: 22.8, fibre: 0, sugar: 3.2 },
  'cottage cheese': { calories: 98, protein: 11.1, carbs: 3.4, fat: 4.3, fibre: 0, sugar: 2.7 },
  curd: { calories: 60, protein: 3.1, carbs: 4.7, fat: 3.3, fibre: 0, sugar: 4.7 },
  'green tea': { calories: 1, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 },
  'lemon water': { calories: 2, protein: 0, carbs: 0.7, fat: 0, fibre: 0, sugar: 0.2 },
};

export const PIECE_WEIGHTS = { apple: 182, banana: 118, almonds: 1.2, mango: 200, papaya: 140, roti: 40 };

export const QUOTES = [
  'Small consistent choices build lasting results.',
  'Progress, not perfection.',
  'Fuel your body like you plan to use it.',
  'Discipline is choosing what you want most over what you want now.',
  'Every meal is a chance to take care of yourself.',
  'Hydration is the easiest win of the day.',
  'Strong habits build a strong body.',
  'You don’t have to be extreme, just consistent.',
  'Nourish, don’t punish.',
  'Track it, don’t stress it.',
];

export const FOOD_PICKS = [
  { icon: '🍛', name: 'Moong dal', stat: '9g · 105 kcal' },
  { icon: '🧀', name: 'Paneer (low-fat)', stat: '18g · 158 kcal' },
  { icon: '🥛', name: 'Greek yogurt', stat: '10g · 59 kcal' },
  { icon: '🌱', name: 'Tofu', stat: '8g · 76 kcal' },
  { icon: '🌿', name: 'Green peas', stat: '5g · 81 kcal' },
  { icon: '🌰', name: 'Chana', stat: '9g · 164 kcal' },
  { icon: '🥜', name: 'Peanut chaat', stat: '26g · 90 kcal/serve' },
  { icon: '🍄', name: 'Mushroom', stat: '3g · 22 kcal' },
  { icon: '🥦', name: 'Broccoli', stat: '2.8g · 34 kcal' },
  { icon: '🌾', name: 'Sattu drink', stat: '22g · 80 kcal/serve' },
  { icon: '🥞', name: 'Besan chilla', stat: '10g · 120 kcal/serve' },
  { icon: '🍲', name: 'Sprouts salad', stat: '8g · 90 kcal/serve' },
];

export const NAV_ITEMS = [
  { id: 'today', label: 'Today' },
  { id: 'trends', label: 'Trends' },
  { id: 'activity', label: 'Activity' },
  { id: 'weight', label: 'Weight' },
  { id: 'meals', label: 'Meals' },
  { id: 'profile', label: 'Profile' },
];
