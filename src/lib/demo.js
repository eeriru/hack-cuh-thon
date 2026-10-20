// Simulated haze week, used ONLY when live data cannot be reached. Everything the
// app shows from here is labelled "Simulated data". The haze peaks yesterday and
// clears over the following days, roughly like the October 2026 episode.

import { aqiFromPm25 } from './aqi.js';
import { addDays, localMidnightUnix, todayMY } from './api.js';
import { heatIndex } from './weather.js';

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
    const temp = 25.5 + 7 * Math.max(0, Math.sin(((hour - 7) / 13) * Math.PI)) - 1.2 * event;
    const rh = 88 - 28 * Math.max(0, Math.sin(((hour - 7) / 13) * Math.PI));
    const sunUp = Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI));
    // Afternoon thunderstorms on clean days, as usual in the inter-monsoon
    const rain = afternoon === 1 && cloudBase > 0.72 && event < 0.4 ? Math.round((cloudBase - 0.7) * 35 * 10) / 10 : 0;
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
      temp,
      rh,
      feels: heatIndex(temp, rh),
      rain,
      rain_chance: Math.round(Math.min(95, Math.max(5, (cloudBase - 0.3) * 120 * afternoon * (1 - 0.6 * event)))),
      uv: Math.round(11 * sunUp * (1 - 0.5 * cloudBase * afternoon) * (1 - 0.4 * event) * 10) / 10,
      wind: 4 + 8 * noise(seed + 7, t / 18000),
      gust: 10 + 18 * noise(seed + 8, t / 18000),
      weather_code: rain > 0 ? (rain > 6 ? 95 : 80) : event > 0.4 ? 45 : cloudBase > 0.7 && afternoon === 1 ? 3 : 2,
    });
  }
  // Daily summary built from the hours (same fields as the live daily forecast)
  const byDay = new Map();
  for (const h of hours) {
    const d = new Date((h.t - 1 + offsetSec) * 1000).toISOString().slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(h);
  }
  const daily = [...byDay.entries()]
    .filter(([d]) => d >= startDate && d <= endDate)
    .map(([d, hs]) => {
      const max = (k) => Math.max(...hs.map((h) => h[k] ?? -Infinity));
      const midnight = localMidnightUnix(d, offsetSec);
      const rainSum = hs.reduce((a, h) => a + (h.rain || 0), 0);
      return {
        t: midnight,
        weather_code: rainSum > 6 ? 95 : rainSum > 0 ? 80 : max('aod') > 1 ? 45 : 2,
        tmax: max('temp'),
        tmin: Math.min(...hs.map((h) => h.temp)),
        feelsMax: max('feels'),
        rain: Math.round(rainSum * 10) / 10,
        rainChance: max('rain_chance'),
        rainHours: hs.filter((h) => h.rain > 0).length,
        windMax: max('wind'),
        gustMax: max('gust'),
        windDir: 200,
        uvMax: max('uv'),
        sunrise: midnight + 7 * 3600 + 5 * 60,
        sunset: midnight + 19 * 3600 + 15 * 60,
        sunshineSec: hs.filter((h) => h.uv > 3).length * 3000,
        radiationMJ: null,
      };
    });
  const now = Math.floor(Date.now() / 3600 / 1000) * 3600;
  const cur = hours.reduce((best, h) => (Math.abs(h.t - now) < Math.abs(best.t - now) ? h : best), hours[0]);
  return {
    offsetSec,
    timezone: 'Asia/Kuala_Lumpur',
    current: { ...cur, time: cur.t, windDir: 200, cloud: cur.cloud_low, isDay: cur.uv > 0 ? 1 : 0 },
    hours,
    daily,
  };
}
