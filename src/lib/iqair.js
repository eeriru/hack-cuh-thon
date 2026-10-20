// IQAir current air quality (US AQI), via our server function /api/iqair which keeps the
// API key secret. Matches the number on iqair.com for the same city.

export const IQAIR_URL = 'https://www.iqair.com/malaysia';

export const IQAIR_POLLUTANTS = {
  p2: 'PM2.5',
  p1: 'PM10',
  o3: 'Ozone',
  n2: 'Nitrogen dioxide',
  s2: 'Sulphur dioxide',
  co: 'Carbon monoxide',
};

// IQAir weather icon codes (first two characters) → plain words
export const IQAIR_CONDITIONS = {
  '01': 'Clear sky',
  '02': 'Few clouds',
  '03': 'Scattered clouds',
  '04': 'Cloudy',
  '09': 'Showers',
  '10': 'Rain',
  '11': 'Thunderstorm',
  '13': 'Snow',
  '50': 'Haze / mist',
};

// ---------- staying inside IQAir's free plan (5 lookups a minute) ----------
// All IQAir lookups from this browser go through here:
//  - readings are remembered for 30 minutes (memory + localStorage), and nearby places
//    share one reading (coordinates rounded to 0.05°, same as the server);
//  - "priority" lookups (the page you're looking at) go straight out; "background" ones
//    (the Rankings list) are spaced 15 s apart, leaving room for the priority ones;
//  - Vercel's cache answers don't count against IQAir's limit, so they skip the spacing;
//  - if IQAir says it's busy, everything pauses for a minute instead of retrying at once.

const TTL = 30 * 60 * 1000;
const GAP = 15000;
const PAUSE = 61000;
export const BUSY_MESSAGE = 'IQAir is busy (free plan: 5 lookups a minute)';

const round = (x) => (Math.round(x * 20) / 20).toFixed(2);
const mem = new Map();
const inflight = new Map();
let pausedUntil = 0;
let lastIqairCall = 0;
let lane = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** When background lookups will resume (ms timestamp), or 0 if not paused. */
export const iqairPausedUntil = () => (Date.now() < pausedUntil ? pausedUntil : 0);

function lsGet(k) {
  try {
    const v = JSON.parse(localStorage.getItem(`iq:${k}`));
    return v && Date.now() - v.at < TTL ? v.data : null;
  } catch {
    return null;
  }
}
function lsSet(k, data) {
  try {
    localStorage.setItem(`iq:${k}`, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage unavailable: memory cache still works */
  }
}

async function fetchOnce(lat, lon) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`/api/iqair?lat=${lat}&lon=${lon}`, { signal: ctrl.signal });
    const fromCache = /HIT|STALE/i.test(r.headers.get('x-vercel-cache') || '');
    if (!fromCache) lastIqairCall = Date.now();
    const json = await r.json().catch(() => null);
    if (r.status === 429 || json?.limited) {
      pausedUntil = Date.now() + PAUSE;
      return { error: BUSY_MESSAGE, limited: true };
    }
    if (!r.ok || !json || json.aqius === null || json.aqius === undefined) {
      return { error: json?.error || `IQAir unavailable (HTTP ${r.status})`, notConfigured: r.status === 501 || r.status === 404 };
    }
    return json;
  } catch (e) {
    return { error: `IQAir unavailable: ${e.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IQAir reading for the nearest IQAir city, or { error, limited? } if unavailable.
 * background: true → waits its turn and retries after a busy pause (used by Rankings).
 */
export function getIqair(place, { background = false } = {}) {
  const lat = round(place.lat);
  const lon = round(place.lon);
  const k = `${lat},${lon}`;
  const m = mem.get(k);
  if (m && Date.now() - m.at < TTL) return Promise.resolve(m.data);
  const saved = lsGet(k);
  if (saved) {
    mem.set(k, { at: Date.now(), data: saved });
    return Promise.resolve(saved);
  }
  if (inflight.has(k)) return inflight.get(k);
  if (!background && Date.now() < pausedUntil) return Promise.resolve({ error: BUSY_MESSAGE, limited: true });

  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (background) {
        const wait = Math.max(pausedUntil - Date.now(), lastIqairCall + GAP - Date.now(), 0);
        if (wait > 0) await sleep(wait);
        const again = mem.get(k);
        if (again) return again.data; // someone else fetched it meanwhile
      }
      const r = await fetchOnce(lat, lon);
      if (!r.error) {
        mem.set(k, { at: Date.now(), data: r });
        lsSet(k, r);
        return r;
      }
      if (!(r.limited && background)) return r;
    }
    return { error: BUSY_MESSAGE, limited: true };
  };
  const p = background ? (lane = lane.then(run, run)) : run();
  inflight.set(k, p);
  p.finally(() => inflight.delete(k));
  return p;
}
