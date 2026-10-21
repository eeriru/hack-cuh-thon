// Township impact board: what rooftop solar does for each township in a day, and what
// the haze takes away. Pure function so it can be tested.

// Rough equivalents for plain-language comparisons.
export const KG_CO2_PER_CAR_KM = 0.17; // average petrol car
export const KG_CO2_PER_TREE_YEAR = 22; // a mature tree absorbs about 22 kg CO₂ a year

/**
 * rows: [{ place, output (kWh per home), lossKwh (kWh per home lost to haze) }]
 * Returns per-township totals (sorted by energy made) and grand totals.
 */
export function townshipImpact(rows, { homes = 500, rate = 0.4, co2PerKwh = 0.7 } = {}) {
  const list = rows
    .map((r) => {
      const kwh = r.output * homes;
      const lost = r.lossKwh * homes;
      return {
        place: r.place,
        kwhPerHome: r.output,
        mwh: kwh / 1000,
        rm: kwh * rate,
        co2Kg: kwh * co2PerKwh,
        lostMwh: lost / 1000,
        lostRm: lost * rate,
      };
    })
    .sort((a, b) => b.mwh - a.mwh);
  const sum = (k) => list.reduce((s, x) => s + x[k], 0);
  const co2Kg = sum('co2Kg');
  return {
    list,
    total: {
      homes: homes * list.length,
      mwh: sum('mwh'),
      rm: sum('rm'),
      co2Kg,
      lostMwh: sum('lostMwh'),
      lostRm: sum('lostRm'),
      carKm: co2Kg / KG_CO2_PER_CAR_KM,
      treeYears: co2Kg / KG_CO2_PER_TREE_YEAR, // trees needed for a whole year to absorb the same
    },
  };
}
