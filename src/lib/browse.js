// Country → region → city browsing for the location search.
// Typing a country name (e.g. "Indonesia") offers to browse it. Regions and cities come
// from IQAir's directory (via /api/places); if that is unavailable, a built-in list of
// major Southeast Asian cities is used instead.

import { CITIES } from './places.js';

// All ISO 3166 country codes; names come from the browser (Intl.DisplayNames).
const ISO =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MP MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS XK YE ZA ZM ZW'.split(
    ' '
  );

// Where IQAir's directory spells a country differently from the browser's English name.
const IQAIR_NAMES = {
  US: 'USA',
  GB: 'United Kingdom',
  KR: 'South Korea',
  CZ: 'Czech Republic',
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  MM: 'Myanmar',
  HK: 'Hong Kong',
  MO: 'Macao',
  TW: 'Taiwan',
  CI: 'Ivory Coast',
  TL: 'Timor-Leste',
  MK: 'North Macedonia',
  PS: 'Palestine',
};

// Extra words people type, mapped to ISO codes (Malay names, short forms)
const ALIASES = {
  usa: 'US', america: 'US', 'united states of america': 'US', uk: 'GB', britain: 'GB', england: 'GB',
  singapura: 'SG', 'filipina': 'PH', 'thailand': 'TH', 'siam': 'TH', 'korea': 'KR', burma: 'MM',
  'brunei darussalam': 'BN', 'east timor': 'TL', 'viet nam': 'VN', indon: 'ID',
};

let countryList = null;
export function countries() {
  if (countryList) return countryList;
  let dn = null;
  try {
    dn = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    /* very old browser: country browsing simply won't trigger */
  }
  countryList = ISO.map((code) => {
    const name = dn ? dn.of(code) : code;
    return { code, name: String(name).replace(/\s*\(.*\)$/, ''), iqairName: IQAIR_NAMES[code] || String(name).replace(/\s*\(.*\)$/, '') };
  });
  return countryList;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Countries matching what the user typed (by name prefix or alias), best first. */
export function matchCountries(q) {
  const n = norm(q);
  if (n.length < 2) return [];
  const list = countries();
  const out = [];
  const alias = ALIASES[n];
  if (alias) out.push(list.find((c) => c.code === alias));
  for (const c of list) {
    const name = norm(c.name);
    if (name === n || name.startsWith(n) || norm(c.iqairName).startsWith(n)) out.push(c);
  }
  return [...new Set(out.filter(Boolean))]
    .sort((a, b) => (norm(a.name) === n ? -1 : norm(b.name) === n ? 1 : a.name.localeCompare(b.name)))
    .slice(0, 3);
}

// ---------- IQAir directory (through our server function) ----------

const cache = new Map();
async function directory(params) {
  const qs = new URLSearchParams(params).toString();
  if (cache.has(qs)) return cache.get(qs);
  const p = fetch(`/api/places?${qs}`)
    .then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.items) throw new Error(j?.error || `HTTP ${r.status}`);
      return j.items.slice().sort((a, b) => a.localeCompare(b));
    });
  cache.set(qs, p);
  p.catch(() => cache.delete(qs));
  return p;
}

export const getRegions = (country) => directory({ type: 'states', country: country.iqairName });
export const getCities = (country, region) => directory({ type: 'cities', country: country.iqairName, state: region });

// ---------- fallback: major Southeast Asian cities (approximate centres) ----------

const c = (name, area, lat, lon) => ({ name, area, lat, lon });
export const FALLBACK_CITIES = {
  MY: CITIES.map((x) => ({ ...x, area: `${x.area}, Malaysia` })),
  ID: [
    c('Jakarta', 'DKI Jakarta', -6.2088, 106.8456), c('Surabaya', 'East Java', -7.2575, 112.7521),
    c('Bandung', 'West Java', -6.9175, 107.6191), c('Medan', 'North Sumatra', 3.5952, 98.6722),
    c('Semarang', 'Central Java', -6.9667, 110.4167), c('Yogyakarta', 'Yogyakarta', -7.7956, 110.3695),
    c('Palembang', 'South Sumatra', -2.9761, 104.7754), c('Pekanbaru', 'Riau', 0.5071, 101.4478),
    c('Jambi', 'Jambi', -1.6101, 103.6131), c('Batam', 'Riau Islands', 1.0456, 104.0305),
    c('Pontianak', 'West Kalimantan', -0.0263, 109.3425), c('Palangka Raya', 'Central Kalimantan', -2.2136, 113.9108),
    c('Banjarmasin', 'South Kalimantan', -3.3186, 114.5944), c('Balikpapan', 'East Kalimantan', -1.2379, 116.8529),
    c('Makassar', 'South Sulawesi', -5.1477, 119.4327), c('Denpasar', 'Bali', -8.65, 115.2167),
  ].map((x) => ({ ...x, area: `${x.area}, Indonesia` })),
  SG: [c('Singapore', 'Singapore', 1.3521, 103.8198)],
  TH: [
    c('Bangkok', 'Thailand', 13.7563, 100.5018), c('Chiang Mai', 'Thailand', 18.7883, 98.9853),
    c('Hat Yai', 'Thailand', 7.0086, 100.4747), c('Phuket', 'Thailand', 7.8804, 98.3923),
    c('Khon Kaen', 'Thailand', 16.4419, 102.835),
  ],
  PH: [
    c('Manila', 'Philippines', 14.5995, 120.9842), c('Quezon City', 'Philippines', 14.676, 121.0437),
    c('Cebu City', 'Philippines', 10.3157, 123.8854), c('Davao City', 'Philippines', 7.1907, 125.4553),
  ],
  VN: [
    c('Hanoi', 'Vietnam', 21.0278, 105.8342), c('Ho Chi Minh City', 'Vietnam', 10.8231, 106.6297),
    c('Da Nang', 'Vietnam', 16.0544, 108.2022),
  ],
  BN: [c('Bandar Seri Begawan', 'Brunei', 4.9031, 114.9398)],
  KH: [c('Phnom Penh', 'Cambodia', 11.5564, 104.9282)],
  LA: [c('Vientiane', 'Laos', 17.9757, 102.6331)],
  MM: [c('Yangon', 'Myanmar', 16.8409, 96.1735), c('Mandalay', 'Myanmar', 21.9588, 96.0891)],
};

// ---------- turning a city name into coordinates ----------

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Coordinates for a city picked from the IQAir directory (free Open-Meteo geocoder). */
export async function locateCity(country, region, city) {
  const r = await fetch(`${GEO_URL}?name=${encodeURIComponent(city)}&count=10&language=en&format=json&countryCode=${country.code}`);
  const j = await r.json().catch(() => null);
  const results = j?.results || [];
  if (!results.length) throw new Error(`Could not find ${city} on the map`);
  const nr = norm(region);
  const best =
    results.find((x) => x.admin1 && (norm(x.admin1).includes(nr) || nr.includes(norm(x.admin1)))) || results[0];
  return { name: city, area: `${region}, ${country.name}`, lat: best.latitude, lon: best.longitude };
}
