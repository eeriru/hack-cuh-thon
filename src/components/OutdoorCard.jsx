import { useState } from 'react';
import { outdoorPlan } from '../lib/outdoor.js';
import { fmtHour } from '../lib/battery.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';
import { addDays } from '../lib/api.js';
import { fmtDate } from './common.jsx';

const KEY = 'sh-sensitive';
export const readSensitive = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const saveSensitive = (v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* fine */
  }
};

/** The "sensitive person" switch, remembered in the browser. */
export function useSensitive() {
  const [sensitive, setSensitive] = useState(readSensitive);
  return [
    sensitive,
    (v) => {
      setSensitive(v);
      saveSensitive(v);
    },
  ];
}

const LEVEL = {
  great: { label: 'Great', color: 'var(--good)' },
  ok: { label: 'OK', color: '#e0b02c' },
  avoid: { label: 'Avoid', color: '#d9d4ca' },
};

// Outdoor planner: the best hours to jog, cycle or play sports in the next day and a half.
export default function OutdoorCard({ data, todayStr, sensitive, setSensitive }) {
  if (!data?.hours?.length) return null;
  const plan = outdoorPlan(data.hours, { offsetSec: data.offsetSec, sensitive });
  if (!plan.hours.length) return null;
  const dayName = (d) => (d === todayStr ? tr('Today') : d === addDays(todayStr, 1) ? tr('Tomorrow') : fmtDate(d, { weekday: 'long' }));

  return (
    <div className="card section" id="plan-outdoor">
      <div className="spread">
        <h2>
          🏃 {tr('Best time to exercise')}
          <Tip text="Each hour is rated for jogging, cycling or outdoor sports using the air-quality forecast (US AQI), how hot it feels (heat index), UV and rain. Night hours (10pm–5am) are left out." />
        </h2>
        <label className="switch">
          <input type="checkbox" checked={sensitive} onChange={() => setSensitive(!sensitive)} />
          <span>{tr('Kids, elderly, asthma')}</span>
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
                <div className="small">{b.level === 'great' ? `✅ ${tr('Great')}` : `👍 ${tr('OK')}`}</div>
              </>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
