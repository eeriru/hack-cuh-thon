// Vercel serverless function: GET /api/places
//   ?type=states&country=Indonesia            → regions IQAir covers in a country
//   ?type=cities&country=Indonesia&state=Riau → cities IQAir covers in a region
// Uses IQAir's free directory endpoints with the same IQAIR_API_KEY as api/iqair.js.
// These lists hardly ever change, so each answer is cached for a day at Vercel's edge,
// which keeps browsing well inside the free plan's 5-calls-a-minute limit.

const BASE = 'https://api.airvisual.com/v2';

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
  const { type, country, state } = req.query || {};
  const clean = (s) => String(s || '').trim().slice(0, 80);
  let url;
  if (type === 'states' && clean(country)) {
    url = `${BASE}/states?country=${encodeURIComponent(clean(country))}&key=${encodeURIComponent(key)}`;
  } else if (type === 'cities' && clean(country) && clean(state)) {
    url = `${BASE}/cities?state=${encodeURIComponent(clean(state))}&country=${encodeURIComponent(clean(country))}&key=${encodeURIComponent(key)}`;
  } else {
    return res.status(400).json({ error: 'Use type=states&country=… or type=cities&country=…&state=…' });
  }
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const json = await r.json().catch(() => null);
    if (!json || json.status !== 'success' || !Array.isArray(json.data)) {
      const code = json?.data?.message || `HTTP ${r.status}`;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(code === 'too_many_requests' || code === 'call_limit_reached' ? 429 : 502).json({ error: `IQAir: ${code}`, code });
    }
    const names = json.data.map((d) => d.state || d.city).filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ items: names });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `Could not reach IQAir: ${err.message || err}` });
  }
}
