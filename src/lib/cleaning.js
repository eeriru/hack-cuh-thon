// Panel cleaning reminder. Uses the same dust (soiling) estimate as the solar model:
// about 1% after a good rain, plus ~0.4% per dry day, plus 0.5% on smoky days, capped
// at 6%. Washing the panels resets it to the clean level (taken as 1%, like after rain).

const CLEAN_PCT = 1;
const PER_DRY_DAY = 0.4;
const CAP = 6;
const WASHING_RAIN_MM = 2; // the same threshold the soiling model uses

/**
 * days: the coming days, today first:
 *   [{ d, label, soilPct, smoky, rainMm, kwhBeforeDust }]
 *   kwhBeforeDust = forecast output after clouds, heat and haze, before dust.
 * rate: RM per kWh.
 * Returns what dust costs this week, what washing today would save, and when to wash.
 */
export function cleaningAdvice(days, { rate = 0.4 } = {}) {
  if (!days.length) return null;
  const today = days[0];
  // Dust if the panels are washed today: clean, then building up again until rain.
  let washedPct = CLEAN_PCT;
  let lostIfLeft = 0;
  let lostIfWashed = 0;
  days.forEach((x, i) => {
    if (i > 0) {
      const prevRain = days[i - 1].rainMm ?? 0;
      washedPct = prevRain >= WASHING_RAIN_MM ? CLEAN_PCT : Math.min(CAP, washedPct + PER_DRY_DAY + (x.smoky ? 0.5 : 0));
    }
    const pctLeft = x.soilPct;
    const pctWashed = Math.min(washedPct, pctLeft); // washing can never make it dirtier
    lostIfLeft += (x.kwhBeforeDust * pctLeft) / 100;
    lostIfWashed += (x.kwhBeforeDust * pctWashed) / 100;
  });
  const savingKwh = Math.max(0, lostIfLeft - lostIfWashed);
  const todayLossKwh = (today.kwhBeforeDust * today.soilPct) / 100;

  // Rain in the next two days will wash the panels for free.
  const rainSoon = days.slice(0, 3).find((x) => (x.rainMm ?? 0) >= 5);
  // Sunniest coming day: washing just before it pays back the most.
  const sunniest = days.reduce((a, b) => (b.kwhBeforeDust > a.kwhBeforeDust ? b : a));

  let action;
  if (today.soilPct < 2.5) action = 'clean';
  else if (rainSoon) action = 'wait-rain';
  else action = 'wash';

  return {
    soilPct: today.soilPct,
    dryDays: today.dryDays ?? null,
    todayLossKwh,
    todayLossRm: todayLossKwh * rate,
    weekLossKwh: lostIfLeft,
    weekLossRm: lostIfLeft * rate,
    savingKwh,
    savingRm: savingKwh * rate,
    action,
    rainDay: rainSoon ? rainSoon.label : null,
    sunniestDay: sunniest.label,
  };
}
