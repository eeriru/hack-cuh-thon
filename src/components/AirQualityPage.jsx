import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY, localDateOf, dayModelHours } from '../lib/api.js';
import { aqiLevel, AQI_LEVELS, ADVICE, POLLUTANTS, hazeLevel, WEATHER_CODES } from '../lib/aqi.js';
import { computeHazeLoss } from '../lib/model.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_LEVELS, DOE_ADVICE, DOE_SYMBOLS, DOE_SOURCE_URL } from '../lib/doe.js';
import { getIqair, IQAIR_POLLUTANTS, IQAIR_URL } from '../lib/iqair.js';
import { AqiBars } from './charts.jsx';
import HazeScene3D from './HazeScene3D.jsx';
import { useAsync, Loading, DemoBanner, fmtTime, fmtDate } from './common.jsx';

const DOE_TO_TIPS = { good: 'good', moderate: 'moderate', unhealthy: 'usg', very: 'very', hazardous: 'hazardous', emergency: 'hazardous' };

function DoeScale({ api }) {
  const segs = [50, 50, 100, 100, 200];
  const pos = Math.min(100, ((api ?? 0) / 500) * 100);
  return (
    <div className="scale-wrap">
      <div className="scale">
        {segs.map((w, i) => (
          <span key={i} style={{ flex: w, background: DOE_LEVELS[i].color }} />
        ))}
      </div>
      <div className="scale-marker" style={{ left: `${pos}%` }} />
      <div className="scale-labels">
        {[0, 50, 100, 200, 300, 500].map((v) => (
          <span key={v} style={{ left: `${(v / 500) * 100}%` }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

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
  const doe = useAsync(() => tryDoeStations(), [today]);
  const iq = useAsync(() => getIqair(place), [place.lat, place.lon]);
  const official = useMemo(() => (doe.data ? nearestStation(doe.data, place) : null), [doe.data, place]);

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

  if (loading || !data || doe.loading || iq.loading) return <Loading />;
  const c = data.current;
  const lvl = aqiLevel(c.us_aqi);
  const haze = hazeLevel(c.aod);
  const st = official?.station;
  const reading = st?.latest;
  const dl = doeLevel(reading?.api);
  const iqa = iq.data && !iq.data.error ? iq.data : null;
  const il = aqiLevel(iqa?.aqius);
  const tipsKey = iqa ? il.key : st ? DOE_TO_TIPS[dl.key] : lvl.key;
  const iqaTs = iqa?.ts ? Date.parse(iqa.ts) / 1000 : null;
  // Weather: IQAir's when available, otherwise the forecast model's
  const wx = iqa?.weather?.tempC !== undefined && iqa?.weather?.tempC !== null
    ? { temp: iqa.weather.tempC, rh: iqa.weather.humidity, wind: iqa.weather.windMs !== null ? iqa.weather.windMs * 3.6 : null }
    : { temp: c.temp, rh: c.rh, wind: c.wind };
  const past24 = st ? st.readings.slice(-24) : [];

  return (
    <>
      <DemoBanner source={data.source} />
      {iq.data?.error && !iq.data.notConfigured && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>{iq.data.error}. Showing {st ? 'the official DOE reading' : 'a model estimate'} instead.</span>
        </div>
      )}
      {!iqa && !st && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            Official DOE readings could not be loaded right now{doe.data ? ' (no station has reported in the last 6 hours)' : ''}, so the
            main number below is a model estimate on the US AQI scale. Official readings:{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a>.
          </span>
        </div>
      )}
      <div className="place-title">
        <h1>{place.name}</h1>
        <span className="sub">{place.area}</span>
        <span className="stamp">
          {iqa && iqaTs
            ? `IQAir · updated ${fmtTime(iqaTs, 8 * 3600)}`
            : st
              ? `DOE reading for ${fmtTime(reading.t, 8 * 3600)}`
              : `Updated ${c.time ? fmtTime(c.time, data.offsetSec) : '—'} local time`}
        </span>
      </div>

      <section className="hero section" aria-label="Current air quality">
        {iqa ? (
          <div className="hero-aqi" style={{ background: il.color, color: il.ink }}>
            <span className="label">US AQI · IQAir · {iqa.city}</span>
            <div className="big">
              <span className="num">{Math.round(iqa.aqius)}</span>
              <span className="cat">{il.label}</span>
              <span className="face" aria-hidden="true">{il.face}</span>
            </div>
            <span className="main-pol">
              {IQAIR_POLLUTANTS[iqa.mainus] ? `Main pollutant: ${IQAIR_POLLUTANTS[iqa.mainus]}` : ''}
              {st ? ` · Official DOE API at ${st.name}: ${reading.api} (${dl.label})` : ''}
            </span>
            <AqiScale aqi={iqa.aqius} />
          </div>
        ) : st ? (
          <div className="hero-aqi" style={{ background: dl.color, color: dl.ink }}>
            <span className="label">Official API · Department of Environment</span>
            <div className="big">
              <span className="num">{reading.api}</span>
              <span className="cat">{dl.label}</span>
            </div>
            <span className="main-pol">
              {DOE_SYMBOLS[reading.symbol] ? `Dominant pollutant: ${DOE_SYMBOLS[reading.symbol]} · ` : ''}
              Station: {st.name}
              {st.state ? `, ${st.state}` : ''} ({official.distanceKm < 1 ? '<1' : Math.round(official.distanceKm)} km away)
            </span>
            <DoeScale api={reading.api} />
          </div>
        ) : (
          <div className="hero-aqi" style={{ background: lvl.color, color: lvl.ink }}>
            <span className="label">Model estimate · US AQI · now</span>
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
        )}
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
              {wx.temp !== undefined && wx.temp !== null ? Math.round(wx.temp) : '–'}
              <small>°C</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">Humidity · Wind</div>
            <div className="v">
              {wx.rh !== undefined && wx.rh !== null ? Math.round(wx.rh) : '–'}
              <small>%</small> {wx.wind !== undefined && wx.wind !== null ? Math.round(wx.wind) : '–'}
              <small>km/h</small>
            </div>
          </div>
        </div>
      </section>

      <div className="section">
        <HazeScene3D aod={c.aod ?? 0.3} label={`Right now · ${place.name}`} interactive={false} height={300} />
      </div>

      <div className="grid grid-2 section">
        {st ? (
          <div className="card">
            <div className="spread">
              <h2>Official DOE readings</h2>
              <span className="badge" style={{ background: dl.color, color: dl.ink }}>API {reading.api}</span>
            </div>
            <p className="lede">
              Past 24 hours at {st.name} ({Math.round(official.distanceKm)} km away), Malaysian API scale. Source:{' '}
              <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">DOE MyEQMS</a>.
            </p>
            <AqiBars
              level={doeLevel}
              unit="API"
              ticks={[0, 50, 100, 200, 300, 500]}
              points={past24.map((r) => ({
                key: r.t,
                aqi: r.api,
                label: fmtTime(r.t, 8 * 3600, { hour: 'numeric' }),
                sub: fmtTime(r.t, 8 * 3600, { weekday: 'short', hour: 'numeric' }),
              }))}
            />
          </div>
        ) : (
          <div className="card">
            <h2>Hourly forecast</h2>
            <p className="lede">Model estimate, US AQI, next 24 hours.</p>
            <AqiBars
              points={derived.next.map((h) => ({
                key: h.t,
                aqi: h.us_aqi,
                label: fmtTime(h.t, data.offsetSec, { hour: 'numeric' }),
                sub: fmtTime(h.t, data.offsetSec, { weekday: 'short', hour: 'numeric' }),
              }))}
            />
          </div>
        )}
        <div className="card">
          <h2>Health advice</h2>
          {st ? (
            <p className="lede" style={{ color: 'var(--ink-2)' }}>
              <b>DOE advice{iqa ? ' (official API)' : ''}:</b> {DOE_ADVICE[dl.key]}
            </p>
          ) : (
            <p className="lede">What to do at the current level.</p>
          )}
          <div className="advice">
            {(ADVICE[tipsKey] || ADVICE.good).map(([k, v]) => (
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
            <h2>Forecast</h2>
            <p className="lede">
              Model forecast (Copernicus CAMS) on the US AQI scale — the DOE does not publish forecasts. Worst hour of each day.
            </p>
          </div>
        </div>
        {st && (
          <div style={{ marginBottom: 14 }}>
            <AqiBars
              height={140}
              points={derived.next.map((h) => ({
                key: h.t,
                aqi: h.us_aqi,
                label: fmtTime(h.t, data.offsetSec, { hour: 'numeric' }),
                sub: fmtTime(h.t, data.offsetSec, { weekday: 'short', hour: 'numeric' }),
              }))}
            />
          </div>
        )}
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
          <p className="lede">Model estimates of concentrations near the ground (the DOE public feed gives the index only).</p>
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
