// Simulated haze week, used ONLY when live data cannot be reached. Everything the
// app shows from here is labelled "Simulated data". The haze peaks yesterday and
// clears over the following days, roughly like the October 2026 episode.

import { aqiFromPm25 } from './aqi.js';
import { addDays, localMidnightUnix, todayMY } from './api.js';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Smooth pseudo-random noise in [0,1]
function noise(seed, x) {
  return (
    0.5 +
    0.25 * Math.sin(x * 0.9 + seed * 12.1) +
    0.15 * Math.sin(x * 2.3 + seed * 5.7) +
    0.1 * Math.sin(x * 5.1 + seed * 2.3)
  );
}

export function makeDemoData(place, startDate, endDate) {
  const offsetSec = 8 * 3600;
  const seed = hash(`${place.lat.toFixed(2)},${place.lon.toFixed(2)}`);
  const peakDay = addDays(todayMY(), -1);
  const peakT = localMidnightUnix(peakDay, offsetSec) + 14 * 3600;
  const start = localMidnightUnix(startDate, offsetSec);
  const end = localMidnightUnix(addDays(endDate, 1), offsetSec);
  const hazeStrength = 0.7 + 0.6 * seed; // some towns get it worse
  const hours = [];
  for (let t = start; t <= end; t += 3600) {
    const days = (t - peakT) / 86400;
    const hour = ((t + offsetSec) / 3600) % 24;
    const event = Math.exp(-((days / 1.8) ** 2));
    const diurnal = 1 + 0.18 * Math.cos(((hour - 8) / 24) * 2 * Math.PI); // worse in the morning
    const aod = 0.3 + 1.35 * hazeStrength * event * (0.85 + 0.3 * noise(seed, t / 21600));
    const pm2_5 = Math.max(6, (10 + 85 * hazeStrength * event) * diurnal * (0.85 + 0.3 * noise(seed + 1, t / 10800)));
    const afternoon = hour >= 13 && hour <= 19 ? 1 : 0.35;
    const cloudBase = noise(seed + 2, t / 14400);
    hours.push({
      t,
      aod,
      pm2_5,
      pm10: pm2_5 * 1.35,
      ozone: 30 + 40 * Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI)),
      nitrogen_dioxide: 12 + 18 * noise(seed + 3, t / 7200),
      sulphur_dioxide: 3 + 4 * noise(seed + 4, t / 7200),
      carbon_monoxide: 250 + 500 * event + 150 * noise(seed + 5, t / 7200),
      us_aqi: aqiFromPm25(pm2_5),
      cloud_low: Math.round(Math.min(100, (20 + 75 * afternoon * cloudBase) * (1 - 0.3 * event))),
      cloud_mid: Math.round(Math.min(100, 15 + 55 * cloudBase * afternoon)),
      cloud_high: Math.round(Math.min(100, 30 + 60 * noise(seed + 6, t / 28800))),
      temp: 25.5 + 7 * Math.max(0, Math.sin(((hour - 7) / 13) * Math.PI)) - 1.2 * event,
      rh: 88 - 28 * Math.max(0, Math.sin(((hour - 7) / 13) * Math.PI)),
      wind: 4 + 8 * noise(seed + 7, t / 18000),
      weather_code: event > 0.4 ? 45 : cloudBase > 0.7 && afternoon === 1 ? 80 : 2,
    });
  }
  const now = Math.floor(Date.now() / 3600 / 1000) * 3600;
  const cur = hours.reduce((best, h) => (Math.abs(h.t - now) < Math.abs(best.t - now) ? h : best), hours[0]);
  return {
    offsetSec,
    timezone: 'Asia/Kuala_Lumpur',
    current: { ...cur, time: cur.t, windDir: 200 },
    hours,
  };
}
