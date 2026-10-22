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
  const peak = (h) => tou && h >= home.tariff.peakStart && h < home.tariff.peakEnd;
  const stdHours = hoursWith(s.grid.map((g, h) => g + s.solar[h]));
  const stdPeak = stdHours.some(peak);
  // When to set the car's timer: the first smart-charging hour after you get home.
  const smartHours = hoursWith(m.grid.map((g, h) => g + m.solar[h]));
  const order = Array.from({ length: 24 }, (_, i) => (ev.arriveHour + i) % 24);
  const timerHour = ev.homeDaytime ? null : order.find((h) => smartHours.includes(h) && m.grid[h] > 0.01);
  const noSolarWhy = m.solarKwh < 0.05 ? (ev.homeDaytime ? tr('home and battery use it all') : tr('the car is away in the daytime')) : null;
  return (
    <div className="card section" id="plan-ev">
      <div className="spread">
        <h2>
          🚗 {tr('EV charging')}
          {tip}
        </h2>
        <button className="chip" onClick={() => set({ enabled: false })}>{tr('Hide')}</button>
      </div>
      <p className="ev-need">
        🔋 {tr('Your car needs')} <b>{p.needKwh.toFixed(1)} kWh</b> {tr('a day')} <span className="muted">({tr('{km} km of driving', { km: ev.kmPerDay })})</span>
      </p>

      <div className="plan-cols">
        <div className="plan smart">
          <h3>✅ {tr('Best way to charge')}</h3>
          <div className="big">
            RM {m.costRm.toFixed(2)} <small>{tr('a day')}</small>
          </div>
          <ul className="icon-list">
            {m.solarKwh > 0.05 && (
              <li>
                <span aria-hidden="true">☀</span>
                {tr('Free solar {hours} · {kwh} kWh', { hours: hourRanges(hoursWith(m.solar)), kwh: m.solarKwh.toFixed(1) })}
              </li>
            )}
            {m.gridKwh > 0.05 && (
              <li>
                <span aria-hidden="true">🌙</span>
                {tr(tou ? 'Grid {hours} · {kwh} kWh (cheap rate)' : 'Grid {hours} · {kwh} kWh', { hours: hourRanges(hoursWith(m.grid)), kwh: m.gridKwh.toFixed(1) })}
              </li>
            )}
            {timerHour !== undefined && timerHour !== null && (
              <li>
                <span aria-hidden="true">⏲</span>
                {tr("Set the car's timer to {hour}", { hour: fmtHour(timerHour) })}
              </li>
            )}
            {m.shortKwh > 0.05 && (
              <li className="tone-bad">
                <span aria-hidden="true">⚠</span>
                {tr("Can't fully charge: {kwh} kWh short", { kwh: m.shortKwh.toFixed(1) })}
              </li>
            )}
            {noSolarWhy && (
              <li className="muted">
                <span aria-hidden="true">☁</span>
                {tr('No free solar for the car: {why}', { why: noSolarWhy })}
              </li>
            )}
          </ul>
        </div>
        <div className="plan">
          <h3>❌ {tr('Plugging in when you get home')}</h3>
          <div className="big">
            RM {s.costRm.toFixed(2)} <small>{tr('a day')}</small>
          </div>
          <ul className="icon-list">
            <li>
              <span aria-hidden="true">🔌</span>
              {tr('Charges {hours}', { hours: hourRanges(stdHours) || '—' })}
            </li>
            {stdPeak && (
              <li className="tone-bad">
                <span aria-hidden="true">💸</span>
                {tr('Expensive peak rate ({from}–{to})', { from: fmtHour(home.tariff.peakStart), to: fmtHour(home.tariff.peakEnd) })}
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v">RM {p.savingRm.toFixed(2)}</div>
          <div className="k">{tr('You save each day')}</div>
          <div className="s">≈ RM {(p.savingRm * 30).toFixed(0)} {tr('a month')}</div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--ink)' }}>RM {((m.costRm / Math.max(1, ev.kmPerDay)) * 100).toFixed(2)}</div>
          <div className="k">{tr('Cost per 100 km')}</div>
          <div className="s">{tr('Petrol car ≈ RM 14')}</div>
        </div>
        {p.co2SavedKg >= 0.05 && (
          <div>
            <div className="v">{p.co2SavedKg.toFixed(1)} kg</div>
            <div className="k">{tr('Less CO₂ each day')}</div>
            <div className="s">{tr('from charging on solar')}</div>
          </div>
        )}
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
