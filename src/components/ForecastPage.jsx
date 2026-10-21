import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlaceData, getSatelliteGhi, addDays, todayMY, dayModelHours, availableDates, localDateOf } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { planDay, hourRanges, fmtHour } from '../lib/battery.js';
import { hazeLevel } from '../lib/aqi.js';
import { SolarChart, SocChart } from './charts.jsx';
import LossBreakdown from './LossBreakdown.jsx';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { rainByDate, weatherIcon, WEATHER_TEXT, heatIndex, dewPoint, heatRisk, uvLevel, rainLevel, compass } from '../lib/weather.js';
import HazeScene3D from './HazeScene3D.jsx';
import AirNow from './AirNow.jsx';
import { WeatherChart } from './charts.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtDate, fmtTime } from './common.jsx';
import { InShort, Tip, More } from './Friendly.jsx';
import { solarSummary, weatherSummary } from '../lib/summary.js';

const MAX_PAST = 85;
const MAX_AHEAD = 6; // a 7-day forecast (today + 6)

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d));
const has = (v) => v !== null && v !== undefined;

const Stat = ({ k, v, unit, sub, tone, tip }) => (
  <div className="stat">
    <div className="k">
      {k}
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
export default function ForecastPage({ place, engine, settings, setSettings, go }) {
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

  const system = useMemo(() => ({ ...DEFAULT_SYSTEM, kwp: settings.kwp }), [settings.kwp]);
  const home = useMemo(
    () => ({
      ...settings.home,
      battery: { ...settings.home.battery, capacityKwh: settings.batteryKwh, powerKw: Math.max(2.5, settings.batteryKwh / 2) },
      dailyKwh: settings.dailyKwh,
    }),
    [settings]
  );

  const days = useMemo(() => {
    if (!data || !engine) return [];
    return availableDates(data)
      .filter((d) => d >= startDate && d <= endDate)
      .map((d) => {
        const loss = computeHazeLoss(dayModelHours(data, d), { ...place, engine, system });
        const soil = soilingForDate(data, d);
        const breakdown = lossBreakdown(loss, { system, soilingPct: soil.pct });
        const daily = (data.daily || []).find((x) => new Date((x.t + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
        const dayHours = data.hours.filter((h) => new Date((h.t - 1 + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
        const temps = dayHours.map((h) => h.temp).filter((x) => x !== null && x !== undefined);
        const hazeForecast = loss.rows.some((r) => r.clearGhi > 50 && r.aod !== null && r.aod !== undefined);
        return {
          d,
          loss,
          soil,
          breakdown,
          hazeForecast,
          daily,
          wx: {
            code: daily?.weather_code ?? null,
            rain: daily?.rain ?? rainByDate(dayHours, data.offsetSec).get(d) ?? null,
            rainChance: daily?.rainChance ?? null,
            tmax: daily?.tmax ?? (temps.length ? Math.max(...temps) : null),
          },
        };
      })
      .filter((x) => x.loss.rows.length >= 20);
  }, [data, engine, place, system, startDate, endDate]);

  const current = days.find((x) => x.d === selected) || days.find((x) => x.d === today) || days[days.length - 1];
  const weekend = current ? [0, 6].includes(new Date(`${current.d}T00:00:00Z`).getUTCDay()) : false;
  // Time-of-use peak pricing applies on weekdays only; weekends are off-peak all day.
  const dayHome = useMemo(
    () => (weekend && home.tariff.mode === 'tou' ? { ...home, tariff: { ...home.tariff, mode: 'flat', flatRate: home.tariff.offPeakRate } } : home),
    [home, weekend]
  );
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

  const plan = useMemo(() => {
    if (!current) return null;
    const pv = new Array(24).fill(0);
    const pvClean = new Array(24).fill(0);
    const pm = new Array(24).fill(0);
    const keep = 1 - current.soil.pct / 100; // dust on the panels
    current.loss.rows.forEach((r) => {
      pv[r.localHour] = r.kwhHaze * keep;
      pvClean[r.localHour] = r.kwhClean * keep;
      pm[r.localHour] = r.pm2_5 ?? 0;
    });
    const p = planDay(pv, pm, dayHome);
    // Same day, same household, but the sunlight the haze took away is given back.
    p.hazeCostRm = Math.max(0, p.hazeAware.costRm - planDay(pvClean, pm, dayHome).hazeAware.costRm);
    const t = dayHome.tariff;
    p.lossValueRm = current.loss.lossKwh * (t.mode === 'flat' ? t.flatRate : (t.peakRate + t.offPeakRate) / 2);
    return p;
  }, [current, dayHome]);

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
  if (!current) return <div className="card section">No data for this date. Try another date.</div>;

  const L = current.loss;
  const B = current.breakdown;
  const haze = hazeLevel(L.meanAod);
  const dayWord = current.d === today ? 'today' : current.d === addDays(today, 1) ? 'tomorrow' : `on ${fmtDate(current.d)}`;
  const isPast = current.d < today;
  const maxOut = Math.max(1, ...days.map((x) => x.breakdown.final));
  const t = dayHome.tariff;
  const avgRate = t.mode === 'flat' ? t.flatRate : (t.peakRate + t.offPeakRate) / 2;

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
        label: x.d === today ? 'Today' : fmtDate(x.d, { weekday: 'long' }),
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
        <h1>Weather & solar</h1>
        <span className="sub">
          {place.name} · {place.area} · solar for a {settings.kwp} kW rooftop
          <Tip term="kwp" label="What is kW / kWp?" />
        </span>
        <span className="stamp">Updated {W.c.time ? fmtTime(W.c.time, W.offsetSec) : '—'} local time</span>
      </div>

      <InShort
        title={`In short · ${isPast ? fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' }) : dayWord === 'today' ? 'today' : dayWord.replace(/^on /, '')}`}
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
            .map((x) => ({ label: x.d === today ? 'today' : fmtDate(x.d, { weekday: 'long' }), final: x.breakdown.final })),
          dailyUse: home.dailyKwh,
          isPast,
          tip:
            plan && plan.flexWhy === 'sunniest' && !isPast
              ? `Tip: run the washing machine and water heater ${hourRanges(plan.flexHours)}, the sunniest hours.`
              : null,
        })]}
      />

      <section className="wx-hero section" aria-label="Weather now">
        <div className={`wx-now ${mood}`}>
          <span className="label">Weather now</span>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="temp">
              {fmt(W.c.temp)}
              <small>°C</small>
            </span>
            <span style={{ fontSize: 54 }} aria-hidden="true">{weatherIcon(W.c.weather_code, !night)}</span>
          </div>
          <span className="cond">{WEATHER_TEXT[W.c.weather_code] || '—'}</span>
          <span className="feels">
            Feels like {fmt(W.c.feels ?? W.hi)}°C<Tip term="feelsLike" />
            {W.todayDaily ? ` · today ${fmt(W.todayDaily.tmin)}–${fmt(W.todayDaily.tmax)}°C` : ''}
          </span>
        </div>
        <div className="wx-stats">
          <Stat k="Heat index" tip="heatIndex" v={fmt(W.hi)} unit="°C" sub={W.risk.label} tone={W.risk.tone} />
          <Stat k="Humidity" tip="dewPoint" v={fmt(W.c.rh)} unit="%" sub={W.dew !== null ? `Dew point ${fmt(W.dew)}°C${W.dew >= 24 ? ' · muggy' : ''}` : null} />
          <Stat k="UV index" tip="uv" v={fmt(W.c.uv, 1)} sub={W.uv.label} tone={W.uv.tone} />
          <Stat k="Wind" v={fmt(W.c.wind)} unit="km/h" sub={`${compass(W.c.windDir)}${W.c.gust ? ` · gusts ${fmt(W.c.gust)} km/h` : ''}`} />
          <Stat k="Rain next 24 h" tip="rainChance" v={fmt(W.rainNext24, 1)} unit="mm" sub={`Up to ${Math.round(W.maxChance)}% chance`} />
          <Stat k="Cloud cover" v={fmt(W.c.cloud)} unit="%" sub={W.todayDaily?.sunset ? `Sunset ${fmtTime(W.todayDaily.sunset, W.offsetSec)}` : null} />
        </div>
      </section>

      {W.hi !== null && W.hi >= 32 && (
        <div className="card section risk-card">
          <h2>Heat warning: {W.risk.label.toLowerCase()}</h2>
          <p className="lede" style={{ margin: 0, color: 'var(--ink-2)' }}>
            With {fmt(W.c.rh)}% humidity, {fmt(W.c.temp)}°C feels like {fmt(W.hi)}°C. {W.risk.advice}
          </p>
        </div>
      )}

      <AirNow place={place} go={go} />

      <section className="headline section">
        <div>
          <div className="eyebrow">{isPast ? 'Replay' : 'Forecast'} · {fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2>
            Your panels {isPast ? 'made' : 'will make'} <em>{B.final.toFixed(1)} kWh</em> {dayWord}.
          </h2>
          <p>
            That's {B.performancePct.toFixed(0)}% of the ideal
            <Tip term="ideal" label="What is ideal output?" /> and worth about RM {(B.final * avgRate).toFixed(2)} of electricity
            <Tip term="kwh" label="What is a kWh?" />. The biggest loss is <b style={{ color: 'var(--paper)' }}>{B.biggest.label.toLowerCase()}</b>
            {L.lossPct >= 1 ? `; haze ${isPast ? 'took' : 'takes'} ${L.lossPct.toFixed(0)}%` : '; haze is barely a factor'}.
          </p>
        </div>
        <div className="headline-stats">
          <div className="hs">
            <div className="k">Solar output</div>
            <div className="v">
              {B.final.toFixed(1)}
              <small>kWh</small>
            </div>
          </div>
          <div className="hs">
            <div className="k">
              Lost to haze
              <Tip term="hazeLoss" label="How is haze loss measured?" />
            </div>
            <div className="v">
              {L.lossKwh.toFixed(1)}
              <small>kWh · {L.lossPct.toFixed(0)}%</small>
            </div>
            {plan && (
              <div className="k">
                {plan.hazeCostRm >= 0.01 ? `Adds RM ${plan.hazeCostRm.toFixed(2)} to your bill` : 'No extra cost on your bill today'}
              </div>
            )}
          </div>
          <div className="hs">
            <div className="k">Weather</div>
            <div className="v" style={{ fontSize: 18 }}>
              {weatherIcon(current.wx.code)} {WEATHER_TEXT[current.wx.code] || '—'}
            </div>
            <div className="k">
              {current.wx.tmax !== null ? `${Math.round(current.wx.tmax)}°C max` : ''}
              {current.wx.rain !== null ? ` · ${current.wx.rain.toFixed(1)} mm rain` : ''}
            </div>
          </div>
          <div className="hs">
            <div className="k">Cloud cover (daylight)</div>
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
            <h2>7-day weather & solar</h2>
            <p className="lede">
              Pick a day to see its weather and solar output. Bar = expected output. Past days replay real readings; future days use the weather
              and haze forecast.
              <Tip term="kwh" label="What is a kWh?" />
            </p>
          </div>
          <label className="field" style={{ minWidth: 190 }}>
            <label htmlFor="jump">Jump to a date</label>
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
                {d === today ? 'Today' : fmtDate(d)} <span aria-hidden="true">{weatherIcon(wx.code)}</span>
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
                {loss.lossPct >= 0.5 ? `haze −${loss.lossPct.toFixed(0)}%` : 'no haze'}
                {wx.rain >= 0.5 ? ` · rain ${wx.rain.toFixed(0)} mm` : ''}
              </div>
            </button>
          ))}
        </div>
        {current.daily && <DayWeather daily={current.daily} offsetSec={data.offsetSec} label={fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' })} />}
      </div>

      <div className="card section">
        <h2>Next 24 hours</h2>
        <p className="lede">Temperature (solid), feels-like (dashed) and rain (bars). Hover for details.</p>
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
        <h2>What's reducing your solar?</h2>
        <p className="lede">
          Start from the best possible day at the top; each row is something that takes power away. The yellow bar at the bottom is what you
          {isPast ? ' got' : "'ll get"}.
        </p>
        <LossBreakdown breakdown={B} soil={current.soil} />
        {!current.hazeForecast && (
          <p className="small muted" style={{ marginTop: 10 }}>
            No haze forecast this far ahead, so normal haze is assumed for this day.
          </p>
        )}
      </div>

      <div className="card section">
        <h2>See the haze over your roof</h2>
        <p className="lede">
          A 3D view of terrace homes at {isPast ? 'the' : "the forecast"} haze level for {fmtDate(current.d)}. Drag to look around, or move the
          slider to see how thicker haze dims the panels.
        </p>
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
        <p className="lede">The hatched band is the sunlight the haze took away. Hover for the inputs the model used each hour.</p>
        <SolarChart rows={L.rows} satellite={sat.data} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--sun-deep)', height: 0 }} />Without haze (run B)</span>
          <span><i style={{ background: '#fbd98a' }} />With haze (run A)</span>
          <span><i style={{ background: '#f6c3a8', boxShadow: 'inset 0 0 0 2px #e0703e' }} />Lost to haze</span>
          {sat.data?.size > 0 && <span><i style={{ background: 'var(--sky)', borderRadius: 99, width: 10 }} />Measured by Himawari satellite</span>}
        </div>
        {validation && (
          <p className="small" style={{ marginTop: 12 }}>
            <b>Reality check:</b> over {validation.n} daylight hours, the haze-aware prediction was off by{' '}
            {Math.round(validation.maeHaze)} W/m² on average against satellite measurements, versus {Math.round(validation.maeClean)} W/m² if
            haze were ignored. Total sunlight {validation.biasPct >= 0 ? 'over' : 'under'}-estimated by {Math.abs(validation.biasPct).toFixed(0)}%
            (ignoring haze: {validation.noHazeBiasPct >= 0 ? 'over' : 'under'} by {Math.abs(validation.noHazeBiasPct).toFixed(0)}%). Cloud forecasts are the biggest source of error on any single day.
          </p>
        )}
      </div>
      </More>

      <More title="How these numbers are calculated" hint="Heat index, dew point, warnings, UV, rain and solar">
        <div className="card">
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--ink-2)' }}>
            <li><b>Heat index</b>: NOAA formula from temperature and humidity (how hot it feels in the shade).</li>
            <li><b>Dew point</b>: Magnus formula; above 24°C the air feels muggy.</li>
            <li><b>Heat warning</b>: NOAA heat-index bands (caution from 27°C, extreme caution from 32°C, danger from 41°C).</li>
            <li><b>UV</b>: WHO categories. <b>Rain</b>: daily totals (light &lt;10 mm, heavy ≥30 mm).</li>
            <li><b>Solar per day</b>: weather, haze and dust go through the solar model, then the losses are split out in "What's reducing your solar?".</li>
          </ul>
        </div>
      </More>

      <More title="Your home settings" hint={`${settings.kwp} kW solar · ${settings.batteryKwh} kWh battery · ${settings.dailyKwh} kWh/day · ${settings.home.tariff.mode === 'tou' ? 'time-of-use' : 'flat'} tariff`}>
      <div className="card">
        <p className="lede">Change these to match your house. Saved in this browser.</p>
        <div className="settings">
          <NumField label="Solar size" unit="kWp" value={settings.kwp} min={1} max={20} step={0.5} onChange={(v) => setSettings({ ...settings, kwp: v })} />
          <NumField label="Battery" unit="kWh" value={settings.batteryKwh} min={1} max={30} step={0.5} onChange={(v) => setSettings({ ...settings, batteryKwh: v })} />
          <NumField label="Daily use" unit="kWh" value={settings.dailyKwh} min={5} max={60} step={1} onChange={(v) => setSettings({ ...settings, dailyKwh: v })} hint="Your monthly bill kWh ÷ 30" />
          <div className="field">
            <label htmlFor="tariff">Tariff</label>
            <select
              id="tariff"
              value={settings.home.tariff.mode}
              onChange={(e) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, mode: e.target.value } } })}
            >
              <option value="tou">Time-of-use (peak 2pm–10pm weekdays)</option>
              <option value="flat">Flat rate</option>
            </select>
          </div>
          {settings.home.tariff.mode === 'tou' ? (
            <>
              <NumField label="Peak rate" unit="RM/kWh" value={settings.home.tariff.peakRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, peakRate: v } } })} hint="Example value — use your bill" />
              <NumField label="Off-peak rate" unit="RM/kWh" value={settings.home.tariff.offPeakRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, offPeakRate: v } } })} hint="Example value — use your bill" />
            </>
          ) : (
            <NumField label="Rate" unit="RM/kWh" value={settings.home.tariff.flatRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, flatRate: v } } })} hint="Example value — use your bill" />
          )}
        </div>
      </div>
      </More>
    </>
  );
}

function DayWeather({ daily: d, offsetSec, label }) {
  const rl = rainLevel(d.rain);
  const ul = uvLevel(d.uvMax);
  return (
    <div className="day-wx" aria-label={`Weather for ${label}`}>
      <div className="day-wx-head">
        <span className="ic" aria-hidden="true">{weatherIcon(d.weather_code)}</span>
        <div>
          <div className="small muted">{label}</div>
          <b>{WEATHER_TEXT[d.weather_code] || '—'}</b>
        </div>
      </div>
      <div className="day-wx-stats">
        <span><b>{fmt(d.tmax)}° / {fmt(d.tmin)}°</b>{has(d.feelsMax) ? ` · feels ${fmt(d.feelsMax)}°` : ''}</span>
        <span className={`tone-${rl.tone}`}>💧 {fmt(d.rain, 1)} mm{has(d.rainChance) ? ` · ${Math.round(d.rainChance)}%` : ''}</span>
        <span>UV {fmt(d.uvMax)} <span className={`tone-${ul.tone}`}>{ul.label}</span></span>
        <span>Wind {fmt(d.windMax)} km/h {compass(d.windDir)}</span>
        {has(d.sunshineSec) && <span>☀ {fmt(d.sunshineSec / 3600, 1)} h sunshine</span>}
        {d.sunrise && d.sunset && <span>🌅 {fmtTime(d.sunrise, offsetSec)} – {fmtTime(d.sunset, offsetSec)}</span>}
      </div>
    </div>
  );
}

function NumField({ label, unit, value, onChange, min, max, step, hint }) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} ({unit})
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function PlanCard({ plan, home, isPast, weekend }) {
  const tou = home.tariff.mode === 'tou';
  const s = plan.standard;
  const h = plan.hazeAware;
  const steps = [];
  if (plan.flexWhy === 'sunniest') steps.push(`Run the washing machine, dryer and water heater ${hourRanges(plan.flexHours)} — the sunniest hours left after the haze.`);
  else if (plan.flexWhy === 'offpeak') steps.push(`Solar is too weak to cover chores today — run them after ${fmtHour(home.tariff.peakEnd)} at the off-peak rate.`);
  else steps.push(`Keep chores at the usual time (${hourRanges(plan.flexHours)}); moving them would not save money today.`);
  if (plan.reserve) steps.push(`Save the battery for the ${fmtHour(home.tariff.peakStart)}–${fmtHour(home.tariff.peakEnd)} peak instead of draining it in the morning.`);
  if (plan.topUpKwh > 0.05) steps.push(`Haze means the battery will not fill from solar alone: top it up with ${plan.topUpKwh.toFixed(1)} kWh from the grid between 2am and 6am at the off-peak rate.`);
  if (!plan.reserve && plan.topUpKwh <= 0.05 && tou) steps.push('Let the battery cover demand whenever solar falls short — no reserve needed today.');

  return (
    <div className="card section">
      <h2>
        Save money with a smarter day {isPast ? '(what would have helped)' : ''}
        <Tip term="battery" />
      </h2>
      <p className="lede">
        We replay the day hour by hour with your predicted (hazy) solar output and try every combination of chore timing, battery reserve
        and off-peak top-up, keeping the cheapest. Household demand is simulated from a typical Malaysian terrace home.
        {weekend && ' Weekend: time-of-use is off-peak all day.'}
      </p>
      <div className="plan-cols">
        <div className="plan">
          <h3>Standard day</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh from the grid · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            <li>Chores at {hourRanges(plan.usualHours)}</li>
            <li>Battery empties whenever solar falls short</li>
          </ul>
        </div>
        <div className="plan smart">
          <h3>☀ Haze-aware plan</h3>
          <div className="big">RM {h.costRm.toFixed(2)}</div>
          <div className="small muted">
            {h.gridKwh.toFixed(1)} kWh from the grid · {h.co2Kg.toFixed(1)} kg CO₂
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
          <div className="k">Saved today · ~RM {(plan.savingRm * 30).toFixed(0)}/month at this rate</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.gridSavedKwh >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {plan.gridSavedKwh >= 0 ? '' : '+'}
            {Math.abs(plan.gridSavedKwh).toFixed(1)} kWh
          </div>
          <div className="k">{plan.gridSavedKwh >= 0 ? 'Less grid power' : 'More grid power (cheaper hours)'}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.co2SavedKg >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {Math.abs(plan.co2SavedKg).toFixed(1)} kg
          </div>
          <div className="k">CO₂ {plan.co2SavedKg >= 0 ? 'avoided' : 'added'}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>Haze-aware schedule</div>
        <div className="timeline" aria-label="24-hour schedule">
          {Array.from({ length: 24 }, (_, hr) => {
            const peak = tou && hr >= home.tariff.peakStart && hr < home.tariff.peakEnd;
            const flex = plan.flexHours.includes(hr);
            const top = (plan.gridChargeKwh?.[hr] || 0) > 0;
            return (
              <div
                key={hr}
                className={`${peak ? 'peak' : ''} ${flex ? 'flex' : ''} ${top ? 'topup' : ''}`}
                title={`${fmtHour(hr)}${flex ? ' · run chores' : ''}${top ? ' · grid top-up' : ''}${peak ? ' · peak rate' : ''}`}
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
          <span><i style={{ background: 'var(--sun)' }} />Run chores</span>
          {plan.topUpKwh > 0.05 && <span><i style={{ background: 'var(--sky)' }} />Grid top-up</span>}
          {tou && <span><i style={{ background: 'var(--paper-2)', boxShadow: 'inset 0 -3px 0 #c9b9a0' }} />Peak rate</span>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>Battery charge through the day</div>
        <SocChart standard={s.soc} smart={h.soc} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--ink-3)', height: 0 }} />Standard</span>
          <span><i style={{ background: 'var(--sun-deep)', height: 3 }} />Haze-aware</span>
        </div>
      </div>
    </div>
  );
}
