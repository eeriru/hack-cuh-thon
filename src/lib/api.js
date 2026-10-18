// Data layer: free Open-Meteo APIs, called straight from the browser (no keys,
// no server). If the network fails (e.g. venue Wi-Fi), the app switches to a
// clearly labelled simulated haze week so a demo still works.

import { makeDemoData } from './demo.js';

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WX_URL = 'https://api.open-meteo.com/v1/forecast';
const SAT_URL = 'https://satellite-api.open-meteo.com/v1/archive';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const AQ_HOURLY = [
  'us_aqi',
  'pm2_5',
  'pm10',
  'ozone',
  'nitrogen_dioxide',
  'sulphur_dioxide',
  'carbon_monoxide',
  'aerosol_optical_depth',
];
const AQ_CURRENT = [...AQ_HOURLY];
const WX_HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'wind_speed_10m',
  'weather_code',
];
const WX_CURRENT = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', 'weather_code'];

const cache = new Map();

async function getJson(url, timeoutMs = 15000) {
  if (cache.has(url)) return cache.get(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const p = fetch(url, { signal: ctrl.signal })
    .then(async (r) => {
      const json = await r.json().catch(() => null);
      if (!r.ok || !json || json.error) throw new Error(json?.reason || `HTTP ${r.status}`);
      return json;
    })
    .finally(() => clearTimeout(timer));
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

// ---------- dates ----------

export const localDateOf = (unix, offsetSec) => new Date((unix + offsetSec) * 1000).toISOString().slice(0, 10);

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Malaysia (UTC+8), used to bound requests before we know a location's offset. */
export const todayMY = () => localDateOf(Math.floor(Date.now() / 1000), 8 * 3600);

export function localMidnightUnix(dateStr, offsetSec) {
  return Date.parse(`${dateStr}T00:00:00Z`) / 1000 - offsetSec;
}

// ---------- normalising ----------

function zipHourly(json, map) {
  const out = new Map();
  const h = json?.hourly;
  if (!h?.time) return out;
  h.time.forEach((t, i) => {
    const row = { t };
    for (const [src, dst] of Object.entries(map)) row[dst] = h[src]?.[i] ?? null;
    out.set(t, row);
  });
  return out;
}

const AQ_MAP = Object.fromEntries(AQ_HOURLY.map((k) => [k, k === 'aerosol_optical_depth' ? 'aod' : k]));
const WX_MAP = {
  temperature_2m: 'temp',
  relative_humidity_2m: 'rh',
  cloud_cover_low: 'cloud_low',
  cloud_cover_mid: 'cloud_mid',
  cloud_cover_high: 'cloud_high',
  wind_speed_10m: 'wind',
  weather_code: 'weather_code',
};

function normalize(aq, wx) {
  const aqRows = zipHourly(aq, AQ_MAP);
  const wxRows = zipHourly(wx, WX_MAP);
  const times = [...new Set([...aqRows.keys(), ...wxRows.keys()])].sort((a, b) => a - b);
  const hours = times.map((t) => ({ ...(wxRows.get(t) || { t }), ...(aqRows.get(t) || {}) }));
  const c = aq?.current || {};
  const w = wx?.current || {};
  return {
    offsetSec: wx?.utc_offset_seconds ?? aq?.utc_offset_seconds ?? 8 * 3600,
    timezone: wx?.timezone || aq?.timezone,
    current: {
      time: c.time ?? w.time,
      us_aqi: c.us_aqi,
      pm2_5: c.pm2_5,
      pm10: c.pm10,
      ozone: c.ozone,
      nitrogen_dioxide: c.nitrogen_dioxide,
      sulphur_dioxide: c.sulphur_dioxide,
      carbon_monoxide: c.carbon_monoxide,
      aod: c.aerosol_optical_depth,
      temp: w.temperature_2m,
      rh: w.relative_humidity_2m,
      wind: w.wind_speed_10m,
      windDir: w.wind_direction_10m,
      weather_code: w.weather_code,
    },
    hours,
  };
}

// ---------- public API ----------

/**
 * Air quality + weather for one place between two local dates (inclusive).
 * Open-Meteo keeps about 3 months of past data and forecasts air quality ~5 days ahead.
 */
export async function getPlaceData(place, { startDate, endDate }) {
  const common = {
    latitude: place.lat,
    longitude: place.lon,
    timezone: 'auto',
    timeformat: 'unixtime',
    start_date: startDate,
    end_date: endDate,
  };
  try {
    const [aq, wx] = await Promise.all([
      getJson(`${AQ_URL}?${qs({ ...common, hourly: AQ_HOURLY.join(','), current: AQ_CURRENT.join(',') })}`),
      getJson(`${WX_URL}?${qs({ ...common, hourly: WX_HOURLY.join(','), current: WX_CURRENT.join(',') })}`),
    ]);
    return { source: 'live', ...normalize(aq, wx) };
  } catch (err) {
    console.warn('Live data unavailable, using simulated haze week:', err);
    return { source: 'demo', error: String(err.message || err), ...makeDemoData(place, startDate, endDate) };
  }
}

/** Same as getPlaceData but for many places in one request each (used by the rankings). */
export async function getManyPlaces(places, { startDate, endDate }) {
  const common = {
    latitude: places.map((p) => p.lat).join(','),
    longitude: places.map((p) => p.lon).join(','),
    timezone: 'auto',
    timeformat: 'unixtime',
    start_date: startDate,
    end_date: endDate,
  };
  try {
    const [aq, wx] = await Promise.all([
      getJson(`${AQ_URL}?${qs({ ...common, hourly: 'pm2_5,aerosol_optical_depth,us_aqi', current: 'us_aqi,pm2_5,aerosol_optical_depth' })}`),
      getJson(`${WX_URL}?${qs({ ...common, hourly: WX_HOURLY.join(','), current: WX_CURRENT.join(',') })}`),
    ]);
    const aqList = Array.isArray(aq) ? aq : [aq];
    const wxList = Array.isArray(wx) ? wx : [wx];
    return places.map((p, i) => ({ place: p, source: 'live', ...normalize(aqList[i], wxList[i]) }));
  } catch (err) {
    console.warn('Live rankings unavailable, using simulated data:', err);
    return places.map((p) => ({ place: p, source: 'demo', ...makeDemoData(p, startDate, endDate) }));
  }
}

/** Measured sunlight from the Himawari satellite (past days only), keyed by unix hour end. */
export async function getSatelliteGhi(place, { startDate, endDate }) {
  const url = `${SAT_URL}?${qs({
    latitude: place.lat,
    longitude: place.lon,
    hourly: 'shortwave_radiation',
    models: 'satellite_radiation_seamless',
    timezone: 'auto',
    timeformat: 'unixtime',
    start_date: startDate,
    end_date: endDate,
  })}`;
  try {
    const json = await getJson(url);
    const map = new Map();
    json.hourly?.time?.forEach((t, i) => {
      const v = json.hourly.shortwave_radiation?.[i];
      if (v !== null && v !== undefined) map.set(t, v);
    });
    return map;
  } catch {
    return new Map();
  }
}

export async function searchPlaces(name) {
  if (!name || name.trim().length < 2) return [];
  const json = await getJson(`${GEO_URL}?${qs({ name: name.trim(), count: 8, language: 'en', format: 'json' })}`);
  return (json.results || []).map((r) => ({
    name: r.name,
    area: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// ---------- model inputs ----------

const avg = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : (a + b) / 2);

/**
 * The 24 model rows for one local day. Each row is the hour ENDING at `t`; its haze and
 * weather inputs are the average of the readings at the start and end of that hour
 * (training uses the same rule).
 */
export function dayModelHours(data, dateStr) {
  const byT = new Map(data.hours.map((h) => [h.t, h]));
  const midnight = localMidnightUnix(dateStr, data.offsetSec);
  const rows = [];
  for (let k = 0; k < 24; k++) {
    const t = midnight + (k + 1) * 3600;
    const end = byT.get(t);
    const start = byT.get(t - 3600);
    if (!end && !start) continue;
    const e = end || start;
    const s = start || end;
    rows.push({
      t,
      localHour: k,
      aod: avg(s.aod, e.aod),
      pm2_5: avg(s.pm2_5, e.pm2_5),
      cloud_low: avg(s.cloud_low, e.cloud_low),
      cloud_mid: avg(s.cloud_mid, e.cloud_mid),
      cloud_high: avg(s.cloud_high, e.cloud_high),
      rh: avg(s.rh, e.rh),
      temp: avg(s.temp, e.temp),
    });
  }
  return rows;
}

/** Dates (local) that have data, in order. */
export function availableDates(data) {
  const set = new Set(data.hours.map((h) => localDateOf(h.t - 1, data.offsetSec)));
  return [...set].sort();
}
