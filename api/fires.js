// Vercel serverless function: GET /api/fires
// Fire hotspots for the region around Malaysia from NASA FIRMS (VIIRS satellites, last
// 2 days). Needs a free FIRMS "MAP_KEY" in the FIRMS_MAP_KEY environment variable:
// https://firms.modaps.eosdis.nasa.gov/api/map_key/ . Cached for an hour.

import { parseFirmsCsv, REGION_BBOX } from '../src/lib/fires.js';

export default async function handler(req, res) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(501).json({ error: 'FIRMS_MAP_KEY is not set', notConfigured: true });
  }
  const { west, south, east, north } = REGION_BBOX;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${west},${south},${east},${north}/2`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (!r.ok || !text.startsWith('latitude')) throw new Error(text.slice(0, 120) || `FIRMS responded ${r.status}`);
    const fires = parseFirmsCsv(text).map((f) => ({ lat: +f.lat.toFixed(3), lon: +f.lon.toFixed(3), frp: Math.round(f.frp * 10) / 10, date: f.date }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({ fires, source: 'NASA FIRMS VIIRS S-NPP', days: 2 });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `Could not reach NASA FIRMS: ${err.message || err}` });
  }
}
