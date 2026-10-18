// US AQI categories (the scale IQAir and Open-Meteo use). Malaysia's official
// Air Pollutant Index (API) from the Department of Environment uses its own scale,
// so readings here can differ from the DOE figures in the news.

export const AQI_LEVELS = [
  { max: 50, key: 'good', label: 'Good', color: '#8fd16a', ink: '#1f4d12', face: '🙂' },
  { max: 100, key: 'moderate', label: 'Moderate', color: '#f6d24c', ink: '#5c4600', face: '😐' },
  { max: 150, key: 'usg', label: 'Unhealthy for sensitive groups', short: 'Sensitive groups', color: '#fb9b55', ink: '#6b2f00', face: '😷' },
  { max: 200, key: 'unhealthy', label: 'Unhealthy', color: '#f2605f', ink: '#5e0a0a', face: '😷' },
  { max: 300, key: 'very', label: 'Very unhealthy', color: '#a87bc9', ink: '#33114d', face: '🤢' },
  { max: Infinity, key: 'hazardous', label: 'Hazardous', color: '#9b5f6f', ink: '#ffffff', face: '☠️' },
];

export function aqiLevel(aqi) {
  if (aqi === null || aqi === undefined || Number.isNaN(aqi)) {
    return { key: 'na', label: 'No data', color: '#d9d4ca', ink: '#3d3a33', face: '·' };
  }
  return AQI_LEVELS.find((l) => aqi <= l.max);
}

export const ADVICE = {
  good: [
    ['Outdoor exercise', 'Enjoy outdoor activities'],
    ['Windows', 'Open windows for fresh air'],
    ['Mask', 'Not needed'],
    ['Air purifier', 'Not needed'],
  ],
  moderate: [
    ['Outdoor exercise', 'Sensitive people should take it easier'],
    ['Windows', 'Fine to open; close if you smell smoke'],
    ['Mask', 'Optional for sensitive groups'],
    ['Air purifier', 'Optional'],
  ],
  usg: [
    ['Outdoor exercise', 'Children, elderly and asthma patients should limit it'],
    ['Windows', 'Close windows to keep haze out'],
    ['Mask', 'Sensitive groups should wear an N95'],
    ['Air purifier', 'Run it in bedrooms'],
  ],
  unhealthy: [
    ['Outdoor exercise', 'Avoid; move activities indoors'],
    ['Windows', 'Keep closed'],
    ['Mask', 'Wear an N95 outdoors'],
    ['Air purifier', 'Run it continuously'],
  ],
  very: [
    ['Outdoor exercise', 'Avoid all outdoor exertion'],
    ['Windows', 'Keep closed; seal gaps'],
    ['Mask', 'N95 essential outdoors'],
    ['Air purifier', 'Run on high'],
  ],
  hazardous: [
    ['Outdoor exercise', 'Stay indoors'],
    ['Windows', 'Keep sealed'],
    ['Mask', 'N95 essential; limit time outside'],
    ['Air purifier', 'Run on high; create a clean room'],
  ],
};

export const POLLUTANTS = [
  { key: 'pm2_5', label: 'PM2.5', unit: 'µg/m³', name: 'Fine particles — the main haze pollutant' },
  { key: 'pm10', label: 'PM10', unit: 'µg/m³', name: 'Coarse particles and dust' },
  { key: 'ozone', label: 'O₃', unit: 'µg/m³', name: 'Ozone' },
  { key: 'nitrogen_dioxide', label: 'NO₂', unit: 'µg/m³', name: 'Nitrogen dioxide (traffic)' },
  { key: 'sulphur_dioxide', label: 'SO₂', unit: 'µg/m³', name: 'Sulphur dioxide' },
  { key: 'carbon_monoxide', label: 'CO', unit: 'µg/m³', name: 'Carbon monoxide (burning)' },
];

const PM25_BREAKS = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

/** US AQI from a PM2.5 concentration (EPA 2024 breakpoints). Used for demo data. */
export function aqiFromPm25(pm) {
  const c = Math.max(0, Math.floor(pm * 10) / 10);
  for (const [cl, ch, il, ih] of PM25_BREAKS) {
    if (c <= ch) return Math.round(((ih - il) / (ch - cl)) * (Math.max(c, cl) - cl) + il);
  }
  return 500;
}

/** Map aerosol optical depth to a plain-language haze level. */
export function hazeLevel(aod) {
  if (aod === null || aod === undefined) return { label: 'Unknown', tone: 'muted' };
  if (aod < 0.4) return { label: 'Clear', tone: 'good' };
  if (aod < 0.8) return { label: 'Light haze', tone: 'moderate' };
  if (aod < 1.5) return { label: 'Thick haze', tone: 'bad' };
  return { label: 'Severe haze', tone: 'worse' };
}

export const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog / haze',
  48: 'Fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, hail',
};
