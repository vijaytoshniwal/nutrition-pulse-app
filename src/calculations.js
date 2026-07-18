import { NUTRIENTS } from './constants.js';
import { num, dayKey, displayDate, weekdayLabel } from './utils.js';
import { totalsFor } from './state.js';

export function computeStreak(state) {
  const dates = new Set(state.history.filter(h => num(h.calories) > 0).map(h => h.id));
  if (state.foods.length) dates.add(state.currentDate);
  let count = 0;
  const cursor = new Date(`${state.currentDate}T00:00:00`);
  while (dates.has(dayKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

export function weeklyData(state, todayTotals) {
  const current = new Date(`${state.currentDate}T00:00:00`);
  const weekday = (current.getDay() + 6) % 7;
  const start = new Date(current);
  start.setDate(current.getDate() - weekday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startKey = dayKey(start);
  const endKey = dayKey(end);
  const weekly = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, water: 0 };
  state.history
    .filter(h => h.id >= startKey && h.id <= endKey && h.id !== state.currentDate)
    .forEach(h => {
      NUTRIENTS.forEach(n => (weekly[n] += num(h[n])));
      weekly.water += num(h.water);
    });
  NUTRIENTS.forEach(n => (weekly[n] += todayTotals[n]));
  weekly.water += state.water;
  return { weekly, start, end };
}

/** 0-100 sub-scores for a single day's totals, weighted into an overall score. */
export function scoreParts(targets, totals, water) {
  const calGoal = Math.max(1, num(targets.calories));
  const cal = totals.calories <= calGoal
    ? Math.round((totals.calories / calGoal) * 100)
    : Math.max(0, Math.round(100 - ((totals.calories - calGoal) / calGoal) * 200));
  const protein = Math.min(100, Math.round((totals.protein / Math.max(1, num(targets.protein))) * 100));
  const fibre = Math.min(100, Math.round((totals.fibre / Math.max(1, num(targets.fibre))) * 100));
  const hyd = Math.min(100, Math.round((water / Math.max(0.05, num(targets.water))) * 100));
  const sugarGoal = Math.max(1, num(targets.sugar));
  const sugar = totals.sugar <= sugarGoal ? 100 : Math.max(0, Math.round(100 - ((totals.sugar - sugarGoal) / sugarGoal) * 150));
  const total = Math.round(cal * 0.3 + protein * 0.25 + fibre * 0.15 + hyd * 0.15 + sugar * 0.15);
  return { cal, protein, fibre, hyd, sugar, total };
}

export function weeklyScoreParts(state, todayTotals) {
  const current = new Date(`${state.currentDate}T00:00:00`);
  const weekday = (current.getDay() + 6) % 7;
  const days = [];
  for (let i = 0; i <= weekday; i++) {
    const d = new Date(current);
    d.setDate(current.getDate() - (weekday - i));
    const k = dayKey(d);
    if (k === state.currentDate) {
      days.push(scoreParts(state.targets, todayTotals, state.water));
    } else {
      const h = state.history.find(x => x.id === k);
      if (h) days.push(scoreParts(state.targets, h, num(h.water)));
    }
  }
  if (!days.length) return { cal: 0, protein: 0, fibre: 0, hyd: 0, sugar: 0, total: 0 };
  const avg = key => Math.round(days.reduce((a, d) => a + d[key], 0) / days.length);
  return { cal: avg('cal'), protein: avg('protein'), fibre: avg('fibre'), hyd: avg('hyd'), sugar: avg('sugar'), total: avg('total') };
}

export function gradeForScore(score) {
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

export function sparklineData(state, todayTotals) {
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${state.currentDate}T00:00:00`);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    last7.push(k === state.currentDate ? { id: k, calories: todayTotals.calories } : (state.history.find(h => h.id === k) || { id: k, calories: 0 }));
  }
  const maxCal = Math.max(1, ...last7.map(d => num(d.calories)));
  return last7.map(d => ({
    id: d.id,
    heightPercent: Math.max(4, Math.round((num(d.calories) / maxCal) * 100)),
    label: weekdayLabel(d.id).slice(0, 1),
    isToday: d.id === state.currentDate,
  }));
}

export function latestWeight(state) {
  return state.weights.length ? state.weights[state.weights.length - 1].kg : 0;
}

/** Healthy-BMI-band (18.5-24.9) weight range for the given height. */
export function idealWeightRange(profile) {
  const h = num(profile.heightCm) / 100;
  if (h <= 0) return null;
  return {
    min: Math.round(18.5 * h * h * 10) / 10,
    max: Math.round(24.9 * h * h * 10) / 10,
    target: Math.round(21.7 * h * h * 10) / 10,
  };
}

/** Mifflin-St Jeor BMR scaled by activity factor, adjusted for the chosen goal/pace. */
export function computeTargetsFromProfile(profile, weightKg) {
  const h = num(profile.heightCm);
  const age = num(profile.age);
  if (!weightKg || h <= 0 || age <= 0) return null;
  const bmr = profile.sex === 'male' ? 10 * weightKg + 6.25 * h - 5 * age + 5 : 10 * weightKg + 6.25 * h - 5 * age - 161;
  let calories = bmr * num(profile.activity);
  const dailyAdjust = (num(profile.pace) * 7700) / 7;
  if (profile.goal === 'lose') calories -= dailyAdjust;
  else if (profile.goal === 'gain') calories += dailyAdjust;
  calories = Math.max(profile.sex === 'male' ? 1500 : 1200, calories);
  calories = Math.round(calories / 10) * 10;
  const protein = Math.round(weightKg * (profile.goal === 'lose' ? 1.6 : 1.4));
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.round((calories - protein * 4 - fat * 9) / 4);
  const fibre = Math.round((calories / 1000) * 14);
  const sugar = Math.round((calories * 0.1) / 4);
  const water = Math.round((weightKg * 35) / 10) / 100;
  return { calories, protein, carbs, fat, fibre, sugar, water };
}

/**
 * Fits a straight line through all weigh-ins (least-squares linear regression,
 * days-since-first-entry vs kg) so the trend reflects the actual observed
 * rate of change rather than the flat pace assumption in the profile. Returns
 * null when there isn't enough data or the trend is flat.
 */
export function computeWeightForecast(weights, goalWeight) {
  if (weights.length < 2) return null;
  const firstDate = new Date(`${weights[0].id}T00:00:00`);
  const points = weights.map(w => ({
    x: (new Date(`${w.id}T00:00:00`) - firstDate) / 86400000,
    y: w.kg,
  }));
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const weeklyRate = Math.round(slope * 7 * 10) / 10;
  const lastX = points[points.length - 1].x;

  let etaLabel = '';
  if (goalWeight > 0 && Math.abs(slope) > 0.001) {
    const goalX = (goalWeight - intercept) / slope;
    const daysToGoal = goalX - lastX;
    if (daysToGoal > 0 && daysToGoal < 365 * 2) {
      const eta = new Date();
      eta.setDate(eta.getDate() + Math.round(daysToGoal));
      etaLabel = `At this rate (${weeklyRate >= 0 ? '+' : ''}${weeklyRate} kg/week), you'll reach ${goalWeight} kg around ${eta.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`;
    }
  }

  const projected = [1, 2, 3, 4].map(weeksOut => ({
    weeksOut,
    kg: Math.round((slope * (lastX + weeksOut * 7) + intercept) * 10) / 10,
  }));

  return { weeklyRate, etaLabel, projected };
}

export function weightBarData(weights, count) {
  const w = weights.slice(-count);
  if (!w.length) return [];
  const kgs = w.map(x => x.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  const span = Math.max(0.1, max - min);
  return w.map((x, i) => ({
    heightPercent: Math.round(45 + ((x.kg - min) / span) * 50),
    label: displayDate(x.id),
    kg: x.kg,
    isLatest: i === w.length - 1,
  }));
}

export function weightJourney(state) {
  const goalWeight = num(state.profile.goalWeight);
  const hasWeights = state.weights.length > 0;
  const startWeight = hasWeights ? state.weights[0].kg : 0;
  const currentWeight = hasWeights ? state.weights[state.weights.length - 1].kg : 0;
  const active = goalWeight > 0 && hasWeights && Math.abs(startWeight - goalWeight) > 0.05;
  if (!active) return { active: false };

  const total = startWeight - goalWeight;
  const done = startWeight - currentWeight;
  const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  const lost = Math.round(done * 10) / 10;
  const left = Math.round((currentWeight - goalWeight) * 10) / 10;
  const reached = total > 0 ? left <= 0 : left >= 0;
  let etaLabel = '';
  if (!reached) {
    const pace = Math.max(0.1, num(state.profile.pace));
    const weeks = Math.abs(left) / pace;
    if (weeks < 520) {
      const eta = new Date();
      eta.setDate(eta.getDate() + Math.round(weeks * 7));
      etaLabel = `On track to reach ${goalWeight} kg around ${eta.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} at ${pace} kg/week.`;
    }
  }
  return {
    active: true,
    percent,
    lostLabel: `${Math.abs(lost)} kg ${total > 0 ? 'lost' : 'gained'}`,
    leftLabel: reached ? 'Goal reached! 🎉' : `${Math.abs(left)} kg to go`,
    etaLabel,
    startLabel: `${startWeight} kg`,
    goalLabel: `${goalWeight} kg`,
  };
}
