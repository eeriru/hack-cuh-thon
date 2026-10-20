// Vercel serverless function: GET /api/iqair?lat=..&lon=..
// Returns IQAir's current US AQI for the nearest city they cover — the same number the
// IQAir website and app show for that city. Uses the free IQAir "Community" API plan.
//
// Setup: create a free key at https://dashboard.iqair.com (API keys), then in Vercel:
//   Project → Settings → Environment Variables → IQAIR_API_KEY = <your key>  → redeploy.
// The key never reaches the browser.
//
// The free plan allows 5 calls a minute and 500 a day. To stay inside it:
//  - coordinates are rounded to 0.05° (~5 km), so nearby townships share one cached answer
//    (IQAir returns the nearest city anyway);
//  - each answer is cached at Vercel's edge for 30 minutes (IQAir updates hourly);
//  - when IQAir says "too many requests", that answer is cached for 60 seconds so other
//    visitors wait instead of hitting IQAir again.

const BASE = 'https://api.airvisual.com/v2/nearest_city';

const MESSAGES = {
  call_limit_reached: 'IQAir daily/monthly call limit reached',
  too_many_requests: 'IQAir per-minute limit reached, try again shortly',
  api_key_expired: 'IQAir API key expired',
  incorrect_api_key: 'IQAir API key is not valid',
  permission_denied: 'IQAir API key not allowed for this request',
  no_nearest_station: 'No IQAir city near this location',
  city_not_found: 'No IQAir city near this location',
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const key = process.env.IQAIR_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(501).json({ error: 'IQAIR_API_KEY is not set on the server' });
  }
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const round = (x) => (Math.round(x * 20) / 20).toFixed(2);
  const url = `${BASE}?lat=${round(lat)}&lon=${round(lon)}&key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const json = await r.json().catch(() => null);
    if (!json || json.status !== 'success') {
      // IQAir sends codes like "call_limit_reached" but also plain text like "Too Many Requests"
      const raw = String(json?.data?.message || (r.status === 429 ? 'too_many_requests' : `HTTP ${r.status}`));
      const code = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const limited = code === 'too_many_requests' || code === 'call_limit_reached' || r.status === 429;
      if (limited) {
        res.setHeader('Retry-After', '60');
        res.setHeader('Cache-Control', 's-maxage=60');
      } else {
        res.setHeader('Cache-Control', 'no-store');
      }
      return res.status(limited ? 429 : 502).json({ error: MESSAGES[code] || `IQAir error: ${raw}`, code, limited });
    }
    const d = json.data;
    const p = d.current?.pollution || {};
    const w = d.current?.weather || {};
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      city: d.city,
      state: d.state,
      country: d.country,
      lat: d.location?.coordinates?.[1] ?? null,
      lon: d.location?.coordinates?.[0] ?? null,
      aqius: p.aqius ?? null,
      mainus: p.mainus ?? null,
      ts: p.ts ?? null,
      weather: { tempC: w.tp ?? null, humidity: w.hu ?? null, windMs: w.ws ?? null, windDir: w.wd ?? null, icon: w.ic ?? null, ts: w.ts ?? null },
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `Could not reach IQAir: ${err.message || err}` });
  }
}
