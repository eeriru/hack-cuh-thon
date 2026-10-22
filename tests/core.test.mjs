// Run with: node tests/core.test.mjs
import assert from 'node:assert/strict';
import { solarPosition, hourGeometry, pvEnergyKwh } from '../src/lib/solar.js';
import { computeHazeLoss, physicsKc, PHYSICS_ENGINE, evalTrees } from '../src/lib/model.js';
import { planDay, hourRanges } from '../src/lib/battery.js';
import { aqiFromPm25 } from '../src/lib/aqi.js';
import { makeDemoData } from '../src/lib/demo.js';
import { dayModelHours, addDays, todayMY } from '../src/lib/api.js';
import { tr, setLang } from '../src/lib/i18n.js';
import { MS } from '../src/lib/i18n-ms.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('✓', name);
};

test('sun is nearly overhead at KL solar noon on the March equinox', () => {
  // 2026-03-20, KL (101.69E). Solar noon ≈ 12:00 - 101.69*4min + ~7min (eq. of time) local mean → ~05:20 UTC
  let best = { cos: -1, t: 0 };
  const base = Date.UTC(2026, 2, 20, 3, 0) / 1000;
  for (let m = 0; m < 240; m++) {
    const t = base + m * 60;
    const { cosZenith } = solarPosition(t, 3.139, 101.687);
    if (cosZenith > best.cos) best = { cos: cosZenith, t };
  }
  assert.ok(best.cos > 0.995, `cosZ ${best.cos}`);
  const utcH = new Date(best.t * 1000).getUTCHours() + new Date(best.t * 1000).getUTCMinutes() / 60;
  assert.ok(utcH > 5.0 && utcH < 5.5, `noon at ${utcH} UTC`);
});

test('night hours have no clear-sky sunlight', () => {
  const t = Date.UTC(2026, 9, 15, 15, 0) / 1000; // 11pm in Malaysia
  assert.equal(hourGeometry(t, 3.1, 101.5).clearGhi, 0);
});

test('panel output rises with sunlight and falls with heat', () => {
  assert.ok(pvEnergyKwh(800, 30) > pvEnergyKwh(400, 30));
  assert.ok(pvEnergyKwh(800, 25) > pvEnergyKwh(800, 35));
  assert.ok(pvEnergyKwh(1000, 25) < 4.5 && pvEnergyKwh(1000, 25) > 3.5);
});

test('thicker haze lowers predicted sunlight; clouds lower it too', () => {
  const x = { cos_zenith: 0.9, cloud_low: 10, cloud_mid: 0, cloud_high: 10, rh: 70, temp: 31 };
  const clean = physicsKc({ ...x, aod: 0.3 });
  const hazy = physicsKc({ ...x, aod: 1.5 });
  const cloudy = physicsKc({ ...x, aod: 0.3, cloud_low: 90 });
  assert.ok(hazy < clean && cloudy < clean);
  const lossPct = (1 - hazy / clean) * 100;
  assert.ok(lossPct > 10 && lossPct < 35, `noon haze loss ${lossPct}`);
});

test('haze matters less under thick cloud (little direct beam left)', () => {
  const x = { cos_zenith: 0.9, cloud_mid: 0, cloud_high: 0, rh: 70, temp: 31 };
  const lossClear = 1 - physicsKc({ ...x, cloud_low: 0, aod: 1.5 }) / physicsKc({ ...x, cloud_low: 0, aod: 0.3 });
  const lossCloud = 1 - physicsKc({ ...x, cloud_low: 95, aod: 1.5 }) / physicsKc({ ...x, cloud_low: 95, aod: 0.3 });
  assert.ok(lossCloud < lossClear);
});

test('demo haze day loses more solar than a clean day; loss is never negative', () => {
  const place = { lat: 3.17, lon: 101.47 };
  const today = todayMY();
  const data = makeDemoData(place, addDays(today, -4), addDays(today, 3));
  const peak = computeHazeLoss(dayModelHours(data, addDays(today, -1)), { ...place, engine: PHYSICS_ENGINE });
  const clean = computeHazeLoss(dayModelHours(data, addDays(today, 3)), { ...place, engine: PHYSICS_ENGINE });
  assert.equal(dayModelHours(data, today).length, 24);
  assert.ok(peak.lossPct > clean.lossPct, `${peak.lossPct} vs ${clean.lossPct}`);
  assert.ok(peak.lossPct > 7, `peak loss ${peak.lossPct}`);
  assert.ok(peak.kwhClean > 8 && peak.kwhClean < 30, `clean-sky kWh ${peak.kwhClean}`);
  assert.ok(peak.rows.every((r) => r.lossKwh >= 0));
});

test('haze-aware plan costs no more than the standard plan', () => {
  const place = { lat: 3.17, lon: 101.47 };
  const today = todayMY();
  const data = makeDemoData(place, addDays(today, -2), today);
  for (const d of [addDays(today, -1), today]) {
    const loss = computeHazeLoss(dayModelHours(data, d), { ...place, engine: PHYSICS_ENGINE });
    const pv = new Array(24).fill(0);
    const pm = new Array(24).fill(0);
    loss.rows.forEach((r) => {
      pv[r.localHour] = r.kwhHaze;
      pm[r.localHour] = r.pm2_5;
    });
    const plan = planDay(pv, pm);
    assert.ok(plan.hazeAware.costRm <= plan.standard.costRm + 1e-9, `${plan.hazeAware.costRm} > ${plan.standard.costRm}`);
    assert.equal(plan.flexHours.length, 2);
    assert.ok(plan.hazeAware.soc.every((s) => s >= -1e-9 && s <= 100 + 1e-9));
  }
});

test('hour ranges read naturally', () => {
  assert.equal(hourRanges([11, 12]), '11am–1pm');
  assert.equal(hourRanges([9, 13]), '9am–10am, 1pm–2pm');
});

test('US AQI from PM2.5 matches EPA breakpoints', () => {
  assert.equal(aqiFromPm25(9.0), 50);
  assert.equal(aqiFromPm25(35.4), 100);
  assert.equal(aqiFromPm25(55.5), 151);
});

test('tree evaluator walks left/right/missing correctly', () => {
  const model = {
    baseline: 0.5,
    trees: [
      { f: [0, 0, 0], t: [1, 0, 0], l: [1, 0, 0], r: [2, 0, 0], m: [1, 0, 0], leaf: [0, 1, 1], v: [0, -0.1, 0.2] },
    ],
  };
  assert.equal(evalTrees(model, [0.5]), 0.4);
  assert.equal(evalTrees(model, [2]), 0.7);
  assert.equal(evalTrees(model, [NaN]), 0.4);
});


// ---------- DOE official readings ----------
import { readFileSync } from 'node:fs';
import { parseDoe, parseDoeApi, parseDoeTime, nearestStation, doeLevel } from '../src/lib/doe.js';
import handler from '../api/doe.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/doe_sample.json', import.meta.url)));
const sampleNow = Date.parse('2026-10-20T10:20:00+08:00') / 1000;

test('DOE times are Malaysia local time', () => {
  assert.equal(parseDoeTime('2026-10-20T10:00:00'), Date.parse('2026-10-20T02:00:00Z') / 1000);
});

test('DOE API values: numbers kept, flags and blanks dropped', () => {
  assert.equal(parseDoeApi('55'), 55);
  assert.equal(parseDoeApi(148), 148);
  assert.equal(parseDoeApi('&'), null);
  assert.equal(parseDoeApi(''), null);
  assert.equal(parseDoeApi('-'), null);
});

test('DOE payload parses into stations with 24 ordered readings', () => {
  const st = parseDoe(sample);
  assert.equal(st.length, 8);
  const shah = st.find((s) => s.id === 'CA22B');
  assert.equal(shah.name, 'Shah Alam');
  assert.equal(shah.state, 'Selangor');
  assert.equal(shah.readings.length, 24);
  assert.ok(shah.readings.every((r, i, a) => i === 0 || r.t > a[i - 1].t));
  const newest = sample.api_table_hourly.find((r) => r.STATION_ID === 'CA22B' && r.DATETIME === '2026-10-20T10:00:00');
  assert.equal(shah.latest.api, Number(newest.API));
  assert.equal(shah.readings.filter((r) => r.api === null).length, 1);
  assert.equal(shah.latest.symbol, '**');
  assert.throws(() => parseDoe({ nope: 1 }));
});

test('nearest station skips stale stations and picks the closest', () => {
  const st = parseDoe(sample);
  const elmina = { lat: 3.17, lon: 101.47 };
  const near = nearestStation(st, elmina, { now: sampleNow });
  assert.equal(near.station.id, 'CA22B');
  assert.ok(near.distanceKm > 5 && near.distanceKm < 15, `${near.distanceKm}`);
  const kuantan = { lat: 3.81, lon: 103.33 };
  assert.equal(nearestStation(st, kuantan, { now: sampleNow }), null); // only a stale station within 60 km
});

test('DOE status bands', () => {
  assert.equal(doeLevel(50).label, 'Good');
  assert.equal(doeLevel(51).label, 'Moderate');
  assert.equal(doeLevel(150).label, 'Unhealthy');
  assert.equal(doeLevel(250).label, 'Very unhealthy');
  assert.equal(doeLevel(301).label, 'Hazardous');
});

const fakeRes = () => {
  const r = { headers: {}, code: 0, body: null };
  r.setHeader = (k, v) => (r.headers[k.toLowerCase()] = v);
  r.status = (c) => ((r.code = c), r);
  r.send = (b) => ((r.body = b), r);
  r.json = (b) => ((r.body = JSON.stringify(b)), r);
  return r;
};

await (async () => {
  // async test
  const name = 'server function passes DOE data through with caching';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(sample), { status: 200 });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['cache-control'], /s-maxage=600/);
  assert.equal(JSON.parse(res.body).api_table_hourly.length, 192);
  globalThis.fetch = async () => new Response('down', { status: 503 });
  const res2 = fakeRes();
  await handler({ method: 'GET' }, res2);
  assert.equal(res2.code, 502);
  globalThis.fetch = realFetch;
  passed++;
  console.log('✓', name);
})();


// ---------- IQAir server function ----------
import iqHandler from '../api/iqair.js';
await (async () => {
  const name = 'IQAir function: hides key, reshapes data, explains errors';
  const realFetch = globalThis.fetch;
  let calledUrl = '';
  delete process.env.IQAIR_API_KEY;
  let res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.17', lon: '101.47' } }, res);
  assert.equal(res.code, 501);

  process.env.IQAIR_API_KEY = 'secret-key';
  globalThis.fetch = async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify({ status: 'success', data: { city: 'Shah Alam', state: 'Selangor', country: 'Malaysia',
      location: { type: 'Point', coordinates: [101.53, 3.07] },
      current: { pollution: { ts: '2026-10-20T06:00:00.000Z', aqius: 161, mainus: 'p2', aqicn: 95, maincn: 'p2' },
        weather: { ts: '2026-10-20T06:00:00.000Z', tp: 32, pr: 1008, hu: 62, ws: 2.1, wd: 220, ic: '50d' } } } }), { status: 200 });
  };
  res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.1712345', lon: '101.4698765' } }, res);
  assert.equal(res.code, 200);
  assert.match(calledUrl, /lat=3\.15&lon=101\.45&key=secret-key/); // rounded to 0.05° so nearby places share a reading
  const body = JSON.parse(res.body);
  assert.equal(body.aqius, 161);
  assert.equal(body.city, 'Shah Alam');
  assert.equal(body.weather.tempC, 32);
  assert.ok(!res.body.includes('secret-key'));
  assert.match(res.headers['cache-control'], /s-maxage=1800/);

  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'fail', data: { message: 'call_limit_reached' } }), { status: 200 });
  res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.17', lon: '101.47' } }, res);
  assert.equal(res.code, 429);
  assert.match(JSON.parse(res.body).error, /limit/);
  // IQAir's plain-text "Too Many Requests" must be treated as the per-minute limit, and cached briefly
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'fail', data: { message: 'Too Many Requests' } }), { status: 429 });
  res = fakeRes();
  await iqHandler({ method: 'GET', query: { lat: '3.17', lon: '101.47' } }, res);
  assert.equal(res.code, 429);
  assert.equal(JSON.parse(res.body).limited, true);
  assert.match(res.headers['cache-control'], /s-maxage=60/);
  assert.equal(res.headers['retry-after'], '60');

  res = fakeRes();
  await iqHandler({ method: 'GET', query: {} }, res);
  assert.equal(res.code, 400);
  globalThis.fetch = realFetch;
  delete process.env.IQAIR_API_KEY;
  passed++;
  console.log('✓', name);
})();


// ---------- country browsing ----------
import { matchCountries, matchRegions, matchCities, wordMatch, iqairRegionName, FALLBACK_CITIES } from '../src/lib/browse.js';
import placesHandler from '../api/places.js';

test('typing a country name offers that country', () => {
  assert.equal(matchCountries('Indonesia')[0].code, 'ID');
  assert.equal(matchCountries('indon')[0].code, 'ID');
  assert.equal(matchCountries('Singapura')[0].code, 'SG');
  assert.equal(matchCountries('USA')[0].iqairName, 'USA');
  assert.equal(matchCountries('Shah Alam').length, 0);
  assert.ok(FALLBACK_CITIES.ID.length >= 10 && FALLBACK_CITIES.ID.every((c) => c.lat < 7 && c.lat > -11));
});

test('search matches whole words anywhere in the name', () => {
  assert.ok(wordMatch('kalimantan', 'East Kalimantan'));
  assert.ok(wordMatch('east kal', 'East Kalimantan'));
  assert.ok(!wordMatch('alimantan', 'East Kalimantan'));
  const regions = matchRegions('Kalimantan').map((r) => r.region);
  for (const r of ['West Kalimantan', 'Central Kalimantan', 'South Kalimantan', 'East Kalimantan', 'North Kalimantan']) assert.ok(regions.includes(r), r);
  assert.deepEqual(matchRegions('jav').map((r) => r.region).sort(), ['Central Java', 'East Java', 'West Java']);
  const cities = matchCities('Kalimantan').map((c) => c.name);
  assert.ok(cities.includes('Pontianak') && cities.includes('Palangka Raya') && cities.includes('Balikpapan'));
  assert.equal(matchCountries('korea')[0].code, 'KR');
  assert.equal(iqairRegionName('Jakarta', ['DKI Jakarta', 'Banten']), 'DKI Jakarta');
  assert.equal(iqairRegionName('Penang', ['Selangor', 'Johor']), null);
});

await (async () => {
  const name = 'places function lists regions and cities from IQAir';
  const realFetch = globalThis.fetch;
  process.env.IQAIR_API_KEY = 'k';
  let url = '';
  globalThis.fetch = async (u) => {
    url = u;
    return new Response(JSON.stringify({ status: 'success', data: [{ state: 'Riau' }, { state: 'Jakarta' }] }), { status: 200 });
  };
  let res = fakeRes();
  await placesHandler({ method: 'GET', query: { type: 'states', country: 'Indonesia' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body).items, ['Riau', 'Jakarta']);
  assert.match(url, /\/v2\/states\?country=Indonesia&key=k/);
  assert.match(res.headers['cache-control'], /s-maxage=86400/);
  globalThis.fetch = async (u) => {
    url = u;
    return new Response(JSON.stringify({ status: 'success', data: [{ city: 'Pekanbaru' }] }), { status: 200 });
  };
  res = fakeRes();
  await placesHandler({ method: 'GET', query: { type: 'cities', country: 'Indonesia', state: 'Riau' } }, res);
  assert.deepEqual(JSON.parse(res.body).items, ['Pekanbaru']);
  assert.match(url, /\/v2\/cities\?state=Riau&country=Indonesia/);
  res = fakeRes();
  await placesHandler({ method: 'GET', query: { type: 'cities', country: 'Indonesia' } }, res);
  assert.equal(res.code, 400);
  globalThis.fetch = realFetch;
  delete process.env.IQAIR_API_KEY;
  passed++;
  console.log('✓', name);
})();

// ---------- weather calculations & solar loss breakdown ----------
import { heatIndex, dewPoint, heatRisk, uvLevel, rainLevel, rainByDate } from '../src/lib/weather.js';
import { lossBreakdown, soilingForDate } from '../src/lib/losses.js';

test('heat index and dew point match published values', () => {
  // NOAA chart: 90°F (32.2°C) at 70% RH ≈ 106°F (41.1°C)
  assert.ok(Math.abs(heatIndex(32.22, 70) - 41.1) < 0.8, `${heatIndex(32.22, 70)}`);
  // Cool, dry: heat index ≈ air temperature
  assert.ok(Math.abs(heatIndex(22, 40) - 21.5) < 1.5);
  // Dew point 30°C at 70% ≈ 23.9°C
  assert.ok(Math.abs(dewPoint(30, 70) - 23.9) < 0.3, `${dewPoint(30, 70)}`);
  assert.equal(heatRisk(35).label, 'Extreme caution');
  assert.equal(uvLevel(11.2).label, 'Extreme');
  assert.equal(rainLevel(35).label, 'Heavy rain');
});

test('loss breakdown steps add up exactly and haze matches the headline', () => {
  const place = { lat: 3.17, lon: 101.47 };
  const today = todayMY();
  const data = makeDemoData(place, addDays(today, -6), addDays(today, 3));
  for (const d of [addDays(today, -1), today, addDays(today, 2)]) {
    const L = computeHazeLoss(dayModelHours(data, d), { ...place, engine: PHYSICS_ENGINE });
    const soil = soilingForDate(data, d);
    const B = lossBreakdown(L, { soilingPct: soil.pct });
    const sum = B.steps.reduce((a, s) => a + s.kwh, 0);
    assert.ok(Math.abs(B.ideal - sum - B.final) < 1e-9, 'steps must sum to ideal - final');
    assert.ok(Math.abs(B.steps.find((s) => s.key === 'haze').kwh - L.lossKwh) < 1e-9, 'haze step = headline haze loss');
    assert.ok(B.steps.find((s) => s.key === 'heat').kwh > 0, 'panels lose output to heat in the tropics');
    assert.ok(B.final > 0 && B.final < B.ideal);
    assert.ok(soil.pct >= 1 && soil.pct <= 6);
  }
});

test('rain washes the panels: soiling resets after a wet day', () => {
  const t0 = Date.parse('2026-10-10T00:00:00+08:00') / 1000;
  const mk = (rainOnDay) =>
    Array.from({ length: 24 * 6 }, (_, i) => ({ t: t0 + (i + 1) * 3600, rain: Math.floor(i / 24) === rainOnDay && i % 24 === 15 ? 12 : 0, pm2_5: 20 }));
  const wetYesterday = soilingForDate({ hours: mk(4), offsetSec: 8 * 3600 }, '2026-10-16');
  const wetLongAgo = soilingForDate({ hours: mk(0), offsetSec: 8 * 3600 }, '2026-10-16');
  assert.equal(wetYesterday.dryDays, 1);
  assert.ok(wetLongAgo.pct > wetYesterday.pct);
  assert.equal(rainByDate(mk(4), 8 * 3600).get('2026-10-14'), 12);
});
// ---------- plain-language summaries ----------
import { airSummary, weatherSummary, solarSummary } from '../src/lib/summary.js';

test('air summary: status, what to do, and forecast in plain words', () => {
  const items = airSummary({
    iq: { aqius: 161, city: 'Shah Alam' },
    iqLevel: { key: 'unhealthy', label: 'Unhealthy' },
    doe: { api: 144, station: 'Shah Alam' },
    doeLevel: { key: 'usg', label: 'Unhealthy' },
    days: [{ label: 'Today', max: 170 }, { label: 'Wednesday', max: 140 }, { label: 'Thursday', max: 80 }],
  });
  assert.match(items[0].text, /Air: unhealthy · IQAir 161 · DOE 144/);
  assert.match(items[1].text, /N95/);
  assert.match(items[2].text, /Better by Thursday/);
  assert.equal(airSummary({ iq: null, doe: null, iqLevel: {}, doeLevel: {} }).length, 0);
});

test('weather summary mentions heat, the rainy day and the best solar day', () => {
  const items = weatherSummary({
    now: { temp: 31, feels: 37, rh: 75, uv: 9 },
    heat: { key: 'extreme', label: 'Extreme caution' },
    days: [
      { label: 'Today', rain: 0, solar: 18 },
      { label: 'Wednesday', rain: 24, code: 95, solar: 12 },
      { label: 'Saturday', rain: 0, solar: 24.5 },
    ],
  });
  const text = items.map((i) => i.text).join(' | ');
  assert.match(text, /31°C, feels 37°C · hot and humid · drink water/);
  assert.match(text, /Heavy rain on Wednesday · 24 mm/);
  assert.match(text, /UV 9: sunscreen/);
  assert.match(text, /Best solar day: Saturday · 25 kWh/);
});

test('solar summary: output, value, share of home use, main cause and tip', () => {
  const items = solarSummary({
    day: { label: 'today', final: 19.5, ideal: 37, hazePct: 10, biggest: { key: 'clouds', label: 'Clouds & rain', kwh: 5.7 }, valueRm: 7.3 },
    days: [{ label: 'today', final: 19.5 }, { label: 'Saturday', final: 24.5 }, { label: 'Wednesday', final: 12 }],
    dailyUse: 22,
    tip: 'Tip: run the washing machine 11am–1pm.',
  });
  const text = items.map((i) => i.text).join(' | ');
  assert.match(text, /20 kWh today · RM 7 · 89% of home use/);
  assert.match(text, /Biggest loss: clouds & rain \(5\.7 kWh\) · haze −10%/);
  assert.match(text, /Best Saturday \(25 kWh\) · worst Wednesday \(12 kWh\)/);
  assert.match(text, /washing machine/);
});

import { rateHour, outdoorPlan } from '../src/lib/outdoor.js';
import { planEv, pluggedHours, DEFAULT_EV } from '../src/lib/ev.js';
import { townshipImpact } from '../src/lib/impact.js';
import { hazeSources, bearing, distanceKm, parseFirmsCsv, nearestRegion } from '../src/lib/fires.js';
import { DEFAULT_HOME } from '../src/lib/battery.js';

test('outdoor: rates hours and finds the best slot', () => {
  const base = Date.UTC(2026, 9, 21, 22, 0) / 1000; // 6am local (UTC+8)
  const hours = Array.from({ length: 18 }, (_, i) => {
    const local = 6 + i;
    return { t: base + i * 3600, us_aqi: 40, temp: 24 + (local > 10 && local < 17 ? 8 : 0), rh: 75, uv: local > 10 && local < 15 ? 9 : 1, rain: local === 16 ? 5 : 0, rain_chance: 10 };
  });
  const p = outdoorPlan(hours, { now: base });
  assert.equal(p.best[0].startHour, 6);
  assert.equal(p.best[0].level, 'great');
  const storm = rateHour({ t: base + 10 * 3600, us_aqi: 40, temp: 30, rh: 60, rain: 5, weather_code: 95 });
  assert.equal(storm.level, 'avoid');
  assert.ok(storm.reasons.includes('thunderstorm'));
  // Sensitive people: AQI 120 is "avoid"; for others it's only "hazy".
  const hazy = { t: base, us_aqi: 120, temp: 26, rh: 70, uv: 1 };
  assert.equal(rateHour(hazy, { sensitive: true }).level, 'avoid');
  assert.notEqual(rateHour(hazy).level, 'avoid');
});

test('EV: smart charging uses spare solar and off-peak hours, never costs more', () => {
  const spare = new Array(24).fill(0);
  [11, 12, 13, 14].forEach((h) => (spare[h] = 2));
  const home = { ...DEFAULT_HOME };
  const away = planEv(spare, { ...DEFAULT_EV, kmPerDay: 60 }, home);
  assert.ok(Math.abs(away.needKwh - 10) < 1e-9);
  assert.equal(away.smart.solarKwh, 0); // car is at work while the sun shines
  assert.ok(away.smart.grid.slice(14, 22).every((g) => g === 0), 'no peak-hour charging');
  assert.ok(away.savingRm > 0);
  const wfh = planEv(spare, { ...DEFAULT_EV, kmPerDay: 60, homeDaytime: true }, home);
  assert.ok(Math.abs(wfh.smart.solarKwh - 8) < 1e-9);
  assert.ok(wfh.smart.costRm <= wfh.standard.costRm);
  assert.deepEqual(pluggedHours({ leaveHour: 8, arriveHour: 18 }).length, 14);
});

test('township impact: totals add up and sort by energy made', () => {
  const imp = townshipImpact(
    [
      { place: { name: 'A' }, output: 15, lossKwh: 2 },
      { place: { name: 'B' }, output: 20, lossKwh: 1 },
    ],
    { homes: 100, rate: 0.5, co2PerKwh: 0.7 }
  );
  assert.equal(imp.list[0].place.name, 'B');
  assert.ok(Math.abs(imp.total.mwh - 3.5) < 1e-9);
  assert.ok(Math.abs(imp.total.rm - 1750) < 1e-9);
  assert.ok(Math.abs(imp.total.co2Kg - 2450) < 1e-9);
  assert.ok(Math.abs(imp.total.lostMwh - 0.3) < 1e-9);
  assert.equal(imp.total.homes, 200);
});

test('haze sources: fires upwind are found and named', () => {
  const kl = { lat: 3.14, lon: 101.69 };
  assert.ok(Math.abs(bearing(kl, { lat: 13.14, lon: 101.69 }) - 0) < 0.5);
  assert.ok(Math.abs(distanceKm(kl, { lat: 4.14, lon: 101.69 }) - 111.2) < 1);
  const riau = { lat: 0.6, lon: 101.4, frp: 30 };
  const borneo = { lat: -1.8, lon: 113.5, frp: 50 };
  // South-west wind (blowing from 220°): Riau is upwind (bearing ~186°), Kalimantan is not.
  const s = hazeSources(kl, [riau, borneo], { windFromDeg: 200, windKmh: 15 });
  assert.equal(s.upwindCount, 1);
  assert.equal(s.regions[0].name, 'Riau (Sumatra)');
  assert.ok(s.regions[0].hours > 15 && s.regions[0].hours < 25);
  assert.equal(nearestRegion(borneo), 'Central Kalimantan');
  const csv = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n0.5,101.4,330,0.4,0.4,2026-10-21,0612,N,VIIRS,n,2.0NRT,290,12.5,D\n1,102,300,0.4,0.4,2026-10-21,0612,N,VIIRS,l,2.0NRT,290,3,D';
  const f = parseFirmsCsv(csv);
  assert.equal(f.length, 1);
  assert.equal(f[0].frp, 12.5);
});

test('Bahasa Melayu toggle translates text and keeps placeholders', () => {
  setLang('ms');
  assert.equal(tr('Air quality'), 'Kualiti udara');
  assert.equal(tr('Updated {time}', { time: '3:00 pm' }), 'Dikemas kini 3:00 pm');
  assert.equal(tr('Some text with no translation'), 'Some text with no translation');
  setLang('en');
  assert.equal(tr('Air quality'), 'Air quality');
  for (const [en, ms] of Object.entries(MS)) {
    const ph = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(ms), ph(en), `placeholders differ for "${en}"`);
  }
});


import { solarBudget } from '../src/lib/budget.js';
test('solar budget: spare solar, best hours and what it can run', () => {
  const pv = Array.from({ length: 24 }, (_, h) => (h >= 8 && h <= 17 ? 3 : 0));
  const load = new Array(24).fill(1);
  const exported = pv.map((p, h) => (h >= 11 && h <= 14 ? 2 : 0)); // 8 kWh spare, 11am–3pm
  const b = solarBudget({ pv, load, exported });
  assert.equal(b.spareKwh, 8);
  assert.equal(b.surplusKwh, 20); // 2 kWh over home use for 10 sunny hours
  assert.deepEqual(b.window, { start: 8, end: 18, kwh: 20 });
  assert.equal(b.madeKwh, 30);
  assert.equal(b.homeKwh, 10);
  assert.equal(b.batteryKwh, 12);
  assert.ok(b.picks.some((p) => p.key === 'wash'));
  assert.ok(b.picks.reduce((s, p) => s + p.kwh, 0) <= 20 + 1e-9);
  const withEv = solarBudget({ pv, load, exported, evSolar: pv.map((p) => (p ? 2 : 0)) });
  assert.equal(withEv.spareKwh, 0);
  assert.equal(withEv.surplusKwh, 0);
  assert.equal(withEv.picks.length, 0);
});

console.log(`\n${passed} tests passed`);
