// Outdoor planner: scores each coming hour for jogging, cycling or outdoor sports from
// air quality (US AQI), heat (heat index), UV and rain, then finds the best time slots.

import { heatIndex } from './weather.js';

const localHourOf = (t, offsetSec) => new Date((t + offsetSec) * 1000).getUTCHours();
const localDateOf = (t, offsetSec) => new Date((t + offsetSec) * 1000).toISOString().slice(0, 10);

/**
 * One hour's rating. sensitive = children, elderly or asthma: stricter air limits.
 * Returns { level: 'great' | 'ok' | 'avoid', score (0–100, higher is better), reasons: [] }.
 */
export function rateHour(h, { sensitive = false, offsetSec = 8 * 3600 } = {}) {
  const reasons = [];
  let score = 100;
  let avoid = false;

  const aqi = h.us_aqi;
  const [okAqi, badAqi] = sensitive ? [50, 100] : [100, 150];
  if (aqi !== null && aqi !== undefined) {
    if (aqi > badAqi) {
      avoid = true;
      reasons.push('unhealthy air');
    } else if (aqi > okAqi) {
      score -= 30;
      reasons.push('hazy air');
    } else {
      score -= aqi / 5; // up to −20 for a moderate reading
    }
  }

  const hi = heatIndex(h.temp, h.rh);
  if (hi !== null) {
    if (hi >= 41) {
      avoid = true;
      reasons.push('dangerous heat');
    } else if (hi >= 32) {
      score -= 30;
      reasons.push('very hot');
    } else if (hi >= 27) {
      score -= 10;
    }
  }

  if ((h.uv ?? 0) >= 8) {
    score -= 20;
    reasons.push('strong sun');
  } else if ((h.uv ?? 0) >= 6) {
    score -= 8;
  }

  const rain = h.rain ?? 0;
  const chance = h.rain_chance ?? 0;
  if (rain >= 1 || (h.weather_code ?? 0) >= 95) {
    avoid = true;
    reasons.push(h.weather_code >= 95 ? 'thunderstorm' : 'rain');
  } else if (chance >= 60) {
    score -= 20;
    reasons.push('likely rain');
  }

  const hour = localHourOf(h.t, offsetSec);
  if (hour < 5 || hour >= 22) {
    avoid = true;
    reasons.push('night');
  }

  score = Math.max(0, Math.round(score));
  const level = avoid ? 'avoid' : score >= 70 ? 'great' : score >= 45 ? 'ok' : 'avoid';
  return { level, score: avoid ? 0 : score, reasons };
}

/**
 * hours: hourly rows (t, us_aqi, temp, rh, uv, rain, rain_chance, weather_code).
 * Returns the next `count` hours with ratings, and the best slot of `slotHours` per day.
 */
export function outdoorPlan(hours, { now = Date.now() / 1000, offsetSec = 8 * 3600, sensitive = false, count = 36, slotHours = 2 } = {}) {
  const next = hours.filter((h) => h.t >= now - 1800).slice(0, count);
  const rated = next.map((h) => ({ t: h.t, hour: localHourOf(h.t, offsetSec), date: localDateOf(h.t, offsetSec), ...rateHour(h, { sensitive, offsetSec }) }));
  const best = [];
  const dates = [...new Set(rated.map((r) => r.date))];
  for (const d of dates) {
    const day = rated.filter((r) => r.date === d);
    let pick = null;
    for (let i = 0; i + slotHours <= day.length; i++) {
      const slot = day.slice(i, i + slotHours);
      if (slot.some((r) => r.level === 'avoid')) continue;
      if (slot[slotHours - 1].t - slot[0].t !== (slotHours - 1) * 3600) continue; // must be consecutive
      const score = slot.reduce((s, r) => s + r.score, 0) / slotHours;
      if (!pick || score > pick.score) pick = { date: d, startHour: slot[0].hour, endHour: (slot[slotHours - 1].hour + 1) % 24, t: slot[0].t, score, level: score >= 70 ? 'great' : 'ok' };
    }
    best.push(pick ? pick : { date: d, none: true, why: mostCommon(day.flatMap((r) => r.reasons).filter((x) => x !== 'night')) });
  }
  return { hours: rated, best };
}

function mostCommon(list) {
  if (!list.length) return null;
  const n = {};
  list.forEach((x) => (n[x] = (n[x] || 0) + 1));
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
}
