import { useMemo, useState } from 'react';
import { aqiLevel } from '../lib/aqi.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_SYMBOLS } from '../lib/doe.js';
import { getIqair, IQAIR_POLLUTANTS } from '../lib/iqair.js';
import { localDateOf, addDays } from '../lib/api.js';
import { weatherIcon, WEATHER_TEXT, weatherKind } from '../lib/weather.js';
import { useAsync, fmtTime, fmtDate } from './common.jsx';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// Pieces of the dashboard on the Weather & solar page: illustrated weather and air cards,
// the temperature-through-the-day curve, tomorrow's card and the side panel
// (sun arc, UV and the coming days). Plus the drifting clouds behind every page.

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
const localHour = (t, off) => new Date((t + off) * 1000).getUTCHours();

/** A soft cartoon cloud. Colour comes from CSS `color`. */
export function Cloud({ className = '', style }) {
  return (
    <svg className={`cloud ${className}`} style={style} viewBox="0 0 220 110" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="62" cy="68" r="34" />
        <circle cx="104" cy="50" r="44" />
        <circle cx="150" cy="64" r="34" />
        <circle cx="182" cy="80" r="22" />
        <rect x="34" y="66" width="168" height="38" rx="19" />
      </g>
    </svg>
  );
}

/** Clouds drifting slowly behind the pages. Hidden from screen readers; still when motion is reduced. */
export function SkyBackground() {
  return (
    <div className="sky-bg" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Cloud key={i} className={`bg-cloud c${i}`} />
      ))}
    </div>
  );
}

function Scene({ kind, night }) {
  // A small sky picture behind a card: sun or moon, clouds, rain or snow.
  const wet = ['drizzle', 'rain', 'storm'].includes(kind);
  return (
    <div className="scene-art" aria-hidden="true">
      {!wet && kind !== 'fog' && <span className={night ? 'scene-moon' : 'scene-sun'} />}
      <Cloud className="sc1" />
      <Cloud className="sc2" />
      {kind !== 'clear' && <Cloud className="sc3" />}
      {wet && <span className="scene-rain" />}
      {kind === 'snow' && <span className="scene-snow" />}
    </div>
  );
}

/** "Weather now" card with a sky picture and three chips. */
export function WeatherCard({ W, night, placeName }) {
  const kind = weatherKind(W.c.weather_code);
  const mood = night ? 'night' : ['drizzle', 'rain', 'storm', 'snow', 'fog'].includes(kind) ? 'grey' : 'warm';
  return (
    <section className={`scene-card scene-${mood}`} aria-label={tr('Weather now')}>
      <Scene kind={kind} night={night} />
      <div className="scene-head">
        <span className="scene-badge" aria-hidden="true">{weatherIcon(W.c.weather_code, !night)}</span>
        <span>
          <b>{tr('Weather now')}</b>
          <small>📍 {placeName}</small>
        </span>
      </div>
      <div className="scene-big">
        <span className="num">{fmt(W.c.temp)}°C</span>
        <span className="mini-chip">
          {tr('Feels like')} {fmt(W.c.feels ?? W.hi)}°
          <Tip term="feelsLike" />
        </span>
      </div>
      <div className="scene-cond">{tr(WEATHER_TEXT[W.c.weather_code]) || '—'}</div>
      <div className="scene-chips">
        <div className="sc-chip navy">
          <small>{tr('Humidity')}</small>
          <b>{fmt(W.c.rh)}%</b>
        </div>
        <div className="sc-chip lime">
          <small>{tr('Wind')}</small>
          <b>{fmt(W.c.wind)} km/h</b>
        </div>
        <div className="sc-chip white">
          <small>{tr('Rain next 24 h')}</small>
          <b>{fmt(W.rainNext24, 1)} mm</b>
        </div>
      </div>
    </section>
  );
}

/** Air quality card: IQAir (or the DOE reading) on a blue sky, with a Good → Hazardous bar. */
export function AirCard({ place, go }) {
  const iq = useAsync(() => getIqair(place), [place.lat, place.lon]);
  const doe = useAsync(() => tryDoeStations(), []);
  const near = useMemo(() => (doe.data ? nearestStation(doe.data, place) : null), [doe.data, place]);
  const iqa = iq.data && !iq.data.error ? iq.data : null;
  const st = near?.station;
  const loading = iq.loading || doe.loading;
  const value = iqa ? Math.round(iqa.aqius) : st ? st.latest.api : null;
  const lvl = iqa ? aqiLevel(iqa.aqius) : doeLevel(st?.latest?.api);
  const pol = iqa ? IQAIR_POLLUTANTS[iqa.mainus] : DOE_SYMBOLS[st?.latest?.symbol];
  const pos = Math.min(100, Math.max(0, ((value ?? 0) / 300) * 100));
  return (
    <section className="scene-card scene-blue" aria-label={tr('Air quality')}>
      <div className="scene-art" aria-hidden="true">
        <Cloud className="sc1" />
        <Cloud className="sc2" />
        <Cloud className="sc4" />
      </div>
      <div className="scene-head">
        <span className="scene-badge" aria-hidden="true">🌬️</span>
        <span>
          <b>{tr('Air quality')}</b>
          <small>{pol ? `${tr('Main pollutant')}: ${tr(pol)}` : iqa ? 'US AQI · IQAir' : st ? `API · DOE` : ' '}</small>
        </span>
      </div>
      {value === null ? (
        <div className="scene-big">
          <span className="num sm">{loading ? '…' : tr('No reading')}</span>
        </div>
      ) : (
        <>
          <div className="scene-big">
            <span className="num">{value}</span>
            <span className="mini-chip" style={{ background: lvl.color, color: lvl.ink }}>
              {iqa ? 'AQI' : 'API'}
            </span>
          </div>
          <div className="scene-cond">{tr(lvl.short || lvl.label)}</div>
        </>
      )}
      <button className="aq-bar" onClick={() => go?.('air')} aria-label={tr('Air quality details')}>
        <span className="aq-ends">
          <span>{tr('Good')}</span>
          <span>{tr('Hazardous')}</span>
        </span>
        <span className="aq-track">
          <span className="aq-fill" style={{ width: `${pos}%` }} />
          {value !== null && (
            <span className="aq-mark" style={{ left: `${pos}%` }}>
              {tr(lvl.short || lvl.label)}
            </span>
          )}
        </span>
      </button>
    </section>
  );
}

const PERIODS = [
  { key: 'm', label: 'Morning', hour: 8 },
  { key: 'a', label: 'Afternoon', hour: 14 },
  { key: 'e', label: 'Evening', hour: 18 },
  { key: 'n', label: 'Night', hour: 22 },
];
const MODES = [
  { key: 'temp', icon: '🌡️', label: 'Temperature', get: (h) => h.temp, show: (v) => `${fmt(v)}°` },
  { key: 'rain', icon: '☂️', label: 'Rain', get: (h) => h.rain ?? 0, show: (v) => `${fmt(v, 1)} mm` },
  { key: 'wind', icon: '🌬️', label: 'Wind', get: (h) => h.wind, show: (v) => `${fmt(v)} km/h` },
];

/** "How's the temperature today?" Four points through the day, with rain and wind as options. */
export function TempCurve({ hours, offsetSec, today }) {
  const [mode, setMode] = useState('temp');
  const m = MODES.find((x) => x.key === mode);
  const pts = PERIODS.map((p) => {
    const h = hours.find((x) => localDateOf(x.t, offsetSec) === today && localHour(x.t, offsetSec) === p.hour);
    return { ...p, h, v: h ? m.get(h) : null };
  });
  const vals = pts.map((p) => p.v).filter((v) => v !== null && v !== undefined);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const W = 400;
  const H = 90;
  const xy = pts.map((p, i) => ({ x: (W / 4) * (i + 0.5), y: p.v === null || p.v === undefined ? null : hi === lo ? H / 2 : 14 + (1 - (p.v - lo) / (hi - lo)) * (H - 28) }));
  const ok = xy.filter((q) => q.y !== null);
  // Smooth line through the points (Catmull–Rom), running off both edges like the reference.
  const path = (() => {
    if (ok.length < 2) return '';
    const P = [{ x: 0, y: ok[0].y }, ...ok, { x: W, y: ok[ok.length - 1].y }];
    let d = `M ${P[0].x} ${P[0].y}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[i + 2] || p2;
      d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
    }
    return d;
  })();
  const nowH = localHour(Date.now() / 1000, offsetSec);
  const nowKey = nowH < 11 ? 'm' : nowH < 17 ? 'a' : nowH < 20 ? 'e' : 'n';

  return (
    <section className="card temp-card">
      <div className="spread">
        <h2>{tr("How's the temperature today?")}</h2>
        <div className="mode-btns" role="group" aria-label={tr('Show')}>
          {MODES.map((x) => (
            <button key={x.key} className={mode === x.key ? 'active' : ''} aria-pressed={mode === x.key} aria-label={tr(x.label)} title={tr(x.label)} onClick={() => setMode(x.key)}>
              {x.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="curve">
        <div className="curve-cols">
          {pts.map((p) => (
            <div key={p.key} className={`curve-col ${p.key === nowKey ? 'now' : ''}`}>
              <span className="curve-ic" aria-hidden="true">{p.h ? weatherIcon(p.h.weather_code, p.hour >= 7 && p.hour < 19) : '·'}</span>
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="curve-svg" aria-hidden="true">
          <path d={path} fill="none" stroke="var(--sun)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="curve-dots" aria-hidden="true">
          {xy.map((q, i) =>
            q.y === null ? null : <span key={i} className={pts[i].key === nowKey ? 'now' : ''} style={{ left: `${(q.x / W) * 100}%`, top: `${(q.y / H) * 100}%` }} />
          )}
        </div>
        <div className="curve-cols">
          {pts.map((p) => (
            <div key={p.key} className={`curve-col ${p.key === nowKey ? 'now' : ''}`}>
              <b>{p.v === null || p.v === undefined ? '–' : m.show(p.v)}</b>
              <small>{tr(p.label)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Tomorrow: the weather and how much solar to expect. */
export function TomorrowCard({ day, today, go }) {
  if (!day) return null;
  const kind = weatherKind(day.wx.code);
  const wet = ['drizzle', 'rain', 'storm'].includes(kind);
  return (
    <section className={`scene-card scene-lime ${wet ? 'wet' : ''}`} aria-label={tr('Tomorrow')}>
      <div className="scene-art" aria-hidden="true">
        {wet && <span className="scene-rain" />}
        <span className="tm-ic">{weatherIcon(day.wx.code)}</span>
      </div>
      <div className="scene-head">
        <span>
          <b>{tr('Tomorrow')}</b>
          <small>{fmtDate(addDays(today, 1), { weekday: 'long', day: 'numeric', month: 'short' })}</small>
        </span>
      </div>
      <div className="tm-bottom">
        <div className="scene-big">
          <span className="num">{day.wx.tmax !== null ? `${Math.round(day.wx.tmax)}°C` : '–'}</span>
        </div>
        <div className="scene-cond">{tr(WEATHER_TEXT[day.wx.code]) || '—'}</div>
        <button className="mini-chip solar" onClick={() => go?.('planner')}>
          ☀ {day.breakdown.final.toFixed(1)} kWh
        </button>
      </div>
    </section>
  );
}

const UV_TEXT = {
  Low: 'No sun protection needed',
  Moderate: 'Hat and sunscreen at midday',
  High: 'Shade at midday, hat, sunscreen',
  'Very high': 'Avoid the midday sun',
  Extreme: 'Stay indoors at midday',
};

/** Right-hand panel: sun arc, UV and the coming days. */
export function SidePanel({ W, uv, days, today, placeName, go, onPick }) {
  const d = W.todayDaily;
  const now = Date.now() / 1000;
  const rise = d?.sunrise;
  const set = d?.sunset;
  const p = rise && set ? Math.min(1, Math.max(0, (now - rise) / (set - rise))) : 0.5;
  const up = rise && set && now > rise && now < set;
  const R = 86;
  const sx = 100 - R * Math.cos(Math.PI * p);
  const sy = 100 - R * Math.sin(Math.PI * p);
  const coming = days.filter((x) => x.d > today).slice(0, 5);
  const weekday = fmtDate(today, { weekday: 'long' });

  return (
    <aside className="side-panel" aria-label={tr('Today')}>
      <div className="sp-head">
        <div>
          <b>{weekday}</b>
          <small>📍 {placeName}</small>
        </div>
        <span className="sp-temp">{fmt(W.c.temp)}°C</span>
      </div>

      <div className="sun-arc">
        <svg viewBox="0 0 200 112" aria-hidden="true">
          <defs>
            <linearGradient id="sunfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f5a524" stopOpacity="0.28" />
              <stop offset="1" stopColor="#f5a524" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={`M 14 100 A ${R} ${R} 0 0 1 186 100`} fill="none" stroke="#e7c48a" strokeWidth="1.6" strokeDasharray="3 5" />
          {up && <path d={`M 14 100 A ${R} ${R} 0 0 1 ${sx} ${sy} L ${sx} 100 Z`} fill="url(#sunfill)" />}
          <line x1="6" y1="100" x2="194" y2="100" stroke="var(--sun)" strokeWidth="2" />
          <circle cx="14" cy="100" r="4" fill="var(--sun)" />
          <circle cx="186" cy="100" r="4" fill="var(--ink)" />
          {up ? <text x={sx} y={sy + 6} textAnchor="middle" fontSize="18">☀️</text> : <text x="100" y="60" textAnchor="middle" fontSize="18">🌙</text>}
        </svg>
        <div className="sun-times">
          <span>
            <b>{tr('Sunrise')}</b>
            <small>{rise ? fmtTime(rise, W.offsetSec) : '–'}</small>
          </span>
          <span style={{ textAlign: 'right' }}>
            <b>{tr('Sunset')}</b>
            <small>{set ? fmtTime(set, W.offsetSec) : '–'}</small>
          </span>
        </div>
      </div>

      <div className="uv-card">
        <span className="uv-ic" aria-hidden="true">☀️</span>
        <div>
          <div className="uv-top">
            <b>{fmt(W.c.uv, 0)} UVI</b>
            <span className="uv-badge">{tr(uv.label)}</span>
            <Tip term="uv" />
          </div>
          <small>{tr(UV_TEXT[uv.label] || '')}</small>
        </div>
      </div>

      <h3 className="sp-title">{tr('Coming days')}</h3>
      <ul className="sp-days">
        {coming.map((x) => (
          <li key={x.d}>
            <button className="sp-day" onClick={() => onPick?.(x.d)} aria-label={tr('See {day}', { day: fmtDate(x.d, { weekday: 'long' }) })}>
            <span className="sp-ic" aria-hidden="true">{weatherIcon(x.wx.code)}</span>
            <span className="sp-mid">
              <small>{fmtDate(x.d, { weekday: 'short', day: 'numeric', month: 'short' })}</small>
              <b>{tr(WEATHER_TEXT[x.wx.code]) || '—'}</b>
            </span>
            <span className="sp-right">
              <b>{x.wx.tmax !== null ? Math.round(x.wx.tmax) : '–'}°</b>
              {x.daily?.tmin !== null && x.daily?.tmin !== undefined && <span className="muted"> / {Math.round(x.daily.tmin)}°</span>}
              <small>☀ {x.breakdown.final.toFixed(1)} kWh</small>
            </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn sp-btn" onClick={() => go?.('planner')}>
        🗓 {tr('Planner')}
      </button>
    </aside>
  );
}
