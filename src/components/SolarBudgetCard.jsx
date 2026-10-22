import { fmtHour } from '../lib/battery.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// "Use your free solar": how much solar is spare today, when, and what it can run.
export default function SolarBudgetCard({ budget: b, rate }) {
  const max = Math.max(0.1, ...b.surplus);
  const parts = [
    { key: 'home', label: tr('Home uses'), kwh: b.homeKwh, color: '#9aa3b2' },
    { key: 'battery', label: tr('Battery stores'), kwh: b.batteryKwh, color: 'var(--sky)' },
    { key: 'ev', label: tr('EV'), kwh: b.evKwh, color: '#6bb38a' },
    { key: 'spare', label: tr('To the grid'), kwh: b.spareKwh, color: 'var(--sun)' },
  ].filter((p) => p.kwh >= 0.05);
  const total = Math.max(0.1, parts.reduce((s, p) => s + p.kwh, 0));
  const none = b.surplusKwh < 0.5;

  return (
    <div className="card section" id="plan-budget">
      <h2>
        ☀ {tr('Use your spare solar')}
        <Tip text="Spare solar is what your panels make beyond your home's normal use in each hour. Right now it charges the battery or goes to the grid. Run appliances in these hours instead of the evening and they use solar straight from the roof, so you buy less power later. Appliance figures are typical: washing machine 0.5 kWh, water heater 1.5 kWh, iron 0.8 kWh, dishwasher 1.2 kWh, dryer 2.5 kWh, aircon about 1 kWh an hour." />
      </h2>

      <div className="budget-head">
        <div className={`budget-big ${none ? 'none' : ''}`}>
          <div className="v">
            {b.surplusKwh.toFixed(1)}
            <small> kWh</small>
          </div>
          <div className="k">{none ? tr('No spare solar') : tr('spare solar you can use')}</div>
          {!none && <div className="small">≈ RM {(b.surplusKwh * rate).toFixed(2)} {tr('you won\'t need to buy')}</div>}
        </div>
        <div className="budget-when">
          <div className="k">🕐 {tr('Best time')}</div>
          <div className="v">{b.window ? `${fmtHour(b.window.start)}–${fmtHour(b.window.end)}` : '—'}</div>
          {b.peakHour !== null && !none && <div className="small muted">{tr('Most at {hour}', { hour: fmtHour(b.peakHour) })}</div>}
        </div>
      </div>

      <div className="budget-split" aria-label={tr('Where your solar goes')}>
        <div className="legend">
          <span className="muted">☀ {tr('Solar made')} {b.madeKwh.toFixed(1)} kWh:</span>
          {parts.map((p) => (
            <span key={p.key}>
              <i style={{ background: p.color }} />
              {p.label} {p.kwh.toFixed(1)}
            </span>
          ))}
        </div>
      </div>

      {b.picks.length > 0 ? (
        <>
          <div className="small" style={{ fontWeight: 700, margin: '14px 0 8px' }}>{tr('Run these in those hours:')}</div>
          <div className="budget-picks">
            {b.picks.map((p) => (
              <span key={p.key} className="pick">
                <span aria-hidden="true">{p.icon}</span>
                {p.key === 'aircon' ? tr('Aircon {n} h', { n: p.hours }) : tr(p.label)}
                <small>{p.kwh.toFixed(1)} kWh</small>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: '12px 0 0' }}>{tr('Your home uses all the solar. Nothing to shift.')}</p>
      )}
    </div>
  );
}
