import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { heatIndex, dewPoint, heatRisk, uvLevel, rainLevel, compass, weatherIcon, WEATHER_TEXT } from '../lib/weather.js';
import { WeatherChart } from './charts.jsx';
import { useAsync, Loading, DemoBanner, fmtTime, fmtDate } from './common.jsx';

const Stat = ({ k, v, unit, sub, tone }) => (
  <div className="stat">
    <div className="k">{k}</div>
    <div className="v">
      {v}
      {unit && <small>{unit}</small>}
    </div>
    {sub && <div className={`small ${tone ? `tone-${tone}` : 'muted'}`}>{sub}</div>}
  </div>
);

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d));

export default function WeatherPage({ place, engine, settings, go }) {
  const today = todayMY();
  const { data, loading } = useAsync(
    () => getPlaceData(place, { startDate: addDays(today, -3), endDate: addDays(today, 6) }),
    [place.lat, place.lon, today]
  );

  const derived = useMemo(() => {
    if (!data) return null;
    const now = Date.now() / 1000;
    const next = data.hours.filter((h) => h.t >= now - 1800).slice(0, 24);
    const system = { ...DEFAULT_SYSTEM, kwp: settings.kwp };
    const dateOf = (t) => new Date((t + data.offsetSec) * 1000).toISOString().slice(0, 10);
    const days = (data.daily || [])
      .filter((d) => dateOf(d.t) >= today)
      .slice(0, 7)
      .map((d) => {
        const ds = dateOf(d.t);
        let solar = null;
        if (engine) {
          const rows = dayModelHours(data, ds);
          if (rows.length >= 20) {
            const L = computeHazeLoss(rows, { ...place, engine, system });
            solar = lossBreakdown(L, { system, soilingPct: soilingForDate(data, ds).pct }).final;
          }
        }
        return { ...d, ds, solar };
      });
    return { next, days };
  }, [data, engine, place, settings.kwp, today]);

  if (loading || !data) return <Loading text="Loading the weather forecast…" />;
  const c = data.current;
  const hi = heatIndex(c.temp, c.rh);
  const risk = heatRisk(hi);
  const dew = dewPoint(c.temp, c.rh);
  const uv = uvLevel(c.uv);
  const night = c.isDay === 0;
  const mood = night ? 'night' : (c.rain ?? 0) > 0.2 || c.weather_code >= 61 ? 'rain' : c.weather_code === 45 || (c.aod ?? 0) > 1 ? 'haze' : '';
  const todayDaily = derived.days.find((d) => d.ds === today);
  const rainNext24 = derived.next.reduce((a, h) => a + (h.rain || 0), 0);
  const maxChance = Math.max(0, ...derived.next.map((h) => h.rain_chance ?? 0));

  return (
    <>
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>Weather</h1>
        <span className="sub">{place.name} · {place.area}</span>
        <span className="stamp">Updated {c.time ? fmtTime(c.time, data.offsetSec) : '—'} local time</span>
      </div>

      <section className="wx-hero section" aria-label="Weather now">
        <div className={`wx-now ${mood}`}>
          <span className="label">Now</span>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="temp">
              {fmt(c.temp)}
              <small>°C</small>
            </span>
            <span style={{ fontSize: 54 }} aria-hidden="true">{weatherIcon(c.weather_code, !night)}</span>
          </div>
          <span className="cond">{WEATHER_TEXT[c.weather_code] || '—'}</span>
          <span className="feels">
            Feels like {fmt(c.feels ?? hi)}°C
            {todayDaily ? ` · today ${fmt(todayDaily.tmin)}–${fmt(todayDaily.tmax)}°C` : ''}
          </span>
        </div>
        <div className="wx-stats">
          <Stat k="Heat index" v={fmt(hi)} unit="°C" sub={risk.label} tone={risk.tone} />
          <Stat k="Humidity" v={fmt(c.rh)} unit="%" sub={dew !== null ? `Dew point ${fmt(dew)}°C${dew >= 24 ? ' · muggy' : ''}` : null} />
          <Stat k="UV index" v={fmt(c.uv, 1)} sub={uv.label} tone={uv.tone} />
          <Stat k="Wind" v={fmt(c.wind)} unit="km/h" sub={`${compass(c.windDir)}${c.gust ? ` · gusts ${fmt(c.gust)} km/h` : ''}`} />
          <Stat k="Rain next 24 h" v={fmt(rainNext24, 1)} unit="mm" sub={`Up to ${Math.round(maxChance)}% chance`} />
          <Stat k="Cloud cover" v={fmt(c.cloud)} unit="%" sub={todayDaily?.sunset ? `Sunset ${fmtTime(todayDaily.sunset, data.offsetSec)}` : null} />
        </div>
      </section>

      {hi !== null && hi >= 32 && (
        <div className="card section risk-card">
          <h2>Heat warning: {risk.label.toLowerCase()}</h2>
          <p className="lede" style={{ margin: 0, color: 'var(--ink-2)' }}>
            With {fmt(c.rh)}% humidity, {fmt(c.temp)}°C feels like {fmt(hi)}°C. {risk.advice}
          </p>
        </div>
      )}

      <div className="card section">
        <h2>Next 24 hours</h2>
        <p className="lede">Temperature (solid), feels-like (dashed) and rain (bars). Hover for details.</p>
        <WeatherChart
          rows={derived.next.map((h) => ({
            t: h.t,
            temp: h.temp,
            feels: h.feels ?? heatIndex(h.temp, h.rh),
            rain: h.rain,
            rainChance: h.rain_chance,
            label: fmtTime(h.t, data.offsetSec, { hour: 'numeric' }),
            sub: fmtTime(h.t, data.offsetSec, { weekday: 'short', hour: 'numeric' }),
          }))}
        />
      </div>

      <div className="card section">
        <div className="spread">
          <div>
            <h2>7-day forecast</h2>
            <p className="lede">Weather from the Open-Meteo forecast, with the solar output your {settings.kwp} kW system can expect each day.</p>
          </div>
          <button className="chip" onClick={() => go('solar')}>Solar details ›</button>
        </div>
        <div className="wx-days">
          {derived.days.map((d) => {
            const rl = rainLevel(d.rain);
            const ul = uvLevel(d.uvMax);
            const hiMax = d.feelsMax;
            return (
              <div className="wx-day" key={d.ds}>
                <div className="d">{d.ds === today ? 'Today' : fmtDate(d.ds, { weekday: 'short', day: 'numeric' })}</div>
                <div className="ic" aria-hidden="true">{weatherIcon(d.weather_code)}</div>
                <div className="small muted">{WEATHER_TEXT[d.weather_code] || '—'}</div>
                <div className="t">
                  {fmt(d.tmax)}°<small> / {fmt(d.tmin)}°</small>
                </div>
                <div className="r">
                  {hiMax !== null && hiMax !== undefined && <div>Feels {fmt(hiMax)}°</div>}
                  <div className={`tone-${rl.tone}`}>
                    💧 {fmt(d.rain, 1)} mm{d.rainChance !== null && d.rainChance !== undefined ? ` · ${Math.round(d.rainChance)}%` : ''}
                  </div>
                  <div>
                    UV {fmt(d.uvMax)} <span className={`tone-${ul.tone}`}>{ul.label}</span>
                  </div>
                  <div>
                    Wind {fmt(d.windMax)} km/h {compass(d.windDir)}
                  </div>
                  {d.sunshineSec !== null && d.sunshineSec !== undefined && <div>☀ {fmt(d.sunshineSec / 3600, 1)} h sunshine</div>}
                </div>
                <div className="solar">{d.solar !== null ? `⚡ ${d.solar.toFixed(1)} kWh solar` : '⚡ —'}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <h2>How we calculate</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--ink-2)' }}>
            <li><b>Heat index</b>: NOAA formula from temperature and humidity (how hot it feels in the shade).</li>
            <li><b>Dew point</b>: Magnus formula; above 24°C the air feels muggy.</li>
            <li><b>Heat warning</b>: NOAA heat-index bands (caution from 27°C, extreme caution from 32°C, danger from 41°C).</li>
            <li><b>UV</b>: WHO categories. <b>Rain</b>: daily totals (light &lt;10 mm, heavy ≥30 mm).</li>
            <li><b>Solar per day</b>: the same model as the Solar forecast page, including clouds, heat, haze and dust.</li>
          </ul>
        </div>
        <div className="card">
          <h2>Today at a glance</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--ink-2)' }}>
            {todayDaily && <li>Temperature {fmt(todayDaily.tmin)}–{fmt(todayDaily.tmax)}°C, feeling up to {fmt(todayDaily.feelsMax)}°C.</li>}
            {todayDaily && <li>{rainLevel(todayDaily.rain).label} expected ({fmt(todayDaily.rain, 1)} mm, {Math.round(todayDaily.rainChance ?? 0)}% chance).</li>}
            {todayDaily && <li>UV peaks at {fmt(todayDaily.uvMax)} ({uvLevel(todayDaily.uvMax).label.toLowerCase()}): {todayDaily.uvMax >= 8 ? 'cover up and use sunscreen at midday' : 'normal sun care'}.</li>}
            {todayDaily?.solar !== null && todayDaily?.solar !== undefined && <li>Your panels should make about {todayDaily.solar.toFixed(1)} kWh.</li>}
            {todayDaily?.sunrise && <li>Sunrise {fmtTime(todayDaily.sunrise, data.offsetSec)}, sunset {fmtTime(todayDaily.sunset, data.offsetSec)}.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
