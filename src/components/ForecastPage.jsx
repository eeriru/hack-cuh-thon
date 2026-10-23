import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPlaceData, addDays, todayMY, localDateOf } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { hourRanges } from '../lib/battery.js';
import LossBreakdown from './LossBreakdown.jsx';
import { weatherIcon, heatIndex, dewPoint, heatRisk, uvLevel, compass } from '../lib/weather.js';
import HazeScene3D from './HazeScene3D.jsx';
import { WeatherCard, AirCard, TempCurve, TomorrowCard, SidePanel } from './Dashboard.jsx';
import SolarForecast from './SolarForecast.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtDate, fmtTime } from './common.jsx';
import { InShort, Tip, More } from './Friendly.jsx';
import { solarSummary, weatherSummary } from '../lib/summary.js';
import { buildDays, homeFromSettings, dayHomeFor, planForDay, avgRate as avgRateOf } from '../lib/forecastDays.js';
import { tr } from '../lib/i18n.js';

const MAX_PAST = 85;
const MAX_AHEAD = 6; // a 7-day forecast (today + 6)


// One page for the weather and the solar forecast: weather right now, then the
// selected day's solar output, the day picker, and the details below.
export default function ForecastPage({ place, engine, settings, go }) {
  const today = todayMY();
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  useEffect(() => {
    setAnchor(today);
    setSelected(today);
  }, [place.lat, place.lon, today]);

  const startDate = addDays(anchor, -5) < addDays(today, -MAX_PAST) ? addDays(today, -MAX_PAST) : addDays(anchor, -5);
  const endDate = addDays(anchor, 6) > addDays(today, MAX_AHEAD) ? addDays(today, MAX_AHEAD) : addDays(anchor, 6);

  const { data, loading } = useAsync(() => getPlaceData(place, { startDate, endDate }), [place.lat, place.lon, startDate, endDate]);
  // "Weather now" and the next 24 hours always use the window around today, even when an
  // older date is picked. When today is picked this is the same request, so it is cached.
  const nowRange = { startDate: addDays(today, -5), endDate: addDays(today, MAX_AHEAD) };
  const nowQ = useAsync(() => getPlaceData(place, nowRange), [place.lat, place.lon, today]);

  const system = useMemo(() => ({ ...DEFAULT_SYSTEM, kwp: settings.kwp }), [settings.kwp]);
  const home = useMemo(() => homeFromSettings(settings), [settings]);

  const days = useMemo(() => buildDays(data, { engine, place, system, startDate, endDate }), [data, engine, place, system, startDate, endDate]);
  // Days around today for the dashboard (tomorrow card, coming days), whatever date is picked.
  const nowDays = useMemo(
    () => buildDays(nowQ.data, { engine, place, system, startDate: nowRange.startDate, endDate: nowRange.endDate }),
    [nowQ.data, engine, place, system, nowRange.startDate, nowRange.endDate]
  );

  const current = days.find((x) => x.d === selected) || days.find((x) => x.d === today) || days[days.length - 1];
  const dayHome = useMemo(() => (current ? dayHomeFor(home, current.d) : home), [home, current]);

  // Same calculation as the headline, for the 3D scene's haze slider: scale every hour's haze
  // so the day's average matches the slider, and rerun the solar model. At today's level it
  // returns exactly the headline figure.
  const shareForAod = useCallback(
    (aod) => {
      if (!current || !engine) return 1;
      const L0 = current.loss;
      if (L0.meanAod > 0 && Math.abs(aod - L0.meanAod) < 1e-6) return L0.kwhClean > 0 ? L0.kwhHaze / L0.kwhClean : 1;
      const k = L0.meanAod > 0 ? aod / L0.meanAod : 1;
      const hours = L0.rows.map((r) => ({
        t: r.t,
        localHour: r.localHour,
        aod: r.aod === null || r.aod === undefined ? null : r.aod * k,
        pm2_5: r.pm2_5 === null || r.pm2_5 === undefined ? null : r.pm2_5 * k,
        cloud_low: r.cloud_low,
        cloud_mid: r.cloud_mid,
        cloud_high: r.cloud_high,
        rh: r.rh,
        temp: r.temp,
      }));
      const L1 = computeHazeLoss(hours, { ...place, engine, system });
      return L1.kwhClean > 0 ? L1.kwhHaze / L1.kwhClean : 1;
    },
    [current, engine, place, system]
  );

  const plan = useMemo(() => (current ? planForDay(current, dayHome) : null), [current, dayHome]);


  const wxNow = useMemo(() => {
    const nd = nowQ.data;
    if (!nd) return null;
    const now = Date.now() / 1000;
    const next = nd.hours.filter((h) => h.t >= now - 1800).slice(0, 24);
    const todayDaily = (nd.daily || []).find((x) => localDateOf(x.t, nd.offsetSec) === today);
    const c = nd.current;
    const hi = heatIndex(c.temp, c.rh);
    return {
      c,
      next,
      todayDaily,
      offsetSec: nd.offsetSec,
      hi,
      risk: heatRisk(hi),
      dew: dewPoint(c.temp, c.rh),
      uv: uvLevel(c.uv),
      rainNext24: next.reduce((a, h) => a + (h.rain || 0), 0),
      maxChance: Math.max(0, ...next.map((h) => h.rain_chance ?? 0)),
    };
  }, [nowQ.data, today]);

  if (loading || !data || !engine || !wxNow) return <Loading text="Loading the weather and running the solar model…" />;
  if (!current) return <div className="card section">{tr('No data for this date. Try another date.')}</div>;

  const L = current.loss;
  const B = current.breakdown;
  // Solar per hour (kWh, hour ending at t) for the hour tiles.
  const nowKwh = new Map(nowDays.flatMap((x) => x.loss.rows.map((r) => [r.t, r.kwhHaze * (1 - x.soil.pct / 100)])));
  const isDayAt = (t) => {
    const hr = new Date((t + W.offsetSec) * 1000).getUTCHours();
    return hr >= 7 && hr < 19;
  };
  const dayWord = current.d === today ? tr('today') : current.d === addDays(today, 1) ? tr('tomorrow') : tr('on {date}', { date: fmtDate(current.d) });
  const isPast = current.d < today;
  const avgRate = avgRateOf(dayHome.tariff);

  const W = wxNow;
  const night = W.c.isDay === 0;
  const mood = night ? 'night' : (W.c.rain ?? 0) > 0.2 || W.c.weather_code >= 61 ? 'rain' : W.c.weather_code === 45 || (W.c.aod ?? 0) > 1 ? 'haze' : '';
  // Weather lines for "In short". The solar lines already name the best and weakest day,
  // so the weather summary is given no solar figures (avoids saying it twice).
  const weatherItems = weatherSummary({
    now: { temp: W.c.temp, feels: W.c.feels ?? W.hi, rh: W.c.rh, uv: W.c.uv, rainNext24: W.rainNext24 },
    heat: W.risk,
    days: days
      .filter((x) => x.d >= today && x.daily)
      .map((x) => ({
        label: x.d === today ? tr('Today') : fmtDate(x.d, { weekday: 'long' }),
        rain: x.daily.rain,
        rainChance: x.daily.rainChance,
        code: x.daily.weather_code,
        tmax: x.daily.tmax,
        solar: null,
      })),
  });

  return (
    <>
      <DemoBanner source={data.source} error={data.error} />
      <h1 className="sr-only">{tr('Weather & solar')}</h1>
      <InShort
        title={`${tr('In short')} · ${isPast ? fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' }) : current.d === today ? tr('today') : current.d === addDays(today, 1) ? tr('tomorrow') : fmtDate(current.d)}`}
        items={[...weatherItems, ...solarSummary({
          day: {
            label: dayWord,
            final: B.final,
            ideal: B.ideal,
            hazePct: L.lossPct,
            biggest: B.biggest,
            valueRm: B.final * avgRate,
          },
          days: days
            .filter((x) => x.d >= today)
            .map((x) => ({ label: x.d === today ? tr('today') : fmtDate(x.d, { weekday: 'long' }), final: x.breakdown.final })),
          dailyUse: home.dailyKwh,
          isPast,
          tip: plan && plan.flexWhy === 'sunniest' && !isPast ? tr('Laundry & water heater: {hours}', { hours: hourRanges(plan.flexHours) }) : null,
        })]}
      />



      <div className="dash section">
        <div className="dash-main">
          <div className="scene-row">
            <WeatherCard W={W} night={night} placeName={place.name} />
            <AirCard place={place} go={go} />
          </div>
          <div className="temp-row">
            <TempCurve hours={nowQ.data.hours} offsetSec={W.offsetSec} today={today} />
            <TomorrowCard day={nowDays.find((x) => x.d === addDays(today, 1))} today={today} go={go} />
          </div>
          <NextWeather hours={W.next} offsetSec={W.offsetSec} isDayAt={isDayAt} inDash />
        </div>
        <SidePanel
          W={W}
          uv={W.uv}
          days={nowDays}
          today={today}
          placeName={place.name}
          go={go}
          onPick={(d) => {
            setAnchor(today);
            setSelected(d);
            document.getElementById('solar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      </div>
      <p className="stamp small muted">
        {place.name} · {settings.kwp} kW {tr('solar')}
        <Tip term="kwp" label="What is kW / kWp?" /> · {tr('Updated {time}', { time: W.c.time ? fmtTime(W.c.time, W.offsetSec) : '—' })}
      </p>


      {W.hi !== null && W.hi >= 32 && (
        <div className="card section risk-card">
          <h2>🥵 {tr('Heat warning')}: {tr(W.risk.label).toLowerCase()}</h2>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>{tr(W.risk.advice)}</p>
        </div>
      )}



      <SolarForecast
        days={days}
        current={current}
        today={today}
        onSelect={setSelected}
        rate={avgRate}
        offsetSec={data.offsetSec}
        dateRange={{ min: addDays(today, -MAX_PAST), max: addDays(today, MAX_AHEAD), onDate: (d) => { setAnchor(d); setSelected(d); } }}
      />

      <NextSolar hours={W.next} hourKwh={nowKwh} offsetSec={W.offsetSec} isDayAt={isDayAt} />

      <div className="two-col section">
        <section className="card">
          <h2>
            🔍 {tr("What's reducing your solar?")}
            <Tip
              text={
                isPast
                  ? 'Start from the best possible day at the top; each row is something that takes power away. The yellow bar at the bottom is what you got.'
                  : "Start from the best possible day at the top; each row is something that takes power away. The yellow bar at the bottom is what you'll get."
              }
            />
          </h2>
          <LossBreakdown breakdown={B} soil={current.soil} />
          {!current.hazeForecast && <p className="small muted" style={{ marginTop: 10 }}>{tr('No haze forecast this far ahead, so normal haze is assumed for this day.')}</p>}
        </section>
        <section className="card">
          <h2>
            🏠 {current.d === today ? tr('Your roof today') : tr('Your roof on {date}', { date: fmtDate(current.d, { weekday: 'short', day: 'numeric', month: 'short' }) })}
            <Tip text="Drag to look around. Try different weather and haze levels to see how they dim the panels." />
          </h2>
          <HazeScene3D
            aod={L.meanAod}
            shareForAod={shareForAod}
            weatherCode={current.wx.code}
            kwh={B.final}
            label={`${fmtDate(current.d)} · ${place.name}`}
            signTitle={TOWNSHIPS.some((t) => t.name === place.name) ? place.name : null}
          />
        </section>
      </div>

      <More title="How these numbers are calculated" hint="Heat index, dew point, warnings, UV, rain and solar">
        <div className="card">
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--ink-2)' }}>
            <li><b>{tr('Heat index')}</b>: {tr('NOAA formula from temperature and humidity (how hot it feels in the shade).')}</li>
            <li><b>{tr('Dew point')}</b>: {tr('Magnus formula; above 24°C the air feels muggy.')}</li>
            <li><b>{tr('Heat warning')}</b>: {tr('NOAA heat-index bands (caution from 27°C, extreme caution from 32°C, danger from 41°C).')}</li>
            <li><b>UV</b>: {tr('WHO categories.')} <b>{tr('Rain')}</b>: {tr('daily totals (light <10 mm, heavy ≥30 mm).')}</li>
            <li><b>{tr('Solar per day')}</b>: {tr('weather, haze and dust go through the solar model, then the losses are split out in the breakdown above.')}</li>
          </ul>
        </div>
      </More>
    </>
  );
}

// Solar output hour by hour for the next 24 hours (daylight hours only), with a bar per hour.
// hourKwh is keyed by the hour's end time, as the solar model reports it.
function NextSolar({ hours, hourKwh, offsetSec, isDayAt }) {
  const rows = hours.map((h) => ({ h, kwh: hourKwh.get(h.t + 3600) ?? 0 })).filter((r) => r.kwh >= 0.05);
  const total = rows.reduce((t, r) => t + r.kwh, 0);
  const max = Math.max(0.1, ...rows.map((r) => r.kwh));
  return (
    <section className="card section">
      <div className="spread">
        <h2>☀ {tr('Solar output · next 24 hours')}</h2>
        {rows.length > 0 && <span className="badge soft">{tr('{kwh} kWh in total', { kwh: total.toFixed(1) })}</span>}
      </div>
      {rows.length ? (
        <div className="solar-hours" role="list">
          {rows.map(({ h, kwh }) => (
            <div key={h.t} className="sh-col" role="listitem">
              <b className="sh-v">{kwh.toFixed(1)}</b>
              <div className="sh-bar">
                <span style={{ height: `${Math.max(6, (kwh / max) * 100)}%` }} />
              </div>
              <span className="sh-ic" aria-hidden="true">{weatherIcon(h.weather_code, isDayAt(h.t))}</span>
              <small>{fmtTime(h.t, offsetSec, { hour: 'numeric' })}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">{tr('No sun in the next 24 hours.')}</p>
      )}
      <p className="small muted" style={{ margin: '8px 0 0' }}>{tr('kWh your panels make in each hour, after weather and haze.')}</p>
    </section>
  );
}

// Weather for each of the next 24 hours: icon, rain chance, temperature, wind and humidity.
function NextWeather({ hours, offsetSec, isDayAt, inDash = false }) {
  const has = (v) => v !== null && v !== undefined;
  return (
    <section className={inDash ? 'card' : 'card section'}>
      <h2>🌤 {tr('Weather · next 24 hours')}</h2>
      <div className="aq-hours wx-hours" role="list">
        {hours.map((h, i) => (
          <div key={h.t} className="aq-hour" role="listitem">
            <div className="ah-time">{i === 0 ? tr('Now') : fmtTime(h.t, offsetSec, { hour: 'numeric' })}</div>
            <div className="ah-ic" aria-hidden="true">{weatherIcon(h.weather_code, isDayAt(h.t))}</div>
            <div className="ah-rain">{has(h.rain_chance) && h.rain_chance >= 20 ? `${Math.round(h.rain_chance)}%` : ''}</div>
            {has(h.temp) && <div className="ah-temp">{Math.round(h.temp)}°</div>}
            {has(h.wind) && (
              <div className="ah-wind">
                {has(h.windDir) && (
                  <span className="ah-arrow" style={{ transform: `rotate(${h.windDir}deg)` }} aria-label={tr('Wind from {dir}', { dir: compass(h.windDir) })}>
                    ▼
                  </span>
                )}
                <b>{Math.round(h.wind)}</b>
                <small>km/h</small>
              </div>
            )}
            {has(h.rh) && (
              <div className="ah-rh">
                <span aria-hidden="true">💧</span>
                {Math.round(h.rh)}%
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
