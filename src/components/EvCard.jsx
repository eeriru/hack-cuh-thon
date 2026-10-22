import { planEv, DEFAULT_EV } from '../lib/ev.js';
import { fmtHour, hourRanges } from '../lib/battery.js';
import { Tip } from './Friendly.jsx';
import { NumField } from './HomeSettings.jsx';
import { tr } from '../lib/i18n.js';

// EV charging planner for the selected day.
export default function EvCard({ spareSolar, settings, setSettings, home }) {
  const ev = { ...DEFAULT_EV, ...settings.ev };
  const set = (patch) => setSettings({ ...settings, ev: { ...ev, ...patch } });
  const tou = home.tariff.mode === 'tou';
  const tip = (
    <Tip text="We work out how much charge your daily driving needs, then fill it from solar your house and battery can't use (it would otherwise go to the grid), and the rest at the cheapest hours your car is plugged in at home." />
  );

  if (!ev.enabled) {
    return (
      <div className="card section" id="plan-ev">
        <div className="spread">
          <h2>
            🚗 {tr('EV charging')}
            {tip}
          </h2>
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
    <div className="card section" id="plan-ev">
      <div className="spread">
        <h2>
          🚗 {tr('EV charging')}
          {tip}
          <span className="h-sub">{tr('{km} km → {kwh} kWh', { km: ev.kmPerDay, kwh: p.needKwh.toFixed(1) })}</span>
        </h2>
        <button className="chip" onClick={() => set({ enabled: false })}>{tr('Hide')}</button>
      </div>

      <div className="plan-cols">
        <div className="plan">
          <h3>{tr('Plug in at home')}</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh {tr('grid')} · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul className="icon-list">
            <li>
              <span aria-hidden="true">🔌</span>
              {hourRanges(hoursWith(s.grid.map((g, h) => g + s.solar[h]))) || '—'}
            </li>
            {tou && (
              <li className="tone-bad">
                <span aria-hidden="true">💸</span>
                {tr('Peak rate {from}–{to}', { from: fmtHour(home.tariff.peakStart), to: fmtHour(home.tariff.peakEnd) })}
              </li>
            )}
          </ul>
        </div>
        <div className="plan smart">
          <h3>☀ {tr('Smart charging')}</h3>
          <div className="big">RM {m.costRm.toFixed(2)}</div>
          <div className="small muted">
            {m.gridKwh.toFixed(1)} kWh {tr('grid')} · {m.solarKwh.toFixed(1)} kWh {tr('solar')}
          </div>
          <ul className="icon-list">
            {m.solarKwh > 0.05 && (
              <li>
                <span aria-hidden="true">☀</span>
                {tr('Solar {hours}', { hours: hourRanges(hoursWith(m.solar)) })}
              </li>
            )}
            {m.gridKwh > 0.05 && (
              <li>
                <span aria-hidden="true">⚡</span>
                {tr(tou ? 'Grid {hours} (off-peak)' : 'Grid {hours}', { hours: hourRanges(hoursWith(m.grid)) })}
              </li>
            )}
            {m.shortKwh > 0.05 && (
              <li className="tone-bad">
                <span aria-hidden="true">⚠</span>
                {tr('{kwh} kWh short', { kwh: m.shortKwh.toFixed(1) })}
              </li>
            )}
            {!ev.homeDaytime && (
              <li>
                <span aria-hidden="true">⏲</span>
                {tr("Use the car's charging timer")}
              </li>
            )}
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
          <div className="k">{tr('per 100 km (petrol ≈ RM 14)')}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
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

      <details className="mini-more">
        <summary>⚙ {tr('Car settings')}</summary>
        <div className="settings" style={{ marginTop: 10 }}>
          <NumField label="Driving per day" unit="km" value={ev.kmPerDay} min={0} max={500} step={5} onChange={(v) => set({ kmPerDay: v })} />
          <NumField label="Car uses" unit="kWh/100 km" value={ev.kwhPer100km} min={8} max={30} step={0.5} onChange={(v) => set({ kwhPer100km: v })} hint="Most small EVs use 13–17" />
          <NumField label="Charger" unit="kW" value={ev.chargerKw} min={1.8} max={22} step={0.1} onChange={(v) => set({ chargerKw: v })} hint="Wall box 7 kW · 3-pin plug 2.3 kW" />
          <div className="field">
            <label htmlFor="ev-day">{tr('Car at home in the daytime?')}</label>
            <select id="ev-day" value={ev.homeDaytime ? 'yes' : 'no'} onChange={(e) => set({ homeDaytime: e.target.value === 'yes' })}>
              <option value="no">{tr('No, I drive to work')}</option>
              <option value="yes">{tr('Yes (work from home, weekend)')}</option>
            </select>
          </div>
          {!ev.homeDaytime && (
            <>
              <NumField label="Leave home" unit="hour, 0–23" value={ev.leaveHour} min={0} max={23} step={1} onChange={(v) => set({ leaveHour: Math.round(v) })} />
              <NumField label="Get home" unit="hour, 0–23" value={ev.arriveHour} min={0} max={23} step={1} onChange={(v) => set({ arriveHour: Math.round(v) })} />
            </>
          )}
        </div>
      </details>
    </div>
  );
}
