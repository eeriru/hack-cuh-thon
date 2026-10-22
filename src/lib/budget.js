// Solar budget: how much solar is left over in the sunny hours after the home's normal use,
// when it is available, and which appliances it could run without buying power.
// Running an appliance in these hours instead of the evening always helps: the energy
// comes straight from the panels instead of the grid or the battery (which loses ~8%).
// Part of it would otherwise charge the battery, and part would go to the grid for little.

export const APPLIANCES = [
  { key: 'wash', icon: '🧺', label: 'Washing machine', kwh: 0.5 },
  { key: 'heater', icon: '🚿', label: 'Water heater', kwh: 1.5 },
  { key: 'iron', icon: '👔', label: 'Iron', kwh: 0.8 },
  { key: 'dish', icon: '🍽', label: 'Dishwasher', kwh: 1.2 },
  { key: 'dryer', icon: '🌀', label: 'Clothes dryer', kwh: 2.5 },
];
const AIRCON_KWH_PER_HOUR = 1; // a 1.5 hp inverter aircon
const MIN_SPARE_HOUR = 0.3; // kWh in an hour worth planning around

const sum = (a) => a.reduce((s, x) => s + x, 0);

/**
 * pv: solar kWh per local hour (after haze and dust). load: house demand per hour.
 * exported: solar per hour left after the house and battery (the planner's output).
 * evSolar: solar per hour the EV planner already uses (optional).
 */
export function solarBudget({ pv, load, exported, evSolar = null, splitLoad = load }) {
  const spare = exported.map((x, h) => Math.max(0, x - (evSolar?.[h] || 0)));
  // Solar beyond the home's own use, hour by hour (the EV's share taken out).
  const surplus = pv.map((p, h) => Math.max(0, p - load[h] - (evSolar?.[h] || 0)));
  const surplusKwh = sum(surplus);
  const madeKwh = sum(pv);
  // splitLoad: the planned day's load (with chores), for the home/battery/grid split.
  const homeKwh = sum(pv.map((p, h) => Math.min(p, splitLoad[h])));
  const evKwh = evSolar ? sum(evSolar) : 0;
  const spareKwh = sum(spare);
  const batteryKwh = Math.max(0, madeKwh - homeKwh - sum(exported));

  // Best window: the run of consecutive hours with useful spare solar that holds the most energy.
  let best = null;
  let run = null;
  for (let h = 0; h <= 24; h++) {
    if (h < 24 && surplus[h] >= MIN_SPARE_HOUR) {
      run = run ? { ...run, end: h, kwh: run.kwh + surplus[h] } : { start: h, end: h, kwh: surplus[h] };
    } else if (run) {
      if (!best || run.kwh > best.kwh) best = run;
      run = null;
    }
  }
  const peakHour = surplus.indexOf(Math.max(...surplus));

  // What fits: each appliance once (smallest first), then aircon hours with what is left.
  let left = surplusKwh;
  const picks = [];
  for (const a of [...APPLIANCES].sort((x, y) => x.kwh - y.kwh)) {
    if (a.kwh <= left) {
      picks.push({ ...a, count: 1 });
      left -= a.kwh;
    }
  }
  const airconHours = Math.min(6, Math.floor(left / AIRCON_KWH_PER_HOUR));
  if (airconHours > 0) {
    picks.push({ key: 'aircon', icon: '❄', label: 'Aircon', kwh: airconHours * AIRCON_KWH_PER_HOUR, hours: airconHours });
    left -= airconHours * AIRCON_KWH_PER_HOUR;
  }

  return {
    spare,
    surplus,
    surplusKwh,
    madeKwh,
    homeKwh,
    batteryKwh,
    evKwh,
    spareKwh,
    window: best ? { start: best.start, end: best.end + 1, kwh: best.kwh } : null,
    peakHour: surplusKwh > 0 ? peakHour : null,
    picks: surplusKwh >= 0.5 ? picks : [],
    leftKwh: Math.max(0, left),
  };
}
