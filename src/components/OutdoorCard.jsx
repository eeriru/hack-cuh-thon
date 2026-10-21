import { useState } from 'react';
import { outdoorPlan } from '../lib/outdoor.js';
import { fmtHour } from '../lib/battery.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

const KEY = 'sh-sensitive';
const readSensitive = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

const LEVEL = {
  great: { label: 'Great', color: 'var(--good)' },
  ok: { label: 'OK', color: '#e0b02c' },
  avoid: { label: 'Avoid', color: '#d9d4ca' },
};

// Outdoor planner: the best hours to jog, cycle or play sports in the next day and a half.
export default function OutdoorCard({ data, todayStr }) {
  const [sensitive, setSensitive] = useState(readSensitive);
  if (!data?.hours?.length) return null;
  const plan = outdoorPlan(data.hours, { offsetSec: data.offsetSec, sensitive });
  if (!plan.hours.length) return null;
  const toggle = () => {
    const v = !sensitive;
    setSensitive(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* fine */
    }
  };
  const dayName = (d) => (d === todayStr ? tr('Today') : tr('Tomorrow'));

  return (
    <div className="card section">
      <div className="spread">
        <div>
          <h2>
            🏃 {tr('Outdoor planner')}
            <Tip text="Each hour is rated for jogging, cycling or outdoor sports using the air-quality forecast (US AQI), how hot it feels (heat index), UV and rain. Night hours (10pm–5am) are left out." />
          </h2>
          <p className="lede" style={{ margin: 0 }}>{tr('The best time to exercise outside, from air quality, heat, UV and rain.')}</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={sensitive} onChange={toggle} />
          <span>{tr('Child, elderly or asthma (stricter air limits)')}</span>
        </label>
      </div>

      <div className="outdoor-best">
        {plan.best.map((b) => (
          <div key={b.date} className={`ob ${b.none ? 'none' : b.level}`}>
            <div className="k">{dayName(b.date)}</div>
            {b.none ? (
              <div className="v">{tr('No good time')}{b.why ? ` (${tr(b.why)})` : ''}</div>
            ) : (
              <>
                <div className="v">
                  {fmtHour(b.startHour)}–{fmtHour(b.endHour)}
                </div>
                <div className="small">{b.level === 'great' ? tr('Great conditions') : tr('Fine, not perfect')}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="outdoor-strip" role="list" aria-label={tr('Hour-by-hour outdoor rating')}>
        {plan.hours.map((h) => (
          <div
            role="listitem"
            key={h.t}
            className="oh"
            style={{ background: LEVEL[h.level].color }}
            title={`${dayName(h.date)} ${fmtHour(h.hour)}: ${tr(LEVEL[h.level].label)}${h.reasons.length ? ` (${h.reasons.map((r) => tr(r)).join(', ')})` : ''}`}
          >
            <span>{h.hour % 3 === 0 ? fmtHour(h.hour) : ''}</span>
          </div>
        ))}
      </div>
      <div className="legend">
        {Object.entries(LEVEL).map(([k, l]) => (
          <span key={k}>
            <i style={{ background: l.color }} />
            {tr(l.label)}
          </span>
        ))}
        <span className="muted">{tr('Hover or tap an hour for the reason')}</span>
      </div>
    </div>
  );
}
