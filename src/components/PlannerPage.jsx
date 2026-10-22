import { useEffect, useMemo, useState } from 'react';
import { getPlaceData, addDays, todayMY } from '../lib/api.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { weatherIcon } from '../lib/weather.js';
import { fmtHour } from '../lib/battery.js';
import { planEv, DEFAULT_EV } from '../lib/ev.js';
import { buildDays, homeFromSettings, dayHomeFor, planForDay, avgRate, isWeekend } from '../lib/forecastDays.js';
import { useAsync, Loading, DemoBanner, fmtDate } from './common.jsx';
import PlanCard from './PlanCard.jsx';
import EvCard from './EvCard.jsx';
import HomeSettings from './HomeSettings.jsx';
import SolarBudgetCard from './SolarBudgetCard.jsx';
import TipsCard from './TipsCard.jsx';
import { solarBudget } from '../lib/budget.js';
import { tr } from '../lib/i18n.js';
import { Cloud } from './Dashboard.jsx';

// Planner: everything you can act on. Spare solar, battery and chores, EV charging
// with a one-glance summary at the top.
// Sky pictures for the three summary cards.
const SCENE = { 'plan-budget': 'scene-solar', 'plan-battery': 'scene-blue', 'plan-ev': 'scene-lime' };

export default function PlannerPage({ place, engine, settings, setSettings }) {
  const today = todayMY();
  const [selected, setSelected] = useState(today);
  useEffect(() => setSelected(today), [place.lat, place.lon, today]);

  // The same window as the Weather & solar page opens with, so the data is shared from cache.
  const startDate = addDays(today, -5);
  const endDate = addDays(today, 6);
  const { data, loading } = useAsync(() => getPlaceData(place, { startDate, endDate }), [place.lat, place.lon, today]);

  const system = useMemo(() => ({ ...DEFAULT_SYSTEM, kwp: settings.kwp }), [settings.kwp]);
  const home = useMemo(() => homeFromSettings(settings), [settings]);
  const days = useMemo(
    () => buildDays(data, { engine, place, system, startDate, endDate }).filter((x) => x.d >= today),
    [data, engine, place, system, startDate, endDate, today]
  );
  const current = days.find((x) => x.d === selected) || days[0];
  const dayHome = useMemo(() => (current ? dayHomeFor(home, current.d) : home), [home, current]);
  const plan = useMemo(() => (current ? planForDay(current, dayHome) : null), [current, dayHome]);

  if (loading || !data || !engine) return <Loading text="Loading the weather and running the solar model…" />;
  if (!current) return <div className="card section">{tr('No data for this date. Try another date.')}</div>;

  const label = (d) => (d === today ? tr('Today') : d === addDays(today, 1) ? tr('Tomorrow') : fmtDate(d, { weekday: 'short' }));
  const rate = avgRate(dayHome.tariff);

  // One-glance tiles
  const ev = { ...DEFAULT_EV, ...settings.ev };
  const evPlan = ev.enabled && plan ? planEv(plan.hazeAware.exported, ev, dayHome) : null;
  const budget = plan ? solarBudget({ pv: plan.pv, load: plan.load.hazeAware, baseLoad: plan.load.base, splitLoad: plan.load.hazeAware, exported: plan.hazeAware.exported, evSolar: evPlan?.smart.solar }) : null;
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tiles = [
    budget && {
      id: 'plan-budget',
      icon: '☀',
      k: tr('Spare solar'),
      v: `${budget.surplusKwh.toFixed(1)} kWh`,
      sub: budget.window ? `${fmtHour(budget.window.start)}–${fmtHour(budget.window.end)}` : tr('No spare solar'),
      tone: budget.surplusKwh >= 0.5 ? 'good' : undefined,
    },
    plan && { id: 'plan-battery', icon: '🔋', k: tr('Battery & chores'), v: `RM ${plan.savingRm.toFixed(2)}`, sub: tr('saved') },
    { id: 'plan-ev', icon: '🚗', k: tr('EV charging'), v: evPlan ? `RM ${evPlan.savingRm.toFixed(2)}` : '—', sub: evPlan ? tr('saved') : tr('Add my EV') },
  ].filter(Boolean);

  return (
    <>
      <DemoBanner source={data.source} />
      <h1 className="sr-only">{tr('Planner')}</h1>
      <div className="dash section">
        <div className="dash-main">
          <p className="sec-lead plan-intro">{tr('The planner turns the solar forecast into a plan for your home. Pick a day from the list, then see how much free solar you will have, when to run chores and the battery, and when to charge your EV. Tap a card to jump to it.')}</p>
          <section className="plan-scenes" aria-label={tr('At a glance')}>
            {tiles.map((t) => (
              <button key={t.id} className={`scene-card plan-scene ${SCENE[t.id]}`} onClick={() => jump(t.id)}>
                <span className="scene-art" aria-hidden="true">
                  <Cloud className="sc1" />
                </span>
                <span className="scene-head">
                  <span className="scene-badge" aria-hidden="true">{t.icon}</span>
                  <b>{t.k}</b>
                </span>
                <span className="plan-scene-v">{t.v}</span>
                <span className="plan-scene-s">{t.sub}</span>
              </button>
            ))}
          </section>

          {budget && <SolarBudgetCard budget={budget} rate={rate} choreHours={plan.flexHours} />}
          {budget && <TipsCard budget={budget} day={current} nextDay={days[days.indexOf(current) + 1]} home={dayHome} ev={ev} dayLabel={current.d === today ? tr('today') : current.d === addDays(today, 1) ? tr('tomorrow') : fmtDate(current.d, { weekday: 'long' })} />}
          {plan && <PlanCard plan={plan} home={dayHome} weekend={isWeekend(current.d) && home.tariff.mode === 'tou'} />}
          {plan && <EvCard spareSolar={plan.hazeAware.exported} settings={settings} setSettings={setSettings} home={dayHome} />}
        </div>

        <aside className="side-panel" aria-label={tr('Pick a day')}>
          <div className="sp-head">
            <div>
              <b>{tr('Planner')}</b>
              <small>
                📍 {place.name} · {settings.kwp} kW
              </small>
            </div>
            <span className="sp-temp">
              {current.breakdown.final.toFixed(0)}
              <small style={{ fontSize: 14 }}> kWh</small>
            </span>
          </div>
          <h3 className="sp-title">{tr('Pick a day')}</h3>
          <ul className="sp-days" role="tablist">
            {days.map((x) => (
              <li key={x.d} className={x.d === current.d ? 'active' : ''}>
                <button role="tab" aria-selected={x.d === current.d} className="sp-day" onClick={() => setSelected(x.d)}>
                  <span className="sp-ic" aria-hidden="true">{weatherIcon(x.wx.code)}</span>
                  <span className="sp-mid">
                    <small>{fmtDate(x.d, { day: 'numeric', month: 'short' })}</small>
                    <b>{label(x.d)}</b>
                  </span>
                  <span className="sp-right">
                    <b>{x.breakdown.final.toFixed(1)}</b>
                    <small>kWh</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <HomeSettings settings={settings} setSettings={setSettings} />
        </aside>
      </div>
    </>
  );
}
