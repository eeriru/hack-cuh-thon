// Where does the solar go? A step-by-step breakdown from the "ideal" output (a perfect,
// cool panel under a perfectly clear sky) down to the forecast output:
//
//   ideal ─ inverter & wiring ─ heat ─ clouds ─ haze ─ dust = what your panels make
//
// Every step is a difference between two full model runs, so the steps always add up
// exactly, and the haze step is the same number as the haze figure everywhere else.

import { pvEnergyKwh, DEFAULT_SYSTEM } from './solar.js';
import { addDays } from './api.js';
import { rainByDate } from './weather.js';

/**
 * Dust on the panels (soiling), as a share of output. Dust builds up on dry days and
 * rain washes it off; haze smoke settles on panels too. Rough rule of thumb for the
 * tropics: about 1% after a good rain, plus ~0.4% per dry day, plus 0.5% on smoky days,
 * capped at 6%. This is an estimate, not a measurement.
 */
export function soilingForDate(data, dateStr) {
  const rain = rainByDate(data.hours || [], data.offsetSec ?? 8 * 3600);
  let dry = 0;
  let known = false;
  for (let k = 1; k <= 14; k++) {
    const mm = rain.get(addDays(dateStr, -k));
    if (mm === undefined) break; // no data that far back
    known = true;
    if (mm >= 2) break;
    dry++;
  }
  if (!known) dry = 3; // assume a few dry days when we can't see back
  const dayPm = (data.hours || [])
    .filter((h) => new Date((h.t - 1 + (data.offsetSec ?? 0)) * 1000).toISOString().slice(0, 10) === dateStr && h.pm2_5 !== null && h.pm2_5 !== undefined)
    .map((h) => h.pm2_5);
  const meanPm = dayPm.length ? dayPm.reduce((a, b) => a + b, 0) / dayPm.length : 0;
  const smoky = meanPm > 50;
  const pct = Math.min(6, 1 + 0.4 * dry + (smoky ? 0.5 : 0));
  return { pct, dryDays: dry, smoky, assumed: !known };
}

/**
 * loss: result of computeHazeLoss() for one day (rows carry clearGhi, temp, kwhClean, kwhHaze).
 * Returns the steps (kWh) and the final output after dust.
 */
export function lossBreakdown(loss, { system = DEFAULT_SYSTEM, soilingPct = 0 } = {}) {
  let ideal = 0;
  let clearOut = 0;
  for (const r of loss.rows) {
    if (!r.clearGhi) continue;
    ideal += (system.kwp * r.clearGhi) / 1000;
    clearOut += pvEnergyKwh(r.clearGhi, r.temp, system);
  }
  const afterSystem = ideal * system.derate;
  const afterHeat = clearOut; // same sunshine, but panels at their real (hot) temperature
  const afterClouds = loss.kwhClean;
  const afterHaze = loss.kwhHaze;
  const dust = afterHaze * (soilingPct / 100);
  const final = afterHaze - dust;
  const steps = [
    { key: 'system', label: 'Inverter & wiring', kwh: ideal - afterSystem, short: 'Fixed equipment losses', note: 'Inverter, wiring and mismatch losses, about 14%.' },
    {
      key: 'heat',
      label: 'Heat',
      kwh: afterSystem - afterHeat,
      short: 'Hot panels: −0.4% per °C above 25 °C',
      note: 'Panels lose about 0.4% for every °C above 25 °C. Measured as if the day were sunny; the cooling effect of clouds is counted under clouds.',
    },
    { key: 'clouds', label: 'Clouds & rain', kwh: afterHeat - afterClouds, short: 'Forecast cloud cover', note: 'Forecast cloud cover blocking the sun (net of cooler panels).' },
    { key: 'haze', label: 'Haze', kwh: afterClouds - afterHaze, short: 'Smoke in the air vs a normal day', note: 'Smoke and dust in the air, compared with a normal day.' },
    { key: 'dust', label: 'Dust on panels', kwh: dust, short: 'Estimate; rain washes panels', note: `Estimated ${soilingPct.toFixed(1)}% soiling; rain washes panels clean.` },
  ];
  const biggest = steps.filter((s) => s.key !== 'system').sort((a, b) => b.kwh - a.kwh)[0];
  return { ideal, final, steps, biggest, performancePct: ideal > 0 ? (final / ideal) * 100 : 0 };
}
