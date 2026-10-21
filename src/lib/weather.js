// Weather calculations used by the Weather & solar page and the solar model.

/** Heat index (°C): how hot it feels once humidity is taken into account (NOAA / Rothfusz). */
export function heatIndex(tempC, rh) {
  if (tempC === null || tempC === undefined || rh === null || rh === undefined) return null;
  const T = (tempC * 9) / 5 + 32;
  const R = rh;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi =
      -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T -
      0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** Dew point (°C), Magnus formula. Above ~24 °C the air feels oppressive. */
export function dewPoint(tempC, rh) {
  if (tempC === null || tempC === undefined || !rh) return null;
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(rh / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/** Heat-stress level from the heat index (NOAA bands). */
export function heatRisk(hiC) {
  if (hiC === null || hiC === undefined) return { key: 'na', label: '—', tone: 'muted', advice: '' };
  if (hiC < 27) return { key: 'ok', label: 'Comfortable', tone: 'good', advice: 'No heat precautions needed.' };
  if (hiC < 32) return { key: 'caution', label: 'Caution', tone: 'moderate', advice: 'Fatigue possible with long activity outdoors. Drink water.' };
  if (hiC < 41) return { key: 'extreme', label: 'Extreme caution', tone: 'bad', advice: 'Heat cramps and exhaustion possible. Take breaks in shade, drink often.' };
  if (hiC < 54) return { key: 'danger', label: 'Danger', tone: 'worse', advice: 'Heat exhaustion likely, heatstroke possible. Avoid strenuous outdoor work at midday.' };
  return { key: 'extreme-danger', label: 'Extreme danger', tone: 'worse', advice: 'Heatstroke highly likely. Stay indoors and cool.' };
}

/** UV index categories (WHO). */
export function uvLevel(uv) {
  if (uv === null || uv === undefined) return { label: '—', tone: 'muted' };
  if (uv < 3) return { label: 'Low', tone: 'good' };
  if (uv < 6) return { label: 'Moderate', tone: 'moderate' };
  if (uv < 8) return { label: 'High', tone: 'bad' };
  if (uv < 11) return { label: 'Very high', tone: 'worse' };
  return { label: 'Extreme', tone: 'worse' };
}

/** Daily rain amount in plain words (MetMalaysia-style thresholds). */
export function rainLevel(mm) {
  if (mm === null || mm === undefined) return { label: '—', tone: 'muted' };
  if (mm < 0.5) return { label: 'Dry', tone: 'good' };
  if (mm < 10) return { label: 'Light rain', tone: 'moderate' };
  if (mm < 30) return { label: 'Moderate rain', tone: 'bad' };
  if (mm < 60) return { label: 'Heavy rain', tone: 'worse' };
  return { label: 'Very heavy rain', tone: 'worse' };
}

export function compass(deg) {
  if (deg === null || deg === undefined) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export const WEATHER_TEXT = {
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

/** Small text icon for a weather code (emoji keeps it dependency-free). */
export function weatherIcon(code, isDay = true) {
  if (code === null || code === undefined) return '·';
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 95) return '⛈️';
  if (code >= 80) return '🌦️';
  if (code >= 51) return '🌧️';
  return '☁️';
}

/** Rain total (mm) for each local date, from hourly data. */
export function rainByDate(hours, offsetSec) {
  const out = new Map();
  for (const h of hours) {
    if (h.rain === null || h.rain === undefined) continue;
    const d = new Date((h.t - 1 + offsetSec) * 1000).toISOString().slice(0, 10);
    out.set(d, (out.get(d) || 0) + h.rain);
  }
  return out;
}
