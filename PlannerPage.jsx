import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY } from '../lib/api.js';
import { systemFor, homeFor, homeForDay, avgRateOf, buildDays, planFor, cleaningDays } from '../lib/days.js';
import { useAsync, Loading, DemoBanner, fmtDate } from './common.jsx';
import { Tip } from './Friendly.jsx';
import EvCard from './EvCard.jsx';
import CleaningCard from './CleaningCard.jsx';
import { tr } from '../lib/i18n.js';

// Personal planner: your home, then the EV charging plan and the panel cleaning reminder for today.
export default function PlannerPage({ place, engine, settings, setSettings }) {
  const today = todayMY();
  // Same window as "Weather now" on the Weather & solar page, so the request is shared (cached).
  const startDate = addDays(today, -5);
  const endDate = addDays(today, 6);
  const { data, loading } = useAsync(() => getPlaceData(place, { startDate, endDate }), [place.lat, place.lon, today]);

  const system = useMemo(() => systemFor(settings), [settings]);
  const home = useMemo(() => homeFor(settings), [settings]);
  const days = useMemo(() => buildDays(data, { engine, place, system, startDate, endDate }), [data, engine, place, system, startDate, endDate]);
  const current = days.find((x) => x.d === today);
  const dayHome = useMemo(() => homeForDay(home, today), [home, today]);
  const plan = useMemo(() => planFor(current, dayHome), [current, dayHome]);
  const cleanDays = cleaningDays(days, today, (d) => (d === today ? tr('today') : fmtDate(d, { weekday: 'long' })));

  return (
    <>
      <div className="place-title">
        <h1>{tr('Personal Planner')}</h1>
        <span className="sub">{place.name} · {place.area}</span>
      </div>

      <HomeSettingsCard settings={settings} setSettings={setSettings} />

      {loading || !data || !engine ? (
        <Loading text="Running the solar model for your home…" />
      ) : (
        <>
          <DemoBanner source={data.source} />
          {plan ? (
            <EvCard spareSolar={plan.hazeAware.exported} settings={settings} setSettings={setSettings} home={dayHome} isPast={false} />
          ) : (
            <div className="card section">{tr('No data for this date. Try another date.')}</div>
          )}
          {cleanDays.length > 0 && cleanDays[0].d === today && <CleaningCard days={cleanDays} rate={avgRateOf(dayHome.tariff)} />}
        </>
      )}
    </>
  );
}

function HomeSettingsCard({ settings, setSettings }) {
  const tariff = settings.home.tariff;
  const setTariff = (patch) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...tariff, ...patch } } });
  return (
    <div className="card section">
      <h2>
        🏠 {tr('Your home settings')}
        <Tip text="Change these to match your house. They are saved in this browser and used on every page." />
      </h2>
      <div className="home-tiles">
        <SliderTile icon="☀️" label="Solar size" unit="kWp" value={settings.kwp} min={1} max={20} step={0.5} onChange={(v) => setSettings({ ...settings, kwp: v })} tip="kwp" />
        <SliderTile icon="🔋" label="Battery" unit="kWh" value={settings.batteryKwh} min={1} max={30} step={0.5} onChange={(v) => setSettings({ ...settings, batteryKwh: v })} tip="battery" />
        <SliderTile icon="🔌" label="Daily use" unit="kWh" value={settings.dailyKwh} min={5} max={60} step={1} onChange={(v) => setSettings({ ...settings, dailyKwh: v })} hint="Your monthly bill kWh ÷ 30" />
      </div>

      <div className="tariff-row">
        <span className="tariff-k">💡 {tr('Tariff')}</span>
        <div className="seg" role="group" aria-label={tr('Tariff')}>
          <button className={tariff.mode === 'tou' ? 'active' : ''} aria-pressed={tariff.mode === 'tou'} onClick={() => setTariff({ mode: 'tou' })}>
            🕑 {tr('Time-of-use')}
          </button>
          <button className={tariff.mode === 'flat' ? 'active' : ''} aria-pressed={tariff.mode === 'flat'} onClick={() => setTariff({ mode: 'flat' })}>
            ➖ {tr('Flat rate')}
          </button>
        </div>
        {tariff.mode === 'tou' ? (
          <>
            <RateField label="Peak" value={tariff.peakRate} onChange={(v) => setTariff({ peakRate: v })} />
            <RateField label="Off-peak" value={tariff.offPeakRate} onChange={(v) => setTariff({ offPeakRate: v })} />
          </>
        ) : (
          <RateField label="Rate" value={tariff.flatRate} onChange={(v) => setTariff({ flatRate: v })} />
        )}
        <Tip text="Time-of-use: peak 2pm–10pm on weekdays. Rates are example values; use the ones on your TNB bill." />
      </div>
    </div>
  );
}

function SliderTile({ icon, label, unit, value, min, max, step, onChange, tip, hint }) {
  const id = `home-${label.replace(/\W+/g, '-')}`;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="home-tile">
      <div className="home-tile-top">
        <span className="home-icon" aria-hidden="true">{icon}</span>
        <label htmlFor={id}>
          {tr(label)}
          {tip && <Tip term={tip} />}
          {hint && <Tip text={hint} />}
        </label>
      </div>
      <div className="home-val">
        <input
          type="number"
          aria-label={`${tr(label)} (${unit})`}
          style={{ width: `${String(value).length + 0.6}ch` }}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <small>{unit}</small>
      </div>
      <input
        id={id}
        className="home-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function RateField({ label, value, onChange }) {
  return (
    <label className="rate-field">
      <span>{tr(label)}</span>
      <input
        type="number"
        value={value}
        min={0}
        max={2}
        step={0.01}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(2, Math.max(0, v)));
        }}
      />
      <small>RM/kWh</small>
    </label>
  );
}
