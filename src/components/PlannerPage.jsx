import { useEffect, useMemo, useState } from 'react';
import { getPlaceData, addDays, todayMY } from '../lib/api.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { weatherIcon } from '../lib/weather.js';
import { fmtHour } from '../lib/battery.js';
import { planEv, DEFAULT_EV } from '../lib/ev.js';
import { cleaningAdvice } from '../lib/cleaning.js';
import { outdoorPlan } from '../lib/outdoor.js';
import { buildDays, homeFromSettings, dayHomeFor, planForDay, avgRate, cleaningDays, isWeekend } from '../lib/forecastDays.js';
import { useAsync, Loading, DemoBanner, fmtDate } from './common.jsx';
import PlanCard from './PlanCard.jsx';
import EvCard from './EvCard.jsx';
import CleaningCard, { cleaningVerdict } from './CleaningCard.jsx';
import OutdoorCard, { useSensitive } from './OutdoorCard.jsx';
import HomeSettings from './HomeSettings.jsx';
import { tr } from '../lib/i18n.js';

// Planner: everything you can act on. Battery and chores, EV charging, panel cleaning
// and the best time to exercise, with a one-glance summary at the top.
export default function PlannerPage({ place, engine, settings, setSettings }) {
  const today = todayMY();
  const [selected, setSelected] = useState(today);
  useEffect(() => setSelected(today), [place.lat, place.lon, today]);
  const [sensitive, setSensitive] = useSensitive();

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
  const clean = cleaningAdvice(cleaningDays(days, today, (d) => (d === today ? tr('today') : fmtDate(d, { weekday: 'long' }))), { rate: avgRate(home.tariff) });
  const cv = clean ? cleaningVerdict(clean) : null;
  const out = outdoorPlan(data.hours, { offsetSec: data.offsetSec, sensitive });
  const bestOut = out.best.find((b) => !b.none);
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tiles = [
    plan && { id: 'plan-battery', icon: '🔋', k: tr('Battery & chores'), v: `RM ${plan.savingRm.toFixed(2)}`, sub: tr('saved') },
    { id: 'plan-ev', icon: '🚗', k: tr('EV charging'), v: evPlan ? `RM ${evPlan.savingRm.toFixed(2)}` : '—', sub: evPlan ? tr('saved') : tr('Add my EV') },
    cv && { id: 'plan-clean', icon: cv.icon, k: tr('Panels'), v: cv.short, sub: `${clean.soilPct.toFixed(1)}% ${tr('dust')}`, tone: cv.tone },
    {
      id: 'plan-outdoor',
      icon: '🏃',
      k: tr('Exercise'),
      v: bestOut ? `${fmtHour(bestOut.startHour)}–${fmtHour(bestOut.endHour)}` : tr('No good time'),
      sub: bestOut ? (bestOut.date === today ? tr('Today') : tr('Tomorrow')) : '',
      tone: bestOut ? 'good' : 'bad',
    },
  ].filter(Boolean);

  return (
    <>
      <DemoBanner source={data.source} />
      <div className="place-title">
        <h1>🗓 {tr('Planner')}</h1>
        <span className="sub">
          {place.name} · {settings.kwp} kW {tr('solar')}
        </span>
      </div>

      <section className="glance section" aria-label={tr('At a glance')}>
        {tiles.map((t) => (
          <button key={t.id} className={`glance-tile ${t.tone ? `tone-border-${t.tone}` : ''}`} onClick={() => jump(t.id)}>
            <span className="gi" aria-hidden="true">{t.icon}</span>
            <span className="gk">{t.k}</span>
            <span className="gv">{t.v}</span>
            <span className="gs">{t.sub}</span>
          </button>
        ))}
      </section>

      <div className="chips section day-chips" role="tablist" aria-label={tr('Pick a day')}>
        {days.map((x) => (
          <button key={x.d} role="tab" aria-selected={x.d === current.d} className={`chip ${x.d === current.d ? 'active' : ''}`} onClick={() => setSelected(x.d)}>
            {label(x.d)} {weatherIcon(x.wx.code)} <b>{x.breakdown.final.toFixed(0)}</b> kWh
          </button>
        ))}
      </div>

      {plan && <PlanCard plan={plan} home={dayHome} weekend={isWeekend(current.d) && home.tariff.mode === 'tou'} />}
      {plan && <EvCard spareSolar={plan.hazeAware.exported} settings={settings} setSettings={setSettings} home={dayHome} />}
      <CleaningCard days={cleaningDays(days, today, (d) => (d === today ? tr('today') : fmtDate(d, { weekday: 'long' })))} rate={avgRate(home.tariff)} />
      <OutdoorCard data={data} todayStr={today} sensitive={sensitive} setSensitive={setSensitive} />
      <HomeSettings settings={settings} setSettings={setSettings} />
    </>
  );
}
