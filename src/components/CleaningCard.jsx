import { cleaningAdvice } from '../lib/cleaning.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

/** Short verdict for the cleaning advice, used here and on the Planner's summary tiles. */
export function cleaningVerdict(a) {
  if (a.action === 'wash') return { icon: '🧽', tone: 'bad', short: tr('Wash'), text: tr('Wash before {day}', { day: a.sunniestDay }) };
  if (a.action === 'wait-rain')
    return {
      icon: '🌧️',
      tone: 'moderate',
      short: tr('Wait for rain'),
      text: a.rainDay === tr('today') ? tr('Wait: rain today will clean them') : tr('Wait: rain {day} will clean them', { day: a.rainDay }),
    };
  return { icon: '✨', tone: 'good', short: tr('Clean'), text: tr('Clean enough this week') };
}

// Panel cleaning reminder: how much dust is costing you, and whether to wash now,
// wait for rain, or leave it.
export default function CleaningCard({ days, rate }) {
  const a = cleaningAdvice(days, { rate });
  if (!a) return null;
  const v = cleaningVerdict(a);
  return (
    <div className="card section clean-card" id="plan-clean">
      <div className="spread">
        <div>
          <h2>
            🧽 {tr('Panel cleaning')}
            <Tip text="Dust, pollen and haze smoke settle on solar panels and block sunlight. Rain washes most of it off. We estimate the dust from the number of dry days and the smoke in the air: about 1% after rain, plus about 0.4% a day, up to 6%." />
          </h2>
          <p className={`clean-head tone-${v.tone}`}>
            {v.text}
            {a.action === 'wash' && (
              <Tip
                label="How to wash"
                text="Wash early in the morning or evening with plain water and a soft brush. Never on hot panels, and use a long-handled brush from the ground rather than climbing on the roof."
              />
            )}
          </p>
          {a.dryDays !== null && <span className="badge soft">☀ {tr(a.dryDays === 1 ? '{n} dry day' : '{n} dry days', { n: a.dryDays })}</span>}
        </div>
        <div className="clean-gauge" aria-label={tr('Estimated dust {pct}%', { pct: a.soilPct.toFixed(1) })}>
          <div className="v">{a.soilPct.toFixed(1)}%</div>
          <div className="k">{tr('dust on panels')}</div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (a.soilPct / 6) * 100)}%` }} />
          </div>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v" style={{ color: 'var(--loss)' }}>RM {a.todayLossRm.toFixed(2)}</div>
          <div className="k">{tr('Lost to dust today')} · {a.todayLossKwh.toFixed(1)} kWh</div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--loss)' }}>RM {a.weekLossRm.toFixed(2)}</div>
          <div className="k">{tr('This week if not washed')}</div>
        </div>
        <div>
          <div className="v" style={{ color: a.savingRm >= 0.5 ? 'var(--good)' : 'var(--ink-2)' }}>RM {a.savingRm.toFixed(2)}</div>
          <div className="k">{tr('Saved by washing today')}</div>
        </div>
      </div>
    </div>
  );
}
