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

const cache = new Map();

/** Resolves to the IQAir reading for the nearest IQAir city, or { error } if unavailable. */
export function getIqair(place) {
  const k = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const p = fetch(`/api/iqair?lat=${place.lat.toFixed(2)}&lon=${place.lon.toFixed(2)}`, { signal: ctrl.signal })
    .then(async (r) => {
      const json = await r.json().catch(() => null);
      if (!r.ok || !json || json.aqius === null || json.aqius === undefined) {
        return { error: json?.error || `IQAir unavailable (HTTP ${r.status})`, notConfigured: r.status === 501 || r.status === 404 };
      }
      return json;
    })
    .catch((e) => ({ error: `IQAir unavailable: ${e.message || e}` }))
    .finally(() => clearTimeout(timer));
  cache.set(k, { at: Date.now(), p });
  p.then((v) => v.error && cache.delete(k));
  return p;
}
