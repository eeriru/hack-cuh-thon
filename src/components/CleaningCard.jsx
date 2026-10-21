import { cleaningAdvice } from '../lib/cleaning.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// Panel cleaning reminder: how much dust is costing you, and whether to wash now,
// wait for rain, or leave it.
export default function CleaningCard({ days, rate }) {
  const a = cleaningAdvice(days, { rate });
  if (!a) return null;
  const tone = a.action === 'wash' ? 'bad' : a.action === 'wait-rain' ? 'moderate' : 'good';
  const headline =
    a.action === 'wash'
      ? tr('Time to wash your panels, ideally before {day}.', { day: a.sunniestDay })
      : a.action === 'wait-rain'
        ? a.rainDay === tr('today')
          ? tr('Skip the hose: rain today should wash them for free.')
          : tr('Skip the hose: rain on {day} should wash them for free.', { day: a.rainDay })
        : tr('Your panels are fairly clean. No need to wash them this week.');
  return (
    <div className="card section clean-card">
      <div className="spread">
        <div>
          <h2>
            🧽 {tr('Panel cleaning reminder')}
            <Tip text="Dust, pollen and haze smoke settle on solar panels and block sunlight. Rain washes most of it off. We estimate the dust from the number of dry days and the smoke in the air: about 1% after rain, plus about 0.4% a day, up to 6%." />
          </h2>
          <p className={`clean-head tone-${tone}`}>{headline}</p>
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
          <div className="v" style={{ color: 'var(--loss)' }}>{a.todayLossKwh.toFixed(1)} kWh</div>
          <div className="k">{tr('Lost to dust today (RM {rm})', { rm: a.todayLossRm.toFixed(2) })}</div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--loss)' }}>RM {a.weekLossRm.toFixed(2)}</div>
          <div className="k">{tr('Dust costs this week if you leave it')}</div>
        </div>
        <div>
          <div className="v" style={{ color: a.savingRm >= 0.5 ? 'var(--good)' : 'var(--ink-2)' }}>RM {a.savingRm.toFixed(2)}</div>
          <div className="k">{tr('Saved this week by washing today ({kwh} kWh)', { kwh: a.savingKwh.toFixed(1) })}</div>
        </div>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {a.dryDays !== null ? `${tr(a.dryDays === 1 ? '{n} dry day since the last good rain.' : '{n} dry days since the last good rain.', { n: a.dryDays })} ` : ''}
        {tr('Wash early in the morning or evening with plain water and a soft brush. Never on hot panels, and use a long-handled brush from the ground rather than climbing on the roof.')}
      </p>
    </div>
  );
}
