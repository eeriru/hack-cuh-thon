import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlaceData, getSatelliteGhi, addDays, todayMY, localDateOf } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { hourRanges, fmtHour } from '../lib/battery.js';
import { SolarChart, SocChart } from './charts.jsx';
import LossBreakdown from './LossBreakdown.jsx';
import { systemFor, homeFor, homeForDay, isWeekend, avgRateOf, buildDays, planFor } from '../lib/days.js';
import { weatherIcon, WEATHER_TEXT, heatIndex, dewPoint, heatRisk, uvLevel, rainLevel, compass } from '../lib/weather.js';
import HazeScene3D from './HazeScene3D.jsx';
import AirNow from './AirNow.jsx';
import { WeatherChart } from './charts.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtDate, fmtTime } from './common.jsx';
import { InShort, Tip, More } from './Friendly.jsx';
import { solarSummary, weatherSummary } from '../lib/summary.js';
import { tr } from '../lib/i18n.js';

const MAX_PAST = 85;
const MAX_AHEAD = 6; // a 7-day forecast (today + 6)

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d));
const has = (v) => v !== null && v !== undefined;

const Stat = ({ k, v, unit, sub, tone, tip }) => (
  <div className="stat">
    <div className="k">
      {tr(k)}
      {tip && <Tip term={tip} />}
    </div>
    <div className="v">
      {v}
      {unit && <small>{unit}</small>}
    </div>
    {sub && <div className={`small ${tone ? `tone-${tone}` : 'muted'}`}>{sub}</div>}
  </div>
);

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
  const sat = useAsync(
    () => (selected <= today && data?.source === 'live' ? getSatelliteGhi(place, { startDate: selected, endDate: selected }) : Promise.resolve(new Map())),
    [place.lat, place.lon, selected, data?.source]
  );

  const system = useMemo(() => systemFor(settings), [settings]);
  const home = useMemo(() => homeFor(settings), [settings]);

  const days = useMemo(() => buildDays(data, { engine, place, system, startDate, endDate }), [data, engine, place, system, startDate, endDate]);

  const current = days.find((x) => x.d === selected) || days.find((x) => x.d === today) || days[days.length - 1];
  const weekend = current ? isWeekend(current.d) : false;
  const dayHome = useMemo(() => (current ? homeForDay(home, current.d) : home), [home, current]);
  const barRef = useRef(null);
  useEffect(() => {
    const el = barRef.current?.querySelector('.datebtn.active');
    if (el && barRef.current) barRef.current.scrollLeft = el.offsetLeft - barRef.current.offsetLeft - 40;
  }, [current?.d, days.length]);

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

  const plan = useMemo(() => planFor(current, dayHome), [current, dayHome]);

  const validation = useMemo(() => {
    const m = sat.data;
    if (!current || !m || m.size === 0) return null;
    const pts = current.loss.rows.filter((r) => r.clearGhi > 100 && m.has(r.t));
    if (pts.length < 4) return null;
    const mae = (k) => pts.reduce((s, r) => s + Math.abs(r[k] - m.get(r.t)), 0) / pts.length;
    const actual = pts.reduce((s, r) => s + m.get(r.t), 0);
    const withHaze = pts.reduce((s, r) => s + r.ghiHaze, 0);
    const noHaze = pts.reduce((s, r) => s + r.ghiClean, 0);
    return { n: pts.length, maeHaze: mae('ghiHaze'), maeClean: mae('ghiClean'), biasPct: ((withHaze - actual) / actual) * 100, noHazeBiasPct: ((noHaze - actual) / actual) * 100 };
  }, [sat.data, current]);

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
  const dayWord = current.d === today ? tr('today') : current.d === addDays(today, 1) ? tr('tomorrow') : tr('on {date}', { date: fmtDate(current.d) });
  const isPast = current.d < today;
  const maxOut = Math.max(1, ...days.map((x) => x.breakdown.final));
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
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>{tr('Weather & solar')}</h1>
        <span className="sub">
          {place.name} · {place.area} · {tr('solar for a {kwp} kW rooftop', { kwp: settings.kwp })}
          <Tip term="kwp" label="What is kW / kWp?" />
        </span>
        <button className="chip" onClick={() => go('planner')}>⚙ {tr('My home')}</button>
        <span className="stamp">{tr('Updated {time} local time', { time: W.c.time ? fmtTime(W.c.time, W.offsetSec) : '—' })}</span>
      </div>

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
          tip:
            plan && plan.flexWhy === 'sunniest' && !isPast
              ? tr('Tip: run the washing machine and water heater {hours}, the sunniest hours.', { hours: hourRanges(plan.flexHours) })
              : null,
        })]}
      />

      <section className="wx-hero section" aria-label={tr('Weather now')}>
        <div className={`wx-now ${mood}`}>
          <span className="label">{tr('Weather now')}</span>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="temp">
              {fmt(W.c.temp)}
              <small>°C</small>
            </span>
            <span style={{ fontSize: 54 }} aria-hidden="true">{weatherIcon(W.c.weather_code, !night)}</span>
          </div>
          <span className="cond">{tr(WEATHER_TEXT[W.c.weather_code]) || '—'}</span>
          <span className="feels">
            {tr('Feels like')} {fmt(W.c.feels ?? W.hi)}°C<Tip term="feelsLike" />
            {W.todayDaily ? ` · ${tr('today')} ${fmt(W.todayDaily.tmin)}–${fmt(W.todayDaily.tmax)}°C` : ''}
          </span>
        </div>
        <div className="wx-stats">
          <Stat k="Heat index" tip="heatIndex" v={fmt(W.hi)} unit="°C" sub={tr(W.risk.label)} tone={W.risk.tone} />
          <Stat k="Humidity" tip="dewPoint" v={fmt(W.c.rh)} unit="%" sub={W.dew !== null ? `${tr('Dew point')} ${fmt(W.dew)}°C${W.dew >= 24 ? ` · ${tr('muggy')}` : ''}` : null} />
          <Stat k="UV index" tip="uv" v={fmt(W.c.uv, 1)} sub={tr(W.uv.label)} tone={W.uv.tone} />
          <Stat k="Wind" v={fmt(W.c.wind)} unit="km/h" sub={`${compass(W.c.windDir)}${W.c.gust ? ` · ${tr('gusts')} ${fmt(W.c.gust)} km/h` : ''}`} />
          <Stat k="Rain next 24 h" tip="rainChance" v={fmt(W.rainNext24, 1)} unit="mm" sub={tr('Up to {pct}% chance', { pct: Math.round(W.maxChance) })} />
          <Stat k="Cloud cover" v={fmt(W.c.cloud)} unit="%" sub={W.todayDaily?.sunset ? `${tr('Sunset')} ${fmtTime(W.todayDaily.sunset, W.offsetSec)}` : null} />
        </div>
      </section>

      {W.hi !== null && W.hi >= 32 && (
        <div className="card section risk-card">
          <h2>{tr('Heat warning')}: {tr(W.risk.label).toLowerCase()}</h2>
          <p className="lede" style={{ margin: 0, color: 'var(--ink-2)' }}>
            {tr('With {rh}% humidity, {temp}°C feels like {hi}°C.', { rh: fmt(W.c.rh), temp: fmt(W.c.temp), hi: fmt(W.hi) })} {tr(W.risk.advice)}
          </p>
        </div>
      )}

      <AirNow place={place} go={go} />

      <section className="headline section">
        <div>
          <div className="eyebrow">{isPast ? tr('Replay') : tr('Forecast')} · {fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2>
            {isPast ? tr('Your panels made') : tr('Your panels will make')} <em>{B.final.toFixed(1)} kWh</em> {dayWord}.
          </h2>
          <div className="gauge-row">
            <Gauge pct={B.performancePct} label={tr('of the ideal')} />
            <div className="pills">
              <span className="pill">💰 RM {(B.final * avgRate).toFixed(2)}<Tip term="kwh" label="What is a kWh?" /></span>
              <span className="pill">📉 {tr('Biggest loss')}: <b>{tr(B.biggest.label).toLowerCase()}</b></span>
              <span className="pill">🌫 {L.lossPct >= 1 ? `${tr('haze')} −${L.lossPct.toFixed(0)}%` : tr('no haze')}<Tip term="ideal" label="What is ideal output?" /></span>
            </div>
          </div>
        </div>
        <div className="headline-stats">
          <div className="hs">
            <div className="k">{tr('Solar output')}</div>
            <div className="v">
              {B.final.toFixed(1)}
              <small>kWh</small>
            </div>
          </div>
          <div className="hs">
            <div className="k">
              {tr('Lost to haze')}
              <Tip term="hazeLoss" label="How is haze loss measured?" />
            </div>
            <div className="v">
              {L.lossKwh.toFixed(1)}
              <small>kWh · {L.lossPct.toFixed(0)}%</small>
            </div>
            {plan && (
              <div className="k">
                {plan.hazeCostRm >= 0.01 ? tr('Adds RM {rm} to your bill', { rm: plan.hazeCostRm.toFixed(2) }) : tr('No extra cost on your bill today')}
              </div>
            )}
          </div>
          <div className="hs">
            <div className="k">{tr('Weather')}</div>
            <div className="v" style={{ fontSize: 18 }}>
              {weatherIcon(current.wx.code)} {tr(WEATHER_TEXT[current.wx.code]) || '—'}
            </div>
            <div className="k">
              {current.wx.tmax !== null ? `${Math.round(current.wx.tmax)}°C ${tr('max')}` : ''}
              {current.wx.rain !== null ? ` · ${current.wx.rain.toFixed(1)} mm ${tr('rain')}` : ''}
            </div>
          </div>
          <div className="hs">
            <div className="k">{tr('Cloud cover (daylight)')}</div>
            <div className="v">
              {Math.round(L.meanCloud)}
              <small>%</small>
            </div>
          </div>
        </div>
      </section>

      <div className="card section">
        <div className="spread">
          <div>
            <h2>{tr('7-day weather & solar')}</h2>
            <p className="lede">
              {tr('Tap a day. Longer bar = more solar.')}
              <Tip text="Past days replay real readings; future days use the weather and haze forecast." />
            </p>
          </div>
          <label className="field" style={{ minWidth: 190 }}>
            <label htmlFor="jump">{tr('Jump to a date')}</label>
            <input
              id="jump"
              type="date"
              min={addDays(today, -MAX_PAST)}
              max={addDays(today, MAX_AHEAD)}
              value={current.d}
              onChange={(e) => {
                if (!e.target.value) return;
                setAnchor(e.target.value);
                setSelected(e.target.value);
              }}
            />
          </label>
        </div>
        <div className="datebar" role="tablist" ref={barRef}>
          {days.map(({ d, loss, breakdown, wx, daily }) => (
            <button key={d} role="tab" aria-selected={d === current.d} className={`datebtn ${d === current.d ? 'active' : ''}`} onClick={() => setSelected(d)}>
              <div className="d">
                {d === today ? tr('Today') : fmtDate(d)} <span aria-hidden="true">{weatherIcon(wx.code)}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${(breakdown.final / maxOut) * 100}%`, background: 'var(--sun)' }} />
              </div>
              <div className="p">
                {breakdown.final.toFixed(1)}
                <small> kWh</small>
              </div>
              <div className="small muted">
                {has(wx.tmax) ? `${Math.round(wx.tmax)}°` : ''}
                {has(daily?.tmin) ? ` / ${Math.round(daily.tmin)}°` : ''}
                {has(wx.tmax) ? ' · ' : ''}
                {loss.lossPct >= 0.5 ? `${tr('haze')} −${loss.lossPct.toFixed(0)}%` : tr('no haze')}
                {wx.rain >= 0.5 ? ` · ${tr('rain')} ${wx.rain.toFixed(0)} mm` : ''}
              </div>
            </button>
          ))}
        </div>
        {current.daily && <DayWeather daily={current.daily} offsetSec={data.offsetSec} label={fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' })} />}
      </div>

      <div className="card section">
        <h2>{tr('Next 24 hours')}</h2>
        <div className="legend" style={{ margin: '0 0 8px' }}>
          <span>🌡 {tr('Temperature')}</span>
          <span>┄ {tr('Feels like')}</span>
          <span>💧 {tr('Rain')}</span>
        </div>
        <WeatherChart
          rows={W.next.map((h) => ({
            t: h.t,
            temp: h.temp,
            feels: h.feels ?? heatIndex(h.temp, h.rh),
            rain: h.rain,
            rainChance: h.rain_chance,
            label: fmtTime(h.t, W.offsetSec, { hour: 'numeric' }),
            sub: fmtTime(h.t, W.offsetSec, { weekday: 'short', hour: 'numeric' }),
          }))}
        />
      </div>

      <div className="card section">
        <h2>{tr("What's reducing your solar?")}</h2>
        <p className="lede">☀ {tr('Best possible')} → ➖ {tr('losses')} → <b style={{ color: 'var(--sun-deep)' }}>{tr(isPast ? 'what you got' : "what you'll get")}</b></p>
        <LossBreakdown breakdown={B} soil={current.soil} />
        {!current.hazeForecast && (
          <p className="small muted" style={{ marginTop: 10 }}>
            {tr('No haze forecast this far ahead, so normal haze is assumed for this day.')}
          </p>
        )}
      </div>

      <div className="card section">
        <h2>{tr('See the haze over your roof')}</h2>
        <p className="lede">👆 {tr('Drag to look around · slide to thicken the haze')}</p>
        <HazeScene3D
          aod={L.meanAod}
          shareForAod={shareForAod}
          label={`${fmtDate(current.d)} · ${place.name}`}
          signTitle={TOWNSHIPS.some((t) => t.name === place.name) ? place.name : null}
        />
      </div>

      {plan && <PlanCard plan={plan} home={dayHome} isPast={isPast} weekend={weekend && home.tariff.mode === 'tou'} />}

      <More title="Hour-by-hour sunlight" hint="See exactly when the haze takes power, and check against satellite measurements">
      <div className="card">
        <p className="lede">{tr('The hatched band is the sunlight the haze took away. Hover for the inputs the model used each hour.')}</p>
        <SolarChart rows={L.rows} satellite={sat.data} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--sun-deep)', height: 0 }} />{tr('Without haze (run B)')}</span>
          <span><i style={{ background: '#fbd98a' }} />{tr('With haze (run A)')}</span>
          <span><i style={{ background: '#f6c3a8', boxShadow: 'inset 0 0 0 2px #e0703e' }} />{tr('Lost to haze')}</span>
          {sat.data?.size > 0 && <span><i style={{ background: 'var(--sky)', borderRadius: 99, width: 10 }} />{tr('Measured by Himawari satellite')}</span>}
        </div>
        {validation && (
          <p className="small" style={{ marginTop: 12 }}>
            <b>{tr('Reality check:')}</b>{' '}
            {tr(
              'over {n} daylight hours, the haze-aware prediction was off by {mae} W/m² on average against satellite measurements, versus {mae0} W/m² if haze were ignored. Total sunlight {dir}-estimated by {bias}% (ignoring haze: {dir0} by {bias0}%). Cloud forecasts are the biggest source of error on any single day.',
              {
                n: validation.n,
                mae: Math.round(validation.maeHaze),
                mae0: Math.round(validation.maeClean),
                dir: tr(validation.biasPct >= 0 ? 'over' : 'under'),
                bias: Math.abs(validation.biasPct).toFixed(0),
                dir0: tr(validation.noHazeBiasPct >= 0 ? 'over' : 'under'),
                bias0: Math.abs(validation.noHazeBiasPct).toFixed(0),
              }
            )}
          </p>
        )}
      </div>
      </More>

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

// Ring showing a percentage, for "how close to the ideal day".
export function Gauge({ pct, label, size = 92 }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="gauge" style={{ width: size }}>
      <svg viewBox="0 0 92 92" width={size} height={size} aria-hidden="true">
        <circle cx="46" cy="46" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--sun)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 46 46)" />
        <text x="46" y="52" textAnchor="middle" className="gauge-num">{Math.round(p)}%</text>
      </svg>
      <div className="gauge-k">{label}</div>
    </div>
  );
}

function DayWeather({ daily: d, offsetSec, label }) {
  const rl = rainLevel(d.rain);
  const ul = uvLevel(d.uvMax);
  return (
    <div className="day-wx" aria-label={tr('Weather for {day}', { day: label })}>
      <div className="day-wx-head">
        <span className="ic" aria-hidden="true">{weatherIcon(d.weather_code)}</span>
        <div>
          <div className="small muted">{label}</div>
          <b>{tr(WEATHER_TEXT[d.weather_code]) || '—'}</b>
        </div>
      </div>
      <div className="day-wx-stats">
        <span><b>{fmt(d.tmax)}° / {fmt(d.tmin)}°</b>{has(d.feelsMax) ? ` · ${tr('feels')} ${fmt(d.feelsMax)}°` : ''}</span>
        <span className={`tone-${rl.tone}`}>💧 {fmt(d.rain, 1)} mm{has(d.rainChance) ? ` · ${Math.round(d.rainChance)}%` : ''}</span>
        <span>UV {fmt(d.uvMax)} <span className={`tone-${ul.tone}`}>{tr(ul.label)}</span></span>
        <span>{tr('Wind')} {fmt(d.windMax)} km/h {compass(d.windDir)}</span>
        {has(d.sunshineSec) && <span>☀ {tr('{h} h sunshine', { h: fmt(d.sunshineSec / 3600, 1) })}</span>}
        {d.sunrise && d.sunset && <span>🌅 {fmtTime(d.sunrise, offsetSec)} – {fmtTime(d.sunset, offsetSec)}</span>}
      </div>
    </div>
  );
}

function PlanCard({ plan, home, isPast, weekend }) {
  const tou = home.tariff.mode === 'tou';
  const s = plan.standard;
  const h = plan.hazeAware;
  const steps = [];
  if (plan.flexWhy === 'sunniest') steps.push(tr('Run the washing machine, dryer and water heater {hours} — the sunniest hours left after the haze.', { hours: hourRanges(plan.flexHours) }));
  else if (plan.flexWhy === 'offpeak') steps.push(tr('Solar is too weak to cover chores today — run them after {hour} at the off-peak rate.', { hour: fmtHour(home.tariff.peakEnd) }));
  else steps.push(tr('Keep chores at the usual time ({hours}); moving them would not save money today.', { hours: hourRanges(plan.flexHours) }));
  if (plan.reserve) steps.push(tr('Save the battery for the {from}–{to} peak instead of draining it in the morning.', { from: fmtHour(home.tariff.peakStart), to: fmtHour(home.tariff.peakEnd) }));
  if (plan.topUpKwh > 0.05) steps.push(tr('Haze means the battery will not fill from solar alone: top it up with {kwh} kWh from the grid between 2am and 6am at the off-peak rate.', { kwh: plan.topUpKwh.toFixed(1) }));
  if (!plan.reserve && plan.topUpKwh <= 0.05 && tou) steps.push(tr('Let the battery cover demand whenever solar falls short — no reserve needed today.'));

  return (
    <div className="card section">
      <h2>
        {tr('Save money with a smarter day')} {isPast ? tr('(what would have helped)') : ''}
        <Tip term="battery" />
      </h2>
      <p className="lede">
        {tr('Normal day vs our plan')}
        <Tip text="We replay the day hour by hour with your predicted (hazy) solar output and try every combination of chore timing, battery reserve and off-peak top-up, keeping the cheapest. Household demand is simulated from a typical Malaysian terrace home." />
        {weekend && ` · ${tr('Weekend: time-of-use is off-peak all day.')}`}
      </p>
      <div className="plan-cols">
        <div className="plan">
          <h3>{tr('Standard day')}</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh {tr('from the grid')} · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            <li>{tr('Chores at {hours}', { hours: hourRanges(plan.usualHours) })}</li>
            <li>{tr('Battery empties whenever solar falls short')}</li>
          </ul>
        </div>
        <div className="plan smart">
          <h3>☀ {tr('Haze-aware plan')}</h3>
          <div className="big">RM {h.costRm.toFixed(2)}</div>
          <div className="small muted">
            {h.gridKwh.toFixed(1)} kWh {tr('from the grid')} · {h.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            {steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v">RM {plan.savingRm.toFixed(2)}</div>
          <div className="k">{tr('Saved today · ~RM {m}/month at this rate', { m: (plan.savingRm * 30).toFixed(0) })}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.gridSavedKwh >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {plan.gridSavedKwh >= 0 ? '' : '+'}
            {Math.abs(plan.gridSavedKwh).toFixed(1)} kWh
          </div>
          <div className="k">{plan.gridSavedKwh >= 0 ? tr('Less grid power') : tr('More grid power (cheaper hours)')}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.co2SavedKg >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {Math.abs(plan.co2SavedKg).toFixed(1)} kg
          </div>
          <div className="k">CO₂ {plan.co2SavedKg >= 0 ? tr('avoided') : tr('added')}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>{tr('Haze-aware schedule')}</div>
        <div className="timeline" aria-label={tr('24-hour schedule')}>
          {Array.from({ length: 24 }, (_, hr) => {
            const peak = tou && hr >= home.tariff.peakStart && hr < home.tariff.peakEnd;
            const flex = plan.flexHours.includes(hr);
            const top = (plan.gridChargeKwh?.[hr] || 0) > 0;
            return (
              <div
                key={hr}
                className={`${peak ? 'peak' : ''} ${flex ? 'flex' : ''} ${top ? 'topup' : ''}`}
                title={`${fmtHour(hr)}${flex ? ` · ${tr('run chores')}` : ''}${top ? ` · ${tr('grid top-up')}` : ''}${peak ? ` · ${tr('peak rate')}` : ''}`}
              />
            );
          })}
        </div>
        <div className="timeline-axis">
          {Array.from({ length: 24 }, (_, hr) => (
            <span key={hr}>{hr % 3 === 0 ? fmtHour(hr) : ''}</span>
          ))}
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--sun)' }} />{tr('Run chores')}</span>
          {plan.topUpKwh > 0.05 && <span><i style={{ background: 'var(--sky)' }} />{tr('Grid top-up')}</span>}
          {tou && <span><i style={{ background: 'var(--paper-2)', boxShadow: 'inset 0 -3px 0 #c9b9a0' }} />{tr('Peak rate')}</span>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>{tr('Battery charge through the day')}</div>
        <SocChart standard={s.soc} smart={h.soc} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--ink-3)', height: 0 }} />{tr('Standard')}</span>
          <span><i style={{ background: 'var(--sun-deep)', height: 3 }} />{tr('Haze-aware')}</span>
        </div>
      </div>
    </div>
  );
}
