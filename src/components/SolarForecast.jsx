import { useEffect, useRef } from 'react';
import { addDays } from '../lib/api.js';
import { hazeLevel } from '../lib/aqi.js';
import { weatherIcon, WEATHER_TEXT, uvLevel, rainLevel, compass } from '../lib/weather.js';
import { Cloud } from './Dashboard.jsx';
import { fmtDate, fmtTime } from './common.jsx';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d));
const has = (v) => v !== null && v !== undefined;

// The solar forecast: a strip of days, the picked day's output and its weather.
// Used on Weather & solar and on the Planner. dateRange { min, max, onDate } adds a date box.
// compact (Planner): just the solar card, no day strip or day weather; the side panel picks the day.
export default function SolarForecast({ days, current, today, onSelect, rate, offsetSec, dateRange = null, id = 'solar', compact = false }) {
  const barRef = useRef(null);
  useEffect(() => {
    const el = barRef.current?.querySelector('.datebtn.active');
    if (el && barRef.current) barRef.current.scrollLeft = el.offsetLeft - barRef.current.offsetLeft - 40;
  }, [current?.d, days.length]);

  const L = current.loss;
  const B = current.breakdown;
  const wxLoss = B.steps.filter((s) => ['heat', 'clouds', 'haze'].includes(s.key)).reduce((t, s) => t + Math.max(0, s.kwh), 0);
  const haze = hazeLevel(L.meanAod);
  const dayWord = current.d === today ? tr('today') : current.d === addDays(today, 1) ? tr('tomorrow') : tr('on {date}', { date: fmtDate(current.d) });
  const isPast = current.d < today;
  const avgRate = rate;
  const setSelected = onSelect;

  return (
      <section id={id} className="section">
        <div className="sec-head">
          <h2>
            ☀ {tr('Your solar')}
            <Tip text="Pick a day to see its weather and solar output. Past days replay real readings; future days use the weather and haze forecast." />
          </h2>
          {dateRange && (
          <label className="date-jump">
            <span aria-hidden="true">📅</span>
            <span className="sr-only">{tr('Jump to a date')}</span>
            <input
              type="date"
              min={dateRange.min}
              max={dateRange.max}
              value={current.d}
              onChange={(e) => e.target.value && dateRange.onDate(e.target.value)}
            />
          </label>
          )}
        </div>
        {!compact && (
        <div className="day-strip datebar" role="tablist" ref={barRef}>
            {days.map(({ d, breakdown, wx }) => (
              <button key={d} role="tab" aria-selected={d === current.d} className={`day-pill datebtn ${d === current.d ? 'active' : ''}`} onClick={() => setSelected(d)}>
                <small>{d === today ? tr('Today') : fmtDate(d, { weekday: 'short', day: 'numeric' })}</small>
                <span className="dp-ic" aria-hidden="true">{weatherIcon(wx.code)}</span>
                <b>{breakdown.final.toFixed(1)}</b>
                <small>kWh</small>
              </button>
            ))}
          </div>
        )}

        <div className={`solar-grid ${compact ? 'one' : ''}`}>
          <div className="scene-card scene-solar">
            <div className="scene-art" aria-hidden="true">
              <span className="scene-sun" />
              <Cloud className="sc2" />
              <span className="roof">
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="scene-head">
              <span className="scene-badge" aria-hidden="true">☀️</span>
              <span>
                <b>{isPast ? tr('Replay') : tr('Forecast')}</b>
                <small>{fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'long' })}</small>
              </span>
            </div>
            <div className="scene-big">
              <span className="num">{B.final.toFixed(1)}</span>
              <span className="mini-chip">kWh {dayWord}</span>
            </div>
            <div className="scene-cond solar-sub">
              <span>
                ≈ RM {(B.final * avgRate).toFixed(2)}
                <Tip term="kwh" label="What is a kWh?" />
              </span>
              <span>
                {tr('{pct}% of ideal', { pct: B.performancePct.toFixed(0) })}
                <Tip term="ideal" label="What is ideal output?" />
              </span>
              <span>
                {tr('Biggest loss')}: {tr(B.biggest.label).toLowerCase()}
              </span>
            </div>
            <div className="scene-chips">
              <div className="sc-chip navy">
                <small>
                  {tr('Lost to weather')}
                  <Tip text="Heat, clouds & rain and haze together, compared with an ideal cool, clear day. The breakdown below shows each one." />
                </small>
                <b>{wxLoss.toFixed(1)} kWh</b>
              </div>
              <div className="sc-chip lime">
                <small>☁ {tr('Cloud cover (daylight)')}</small>
                <b>{Math.round(L.meanCloud)}%</b>
              </div>
              <div className="sc-chip white">
                <small>
                  🌫 {tr('Haze')}
                  <Tip term="aod" />
                </small>
                <b>{tr(haze.label)}</b>
              </div>
            </div>
          </div>
          {!compact && current.daily && <DayWeather daily={current.daily} offsetSec={offsetSec} label={fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' })} />}
        </div>
      </section>
  );
}

function DayWeather({ daily: d, offsetSec, label }) {
  const rl = rainLevel(d.rain);
  const ul = uvLevel(d.uvMax);
  const rows = [
    [weatherIcon(d.weather_code), tr('Weather'), tr(WEATHER_TEXT[d.weather_code]) || '—'],
    ['🌡️', tr('Temperature'), `${fmt(d.tmax)}° / ${fmt(d.tmin)}°${has(d.feelsMax) ? ` · ${tr('feels')} ${fmt(d.feelsMax)}°` : ''}`],
    ['💧', tr('Rain'), <span className={`tone-${rl.tone}`}>{fmt(d.rain, 1)} mm{has(d.rainChance) ? ` · ${Math.round(d.rainChance)}%` : ''}</span>],
    ['🔆', 'UV', <span>{fmt(d.uvMax)} <span className={`tone-${ul.tone}`}>{tr(ul.label)}</span></span>],
    ['🌬️', tr('Wind'), `${fmt(d.windMax)} km/h ${compass(d.windDir)}`],
    has(d.sunshineSec) && ['☀️', tr('Sunshine'), tr('{h} h', { h: fmt(d.sunshineSec / 3600, 1) })],
    d.sunrise && d.sunset && ['🌅', tr('Sunrise – sunset'), `${fmtTime(d.sunrise, offsetSec)} – ${fmtTime(d.sunset, offsetSec)}`],
  ].filter(Boolean);
  return (
    <div className="card day-panel" aria-label={tr('Weather for {day}', { day: label })}>
      <h3>{label}</h3>
      <ul className="row-list">
        {rows.map(([ic, k, v]) => (
          <li key={k}>
            <span className="rl-ic" aria-hidden="true">{ic}</span>
            <span className="rl-k">{k}</span>
            <b className="rl-v">{v}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
