// Vercel serverless function: GET /api/doe
// Fetches the Department of Environment's public hourly Air Pollutant Index table
// (all stations, last 24 hours) and passes it through unchanged. Needed because the
// DOE server does not allow browsers on other websites to call it directly.
// Vercel's edge cache keeps one copy for 10 minutes, so the DOE is called at most
// a few times an hour no matter how many people use the app.

const DOE_URL = 'https://eqms.doe.gov.my/api3/publicportalapims/apitablehourly';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const r = await fetch(DOE_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'SuriaHaze/1.0 (student hackathon prototype)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`DOE responded ${r.status}`);
    const body = await r.text();
    const json = JSON.parse(body);
    if (!Array.isArray(json?.api_table_hourly)) throw new Error('Unexpected DOE response shape');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).send(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `Could not reach the DOE feed: ${err.message || err}` });
  }
}
