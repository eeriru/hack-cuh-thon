// Per-day solar results shared by the Weather & solar page and the Personal planner.
import { availableDates, dayModelHours } from './api.js';
import { computeHazeLoss } from './model.js';
import { DEFAULT_SYSTEM } from './solar.js';
import { planDay } from './battery.js';
import { lossBreakdown, soilingForDate } from './losses.js';
import { rainByDate } from './weather.js';

export const systemFor = (settings) => ({ ...DEFAULT_SYSTEM, kwp: settings.kwp });

export const homeFor = (settings) => ({
  ...settings.home,
  battery: { ...settings.home.battery, capacityKwh: settings.batteryKwh, powerKw: Math.max(2.5, settings.batteryKwh / 2) },
  dailyKwh: settings.dailyKwh,
});

export const isWeekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

// Time-of-use peak pricing applies on weekdays only; weekends are off-peak all day.
export const homeForDay = (home, d) =>
  isWeekend(d) && home.tariff.mode === 'tou' ? { ...home, tariff: { ...home.tariff, mode: 'flat', flatRate: home.tariff.offPeakRate } } : home;

export const avgRateOf = (tariff) => (tariff.mode === 'flat' ? tariff.flatRate : (tariff.peakRate + tariff.offPeakRate) / 2);

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

// Battery & chores plan for one day, plus what the haze cost on the bill.
export function planFor(day, dayHome) {
  if (!day) return null;
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
  p.lossValueRm = day.loss.lossKwh * avgRateOf(dayHome.tariff);
  return p;
}

// Coming days for the panel cleaning reminder (today first).
export const cleaningDays = (days, today, labelFor) =>
  days
    .filter((x) => x.d >= today)
    .map((x) => ({
      d: x.d,
      label: labelFor(x.d),
      soilPct: x.soil.pct,
      dryDays: x.soil.dryDays,
      smoky: x.soil.smoky,
      rainMm: x.wx.rain,
      kwhBeforeDust: x.loss.kwhHaze,
    }));
