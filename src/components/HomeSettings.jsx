import { useState } from 'react';
import { More } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

// "Your home" settings used by the solar figures and every planner. Saved in the browser.
export default function HomeSettings({ settings, setSettings, defaultOpen = false }) {
  const tariff = settings.home.tariff;
  const setTariff = (patch) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...tariff, ...patch } } });
  return (
    <More
      title="⚙ Your home"
      hint={`${settings.kwp} kW ${tr('solar')} · ${settings.batteryKwh} kWh ${tr('battery')} · ${settings.dailyKwh} kWh/${tr('day')} · ${tr(tariff.mode === 'tou' ? 'time-of-use tariff' : 'flat tariff')}`}
      defaultOpen={defaultOpen}
    >
      <div className="card">
        <div className="settings">
          <NumField label="Solar size" unit="kWp" value={settings.kwp} min={1} max={20} step={0.5} onChange={(v) => setSettings({ ...settings, kwp: v })} />
          <NumField label="Battery" unit="kWh" value={settings.batteryKwh} min={1} max={30} step={0.5} onChange={(v) => setSettings({ ...settings, batteryKwh: v })} />
          <NumField label="Daily use" unit="kWh" value={settings.dailyKwh} min={5} max={60} step={1} onChange={(v) => setSettings({ ...settings, dailyKwh: v })} hint="Your monthly bill kWh ÷ 30" />
          <div className="field">
            <label htmlFor="tariff">{tr('Tariff')}</label>
            <select id="tariff" value={tariff.mode} onChange={(e) => setTariff({ mode: e.target.value })}>
              <option value="tou">{tr('Time-of-use (peak 2pm–10pm weekdays)')}</option>
              <option value="flat">{tr('Flat rate')}</option>
            </select>
          </div>
          {tariff.mode === 'tou' ? (
            <>
              <NumField label="Peak rate" unit="RM/kWh" value={tariff.peakRate} min={0} max={2} step={0.01} onChange={(v) => setTariff({ peakRate: v })} hint="Example value — use your bill" />
              <NumField label="Off-peak rate" unit="RM/kWh" value={tariff.offPeakRate} min={0} max={2} step={0.01} onChange={(v) => setTariff({ offPeakRate: v })} hint="Example value — use your bill" />
            </>
          ) : (
            <NumField label="Rate" unit="RM/kWh" value={tariff.flatRate} min={0} max={2} step={0.01} onChange={(v) => setTariff({ flatRate: v })} hint="Example value — use your bill" />
          )}
        </div>
      </div>
    </More>
  );
}

export function NumField({ label, unit, value, onChange, min, max, step, hint }) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  // What is typed is kept as text, so "15" can be typed even when the minimum is 8
  // (the "1" on its own used to snap straight to 8). Valid numbers are saved as you type;
  // anything out of range is pulled back into range when you leave the box.
  const [draft, setDraft] = useState(null);
  return (
    <div className="field">
      <label htmlFor={id}>
        {tr(label)} ({tr(unit)})
      </label>
      <input
        id={id}
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => {
          const v = parseFloat(draft);
          if (draft !== null && !Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          setDraft(null);
        }}
      />
      {hint && <div className="hint">{tr(hint)}</div>}
    </div>
  );
}
