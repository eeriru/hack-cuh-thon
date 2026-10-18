import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY, localDateOf, dayModelHours } from '../lib/api.js';
import { aqiLevel, AQI_LEVELS, ADVICE, POLLUTANTS, hazeLevel, WEATHER_CODES } from '../lib/aqi.js';
import { computeHazeLoss } from '../lib/model.js';
import { AqiBars } from './charts.jsx';
import { useAsync, Loading, DemoBanner, fmtTime, fmtDate } from './common.jsx';

const SCALE_MAX = 300;

function AqiScale({ aqi }) {
  const segs = [50, 50, 50, 50, 100];
  const pos = Math.min(100, ((aqi ?? 0) / SCALE_MAX) * 100);
  return (
    <div className="scale-wrap">
      <div className="scale">
        {segs.map((w, i) => (
          <span key={i} style={{ flex: w, background: AQI_LEVELS[i].color }} />
        ))}
      </div>
      <div className="scale-marker" style={{ left: `${pos}%` }} />
    </div>
  );
}

function mainPollutant(c) {
  // US AQI is driven by PM2.5 in almost every haze case; show it unless PM10 clearly dominates.
  if ((c.pm10 ?? 0) > 3 * (c.pm2_5 ?? 0)) return 'PM10';
  return 'PM2.5';
}

export default function AirQualityPage({ place, engine, go }) {
  const today = todayMY();
  const { data, loading } = useAsync(
    () => getPlaceData(place, { startDate: addDays(today, -1), endDate: addDays(today, 4) }),
    [place.lat, place.lon, today]
  );

  const derived = useMemo(() => {
    if (!data) return null;
    const now = Date.now() / 1000;
    const next = data.hours.filter((h) => h.t >= now - 1800 && h.us_aqi !== null && h.us_aqi !== undefined).slice(0, 24);
    const byDay = new Map();
    for (const h of data.hours) {
      if (h.us_aqi === null || h.us_aqi === undefined) continue;
      const d = localDateOf(h.t, data.offsetSec);
      const e = byDay.get(d) || { d, max: 0, tmin: 99, tmax: -99, pm: 0 };
      e.max = Math.max(e.max, h.us_aqi);
      e.pm = Math.max(e.pm, h.pm2_5 ?? 0);
      if (h.temp !== null && h.temp !== undefined) {
        e.tmin = Math.min(e.tmin, h.temp);
        e.tmax = Math.max(e.tmax, h.temp);
      }
      byDay.set(d, e);
    }
    const days = [...byDay.values()].filter((d) => d.d >= today).slice(0, 5);
    const solarToday = engine ? computeHazeLoss(dayModelHours(data, today), { ...place, engine }) : null;
    const solarTomorrow = engine ? computeHazeLoss(dayModelHours(data, addDays(today, 1)), { ...place, engine }) : null;
    return { next, days, solarToday, solarTomorrow };
  }, [data, engine, place, today]);

  if (loading || !data) return <Loading />;
  const c = data.current;
  const lvl = aqiLevel(c.us_aqi);
  const haze = hazeLevel(c.aod);

  return (
    <>
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>{place.name}</h1>
        <span className="sub">{place.area}</span>
        <span className="stamp">
          Updated {c.time ? fmtTime(c.time, data.offsetSec) : '—'} local time
        </span>
      </div>

      <section className="hero section" aria-label="Current air quality">
        <div className="hero-aqi" style={{ background: lvl.color, color: lvl.ink }}>
          <span className="label">US AQI · now</span>
          <div className="big">
            <span className="num">{c.us_aqi !== undefined && c.us_aqi !== null ? Math.round(c.us_aqi) : '–'}</span>
            <span className="cat">{lvl.label}</span>
            <span className="face" aria-hidden="true">{lvl.face}</span>
          </div>
          <span className="main-pol">
            Main pollutant: {mainPollutant(c)} · {c.pm2_5 !== undefined && c.pm2_5 !== null ? c.pm2_5.toFixed(1) : '–'} µg/m³
          </span>
          <AqiScale aqi={c.us_aqi} />
        </div>
        <div className="hero-side">
          <div className="stat">
            <div className="k">Haze level</div>
            <div className="v">
              {haze.label}
              <small>AOD {c.aod !== undefined && c.aod !== null ? c.aod.toFixed(2) : '–'}</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Weather</div>
            <div className="v" style={{ fontSize: 18 }}>{WEATHER_CODES[c.weather_code] || '—'}</div>
          </div>
          <div className="stat">
            <div className="k">Temperature</div>
            <div className="v">
              {c.temp !== undefined && c.temp !== null ? Math.round(c.temp) : '–'}
              <small>°C</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Humidity · Wind</div>
            <div className="v">
              {c.rh !== undefined && c.rh !== null ? Math.round(c.rh) : '–'}
              <small>%</small> {c.wind !== undefined && c.wind !== null ? Math.round(c.wind) : '–'}
              <small>km/h</small>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-2 section">
        <div className="card">
          <h2>Hourly forecast</h2>
          <p className="lede">US AQI for the next 24 hours. Hover a bar for details.</p>
          <AqiBars
            points={derived.next.map((h) => ({
              key: h.t,
              aqi: h.us_aqi,
              label: fmtTime(h.t, data.offsetSec, { hour: 'numeric' }),
              sub: fmtTime(h.t, data.offsetSec, { weekday: 'short', hour: 'numeric' }),
            }))}
          />
        </div>
        <div className="card">
          <h2>Health advice</h2>
          <p className="lede">What to do at the current level.</p>
          <div className="advice">
            {(ADVICE[lvl.key] || ADVICE.good).map(([k, v]) => (
              <div key={k}>
                <b>{k}</b>
                {v}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card section">
        <div className="spread">
          <div>
            <h2>Daily forecast</h2>
            <p className="lede">Worst hour of each day, with temperature range.</p>
          </div>
        </div>
        <div className="daily">
          {derived.days.map((d) => {
            const l = aqiLevel(d.max);
            return (
              <div className="day" key={d.d}>
                <div className="d">{d.d === today ? 'Today' : fmtDate(d.d)}</div>
                <span className="pill" style={{ background: l.color, color: l.ink }}>{Math.round(d.max)}</span>
                <div className="small muted">{l.short || l.label}</div>
                <div className="small">
                  {d.tmin < 99 ? `${Math.round(d.tmin)}–${Math.round(d.tmax)}°C` : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <h2>Pollutants</h2>
          <p className="lede">Current concentrations near the ground.</p>
          <div className="pollutants">
            {POLLUTANTS.map((p) => (
              <div className="pol" key={p.key} title={p.name}>
                <div className="name">{p.label}</div>
                <div className="val">
                  {c[p.key] !== undefined && c[p.key] !== null ? (c[p.key] >= 100 ? Math.round(c[p.key]) : c[p.key].toFixed(1)) : '–'}
                  <small>{p.unit}</small>
                </div>
                <div className="desc">{p.name}</div>
              </div>
            ))}
          </div>
        </div>
        <SolarTeaser derived={derived} go={go} />
      </div>
    </>
  );
}

function SolarTeaser({ derived, go }) {
  const t = derived?.solarToday;
  const m = derived?.solarTomorrow;
  return (
    <div className="card" style={{ background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }}>
      <h2 style={{ color: 'var(--paper)' }}>☀ Solar haze loss</h2>
      <p className="lede" style={{ color: '#c7bfae' }}>For a 5 kW rooftop system at this location.</p>
      <div className="headline-stats">
        <div className="hs">
          <div className="k">Today</div>
          <div className="v">
            {t ? `−${t.lossPct.toFixed(0)}%` : '–'}
            <small>{t ? `${t.lossKwh.toFixed(1)} kWh lost` : ''}</small>
          </div>
        </div>
        <div className="hs">
          <div className="k">Tomorrow</div>
          <div className="v">
            {m && m.rows.length ? `−${m.lossPct.toFixed(0)}%` : '–'}
            <small>{m && m.rows.length ? `${m.lossKwh.toFixed(1)} kWh lost` : ''}</small>
          </div>
        </div>
      </div>
      <p style={{ color: '#d8d1c2', fontSize: 13.5 }}>
        Haze blocks sunlight before it reaches your panels. See the hour-by-hour loss and a battery plan that works around it.
      </p>
      <button className="btn" style={{ background: 'var(--sun)', borderColor: 'var(--sun)', color: 'var(--ink)' }} onClick={() => go('solar')}>
        Open solar planner →
      </button>
    </div>
  );
}
