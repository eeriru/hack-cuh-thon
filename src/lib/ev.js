// EV charging planner. Adds an electric car to the day's plan: how much charge it needs,
// and the cheapest hours to put it in. Solar the house and battery can't use goes to the
// car first (it would otherwise be exported); the rest comes from the grid at the
// cheapest hours the car is plugged in.

import { rateAt } from './battery.js';

export const DEFAULT_EV = {
  enabled: false,
  kmPerDay: 40,
  kwhPer100km: 15, // a typical small EV (e.g. BYD Dolphin, Proton e.MAS 7 use ~13–17)
  chargerKw: 7, // a home wall charger; a 3-pin plug is about 2.3 kW
  homeDaytime: false, // car parked at home during the day (work from home, weekend)
  leaveHour: 8,
  arriveHour: 18,
};

const CHARGE_EFFICIENCY = 0.9;

/** Hours (0–23) the car is plugged in at home. */
export function pluggedHours(ev) {
  if (ev.homeDaytime) return Array.from({ length: 24 }, (_, h) => h);
  const out = [];
  for (let h = 0; h < 24; h++) {
    const away = ev.leaveHour <= ev.arriveHour ? h >= ev.leaveHour && h < ev.arriveHour : h >= ev.leaveHour || h < ev.arriveHour;
    if (!away) out.push(h);
  }
  return out;
}

function fill(order, needKwh, spareSolar, ev, tariff) {
  const solar = new Array(24).fill(0);
  const grid = new Array(24).fill(0);
  let left = needKwh;
  for (const { h, kind } of order) {
    if (left <= 1e-6) break;
    const room = ev.chargerKw - solar[h] - grid[h];
    if (room <= 0) continue;
    const take = Math.min(left, room, kind === 'solar' ? spareSolar[h] : Infinity);
    if (take <= 0) continue;
    if (kind === 'solar') solar[h] += take;
    else grid[h] += take;
    left -= take;
  }
  const gridKwh = grid.reduce((a, b) => a + b, 0);
  const costRm = grid.reduce((s, g, h) => s + g * rateAt(tariff, h), 0);
  return { solar, grid, solarKwh: solar.reduce((a, b) => a + b, 0), gridKwh, costRm, shortKwh: Math.max(0, left) };
}

/**
 * spareSolar: solar kWh per hour left after the house and battery (what would be exported).
 * ev: settings (see DEFAULT_EV). home: tariff and grid CO₂ factor.
 * Standard = plug in when you get home and charge straight away.
 * Smart = spare solar first, then the cheapest plugged-in hours.
 */
export function planEv(spareSolar, ev, home) {
  const needKwh = (ev.kmPerDay * ev.kwhPer100km) / 100 / CHARGE_EFFICIENCY;
  const hours = pluggedHours(ev);
  const start = ev.arriveHour; // the usual habit: plug in on getting home
  // Standard: from arrival, hour by hour around the clock, whatever is available.
  const fromArrival = Array.from({ length: 24 }, (_, i) => (start + i) % 24).filter((h) => hours.includes(h));
  const standard = fill(
    fromArrival.flatMap((h) => [{ h, kind: 'solar' }, { h, kind: 'grid' }]),
    needKwh,
    spareSolar,
    ev,
    home.tariff
  );
  // Smart: all spare solar first (sunniest hours first), then grid by price, later night hours first.
  const solarOrder = hours.filter((h) => spareSolar[h] > 0).sort((a, b) => spareSolar[b] - spareSolar[a]).map((h) => ({ h, kind: 'solar' }));
  const gridOrder = [...hours]
    .sort((a, b) => rateAt(home.tariff, a) - rateAt(home.tariff, b) || nightRank(a) - nightRank(b))
    .map((h) => ({ h, kind: 'grid' }));
  const smart = fill([...solarOrder, ...gridOrder], needKwh, spareSolar, ev, home.tariff);
  const co2 = home.gridKgCo2PerKwh ?? 0.7;
  return {
    needKwh,
    hours,
    standard: { ...standard, co2Kg: standard.gridKwh * co2 },
    smart: { ...smart, co2Kg: smart.gridKwh * co2 },
    savingRm: standard.costRm - smart.costRm,
    co2SavedKg: (standard.gridKwh - smart.gridKwh) * co2,
  };
}

// Prefer the small hours (midnight–6am) for grid charging: lowest demand on the grid.
const nightRank = (h) => (h < 7 ? h : h + 24);
