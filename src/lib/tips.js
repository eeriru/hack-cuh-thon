// Ideas for the day: what to do with spare solar, and simple ways to use less power.
// Built from the day's plan, so every tip names real hours and amounts.
import { fmtHour } from './battery.js';

/**
 * budget: solarBudget() result. day / nextDay: entries from buildDays().
 * home: the day's home settings (tariff, battery). ev: EV settings.
 * Returns { solar: [tip], save: [tip] }, each tip { key, icon, title, text, vars }.
 * title and text are English keys for tr(); vars fill their {placeholders}.
 */
export function energyTips({ budget: b, day, nextDay = null, home, ev = {} }) {
  const solar = [];
  const save = [];
  const spare = b.surplusKwh;
  const win = b.window;
  const hours = win ? `${fmtHour(win.start)}–${fmtHour(win.end)}` : '';

  if (spare >= 0.5 && win) {
    solar.push({ key: 'gadgets', icon: '🔌', title: 'Charge everything at midday', text: 'Charge laptops, phones, power banks and the vacuum between {hours}. It is free power from your roof.', vars: { hours } });
    if (spare >= 1) solar.push({ key: 'cook', icon: '🍚', title: 'Cook ahead', text: 'Use the rice cooker, slow cooker or oven between {hours}, then just warm the food up for dinner.', vars: { hours } });
    if (spare >= 2) {
      const from = Math.max(win.start, win.end - 2);
      solar.push({ key: 'precool', icon: '❄', title: 'Pre-cool the house', text: 'Run the aircon {from}–{to} while the sun pays for it, so the rooms stay cooler into the evening.', vars: { from: fmtHour(from), to: fmtHour(win.end) } });
    }
    if (spare >= 1.5) solar.push({ key: 'heater', icon: '🚿', title: 'Heat water with the sun', text: 'Put the electric water heater on a timer for around {hour}, when you have the most spare solar.', vars: { hour: fmtHour(b.peakHour ?? win.start) } });
    if (!ev.enabled && b.spareKwh >= 3) solar.push({ key: 'ev', icon: '🚗', title: 'Got an EV or e-bike?', text: 'About {kwh} kWh would otherwise go to the grid. Add your EV below to charge it on free solar.', vars: { kwh: b.spareKwh.toFixed(1) } });
    else if (!(home.battery?.capacityKwh > 0) && b.spareKwh >= 3) solar.push({ key: 'battery', icon: '🔋', title: 'Keep it for the evening', text: 'About {kwh} kWh goes to the grid for little money. A home battery would store it for the evening.', vars: { kwh: b.spareKwh.toFixed(1) } });
  } else {
    const better = nextDay && nextDay.breakdown.final > day.breakdown.final * 1.2;
    if (better) solar.push({ key: 'wait', icon: '⏳', title: 'Little spare solar today', text: 'Leave heavy chores like laundry and ironing for {day}, which should make {kwh} kWh.', vars: { day: nextDay.d, kwh: nextDay.breakdown.final.toFixed(1) }, dayVar: true });
    else solar.push({ key: 'none', icon: '🌥', title: 'Little spare solar today', text: 'Your home uses all the solar today. Spread heavy chores out instead of running them together.', vars: {} });
  }

  const t = home.tariff;
  if (t.mode === 'tou') {
    save.push({ key: 'peak', icon: '⏰', title: 'Skip the peak hours', text: 'Power costs RM {peak}/kWh from {from} to {to}, and RM {off} at other times. Run the washer, dryer and iron outside these hours.', vars: { peak: t.peakRate.toFixed(2), off: t.offPeakRate.toFixed(2), from: fmtHour(t.peakStart), to: fmtHour(t.peakEnd) } });
  }
  if ((day.soil?.pct ?? 0) >= 3) save.push({ key: 'dust', icon: '🧽', title: 'Clean your panels', text: 'Dust is costing about {pct}% of your solar. A rinse with plain water early in the morning gets it back.', vars: { pct: day.soil.pct.toFixed(0) } });
  const haze = day.breakdown.steps.find((s) => s.key === 'haze');
  if (haze && day.breakdown.final > 0 && haze.kwh / day.breakdown.final >= 0.05) save.push({ key: 'haze', icon: '🌫', title: 'Haze is cutting your solar', text: 'Haze takes about {kwh} kWh today. Use the solar while the sun is out, and save flexible chores for a clearer day.', vars: { kwh: haze.kwh.toFixed(1) } });
  if ((day.wx?.tmax ?? 0) >= 32) save.push({ key: 'aircon', icon: '🌡', title: 'Set the aircon to 24–25 °C', text: 'It will be {t} °C today. Add a fan instead of going colder: every degree lower makes the aircon work harder.', vars: { t: day.wx.tmax.toFixed(0) } });
  else save.push({ key: 'fan', icon: '🌀', title: 'Try a fan first', text: 'A fan uses a small part of the power of an aircon. Open the windows in the evening if the air is clean.', vars: {} });
  save.push({ key: 'standby', icon: '🔌', title: 'Switch off at the wall', text: 'TVs, decoders and chargers still draw power on standby. Switch them off at night.', vars: {} });

  return { solar: solar.slice(0, 4), save: save.slice(0, 4) };
}
