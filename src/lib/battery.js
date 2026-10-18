// Battery planner: replays one day hour by hour for two strategies and compares them.
//   Standard  – the battery just soaks up spare solar and empties whenever needed;
//               flexible chores run in the evening as usual.
//   Haze-aware – uses tomorrow's predicted (hazy) solar to move chores into the
//               sunniest hours, saves the battery for the expensive peak window and,
//               if haze means the battery will not fill up, tops it up from the grid
//               overnight at the cheaper off-peak rate.
// Household demand is simulated (no public Malaysian smart-meter data exists).

// Share of daily household use in each hour (sums to 1). Malaysian terrace home:
// overnight aircon, morning routine, low midday, evening peak.
const LOAD_SHAPE = [
  0.048, 0.047, 0.045, 0.044, 0.043, 0.042, 0.038, 0.036, 0.03, 0.028, 0.028, 0.03,
  0.032, 0.032, 0.031, 0.031, 0.034, 0.04, 0.05, 0.056, 0.058, 0.058, 0.055, 0.052,
];
const SHAPE_SUM = LOAD_SHAPE.reduce((a, b) => a + b, 0);

export const DEFAULT_HOME = {
  dailyKwh: 22, // everyday use, excluding flexible chores
  flexKwh: 3, // washing machine, dryer, water heater…
  flexHours: 2,
  flexUsualStart: 20, // when people normally run them
  battery: { capacityKwh: 7.5, powerKw: 3.5, efficiency: 0.92, startSocPct: 20 },
  tariff: {
    mode: 'tou', // 'tou' or 'flat'
    peakStart: 14, // 2pm
    peakEnd: 22, // 10pm
    peakRate: 0.45, // RM per kWh — example values, edit to match your bill
    offPeakRate: 0.3,
    flatRate: 0.4,
  },
  gridKgCo2PerKwh: 0.7, // approximate Peninsular Malaysia grid factor; edit if you have a newer figure
};

/** Hourly household demand (kWh) for local hours 0–23, without flexible chores. */
export function baseLoadProfile(home, pm25ByHour = []) {
  return LOAD_SHAPE.map((s, h) => {
    let kwh = (home.dailyKwh * s) / SHAPE_SUM;
    const pm = pm25ByHour[h];
    // On haze days people close windows, run aircon and purifiers, and kids stay home.
    if (pm > 35 && h >= 8 && h <= 18) kwh *= 1 + Math.min(0.3, (pm - 35) / 300);
    return kwh;
  });
}

const rateAt = (tariff, h) =>
  tariff.mode === 'flat'
    ? tariff.flatRate
    : h >= tariff.peakStart && h < tariff.peakEnd
      ? tariff.peakRate
      : tariff.offPeakRate;

function simulate({ pv, load, home, allowDischarge, gridChargeKwh }) {
  const { capacityKwh, powerKw, efficiency, startSocPct } = home.battery;
  let soc = (capacityKwh * startSocPct) / 100;
  const out = { gridKwh: 0, exportKwh: 0, costRm: 0, soc: [], grid: [], fromBattery: [] };
  for (let h = 0; h < 24; h++) {
    let grid = 0;
    let fromBattery = 0;
    // Planned overnight top-up from the grid
    const topUp = Math.min(gridChargeKwh[h] || 0, powerKw, (capacityKwh - soc) / efficiency);
    if (topUp > 0) {
      soc += topUp * efficiency;
      grid += topUp;
    }
    const net = load[h] - pv[h];
    if (net < 0) {
      const room = Math.max(0, powerKw - topUp);
      const charge = Math.min(-net, room, (capacityKwh - soc) / efficiency);
      soc += charge * efficiency;
      out.exportKwh += -net - charge;
    } else if (net > 0) {
      if (allowDischarge(h)) fromBattery = Math.min(net, powerKw, soc);
      soc -= fromBattery;
      grid += net - fromBattery;
    }
    out.gridKwh += grid;
    out.costRm += grid * rateAt(home.tariff, h);
    out.soc.push((soc / capacityKwh) * 100);
    out.grid.push(grid);
    out.fromBattery.push(fromBattery);
  }
  out.co2Kg = out.gridKwh * home.gridKgCo2PerKwh;
  return out;
}

function spreadFlex(home, hours) {
  const flex = new Array(24).fill(0);
  hours.forEach((h) => (flex[h] += home.flexKwh / hours.length));
  return flex;
}

/** Grid top-up (kWh per hour, 2am–6am) so the battery is full enough for the peak window. */
function topUpSchedule(pv, load, home) {
  const out = new Array(24).fill(0);
  const { capacityKwh, efficiency, startSocPct, powerKw } = home.battery;
  const { peakStart, peakEnd } = home.tariff;
  const peakNeed = load.reduce((s, l, h) => s + (h >= peakStart && h < peakEnd ? Math.max(0, l - pv[h]) : 0), 0);
  const solarFill = load.reduce((s, l, h) => s + (h < peakStart ? Math.max(0, pv[h] - l) * efficiency : 0), 0);
  const socAtPeak = Math.min(capacityKwh, (capacityKwh * startSocPct) / 100 + solarFill);
  const shortfall = Math.max(0, Math.min(capacityKwh, peakNeed) - socAtPeak);
  let remaining = shortfall / efficiency;
  for (const h of [2, 3, 4, 5]) {
    if (remaining <= 0.01) break;
    out[h] = Math.min(remaining, powerKw);
    remaining -= out[h];
  }
  return out;
}

/**
 * pv: predicted solar kWh for local hours 0–23 (with haze).
 * pm25: PM2.5 by local hour, used to simulate extra aircon on haze days.
 * The haze-aware planner tries every combination of three levers against the
 * forecast and keeps the cheapest, so it can never do worse than the standard day.
 */
export function planDay(pv, pm25, home = DEFAULT_HOME) {
  const base = baseLoadProfile(home, pm25);
  const tou = home.tariff.mode === 'tou';
  const zero = new Array(24).fill(0);
  const withFlex = (hours) => {
    const flex = spreadFlex(home, hours);
    return base.map((b, h) => b + flex[h]);
  };

  // ---- Standard day ----
  const usualHours = Array.from({ length: home.flexHours }, (_, i) => (home.flexUsualStart + i) % 24);
  const stdLoad = withFlex(usualHours);
  const standard = simulate({ pv, load: stdLoad, home, allowDischarge: () => true, gridChargeKwh: zero });

  // ---- Lever 1: when to run chores ----
  const surplus = pv.map((p, h) => ({ h, s: p - base[h] })).filter((x) => x.h >= 8 && x.h <= 17);
  surplus.sort((a, b) => b.s - a.s);
  const sunniest = surplus.slice(0, home.flexHours).map((x) => x.h).sort((a, b) => a - b);
  const timings = [
    { hours: sunniest, why: 'sunniest' },
    { hours: usualHours, why: 'usual' },
  ];
  if (tou) {
    const after = Array.from({ length: home.flexHours }, (_, i) => (home.tariff.peakEnd + i) % 24);
    timings.push({ hours: after, why: 'offpeak' });
  }

  const candidates = [];
  for (const timing of timings) {
    const load = withFlex(timing.hours);
    // Lever 2: keep the battery for the peak window (time-of-use only)
    for (const reserve of tou ? [false, true] : [false]) {
      const allowDischarge = reserve ? (h) => h >= home.tariff.peakStart : () => true;
      // Lever 3: overnight off-peak top-up when haze means the battery will not fill
      const tops = [zero];
      if (tou && home.tariff.offPeakRate / home.battery.efficiency < home.tariff.peakRate) {
        const sched = topUpSchedule(pv, load, home);
        if (sched.some((k) => k > 0)) tops.push(sched);
      }
      for (const gridChargeKwh of tops) {
        const sim = simulate({ pv, load, home, allowDischarge, gridChargeKwh });
        candidates.push({
          sim,
          load,
          flexHours: timing.hours,
          flexWhy: timing.why,
          reserve,
          topUpKwh: gridChargeKwh.reduce((a, b) => a + b, 0),
          gridChargeKwh,
        });
      }
    }
  }
  candidates.sort((a, b) => a.sim.costRm - b.sim.costRm || a.sim.gridKwh - b.sim.gridKwh);
  const best = candidates[0];

  return {
    standard,
    hazeAware: best.sim,
    flexHours: best.flexHours,
    flexWhy: best.flexWhy,
    reserve: best.reserve,
    topUpKwh: best.topUpKwh,
    gridChargeKwh: best.gridChargeKwh,
    usualHours,
    load: { standard: stdLoad, hazeAware: best.load, base },
    savingRm: standard.costRm - best.sim.costRm,
    gridSavedKwh: standard.gridKwh - best.sim.gridKwh,
    co2SavedKg: standard.co2Kg - best.sim.co2Kg,
  };
}

export const fmtHour = (h) => {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? 'am' : 'pm';
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve}${suffix}`;
};

/** Contiguous runs of hours, e.g. [11,12,15] -> "11am–1pm, 3pm–4pm". */
export function hourRanges(hours) {
  if (!hours.length) return '';
  const sorted = [...hours].sort((a, b) => a - b);
  const runs = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const h of sorted.slice(1)) {
    if (h !== prev + 1) {
      runs.push([start, prev]);
      start = h;
    }
    prev = h;
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => `${fmtHour(a)}–${fmtHour(b + 1)}`).join(', ');
}
