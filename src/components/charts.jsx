import { useState } from 'react';
import { aqiLevel } from '../lib/aqi.js';
import { fmtHour } from '../lib/battery.js';

const W = 720;

/** Hourly AQI bars, coloured by category. points: [{ key, label, aqi, sub }] */
export function AqiBars({ points, height = 170 }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const pad = { l: 30, r: 8, t: 12, b: 26 };
  const max = Math.max(100, ...points.map((p) => p.aqi || 0)) * 1.1;
  const bw = (W - pad.l - pad.r) / Math.max(1, points.length);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 50, 100, 150, 200, 300].filter((v) => v <= max);
  return (
    <div className="chart-box">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hourly air quality forecast">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v ? '3 4' : ''} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const lvl = aqiLevel(p.aqi);
          const x = pad.l + i * bw;
          const top = y(p.aqi || 0);
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect
                x={x + bw * 0.14}
                y={top}
                width={bw * 0.72}
                height={Math.max(2, H - pad.b - top)}
                rx={Math.min(5, bw * 0.3)}
                fill={lvl.color}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              {(i % Math.ceil(points.length / 8) === 0 || points.length <= 8) && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && points[hover] && (
        <div
          className="tip"
          style={{ left: `${((pad.l + (hover + 0.5) * bw) / W) * 100}%`, top: `${(y(points[hover].aqi || 0) / H) * 100}%` }}
        >
          <b>{points[hover].sub}</b> · AQI {Math.round(points[hover].aqi ?? 0)} · {aqiLevel(points[hover].aqi).short || aqiLevel(points[hover].aqi).label}
        </div>
      )}
    </div>
  );
}

/**
 * Sunlight on the roof through the day: without haze vs with haze, plus satellite
 * measurements for past days. rows come from computeHazeLoss().
 */
export function SolarChart({ rows, satellite, height = 280 }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const day = rows.filter((r) => r.localHour >= 6 && r.localHour <= 19);
  if (!day.length) return <p className="muted">No daylight hours in range.</p>;
  const sat = (r) => satellite?.get(r.t);
  const max = Math.max(200, ...day.map((r) => Math.max(r.ghiClean, sat(r) ?? 0))) * 1.08;
  const n = day.length;
  const x = (i) => pad.l + ((W - pad.l - pad.r) * (i + 0.5)) / n;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const path = (key) => day.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${path(key)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const lossBand =
    day.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.ghiClean).toFixed(1)}`).join(' ') +
    ' ' +
    [...day]
      .reverse()
      .map((r, j) => `L${x(n - 1 - j).toFixed(1)},${y(r.ghiHaze).toFixed(1)}`)
      .join(' ') +
    ' Z';
  const ticks = [0, 200, 400, 600, 800, 1000].filter((v) => v <= max);
  const h = hover !== null ? day[hover] : null;
  return (
    <div className="chart-box">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sunlight through the day with and without haze">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#f6c3a8" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#e0703e" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v ? '3 4' : ''} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={pad.l} y={pad.t - 2} style={{ fontWeight: 600 }}>W/m²</text>
        <path d={area('ghiHaze')} fill="#fbd98a" opacity="0.75" />
        <path d={lossBand} fill="url(#hatch)" opacity="0.85" />
        <path d={path('ghiClean')} fill="none" stroke="var(--sun-deep)" strokeWidth="2" strokeDasharray="6 4" />
        <path d={path('ghiHaze')} fill="none" stroke="var(--sun-deep)" strokeWidth="2.5" />
        {day.map((r, i) =>
          sat(r) !== undefined ? (
            <circle key={`s${r.t}`} cx={x(i)} cy={y(sat(r))} r="4.5" fill="var(--sky)" stroke="#fff" strokeWidth="1.5" />
          ) : null
        )}
        {day.map((r, i) => (
          <g key={r.t}>
            {i % 2 === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle">{fmtHour(r.localHour)}</text>
            )}
            <rect
              x={x(i) - (W - pad.l - pad.r) / n / 2}
              y={pad.t}
              width={(W - pad.l - pad.r) / n}
              height={H - pad.t - pad.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
        {h && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink)" strokeOpacity="0.25" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.ghiClean) / H) * 100}%` }}>
          <b>{fmtHour(h.localHour)}–{fmtHour(h.localHour + 1)}</b> · no haze {Math.round(h.ghiClean)} · with haze{' '}
          {Math.round(h.ghiHaze)} W/m²
          {sat(h) !== undefined && <> · satellite {Math.round(sat(h))}</>}
          <br />
          Haze {h.aod?.toFixed(2) ?? '–'} AOD · PM2.5 {Math.round(h.pm2_5 ?? 0)} · cloud {Math.round(h.cloud_low ?? 0)}% low ·
          lost {h.lossKwh.toFixed(2)} kWh
        </div>
      )}
    </div>
  );
}

/** Battery charge level (%) through the day for both plans. */
export function SocChart({ standard, smart, height = 150 }) {
  const H = height;
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const x = (h) => pad.l + ((W - pad.l - pad.r) * h) / 23;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const line = (arr) => arr.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Battery charge through the day">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v ? '3 4' : ''} />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}%</text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={x(h)} y={H - 6} textAnchor="middle">{fmtHour(h)}</text>
      ))}
      <path d={line(standard)} fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="5 4" />
      <path d={line(smart)} fill="none" stroke="var(--sun-deep)" strokeWidth="2.5" />
    </svg>
  );
}
