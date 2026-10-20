// Plain-language "In short" sentences for each page. Pure functions so they can be tested.

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
    const nums = [iq ? `IQAir ${r0(iq.aqius)}` : null, doe ? `official DOE reading ${doe.api}` : null].filter(Boolean).join(', ');
    const tone = key === 'good' ? 'good' : key === 'moderate' ? 'moderate' : 'bad';
    items.push({ icon: tone === 'good' ? '😊' : tone === 'moderate' ? '🙂' : '😷', text: `The air is ${label.toLowerCase()} right now (${nums}).`, tone });
  }
  const DO = {
    good: 'Great time to be outdoors. Open the windows.',
    moderate: 'Fine for most people. If you have asthma, take it a bit easier outdoors.',
    usg: 'Children, elderly people and anyone with asthma should limit time outdoors. Close the windows.',
    unhealthy: 'Move exercise indoors, keep windows closed and wear an N95 mask outside.',
    very: 'Stay indoors as much as possible, keep windows shut and run an air purifier.',
    hazardous: 'Stay indoors with windows sealed. Wear an N95 mask if you must go out.',
    emergency: 'Stay indoors and follow official announcements.',
  };
  if (key && DO[key]) items.push({ icon: '👉', text: DO[key] });
  const future = days.filter((d) => d.max !== null && d.max !== undefined).slice(1);
  if (future.length) {
    const nowBad = key && !['good', 'moderate'].includes(key);
    const better = future.find((d) => d.max <= 100);
    const worse = future.find((d) => d.max > 150);
    if (nowBad && better) items.push({ icon: '📅', text: `Forecast: should improve to moderate or better by ${better.label}.` });
    else if (nowBad) items.push({ icon: '📅', text: `Forecast: likely to stay unhealthy for the next ${future.length} days.`, tone: 'bad' });
    else if (worse) items.push({ icon: '📅', text: `Forecast: air may turn unhealthy on ${worse.label}. Plan outdoor activities earlier.`, tone: 'bad' });
    else items.push({ icon: '📅', text: 'Forecast: no unhealthy air expected in the coming days.' });
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
    const humid = now.rh >= 70 ? ' and humid' : '';
    const hot = feels >= 32 ? 'Hot' : feels >= 27 ? 'Warm' : 'Comfortable';
    items.push({
      icon: feels >= 32 ? '🥵' : '🌡️',
      text: `${hot}${humid}: ${r0(now.temp)}°C, feels like ${r0(feels)}°C.${heat && ['extreme', 'danger', 'extreme-danger'].includes(heat.key) ? ' Drink water and take breaks in the shade.' : ''}`,
      tone: feels >= 32 ? 'bad' : undefined,
    });
  }
  const wet = days.find((d) => (d.rain ?? 0) >= 10);
  const anyRain = days.find((d) => (d.rain ?? 0) >= 1);
  if (wet) items.push({ icon: d2icon(wet.code), text: `Heavy rain expected ${wet.label === 'Today' ? 'today' : `on ${wet.label}`} (about ${r0(wet.rain)} mm). Watch for flash floods in low areas.`, tone: 'moderate' });
  else if (anyRain) items.push({ icon: '🌦️', text: `Some rain ${anyRain.label === 'Today' ? 'today' : `on ${anyRain.label}`} (about ${anyRain.rain.toFixed(0)} mm). Otherwise mostly dry.` });
  else if (days.length) items.push({ icon: '☀️', text: `No real rain expected in the next ${days.length} days.` });
  if (now.uv >= 8) items.push({ icon: '🧴', text: `UV is very high (${now.uv.toFixed(0)}). Use sunscreen and shade around midday.` });
  const solarDays = days.filter((d) => d.solar !== null && d.solar !== undefined);
  if (solarDays.length > 1) {
    const best = solarDays.reduce((a, b) => (b.solar > a.solar ? b : a));
    items.push({ icon: '⚡', text: `Best solar day this week: ${best.label} (about ${best.solar.toFixed(0)} kWh). A good day for laundry and charging.` });
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
    text: `Your panels ${isPast ? 'made' : 'will make'} about ${day.final.toFixed(0)} kWh ${day.label} — worth around RM ${day.valueRm.toFixed(0)}${
      share !== null ? `, about ${share >= 100 ? 'all' : `${share}%`} of a typical day's home use` : ''
    }.`,
  });
  const PHRASE = { clouds: 'clouds & rain take', heat: 'heat on the panels takes', haze: 'haze takes', dust: 'dust on the panels takes' };
  const causes = [`${PHRASE[day.biggest.key] || `${day.biggest.label.toLowerCase()} takes`} the most (${day.biggest.kwh.toFixed(1)} kWh)`];
  if (day.hazePct >= 3 && day.biggest.key !== 'haze') causes.push(`haze cuts ${r0(day.hazePct)}%`);
  else if (day.hazePct < 3) causes.push('haze is barely a factor');
  items.push({ icon: '🔍', text: `What reduces it: ${causes.join('; ')}.` });
  if (days.length > 1) {
    const best = days.reduce((a, b) => (b.final > a.final ? b : a));
    const worst = days.reduce((a, b) => (b.final < a.final ? b : a));
    if (best.final - worst.final > 1) items.push({ icon: '📅', text: `This week: best ${best.label} (${best.final.toFixed(0)} kWh), weakest ${worst.label} (${worst.final.toFixed(0)} kWh).` });
  }
  if (tip) items.push({ icon: '💡', text: tip });
  return items;
}
