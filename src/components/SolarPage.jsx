import { useEffect, useMemo, useRef, useState } from 'react';
import { getPlaceData, getSatelliteGhi, addDays, todayMY, dayModelHours, availableDates } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { planDay, hourRanges, fmtHour } from '../lib/battery.js';
import { hazeLevel } from '../lib/aqi.js';
import { SolarChart, SocChart } from './charts.jsx';
import HazeScene3D from './HazeScene3D.jsx';
import { useAsync, Loading, DemoBanner, fmtDate } from './common.jsx';

const MAX_PAST = 85;
const MAX_AHEAD = 4;

export default function SolarPage({ place, engine, settings, setSettings }) {
  const today = todayMY();
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  useEffect(() => {
    setAnchor(today);
    setSelected(today);
  }, [place.lat, place.lon, today]);

  const startDate = addDays(anchor, -5) < addDays(today, -MAX_PAST) ? addDays(today, -MAX_PAST) : addDays(anchor, -5);
  const endDate = addDays(anchor, 4) > addDays(today, MAX_AHEAD) ? addDays(today, MAX_AHEAD) : addDays(anchor, 4);

  const { data, loading } = useAsync(() => getPlaceData(place, { startDate, endDate }), [place.lat, place.lon, startDate, endDate]);
  const sat = useAsync(
    () => (selected <= today && data?.source === 'live' ? getSatelliteGhi(place, { startDate: selected, endDate: selected }) : Promise.resolve(new Map())),
    [place.lat, place.lon, selected, data?.source]
  );

  const system = useMemo(() => ({ ...DEFAULT_SYSTEM, kwp: settings.kwp }), [settings.kwp]);
  const home = useMemo(
    () => ({
      ...settings.home,
      battery: { ...settings.home.battery, capacityKwh: settings.batteryKwh, powerKw: Math.max(2.5, settings.batteryKwh / 2) },
      dailyKwh: settings.dailyKwh,
    }),
    [settings]
  );

  const days = useMemo(() => {
    if (!data || !engine) return [];
    return availableDates(data)
      .filter((d) => d >= startDate && d <= endDate)
      .map((d) => ({ d, loss: computeHazeLoss(dayModelHours(data, d), { ...place, engine, system }) }))
      .filter((x) => x.loss.rows.length >= 20);
  }, [data, engine, place, system, startDate, endDate]);

  const current = days.find((x) => x.d === selected) || days.find((x) => x.d === today) || days[days.length - 1];
  const weekend = current ? [0, 6].includes(new Date(`${current.d}T00:00:00Z`).getUTCDay()) : false;
  // Time-of-use peak pricing applies on weekdays only; weekends are off-peak all day.
  const dayHome = useMemo(
    () => (weekend && home.tariff.mode === 'tou' ? { ...home, tariff: { ...home.tariff, mode: 'flat', flatRate: home.tariff.offPeakRate } } : home),
    [home, weekend]
  );
  const barRef = useRef(null);
  useEffect(() => {
    const el = barRef.current?.querySelector('.datebtn.active');
    if (el && barRef.current) barRef.current.scrollLeft = el.offsetLeft - barRef.current.offsetLeft - 40;
  }, [current?.d, days.length]);

  const plan = useMemo(() => {
    if (!current) return null;
    const pv = new Array(24).fill(0);
    const pvClean = new Array(24).fill(0);
    const pm = new Array(24).fill(0);
    current.loss.rows.forEach((r) => {
      pv[r.localHour] = r.kwhHaze;
      pvClean[r.localHour] = r.kwhClean;
      pm[r.localHour] = r.pm2_5 ?? 0;
    });
    const p = planDay(pv, pm, dayHome);
    // Same day, same household, but the sunlight the haze took away is given back.
    p.hazeCostRm = Math.max(0, p.hazeAware.costRm - planDay(pvClean, pm, dayHome).hazeAware.costRm);
    const t = dayHome.tariff;
    p.lossValueRm = current.loss.lossKwh * (t.mode === 'flat' ? t.flatRate : (t.peakRate + t.offPeakRate) / 2);
    return p;
  }, [current, dayHome]);

  const validation = useMemo(() => {
    const m = sat.data;
    if (!current || !m || m.size === 0) return null;
    const pts = current.loss.rows.filter((r) => r.clearGhi > 100 && m.has(r.t));
    if (pts.length < 4) return null;
    const mae = (k) => pts.reduce((s, r) => s + Math.abs(r[k] - m.get(r.t)), 0) / pts.length;
    const actual = pts.reduce((s, r) => s + m.get(r.t), 0);
    const withHaze = pts.reduce((s, r) => s + r.ghiHaze, 0);
    const noHaze = pts.reduce((s, r) => s + r.ghiClean, 0);
    return { n: pts.length, maeHaze: mae('ghiHaze'), maeClean: mae('ghiClean'), biasPct: ((withHaze - actual) / actual) * 100, noHazeBiasPct: ((noHaze - actual) / actual) * 100 };
  }, [sat.data, current]);

  if (loading || !data || !engine) return <Loading text="Running the solar model…" />;
  if (!current) return <div className="card section">No data for this date. Try another date.</div>;

  const L = current.loss;
  const haze = hazeLevel(L.meanAod);
  const dayWord = current.d === today ? 'today' : current.d === addDays(today, 1) ? 'tomorrow' : `on ${fmtDate(current.d)}`;
  const isPast = current.d < today;
  const maxLoss = Math.max(5, ...days.map((x) => x.loss.lossPct));

  return (
    <>
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>Solar haze loss</h1>
        <span className="sub">
          {place.name} · {settings.kwp} kW rooftop · {engine.kind === 'trained' ? 'trained AI model' : 'physics baseline model'}
        </span>
      </div>

      <section className="headline section">
        <div>
          <div className="eyebrow">{isPast ? 'Replay' : 'Forecast'} · {fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2>
            {L.lossPct < 1 ? (
              <>Haze is barely touching your solar {dayWord}.</>
            ) : (
              <>
                Haze {isPast ? 'cut' : 'will cut'} your solar by <em>{L.lossPct.toFixed(0)}%</em> {dayWord}.
              </>
            )}
          </h2>
          <p>
            {haze.label} (aerosol optical depth {L.meanAod.toFixed(2)}, PM2.5 {Math.round(L.meanPm25)} µg/m³) during daylight.
            Without haze the panels {isPast ? 'would have made' : 'would make'} {L.kwhClean.toFixed(1)} kWh; with it,{' '}
            {L.kwhHaze.toFixed(1)} kWh.
          </p>
        </div>
        <div className="headline-stats">
          <div className="hs">
            <div className="k">Energy lost to haze</div>
            <div className="v">
              {L.lossKwh.toFixed(1)}
              <small>kWh</small>
            </div>
          </div>
          <div className="hs">
            <div className="k">Solar output</div>
            <div className="v">
              {L.kwhHaze.toFixed(1)}
              <small>kWh</small>
            </div>
          </div>
          <div className="hs">
            <div className="k">Value of lost solar</div>
            <div className="v">
              RM {plan ? plan.lossValueRm.toFixed(2) : '–'}
            </div>
            {plan && <div className="k">Your bill: +RM {plan.hazeCostRm.toFixed(2)}</div>}
          </div>
          <div className="hs">
            <div className="k">Cloud cover (daylight)</div>
            <div className="v">
              {Math.round(L.meanCloud)}
              <small>%</small>
            </div>
          </div>
        </div>
      </section>

      <div className="card section">
        <h2>See the haze over your roof</h2>
        <p className="lede">
          A 3D view of terrace homes at {isPast ? 'the' : "the forecast"} haze level for {fmtDate(current.d)}. Drag to look around, or move the
          slider to see how thicker haze dims the panels.
        </p>
        <HazeScene3D aod={L.meanAod} label={`${fmtDate(current.d)} · ${place.name}`} />
      </div>

      <div className="card section">
        <div className="spread">
          <div>
            <h2>Pick a day</h2>
            <p className="lede">Bar = share of solar lost to haze. Past days replay real readings; future days use the forecast.</p>
          </div>
          <label className="field" style={{ minWidth: 190 }}>
            <label htmlFor="jump">Jump to a past date</label>
            <input
              id="jump"
              type="date"
              min={addDays(today, -MAX_PAST)}
              max={addDays(today, MAX_AHEAD)}
              value={current.d}
              onChange={(e) => {
                if (!e.target.value) return;
                setAnchor(e.target.value);
                setSelected(e.target.value);
              }}
            />
          </label>
        </div>
        <div className="datebar" role="tablist" ref={barRef}>
          {days.map(({ d, loss }) => (
            <button key={d} role="tab" aria-selected={d === current.d} className={`datebtn ${d === current.d ? 'active' : ''}`} onClick={() => setSelected(d)}>
              <div className="d">{d === today ? 'Today' : fmtDate(d)}</div>
              <div className="bar">
                <i style={{ width: `${(loss.lossPct / maxLoss) * 100}%` }} />
              </div>
              <div className="p">
                −{loss.lossPct.toFixed(0)}%<small> {loss.lossKwh.toFixed(1)} kWh</small>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card section">
        <h2>Sunlight on your roof, hour by hour</h2>
        <p className="lede">The hatched band is the sunlight the haze took away. Hover for the inputs the model used each hour.</p>
        <SolarChart rows={L.rows} satellite={sat.data} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--sun-deep)', height: 0 }} />Without haze (run B)</span>
          <span><i style={{ background: '#fbd98a' }} />With haze (run A)</span>
          <span><i style={{ background: '#f6c3a8', boxShadow: 'inset 0 0 0 2px #e0703e' }} />Lost to haze</span>
          {sat.data?.size > 0 && <span><i style={{ background: 'var(--sky)', borderRadius: 99, width: 10 }} />Measured by Himawari satellite</span>}
        </div>
        {validation && (
          <p className="small" style={{ marginTop: 12 }}>
            <b>Reality check:</b> over {validation.n} daylight hours, the haze-aware prediction was off by{' '}
            {Math.round(validation.maeHaze)} W/m² on average against satellite measurements, versus {Math.round(validation.maeClean)} W/m² if
            haze were ignored. Total sunlight {validation.biasPct >= 0 ? 'over' : 'under'}-estimated by {Math.abs(validation.biasPct).toFixed(0)}%
            (ignoring haze: {validation.noHazeBiasPct >= 0 ? 'over' : 'under'} by {Math.abs(validation.noHazeBiasPct).toFixed(0)}%). Cloud forecasts are the biggest source of error on any single day.
          </p>
        )}
      </div>

      {plan && <PlanCard plan={plan} home={dayHome} isPast={isPast} weekend={weekend && home.tariff.mode === 'tou'} />}

      <div className="card section">
        <h2>Your home</h2>
        <p className="lede">Change these to match your house. Saved in this browser.</p>
        <div className="settings">
          <NumField label="Solar size" unit="kWp" value={settings.kwp} min={1} max={20} step={0.5} onChange={(v) => setSettings({ ...settings, kwp: v })} />
          <NumField label="Battery" unit="kWh" value={settings.batteryKwh} min={1} max={30} step={0.5} onChange={(v) => setSettings({ ...settings, batteryKwh: v })} />
          <NumField label="Daily use" unit="kWh" value={settings.dailyKwh} min={5} max={60} step={1} onChange={(v) => setSettings({ ...settings, dailyKwh: v })} hint="Your monthly bill kWh ÷ 30" />
          <div className="field">
            <label htmlFor="tariff">Tariff</label>
            <select
              id="tariff"
              value={settings.home.tariff.mode}
              onChange={(e) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, mode: e.target.value } } })}
            >
              <option value="tou">Time-of-use (peak 2pm–10pm weekdays)</option>
              <option value="flat">Flat rate</option>
            </select>
          </div>
          {settings.home.tariff.mode === 'tou' ? (
            <>
              <NumField label="Peak rate" unit="RM/kWh" value={settings.home.tariff.peakRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, peakRate: v } } })} hint="Example value — use your bill" />
              <NumField label="Off-peak rate" unit="RM/kWh" value={settings.home.tariff.offPeakRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, offPeakRate: v } } })} hint="Example value — use your bill" />
            </>
          ) : (
            <NumField label="Rate" unit="RM/kWh" value={settings.home.tariff.flatRate} min={0} max={2} step={0.01} onChange={(v) => setSettings({ ...settings, home: { ...settings.home, tariff: { ...settings.home.tariff, flatRate: v } } })} hint="Example value — use your bill" />
          )}
        </div>
      </div>
    </>
  );
}

function NumField({ label, unit, value, onChange, min, max, step, hint }) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} ({unit})
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
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function PlanCard({ plan, home, isPast, weekend }) {
  const tou = home.tariff.mode === 'tou';
  const s = plan.standard;
  const h = plan.hazeAware;
  const steps = [];
  if (plan.flexWhy === 'sunniest') steps.push(`Run the washing machine, dryer and water heater ${hourRanges(plan.flexHours)} — the sunniest hours left after the haze.`);
  else if (plan.flexWhy === 'offpeak') steps.push(`Solar is too weak to cover chores today — run them after ${fmtHour(home.tariff.peakEnd)} at the off-peak rate.`);
  else steps.push(`Keep chores at the usual time (${hourRanges(plan.flexHours)}); moving them would not save money today.`);
  if (plan.reserve) steps.push(`Save the battery for the ${fmtHour(home.tariff.peakStart)}–${fmtHour(home.tariff.peakEnd)} peak instead of draining it in the morning.`);
  if (plan.topUpKwh > 0.05) steps.push(`Haze means the battery will not fill from solar alone: top it up with ${plan.topUpKwh.toFixed(1)} kWh from the grid between 2am and 6am at the off-peak rate.`);
  if (!plan.reserve && plan.topUpKwh <= 0.05 && tou) steps.push('Let the battery cover demand whenever solar falls short — no reserve needed today.');

  return (
    <div className="card section">
      <h2>Battery & chores plan {isPast ? '(what would have helped)' : ''}</h2>
      <p className="lede">
        We replay the day hour by hour with your predicted (hazy) solar output and try every combination of chore timing, battery reserve
        and off-peak top-up, keeping the cheapest. Household demand is simulated from a typical Malaysian terrace home.
        {weekend && ' Weekend: time-of-use is off-peak all day.'}
      </p>
      <div className="plan-cols">
        <div className="plan">
          <h3>Standard day</h3>
          <div className="big">RM {s.costRm.toFixed(2)}</div>
          <div className="small muted">
            {s.gridKwh.toFixed(1)} kWh from the grid · {s.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            <li>Chores at {hourRanges(plan.usualHours)}</li>
            <li>Battery empties whenever solar falls short</li>
          </ul>
        </div>
        <div className="plan smart">
          <h3>☀ Haze-aware plan</h3>
          <div className="big">RM {h.costRm.toFixed(2)}</div>
          <div className="small muted">
            {h.gridKwh.toFixed(1)} kWh from the grid · {h.co2Kg.toFixed(1)} kg CO₂
          </div>
          <ul>
            {steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="savings">
        <div>
          <div className="v">RM {plan.savingRm.toFixed(2)}</div>
          <div className="k">Saved today · ~RM {(plan.savingRm * 30).toFixed(0)}/month at this rate</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.gridSavedKwh >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {plan.gridSavedKwh >= 0 ? '' : '+'}
            {Math.abs(plan.gridSavedKwh).toFixed(1)} kWh
          </div>
          <div className="k">{plan.gridSavedKwh >= 0 ? 'Less grid power' : 'More grid power (cheaper hours)'}</div>
        </div>
        <div>
          <div className="v" style={{ color: plan.co2SavedKg >= 0 ? 'var(--good)' : 'var(--ink-2)' }}>
            {Math.abs(plan.co2SavedKg).toFixed(1)} kg
          </div>
          <div className="k">CO₂ {plan.co2SavedKg >= 0 ? 'avoided' : 'added'}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>Haze-aware schedule</div>
        <div className="timeline" aria-label="24-hour schedule">
          {Array.from({ length: 24 }, (_, hr) => {
            const peak = tou && hr >= home.tariff.peakStart && hr < home.tariff.peakEnd;
            const flex = plan.flexHours.includes(hr);
            const top = (plan.gridChargeKwh?.[hr] || 0) > 0;
            return (
              <div
                key={hr}
                className={`${peak ? 'peak' : ''} ${flex ? 'flex' : ''} ${top ? 'topup' : ''}`}
                title={`${fmtHour(hr)}${flex ? ' · run chores' : ''}${top ? ' · grid top-up' : ''}${peak ? ' · peak rate' : ''}`}
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
          <span><i style={{ background: 'var(--sun)' }} />Run chores</span>
          {plan.topUpKwh > 0.05 && <span><i style={{ background: 'var(--sky)' }} />Grid top-up</span>}
          {tou && <span><i style={{ background: 'var(--paper-2)', boxShadow: 'inset 0 -3px 0 #c9b9a0' }} />Peak rate</span>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="small" style={{ fontWeight: 700 }}>Battery charge through the day</div>
        <SocChart standard={s.soc} smart={h.soc} />
        <div className="legend">
          <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--ink-3)', height: 0 }} />Standard</span>
          <span><i style={{ background: 'var(--sun-deep)', height: 3 }} />Haze-aware</span>
        </div>
      </div>
    </div>
  );
}
