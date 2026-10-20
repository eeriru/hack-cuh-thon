// Official Malaysian Air Pollutant Index (API) from the Department of Environment
// (Jabatan Alam Sekitar), via its public MyEQMS / APIMS hourly feed.
// The DOE server does not allow browsers on other sites to call it, so the app goes
// through its own small server function: /api/doe (api/doe.js on Vercel, and a dev
// proxy in vite.config.js locally). That function passes the DOE JSON through unchanged;
// all parsing happens here.

export const DOE_SOURCE_URL = 'https://eqms.doe.gov.my/APIMS/main';
const PROXY_URL = '/api/doe';

// DOE API status bands. Colours follow the DOE's blue → green → yellow → orange → red scheme.
export const DOE_LEVELS = [
  { max: 50, key: 'good', label: 'Good', color: '#3d8fe0', ink: '#ffffff' },
  { max: 100, key: 'moderate', label: 'Moderate', color: '#4caf50', ink: '#ffffff' },
  { max: 200, key: 'unhealthy', label: 'Unhealthy', color: '#f7cf2d', ink: '#4a3b00' },
  { max: 300, key: 'very', label: 'Very unhealthy', color: '#f08a24', ink: '#3d1d00' },
  { max: 500, key: 'hazardous', label: 'Hazardous', color: '#e03b3b', ink: '#ffffff' },
  { max: Infinity, key: 'emergency', label: 'Emergency', color: '#7a1414', ink: '#ffffff' },
];

export function doeLevel(api) {
  if (api === null || api === undefined || Number.isNaN(api)) {
    return { key: 'na', label: 'No reading', color: '#d9d4ca', ink: '#3d3a33' };
  }
  return DOE_LEVELS.find((l) => api <= l.max);
}

// Health advice, quoted from the DOE's "General Information of Air Pollutant Index".
export const DOE_ADVICE = {
  good: 'No restriction for outdoor activities to the public. Maintain healthy lifestyle.',
  moderate: 'No restriction for outdoor activities to the public. Maintain healthy lifestyle.',
  unhealthy: 'Limited outdoor activities for the high risk people. Public need to reduce the extreme outdoor activities.',
  very: 'Old and high risk people are advised to stay indoor and reduce physical activities. People with health complications are advised to see doctor.',
  hazardous: 'Old and high risk people are prohibited for outdoor activities. Public are advised to prevent from outdoor activities.',
  emergency: 'Public are advised to follow orders from National Security Council and always follow the announcement in mass media.',
};

// Dominant-pollutant symbols used in APIMS tables.
export const DOE_SYMBOLS = {
  '**': 'PM2.5',
  '*': 'PM10',
  a: 'Sulphur dioxide',
  b: 'Nitrogen dioxide',
  c: 'Ozone',
  d: 'Carbon monoxide',
  '&': 'More than one pollutant',
};

/** DOE timestamps are Malaysia local time without a zone, e.g. "2026-10-20T10:00:00". */
export function parseDoeTime(s) {
  if (!s) return null;
  const t = Date.parse(`${String(s).slice(0, 19)}+08:00`);
  return Number.isNaN(t) ? null : t / 1000;
}

/** API values can carry flags or be blank; keep plain whole numbers in 0–999 only. */
export function parseDoeApi(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v < 1000 ? Math.round(v) : null;
  const m = /^\s*(\d{1,3})\s*$/.exec(String(v ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bHi-tech\b/g, 'Hi-Tech');

/**
 * Turn the raw DOE payload into stations:
 * [{ id, name, state, lat, lon, readings: [{ t, api, symbol }] (oldest first), latest }]
 */
export function parseDoe(raw) {
  const rows = raw?.api_table_hourly;
  if (!Array.isArray(rows)) throw new Error('Unexpected DOE response');
  const byId = new Map();
  for (const r of rows) {
    const id = r.STATION_ID;
    const lat = parseFloat(r.LATITUDE);
    const lon = parseFloat(r.LONGITUDE);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!byId.has(id)) {
      const loc = String(r.STATION_LOCATION || r.STATION_NAME || id);
      const [town, state] = loc.split(',').map((x) => x.trim());
      byId.set(id, { id, name: titleCase(town || loc), state: state ? titleCase(state) : '', lat, lon, readings: [] });
    }
    const t = parseDoeTime(r.DATETIME);
    if (t === null) continue;
    byId.get(id).readings.push({ t, api: parseDoeApi(r.API), symbol: (r.PARAM_SYMBOL || '').trim() });
  }
  const stations = [...byId.values()];
  for (const s of stations) {
    s.readings.sort((a, b) => a.t - b.t);
    // Drop duplicate hours, keep the last one seen
    s.readings = s.readings.filter((r, i, arr) => i === arr.length - 1 || arr[i + 1].t !== r.t);
    s.latest = [...s.readings].reverse().find((r) => r.api !== null) || null;
  }
  return stations;
}

export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest station with a recent reading (within `maxAgeHours`) and within `maxKm`; null if none. */
export function nearestStation(stations, place, { maxAgeHours = 6, maxKm = 60, now = Date.now() / 1000 } = {}) {
  let best = null;
  for (const s of stations) {
    if (!s.latest || now - s.latest.t > maxAgeHours * 3600) continue;
    const d = distanceKm(place, s);
    if (d > maxKm) continue;
    if (!best || d < best.distanceKm) best = { station: s, distanceKm: d };
  }
  return best;
}

let pending = null;
let pendingAt = 0;
/** Fetch and parse all DOE stations. Cached in memory for 10 minutes. */
export function getDoeStations() {
  if (pending && Date.now() - pendingAt < 10 * 60 * 1000) return pending;
  pendingAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  pending = fetch(PROXY_URL, { signal: ctrl.signal })
    .then(async (r) => {
      if (!r.ok) throw new Error(`DOE feed HTTP ${r.status}`);
      const stations = parseDoe(await r.json());
      if (!stations.length) throw new Error('DOE feed returned no stations');
      return stations;
    })
    .finally(() => clearTimeout(timer));
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** Same as getDoeStations but never throws: resolves to null when the feed is unavailable. */
export const tryDoeStations = () => getDoeStations().catch((e) => {
  console.warn('Official DOE readings unavailable:', e);
  return null;
});
