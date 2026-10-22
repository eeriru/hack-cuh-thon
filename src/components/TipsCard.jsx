import { energyTips } from '../lib/tips.js';
import { fmtDate } from './common.jsx';
import { tr } from '../lib/i18n.js';

// Ideas for the selected day: what to do with spare solar, and easy ways to use less power.
export default function TipsCard({ budget, day, nextDay, home, ev, dayLabel }) {
  const tips = energyTips({ budget, day, nextDay, home, ev });
  const groups = [
    { key: 'solar', title: 'Use your spare solar', list: tips.solar, tone: 'tip-solar' },
    { key: 'save', title: 'Make the most of your energy', list: tips.save, tone: 'tip-save' },
  ];
  return (
    <div className="card section" id="plan-tips">
      <h2>💡 {tr('Ideas for {day}', { day: dayLabel || fmtDate(day.d, { weekday: 'long' }) })}</h2>
      <p className="sec-lead">{tr("Ideas based on this day's forecast: ways to use your spare solar, and simple habits that cut your bill.")}</p>
      <div className="tips-grid">
        {groups.map((g) => (
          <div key={g.key} className={`tips-group ${g.tone}`}>
            <h3>{tr(g.title)}</h3>
            <ul className="tips-list">
              {g.list.map((t) => (
                <li key={t.key}>
                  <span className="tip-ic" aria-hidden="true">{t.icon}</span>
                  <div>
                    <b>{tr(t.title)}</b>
                    <p>{tr(t.text, t.dayVar ? { ...t.vars, day: fmtDate(t.vars.day, { weekday: 'long' }) } : t.vars)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
