import { useState } from 'react';
import { fmtHour, hourRanges } from '../lib/battery.js';
import { itemKwh } from '../lib/budget.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// "Use your free solar": how much solar is spare today, when, and what it can run.
const ITEM_ICONS = ['🔌', '🍳', '🍚', '☕', '💻', '📺', '🎮', '🧹', '🚿', '🏊', '🔋', '🛠'];

export default function SolarBudgetCard({ budget: b, rate, items = [], setItems, choreHours = [] }) {
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
        <Tip text="One shared budget: your home, the chores in the battery plan and the EV's solar charging are taken off first, so nothing is counted twice. Spare solar is what is left in each hour. Right now it charges the battery or goes to the grid. Run appliances in these hours instead of the evening and they use solar straight from the roof, so you buy less power later. Appliance figures are typical: washing machine 0.5 kWh, water heater 1.5 kWh, iron 0.8 kWh, dishwasher 1.2 kWh, dryer 2.5 kWh, aircon about 1 kWh an hour." />
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

      {(b.choresKwh >= 0.05 || b.evKwh >= 0.05) && (
        <div className="budget-counted small">
          <span className="muted">✓ {tr('Already planned on solar:')}</span>
          {b.choresKwh >= 0.05 && (
            <span>
              🧺 {tr('Chores {hours}', { hours: hourRanges(choreHours) })} · {b.choresKwh.toFixed(1)} kWh
            </span>
          )}
          {b.evKwh >= 0.05 && (
            <span>
              🚗 {tr('EV charging')} · {b.evKwh.toFixed(1)} kWh
            </span>
          )}
        </div>
      )}

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
              <span key={p.key} className={`pick ${p.custom ? 'mine' : ''}`}>
                <span aria-hidden="true">{p.icon}</span>
                {p.custom ? p.label : p.key === 'aircon' ? tr('Aircon {n} h', { n: p.hours }) : tr(p.label)}
                <small>{p.kwh.toFixed(1)} kWh</small>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: '12px 0 0' }}>{tr('Your home uses all the solar. Nothing to shift.')}</p>
      )}
      {b.tooBig?.length > 0 && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          ⚠ {tr('Too big for today\'s spare solar:')} {b.tooBig.map((it) => `${it.name} (${it.kwh.toFixed(1)} kWh)`).join(', ')}
        </p>
      )}
      {setItems && <MyItems items={items} setItems={setItems} />}
    </div>
  );
}

// The user's own items: name, power and hours of use. Saved on this device with the other settings.
function MyItems({ items, setItems }) {
  const [icon, setIcon] = useState('🔌');
  const [name, setName] = useState('');
  const [watts, setWatts] = useState('');
  const [hours, setHours] = useState('1');
  const w = parseFloat(watts);
  const hr = parseFloat(hours);
  const ok = name.trim() && w > 0 && hr > 0;
  const add = (e) => {
    e.preventDefault();
    if (!ok) return;
    setItems([...items, { id: Date.now(), icon, name: name.trim().slice(0, 40), watts: Math.min(20000, w), hours: Math.min(24, hr) }]);
    setName('');
    setWatts('');
    setHours('1');
  };
  return (
    <details className="mini-more my-items" open={items.length > 0}>
      <summary>
        ＋ {tr('My items')} {items.length > 0 && <span className="badge soft">{items.length}</span>}
      </summary>
      {items.length > 0 && (
        <ul className="item-list">
          {items.map((it) => (
            <li key={it.id}>
              <span aria-hidden="true">{it.icon}</span>
              <b>{it.name}</b>
              <span className="muted">
                {it.watts} W × {it.hours} h = {itemKwh(it).toFixed(1)} kWh
              </span>
              <button className="chip" aria-label={tr('Remove {name}', { name: it.name })} onClick={() => setItems(items.filter((x) => x.id !== it.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="item-form" onSubmit={add}>
        <select aria-label={tr('Icon')} value={icon} onChange={(e) => setIcon(e.target.value)}>
          {ITEM_ICONS.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <input aria-label={tr('Item name')} placeholder={tr('Item name, e.g. Oven')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>
          <input type="number" min="1" max="20000" step="1" placeholder="1000" value={watts} onChange={(e) => setWatts(e.target.value)} /> W
        </label>
        <label>
          × <input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /> h
        </label>
        <button className="btn" type="submit" disabled={!ok}>
          {tr('Add')}
        </button>
      </form>
      <p className="small muted" style={{ margin: '6px 0 0' }}>{tr('The watts are on the label or plug. Your items are planned first.')}</p>
    </details>
  );
}
