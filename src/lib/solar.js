// Physics layer: sun position, clear-sky sunlight and panel output.
// The training script (training/train_solar_haze_model.py) uses an exact Python
// copy of these formulas, so the model's target (clear-sky index) means the same
// thing in training and in the app. Keep the two files in sync.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Sun position for a UTC unix timestamp (seconds). NOAA solar calculator equations. */
export function solarPosition(unixSeconds, lat, lon) {
  const jd = unixSeconds / 86400 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  const minutesUtc = (((unixSeconds / 60) % 1440) + 1440) % 1440;
  const trueSolarTime = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 - 180;
  const latR = lat * RAD;
  let cosZ =
    Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  cosZ = Math.max(-1, Math.min(1, cosZ));
  return { cosZenith: cosZ, zenithDeg: Math.acos(cosZ) * DEG, declinationDeg: decl * DEG };
}

/** Clear-sky horizontal sunlight (W/m²) from the Haurwitz model. */
export function clearSkyGhi(cosZenith) {
  if (cosZenith <= 0) return 0;
  return 1098 * cosZenith * Math.exp(-0.057 / cosZenith);
}

/**
 * Hour-averaged sun geometry and clear-sky sunlight for the hour ENDING at
 * `hourEndUnix` (Open-Meteo radiation is an average over the preceding hour).
 * Six samples at 5, 15, ... 55 minutes before the hour end.
 */
export function hourGeometry(hourEndUnix, lat, lon) {
  let cosSum = 0;
  let ghiSum = 0;
  for (let k = 0; k < 6; k++) {
    const t = hourEndUnix - (55 - 10 * k) * 60;
    const { cosZenith } = solarPosition(t, lat, lon);
    cosSum += Math.max(0, cosZenith);
    ghiSum += clearSkyGhi(cosZenith);
  }
  return { cosZenith: cosSum / 6, clearGhi: ghiSum / 6 };
}

export const DEFAULT_SYSTEM = {
  kwp: 5, // rooftop size in kW-peak
  tempCoeff: -0.004, // power change per °C above 25 °C
  noct: 45, // nominal operating cell temperature
  derate: 0.86, // inverter, wiring and dirt losses
};

/** Panel cell temperature (°C) from air temperature and sunlight. */
export function cellTemperature(airTempC, ghi, noct = DEFAULT_SYSTEM.noct) {
  return airTempC + ((noct - 20) / 800) * ghi;
}

/**
 * Energy (kWh) a rooftop system produces in one hour with average sunlight `ghi` W/m².
 * Near the equator, rooftop panels sit almost flat, so horizontal sunlight is a fair
 * stand-in for sunlight on the panel.
 */
export function pvEnergyKwh(ghi, airTempC, system = DEFAULT_SYSTEM) {
  if (ghi <= 0) return 0;
  const tc = cellTemperature(airTempC ?? 28, ghi, system.noct);
  const tempFactor = 1 + system.tempCoeff * (tc - 25);
  return Math.max(0, system.kwp * (ghi / 1000) * tempFactor * system.derate);
}
