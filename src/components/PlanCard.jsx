import { hourRanges, fmtHour } from '../lib/battery.js';
import { SocChart } from './charts.jsx';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// Battery and chores plan: a normal day next to the cheapest (haze-aware) day.
export default function PlanCard({ plan, home, weekend }) {
  const tou = home.tariff.mode === 'tou';
  const s = plan.standard;
  const h = plan.hazeAware;
  const steps = [];
  if (plan.flexWhy === 'sunniest') steps.push(['🧺', tr('Chores {hours}', { hours: hourRanges(plan.flexHours) })]);
  else if (plan.flexWhy === 'offpeak') steps.push(['🧺', tr('Chores after {hour} (off-peak)', { hour: fmtHour(home.tariff.peakEnd) })]);
  else steps.push(['🧺', tr('Chores {hours} (no change)', { hours: hourRanges(plan.flexHours) })]);
  if (plan.reserve) steps.push(['🔋', tr('Save battery for {from}–{to}', { from: fmtHour(home.tariff.peakStart), to: fmtHour(home.tariff.peakEnd) })]);
  if (plan.topUpKwh > 0.05) steps.push(['⚡', tr('Grid top-up {kwh} kWh, 2am–6am', { kwh: plan.topUpKwh.toFixed(1) })]);
  if (!plan.reserve && plan.topUpKwh <= 0.05 && tou) steps.push(['🔋', tr('Use battery anytime')]);

  return (
    <div className="card section" id="plan-battery">
      <div className="spread">
        <h2>
          🔋 {tr('Battery & chores')}
          <Tip text="We replay the day hour by hour with your predicted (hazy) solar output and try every combination of chore timing, battery reserve and off-peak top-up, keeping the cheapest. Household demand is simulated from a typical Malaysian terrace home." />
        </h2>
        {weekend && <span className="badge soft">{tr('Weekend: off-peak all day')}</span>}
      </div>
      <div className="plan-cols">
        <div className="plan">
          <h3>{tr('Normal day')}</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh {tr('grid')} · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
        </div>
        <div className="plan smart">
          <h3>☀ {tr('Smart day')}</h3>
          <div className="big">RM {h.costRm.toFixed(2)}</div>
          <div className="small muted">
            {h.gridKwh.toFixed(1)} kWh {tr('grid')} · {h.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul className="icon-list">
            {steps.map(([icon, x]) => (
              <li key={x}>
                <span aria-hidden="true">{icon}</span>
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v">RM {plan.savingRm.toFixed(2)}</div>
          <div className="k">{tr('Saved today · ~RM {m}/month', { m: (plan.savingRm * 30).toFixed(0) })}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.gridSavedKwh >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {plan.gridSavedKwh >= 0 ? '' : '+'}
            {Math.abs(plan.gridSavedKwh).toFixed(1)} kWh
          </div>
          <div className="k">{plan.gridSavedKwh >= 0 ? tr('Less grid power') : tr('More grid power (cheaper hours)')}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.co2SavedKg >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>{Math.abs(plan.co2SavedKg).toFixed(1)} kg</div>
          <div className="k">CO₂ {plan.co2SavedKg >= 0 ? tr('avoided') : tr('added')}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="timeline" aria-label={tr('24-hour schedule')}>
          {Array.from({ length: 24 }, (_, hr) => {
            const peak = tou && hr >= home.tariff.peakStart && hr < home.tariff.peakEnd;
            const flex = plan.flexHours.includes(hr);
            const top = (plan.gridChargeKwh?.[hr] || 0) > 0;
            return (
              <div
                key={hr}
                className={`${peak ? 'peak' : ''} ${flex ? 'flex' : ''} ${top ? 'topup' : ''}`}
                title={`${fmtHour(hr)}${flex ? ` · ${tr('run chores')}` : ''}${top ? ` · ${tr('grid top-up')}` : ''}${peak ? ` · ${tr('peak rate')}` : ''}`}
              />
            );
          })}
        </div>
        <div className="timeline-axis">
          {Array.from({ length: 24 }, (_, hr) => (
            <span key={hr}>{hr % 3 === 0 ? fmtHour(hr) : ''}</span>
          ))}
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--sun)' }} />{tr('Run chores')}</span>
          {plan.topUpKwh > 0.05 && <span><i style={{ background: 'var(--sky)' }} />{tr('Grid top-up')}</span>}
          {tou && <span><i style={{ background: 'var(--paper-2)', boxShadow: 'inset 0 -3px 0 #c9b9a0' }} />{tr('Peak rate')}</span>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>{tr('Battery level')}</div>
        <SocChart standard={s.soc} smart={h.soc} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--ink-3)', height: 0 }} />{tr('Normal day')}</span>
          <span><i style={{ background: 'var(--sun-deep)', height: 3 }} />{tr('Smart day')}</span>
        </div>
      </div>
    </div>
  );
}
