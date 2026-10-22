// Shared by the Weather & solar page and the Planner page: turns the raw forecast data
// into one entry per day (solar model run, dust, loss breakdown, weather), and builds the
// battery plan for a day.

import { availableDates, dayModelHours } from './api.js';
import { computeHazeLoss } from './model.js';
import { lossBreakdown, soilingForDate } from './losses.js';
import { rainByDate } from './weather.js';
import { planDay } from './battery.js';

/** The household used by the planners, from the saved settings. */
export function homeFromSettings(settings) {
  return {
    ...settings.home,
    battery: { ...settings.home.battery, capacityKwh: settings.batteryKwh, powerKw: Math.max(2.5, settings.batteryKwh / 2) },
    dailyKwh: settings.dailyKwh,
  };
}

/** One entry per day between startDate and endDate with enough daylight hours to model. */
export function buildDays(data, { engine, place, system, startDate, endDate }) {
  if (!data || !engine) return [];
  return availableDates(data)
    .filter((d) => d >= startDate && d <= endDate)
    .map((d) => {
      const loss = computeHazeLoss(dayModelHours(data, d), { ...place, engine, system });
      const soil = soilingForDate(data, d);
      const breakdown = lossBreakdown(loss, { system, soilingPct: soil.pct });
      const daily = (data.daily || []).find((x) => new Date((x.t + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
      const dayHours = data.hours.filter((h) => new Date((h.t - 1 + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
      const temps = dayHours.map((h) => h.temp).filter((x) => x !== null && x !== undefined);
      const hazeForecast = loss.rows.some((r) => r.clearGhi > 50 && r.aod !== null && r.aod !== undefined);
      return {
        d,
        loss,
        soil,
        breakdown,
        hazeForecast,
        daily,
        wx: {
          code: daily?.weather_code ?? null,
          rain: daily?.rain ?? rainByDate(dayHours, data.offsetSec).get(d) ?? null,
          rainChance: daily?.rainChance ?? null,
          tmax: daily?.tmax ?? (temps.length ? Math.max(...temps) : null),
        },
      };
    })
    .filter((x) => x.loss.rows.length >= 20);
}

export const isWeekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/** Time-of-use peak pricing applies on weekdays only; weekends are off-peak all day. */
export function dayHomeFor(home, d) {
  return isWeekend(d) && home.tariff.mode === 'tou' ? { ...home, tariff: { ...home.tariff, mode: 'flat', flatRate: home.tariff.offPeakRate } } : home;
}

export const avgRate = (t) => (t.mode === 'flat' ? t.flatRate : (t.peakRate + t.offPeakRate) / 2);

/** Battery and chores plan for one day, plus what the haze costs on the bill. */
export function planForDay(day, dayHome) {
  const pv = new Array(24).fill(0);
  const pvClean = new Array(24).fill(0);
  const pm = new Array(24).fill(0);
  const keep = 1 - day.soil.pct / 100; // dust on the panels
  day.loss.rows.forEach((r) => {
    pv[r.localHour] = r.kwhHaze * keep;
    pvClean[r.localHour] = r.kwhClean * keep;
    pm[r.localHour] = r.pm2_5 ?? 0;
  });
  const p = planDay(pv, pm, dayHome);
  // Same day, same household, but the sunlight the haze took away is given back.
  p.hazeCostRm = Math.max(0, p.hazeAware.costRm - planDay(pvClean, pm, dayHome).hazeAware.costRm);
  p.lossValueRm = day.loss.lossKwh * avgRate(dayHome.tariff);
  p.pv = pv;
  return p;
}
