import { planEv, DEFAULT_EV } from '../lib/ev.js';
import { fmtHour, hourRanges } from '../lib/battery.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// EV charging planner for the selected day.
export default function EvCard({ spareSolar, settings, setSettings, home, isPast }) {
  const ev = { ...DEFAULT_EV, ...settings.ev };
  const set = (patch) => setSettings({ ...settings, ev: { ...ev, ...patch } });
  const tou = home.tariff.mode === 'tou';

  if (!ev.enabled) {
    return (
      <div className="card section">
        <div className="spread">
          <div>
            <h2>🚗 {tr('EV charging planner')}</h2>
            <p className="lede" style={{ margin: 0 }}>{tr('Have an electric car? Find the cheapest hours to charge it, using your spare solar first.')}</p>
          </div>
          <button className="btn" onClick={() => set({ enabled: true })}>{tr('Add my EV')}</button>
        </div>
      </div>
    );
  }

  const p = planEv(spareSolar, ev, home);
  const s = p.standard;
  const m = p.smart;
  const hoursWith = (arr) => arr.map((k, h) => (k > 0.01 ? h : null)).filter((h) => h !== null);
  return (
    <div className="card section">
      <div className="spread">
        <div>
          <h2>
            🚗 {tr('EV charging plan')} {isPast ? tr('(what would have helped)') : ''}
            <Tip text="We work out how much charge your daily driving needs, then fill it from solar your house and battery can't use (it would otherwise go to the grid), and the rest at the cheapest hours your car is plugged in at home." />
          </h2>
          <p className="lede" style={{ margin: 0 }}>
            {tr('{km} km a day needs about {kwh} kWh of charge.', { km: ev.kmPerDay, kwh: p.needKwh.toFixed(1) })}
          </p>
        </div>
        <button className="chip" onClick={() => set({ enabled: false })}>{tr('Hide')}</button>
      </div>

      <div className="settings" style={{ marginTop: 12 }}>
        <Num label="Driving per day" unit="km" value={ev.kmPerDay} min={0} max={500} step={5} onChange={(v) => set({ kmPerDay: v })} />
        <Num label="Car uses" unit="kWh/100 km" value={ev.kwhPer100km} min={8} max={30} step={0.5} onChange={(v) => set({ kwhPer100km: v })} hint="Most small EVs use 13–17" />
        <Num label="Charger" unit="kW" value={ev.chargerKw} min={1.8} max={22} step={0.1} onChange={(v) => set({ chargerKw: v })} hint="Wall box 7 kW · 3-pin plug 2.3 kW" />
        <div className="field">
          <label htmlFor="ev-day">{tr('Car at home in the daytime?')}</label>
          <select id="ev-day" value={ev.homeDaytime ? 'yes' : 'no'} onChange={(e) => set({ homeDaytime: e.target.value === 'yes' })}>
            <option value="no">{tr('No, I drive to work')}</option>
            <option value="yes">{tr('Yes (work from home, weekend)')}</option>
          </select>
        </div>
        {!ev.homeDaytime && (
          <>
            <Num label="Leave home" unit="hour, 0–23" value={ev.leaveHour} min={0} max={23} step={1} onChange={(v) => set({ leaveHour: Math.round(v) })} />
            <Num label="Get home" unit="hour, 0–23" value={ev.arriveHour} min={0} max={23} step={1} onChange={(v) => set({ arriveHour: Math.round(v) })} />
          </>
        )}
      </div>

      <div className="plan-cols">
        <div className="plan">
          <h3>{tr('Plug in when you get home')}</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh {tr('from the grid')} · {s.solarKwh.toFixed(1)} kWh {tr('solar')} · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            <li>{tr('Charges {hours}', { hours: hourRanges(hoursWith(s.grid.map((g, h) => g + s.solar[h]))) || '—' })}</li>
            {tou && <li>{tr('Much of it at the {from}–{to} peak rate', { from: fmtHour(home.tariff.peakStart), to: fmtHour(home.tariff.peakEnd) })}</li>}
          </ul>
        </div>
        <div className="plan smart">
          <h3>☀ {tr('Smart charging')}</h3>
          <div className="big">RM {m.costRm.toFixed(2)}</div>
          <div className="small muted">
            {m.gridKwh.toFixed(1)} kWh {tr('from the grid')} · {m.solarKwh.toFixed(1)} kWh {tr('solar')} · {m.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            {m.solarKwh > 0.05 && <li>{tr('Charge from spare solar {hours}', { hours: hourRanges(hoursWith(m.solar)) })}</li>}
            {m.gridKwh > 0.05 && <li>{tr(tou ? 'Top up from the grid {hours} at the off-peak rate' : 'Top up from the grid {hours}', { hours: hourRanges(hoursWith(m.grid)) })}</li>}
            {m.shortKwh > 0.05 && <li className="tone-bad">{tr("The car can't get a full charge in the hours it's home: {kwh} kWh short", { kwh: m.shortKwh.toFixed(1) })}</li>}
            {ev.homeDaytime ? null : <li>{tr("Set the car's charging timer instead of plugging in and charging straight away")}</li>}
          </ul>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v">RM {p.savingRm.toFixed(2)}</div>
          <div className="k">{tr('Saved today · ~RM {m}/month', { m: (p.savingRm * 30).toFixed(0) })}</div>
        </div>
        <div>
          <div className="v" style={{ color: p.co2SavedKg >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>{Math.abs(p.co2SavedKg).toFixed(1)} kg</div>
          <div className="k">CO₂ {p.co2SavedKg >= 0 ? tr('avoided') : tr('added')}</div>
        </div>
        <div>
          <div className="v">RM {((m.costRm / Math.max(1, ev.kmPerDay)) * 100).toFixed(2)}</div>
          <div className="k">{tr('Cost per 100 km (a petrol car: about RM 14)')}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="small" style={{ fontWeight: 700 }}>{tr('Smart charging schedule')}</div>
        <div className="timeline" aria-label={tr('24-hour EV charging schedule')}>
          {Array.from({ length: 24 }, (_, hr) => {
            const peak = tou && hr >= home.tariff.peakStart && hr < home.tariff.peakEnd;
            const sun = m.solar[hr] > 0.01;
            const grid = m.grid[hr] > 0.01;
            const away = !p.hours.includes(hr);
            return (
              <div
                key={hr}
                className={`${peak ? 'peak' : ''} ${sun ? 'flex' : ''} ${grid ? 'topup' : ''} ${away ? 'away' : ''}`}
                title={`${fmtHour(hr)}${sun ? ` · ${m.solar[hr].toFixed(1)} kWh ${tr('solar')}` : ''}${grid ? ` · ${m.grid[hr].toFixed(1)} kWh ${tr('grid')}` : ''}${away ? ` · ${tr('car away')}` : ''}`}
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
          <span><i style={{ background: 'var(--sun)' }} />{tr('Solar charging')}</span>
          <span><i style={{ background: 'var(--sky)' }} />{tr('Grid charging')}</span>
          <span><i className="away-swatch" />{tr('Car away')}</span>
          {tou && <span><i style={{ background: 'var(--paper-2)', boxShadow: 'inset 0 -3px 0 #c9b9a0' }} />{tr('Peak rate')}</span>}
        </div>
      </div>
    </div>
  );
}

function Num({ label, unit, value, onChange, min, max, step, hint }) {
  const id = `ev-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {tr(label)} ({tr(unit)})
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
      {hint && <div className="hint">{tr(hint)}</div>}
    </div>
  );
}
