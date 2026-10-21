// Haze source map: fire hotspots from NASA FIRMS (satellite-detected fires), and which of
// them sit upwind of you. Haze in Malaysia mostly comes from peat and forest fires in
// Sumatra and Kalimantan, carried by the south-west monsoon (June–September).

// The area the map covers: Peninsular Malaysia, Sumatra, Borneo and southern Thailand.
export const REGION_BBOX = { west: 94, south: -6, east: 120, north: 9 };

// Rough centres for naming where a group of fires is.
export const FIRE_REGIONS = [
  { name: 'Riau (Sumatra)', lat: 0.5, lon: 101.5 },
  { name: 'Jambi (Sumatra)', lat: -1.6, lon: 103.3 },
  { name: 'South Sumatra', lat: -3.2, lon: 104.5 },
  { name: 'North Sumatra', lat: 2.5, lon: 99.0 },
  { name: 'Aceh (Sumatra)', lat: 4.5, lon: 96.8 },
  { name: 'West Kalimantan', lat: -0.1, lon: 110.5 },
  { name: 'Central Kalimantan', lat: -1.8, lon: 113.5 },
  { name: 'South Kalimantan', lat: -3.0, lon: 115.3 },
  { name: 'East Kalimantan', lat: 0.5, lon: 116.5 },
  { name: 'Sarawak', lat: 2.5, lon: 112.5 },
  { name: 'Sabah', lat: 5.3, lon: 117.0 },
  { name: 'Peninsular Malaysia', lat: 4.0, lon: 102.0 },
  { name: 'Southern Thailand', lat: 7.5, lon: 100.0 },
  { name: 'Bangka-Belitung', lat: -2.5, lon: 106.5 },
];

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing (0 = north, 90 = east) from a to b. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function nearestRegion(p) {
  return FIRE_REGIONS.reduce((best, r) => (distanceKm(p, r) < distanceKm(p, best) ? r : best)).name;
}

/**
 * place: { lat, lon }. fires: [{ lat, lon, frp }] (frp = fire power, MW).
 * windFromDeg: where the wind is blowing FROM (weather convention). windKmh: speed.
 * Fires within ±sectorDeg of the upwind direction and maxKm are counted as likely sources.
 */
export function hazeSources(place, fires, { windFromDeg, windKmh = 10, sectorDeg = 35, maxKm = 1500 } = {}) {
  const withGeo = fires.map((f) => ({ ...f, km: distanceKm(place, f), bearing: bearing(place, f) }));
  const hasWind = windFromDeg !== null && windFromDeg !== undefined;
  const upwind = hasWind ? withGeo.filter((f) => f.km <= maxKm && angleDiff(f.bearing, windFromDeg) <= sectorDeg) : [];
  // Group the upwind fires by region and rank by total fire power (or count).
  const groups = {};
  for (const f of upwind) {
    const name = nearestRegion(f);
    const g = (groups[name] ||= { name, count: 0, frp: 0, km: 0 });
    g.count++;
    g.frp += f.frp || 1;
    g.km += f.km;
  }
  const regions = Object.values(groups)
    .map((g) => ({ ...g, km: g.km / g.count, hours: windKmh > 0 ? g.km / g.count / windKmh : null }))
    .sort((a, b) => b.frp - a.frp);
  const nearby = withGeo.filter((f) => f.km <= 100).length;
  return { total: fires.length, upwindCount: upwind.length, upwind, regions, nearby, hasWind };
}

/** Parse NASA FIRMS CSV (latitude, longitude, ..., frp, ...) into [{ lat, lon, frp, conf, date }]. */
export function parseFirmsCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  const col = (n) => head.indexOf(n);
  const [iLat, iLon, iFrp, iConf, iDate] = [col('latitude'), col('longitude'), col('frp'), col('confidence'), col('acq_date')];
  if (iLat < 0 || iLon < 0) return [];
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return { lat: +c[iLat], lon: +c[iLon], frp: iFrp >= 0 ? +c[iFrp] || 0 : 0, conf: iConf >= 0 ? c[iConf] : null, date: iDate >= 0 ? c[iDate] : null };
  }).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && f.conf !== 'l'); // drop low-confidence detections
}

/** The point `km` away from p along a compass bearing (for drawing the upwind wedge). */
export function destination(p, bearingDeg, km) {
  const d = km / R;
  const b = rad(bearingDeg);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

/** Load hotspots from /api/fires. Returns { fires } or { error, notConfigured }. */
export async function getFires() {
  try {
    const r = await fetch('/api/fires');
    if (!(r.headers.get('content-type') || '').includes('json')) {
      return { error: 'the fire service is not running here (it works on Vercel and with npm run dev)', fires: [] };
    }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) return { error: j?.error || `HTTP ${r.status}`, notConfigured: !!j?.notConfigured || r.status === 501, fires: [] };
    return j;
  } catch (e) {
    return { error: String(e.message || e), fires: [] };
  }
}
