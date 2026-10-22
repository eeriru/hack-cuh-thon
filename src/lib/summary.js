// Plain-language "In short" sentences for each page. Pure functions so they can be tested.
import { tr } from './i18n.js';

const r0 = (x) => Math.round(x);

/**
 * Air quality.
 * iq: { aqius, city } | null; iqLevel: { label, key }
 * doe: { api, station } | null; doeLevel: { label, key }
 * days: [{ d, label, max }] model forecast (US AQI), today first
 */
export function airSummary({ iq, iqLevel, doe, doeLevel, days = [] }) {
  const items = [];
  const key = iq ? iqLevel.key : doe ? doeLevel.key : null;
  const label = iq ? iqLevel.label : doe ? doeLevel.label : null;
  if (label) {
    const nums = [iq ? `IQAir ${r0(iq.aqius)}` : null, doe ? `${tr('DOE')} ${doe.api}` : null].filter(Boolean).join(' · ');
    const tone = key === 'good' ? 'good' : key === 'moderate' ? 'moderate' : 'bad';
    items.push({ icon: tone === 'good' ? '😊' : tone === 'moderate' ? '🙂' : '😷', text: `${tr('Air: {level}', { level: tr(label).toLowerCase() })} · ${nums}`, tone });
  }
  const DO = {
    good: 'Good time to be outdoors',
    moderate: 'OK for most · asthma: take it easy',
    usg: 'Kids, elderly, asthma: limit time outside',
    unhealthy: 'Exercise indoors · windows shut · N95 outside',
    very: 'Stay in · windows shut · air purifier on',
    hazardous: 'Stay in · seal windows · N95 if you go out',
    emergency: 'Stay in · follow official news',
  };
  if (key && DO[key]) items.push({ icon: '👉', text: tr(DO[key]) });
  const future = days.filter((d) => d.max !== null && d.max !== undefined).slice(1);
  if (future.length) {
    const nowBad = key && !['good', 'moderate'].includes(key);
    const better = future.find((d) => d.max <= 100);
    const worse = future.find((d) => d.max > 150);
    if (nowBad && better) items.push({ icon: '📅', text: tr('Better by {day}', { day: better.label }) });
    else if (nowBad) items.push({ icon: '📅', text: tr('Unhealthy for {n} more days', { n: future.length }), tone: 'bad' });
    else if (worse) items.push({ icon: '📅', text: tr('May turn unhealthy {day}', { day: worse.label }), tone: 'bad' });
    else items.push({ icon: '📅', text: tr('No unhealthy days ahead') });
  }
  return items;
}

/**
 * Weather.
 * now: { temp, feels, rh, uv, rainNext24 }; heat: { label, key }
 * days: [{ label, rain, rainChance, code, tmax, solar }] today first
 */
export function weatherSummary({ now, heat, days = [] }) {
  const items = [];
  if (now.temp !== null && now.temp !== undefined) {
    const feels = now.feels ?? now.temp;
    const hot = feels >= 32 ? 'Hot' : feels >= 27 ? 'Warm' : 'Comfortable';
    const feel = tr(now.rh >= 70 ? `${hot} and humid` : hot);
    items.push({
      icon: feels >= 32 ? '🥵' : '🌡️',
      text: `${tr('{temp}°C, feels {feels}°C · {feel}', { feel: feel.toLowerCase(), temp: r0(now.temp), feels: r0(feels) })}${heat && ['extreme', 'danger', 'extreme-danger'].includes(heat.key) ? ` · ${tr('drink water')}` : ''}`,
      tone: feels >= 32 ? 'bad' : undefined,
    });
  }
  const wet = days.find((d) => (d.rain ?? 0) >= 10);
  const anyRain = days.find((d) => (d.rain ?? 0) >= 1);
  const when = (d) => (d.label === tr('Today') ? tr('today') : tr('on {day}', { day: d.label }));
  if (wet) items.push({ icon: d2icon(wet.code), text: tr('Heavy rain {when} · {mm} mm · flood risk', { when: when(wet), mm: r0(wet.rain) }), tone: 'moderate' });
  else if (anyRain) items.push({ icon: '🌦️', text: tr('Some rain {when} · {mm} mm', { when: when(anyRain), mm: anyRain.rain.toFixed(0) }) });
  else if (days.length) items.push({ icon: '☀️', text: tr('Dry for {n} days', { n: days.length }) });
  if (now.uv >= 8) items.push({ icon: '🧴', text: tr('UV {uv}: sunscreen at midday', { uv: now.uv.toFixed(0) }) });
  const solarDays = days.filter((d) => d.solar !== null && d.solar !== undefined);
  if (solarDays.length > 1) {
    const best = solarDays.reduce((a, b) => (b.solar > a.solar ? b : a));
    items.push({ icon: '⚡', text: tr('Best solar day: {day} · {kwh} kWh', { day: best.label, kwh: best.solar.toFixed(0) }) });
  }
  return items;
}

function d2icon(code) {
  return code >= 95 ? '⛈️' : '🌧️';
}

/**
 * Solar.
 * day: { label, final, ideal, hazePct, biggest: { key, label, kwh }, valueRm }
 * days: [{ label, final }]; home: { dailyKwh }; tip: string | null
 */
export function solarSummary({ day, days = [], dailyUse, tip, isPast }) {
  const items = [];
  const share = dailyUse ? Math.round((day.final / dailyUse) * 100) : null;
  items.push({
    icon: '⚡',
    text: `${tr('{kwh} kWh {day} · RM {rm}', {
      kwh: day.final.toFixed(0),
      day: day.label,
      rm: day.valueRm.toFixed(0),
    })}${share !== null ? ` · ${tr('{share} of home use', { share: share >= 100 ? '100%' : `${share}%` })}` : ''}`,
  });
  const causes = [tr('Biggest loss: {what} ({kwh} kWh)', { what: tr(day.biggest.label).toLowerCase(), kwh: day.biggest.kwh.toFixed(1) })];
  if (day.hazePct >= 3 && day.biggest.key !== 'haze') causes.push(tr('haze −{pct}%', { pct: r0(day.hazePct) }));
  else if (day.hazePct < 3) causes.push(tr('little haze'));
  items.push({ icon: '🔍', text: causes.join(' · ') });
  if (days.length > 1) {
    const best = days.reduce((a, b) => (b.final > a.final ? b : a));
    const worst = days.reduce((a, b) => (b.final < a.final ? b : a));
    if (best.final - worst.final > 1) items.push({ icon: '📅', text: tr('Best {best} ({bk} kWh) · worst {worst} ({wk} kWh)', { best: best.label, bk: best.final.toFixed(0), worst: worst.label, wk: worst.final.toFixed(0) }) });
  }
  if (tip) items.push({ icon: '💡', text: tip });
  return items;
}
