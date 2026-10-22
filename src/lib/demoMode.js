// Demo mode: open the app with ?demo (e.g. /?demo#/planner or #/planner?demo) to show a
// fixed sample hazy day in Kuala Lumpur on every page, with no live services needed.
// It stays on for the browser tab until the page is opened with ?demo=off.
import { makeDemoData } from './demo.js';
import { aqiFromPm25 } from './aqi.js';
import { addDays, localMidnightUnix, todayMY } from './api.js';
import { CITIES, TOWNSHIPS } from './places.js';

export const DEMO_PLACE = CITIES.find((c) => c.name === 'Kuala Lumpur');

function readFlag() {
  try {
    const hashQuery = window.location.hash.split('?')[1] || '';
    const q = new URLSearchParams(window.location.search + '&' + hashQuery);
    if (q.has('demo')) {
      const on = !['0', 'off', 'false'].includes(q.get('demo'));
      sessionStorage.setItem('sh-demo', on ? '1' : '0');
      return on;
    }
    return sessionStorage.getItem('sh-demo') === '1';
  } catch {
    return false;
  }
}

let flag = null;
export const isDemo = () => (flag ??= readFlag());

/** Midday today: demo readings are shown "as of" 1pm so the story is the same at any hour. */
export const demoNow = () => localMidnightUnix(todayMY(), 8 * 3600) + 13 * 3600;


/** IQAir-style reading for the demo (same fields as /api/iqair). */
export function demoIqair(place) {
  const d = makeDemoData(place, todayMY(), todayMY(), { demo: true });
  const c = d.current;
  return {
    aqius: Math.round(c.us_aqi),
    mainus: 'p2',
    city: place.name,
    state: place.area || '',
    ts: new Date(c.t * 1000).toISOString(),
    weather: { tp: Math.round(c.temp), hu: Math.round(c.rh), ws: Math.round((c.wind / 3.6) * 10) / 10, ic: '50d' },
    demo: true,
  };
}

/** A sample DOE station near each listed town and city, with the last 24 hours of readings. */
export function demoDoeStations() {
  const nowHour = Math.floor(Date.now() / 3600000) * 3600;
  return [...TOWNSHIPS, ...CITIES].map((place, n) => {
    const d = makeDemoData(place, addDays(todayMY(), -2), addDays(todayMY(), 1), { demo: true });
    const hours = d.hours.filter((h) => h.t <= nowHour && h.t > nowHour - 36 * 3600);
    const readings = hours
      .map((h, i) => {
        // DOE's API uses a rolling average, so it moves more slowly than the hourly AQI.
        const win = hours.slice(Math.max(0, i - 11), i + 1);
        const pm = win.reduce((a, x) => a + x.pm2_5, 0) / win.length;
        return { t: h.t, api: Math.round(aqiFromPm25(pm) * 0.9), symbol: '**' };
      })
      .slice(-24);
    const isKl = place === DEMO_PLACE;
    return {
      id: `DEMO${n}`,
      name: isKl ? 'Batu Muda' : `${place.name} (sample)`,
      state: isKl ? 'Kuala Lumpur' : place.area || '',
      lat: place.lat + 0.03,
      lon: place.lon + 0.01,
      readings,
      latest: readings[readings.length - 1] || null,
    };
  });
}

/** Sample fire hotspots in Sumatra and Kalimantan (same shape as /api/fires). */
export function demoFires() {
  const groups = [
    { lat: 0.6, lon: 101.6, n: 38, frp: 60 }, // Riau
    { lat: -1.5, lon: 103.4, n: 26, frp: 45 }, // Jambi
    { lat: -3.1, lon: 104.7, n: 30, frp: 50 }, // South Sumatra
    { lat: -1.9, lon: 113.6, n: 22, frp: 40 }, // Central Kalimantan
    { lat: -0.2, lon: 110.2, n: 12, frp: 30 }, // West Kalimantan
  ];
  const fires = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const g of groups) {
    for (let i = 0; i < g.n; i++) {
      fires.push({ lat: g.lat + (rnd() - 0.5) * 1.6, lon: g.lon + (rnd() - 0.5) * 1.6, frp: Math.round(g.frp * (0.3 + rnd() * 1.4)), conf: 'h', date: todayMY() });
    }
  }
  return { fires, demo: true };
}
