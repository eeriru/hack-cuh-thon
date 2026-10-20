import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlaceData, getSatelliteGhi, addDays, todayMY, dayModelHours, availableDates } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { planDay, hourRanges, fmtHour } from '../lib/battery.js';
import { hazeLevel } from '../lib/aqi.js';
import { SolarChart, SocChart } from './charts.jsx';
import LossBreakdown from './LossBreakdown.jsx';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { rainByDate, weatherIcon, WEATHER_TEXT } from '../lib/weather.js';
import HazeScene3D from './HazeScene3D.jsx';
import AirNow from './AirNow.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtDate } from './common.jsx';
import { InShort, Tip, More } from './Friendly.jsx';
import { solarSummary } from '../lib/summary.js';

const MAX_PAST = 85;
const MAX_AHEAD = 6; // a 7-day solar forecast (today + 6)

export default function SolarPage({ place, engine, settings, setSettings, go }) {
  const today = todayMY();
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  useEffect(() => {
    setAnchor(today);
    setSelected(today);
  }, [place.lat, place.lon, today]);

  const startDate = addDays(anchor, -5) < addDays(today, -MAX_PAST) ? addDays(today, -MAX_PAST) : addDays(anchor, -5);
  const endDate = addDays(anchor, 6) > addDays(today, MAX_AHEAD) ? addDays(today, MAX_AHEAD) : addDays(anchor, 6);

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
      .map((d) => {
        const loss = computeHazeLoss(dayModelHours(data, d), { ...place, engine, system });
        const soil = soilingForDate(data, d);
        const breakdown = lossBreakdown(loss, { system, soilingPct: soil.pct });
        const daily = (data.daily || []).find((x) => new Date((x.t + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
        const dayHours = data.hours.filter((h) => new Date((h.t - 1 + data.offsetSec) * 1000).toISOString().slice(0, 10) === d);
        const temps = dayHours.map((h) => h.temp).filter((x) => x !== null && x !== undefined);
        const hazeForecast = loss.rows.some((r) => r.clearGhi > 50 && r.aod !== null && r.aod !== undefined);
        return {
          d,
          loss,
          soil,
          breakdown,
          hazeForecast,
          wx: {
            code: daily?.weather_code ?? null,
            rain: daily?.rain ?? rainByDate(dayHours, data.offsetSec).get(d) ?? null,
            rainChance: daily?.rainChance ?? null,
            tmax: daily?.tmax ?? (temps.length ? Math.max(...temps) : null),
          },
        };
      })
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

  // Same calculation as the headline, for the 3D scene's haze slider: scale every hour's haze
  // so the day's average matches the slider, and rerun the solar model. At today's level it
  // returns exactly the headline figure.
  const shareForAod = useCallback(
    (aod) => {
      if (!current || !engine) return 1;
      const L0 = current.loss;
      if (L0.meanAod > 0 && Math.abs(aod - L0.meanAod) < 1e-6) return L0.kwhClean > 0 ? L0.kwhHaze / L0.kwhClean : 1;
      const k = L0.meanAod > 0 ? aod / L0.meanAod : 1;
      const hours = L0.rows.map((r) => ({
        t: r.t,
        localHour: r.localHour,
        aod: r.aod === null || r.aod === undefined ? null : r.aod * k,
        pm2_5: r.pm2_5 === null || r.pm2_5 === undefined ? null : r.pm2_5 * k,
        cloud_low: r.cloud_low,
        cloud_mid: r.cloud_mid,
        cloud_high: r.cloud_high,
        rh: r.rh,
        temp: r.temp,
      }));
      const L1 = computeHazeLoss(hours, { ...place, engine, system });
      return L1.kwhClean > 0 ? L1.kwhHaze / L1.kwhClean : 1;
    },
    [current, engine, place, system]
  );

  const plan = useMemo(() => {
    if (!current) return null;
    const pv = new Array(24).fill(0);
    const pvClean = new Array(24).fill(0);
    const pm = new Array(24).fill(0);
    const keep = 1 - current.soil.pct / 100; // dust on the panels
    current.loss.rows.forEach((r) => {
      pv[r.localHour] = r.kwhHaze * keep;
      pvClean[r.localHour] = r.kwhClean * keep;
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
  const B = current.breakdown;
  const haze = hazeLevel(L.meanAod);
  const dayWord = current.d === today ? 'today' : current.d === addDays(today, 1) ? 'tomorrow' : `on ${fmtDate(current.d)}`;
  const isPast = current.d < today;
  const maxOut = Math.max(1, ...days.map((x) => x.breakdown.final));
  const t = dayHome.tariff;
  const avgRate = t.mode === 'flat' ? t.flatRate : (t.peakRate + t.offPeakRate) / 2;

  return (
    <>
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>Solar forecast</h1>
        <span className="sub">
          {place.name} · estimates for a {settings.kwp} kW rooftop
          <Tip term="kwp" label="What is kW / kWp?" />
        </span>
      </div>

      <InShort
        title={`In short · ${isPast ? fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'short' }) : dayWord === 'today' ? 'today' : dayWord.replace(/^on /, '')}`}
        items={solarSummary({
          day: {
            label: dayWord,
            final: B.final,
            ideal: B.ideal,
            hazePct: L.lossPct,
            biggest: B.biggest,
            valueRm: B.final * avgRate,
          },
          days: days
            .filter((x) => x.d >= today)
            .map((x) => ({ label: x.d === today ? 'today' : fmtDate(x.d, { weekday: 'long' }), final: x.breakdown.final })),
          dailyUse: home.dailyKwh,
          isPast,
          tip:
            plan && plan.flexWhy === 'sunniest' && !isPast
              ? `Tip: run the washing machine and water heater ${hourRanges(plan.flexHours)}, the sunniest hours.`
              : null,
        })}
      />

      <AirNow place={place} go={go} />

      <section className="headline section">
        <div>
          <div className="eyebrow">{isPast ? 'Replay' : 'Forecast'} · {fmtDate(current.d, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2>
            Your panels {isPast ? 'made' : 'will make'} <em>{B.final.toFixed(1)} kWh</em> {dayWord}.
          </h2>
          <p>
            That's {B.performancePct.toFixed(0)}% of the ideal
            <Tip term="ideal" label="What is ideal output?" /> and worth about RM {(B.final * avgRate).toFixed(2)} of electricity
            <Tip term="kwh" label="What is a kWh?" />. The biggest loss is <b style={{ color: 'var(--paper)' }}>{B.biggest.label.toLowerCase()}</b>
            {L.lossPct >= 1 ? `; haze ${isPast ? 'took' : 'takes'} ${L.lossPct.toFixed(0)}%` : '; haze is barely a factor'}.
          </p>
        </div>
        <div className="headline-stats">
          <div className="hs">
            <div className="k">Solar output</div>
            <div className="v">
              {B.final.toFixed(1)}
              <small>kWh</small>
            </div>
          </div>
          <div className="hs">
            <div className="k">
              Lost to haze
              <Tip term="hazeLoss" label="How is haze loss measured?" />
            </div>
            <div className="v">
              {L.lossKwh.toFixed(1)}
              <small>kWh · {L.lossPct.toFixed(0)}%</small>
            </div>
            {plan && (
              <div className="k">
                {plan.hazeCostRm >= 0.01 ? `Adds RM ${plan.hazeCostRm.toFixed(2)} to your bill` : 'No extra cost on your bill today'}
              </div>
            )}
          </div>
          <div className="hs">
            <div className="k">Weather</div>
            <div className="v" style={{ fontSize: 18 }}>
              {weatherIcon(current.wx.code)} {WEATHER_TEXT[current.wx.code] || '—'}
            </div>
            <div className="k">
              {current.wx.tmax !== null ? `${Math.round(current.wx.tmax)}°C max` : ''}
              {current.wx.rain !== null ? ` · ${current.wx.rain.toFixed(1)} mm rain` : ''}
            </div>
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
        <div className="spread">
          <div>
            <h2>7-day solar forecast</h2>
            <p className="lede">Bar = expected output. Past days replay real readings; future days use the weather and haze forecast.</p>
          </div>
          <label className="field" style={{ minWidth: 190 }}>
            <label htmlFor="jump">Jump to a date</label>
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
          {days.map(({ d, loss, breakdown, wx }) => (
            <button key={d} role="tab" aria-selected={d === current.d} className={`datebtn ${d === current.d ? 'active' : ''}`} onClick={() => setSelected(d)}>
              <div className="d">
                {d === today ? 'Today' : fmtDate(d)} <span aria-hidden="true">{weatherIcon(wx.code)}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${(breakdown.final / maxOut) * 100}%`, background: 'var(--sun)' }} />
              </div>
              <div className="p">
                {breakdown.final.toFixed(1)}
                <small> kWh</small>
              </div>
              <div className="small muted">
                {loss.lossPct >= 0.5 ? `haze −${loss.lossPct.toFixed(0)}%` : 'no haze'}
                {wx.rain >= 0.5 ? ` · rain ${wx.rain.toFixed(0)} mm` : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card section">
        <h2>What's reducing your solar?</h2>
        <p className="lede">
          Start from the best possible day at the top; each row is something that takes power away. The yellow bar at the bottom is what you
          {isPast ? ' got' : "'ll get"}.
        </p>
        <LossBreakdown breakdown={B} soil={current.soil} />
        {!current.hazeForecast && (
          <p className="small muted" style={{ marginTop: 10 }}>
            No haze forecast this far ahead, so normal haze is assumed for this day.
          </p>
        )}
      </div>

      <div className="card section">
        <h2>See the haze over your roof</h2>
        <p className="lede">
          A 3D view of terrace homes at {isPast ? 'the' : "the forecast"} haze level for {fmtDate(current.d)}. Drag to look around, or move the
          slider to see how thicker haze dims the panels.
        </p>
        <HazeScene3D
          aod={L.meanAod}
          shareForAod={shareForAod}
          label={`${fmtDate(current.d)} · ${place.name}`}
          signTitle={TOWNSHIPS.some((t) => t.name === place.name) ? place.name : null}
        />
      </div>

      {plan && <PlanCard plan={plan} home={dayHome} isPast={isPast} weekend={weekend && home.tariff.mode === 'tou'} />}

      <More title="Hour-by-hour sunlight" hint="See exactly when the haze takes power, and check against satellite measurements">
      <div className="card">
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
      </More>

      <More title="Your home settings" hint={`${settings.kwp} kW solar · ${settings.batteryKwh} kWh battery · ${settings.dailyKwh} kWh/day · ${settings.home.tariff.mode === 'tou' ? 'time-of-use' : 'flat'} tariff`}>
      <div className="card">
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
      </More>
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
      <h2>
        Save money with a smarter day {isPast ? '(what would have helped)' : ''}
        <Tip term="battery" />
      </h2>
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
