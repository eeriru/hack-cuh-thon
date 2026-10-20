// "Where your solar goes": a waterfall from the ideal output down to what the panels make.
import { Tip } from './Friendly.jsx';

const TIP = { heat: 'heat', haze: 'hazeLoss', dust: 'dust' };

const COLORS = {
  system: '#9aa3b2',
  heat: '#e8833a',
  clouds: '#6f8fb8',
  haze: '#b39770',
  dust: '#a8865c',
};

export default function LossBreakdown({ breakdown, soil }) {
  const { ideal, final, steps } = breakdown;
  if (!ideal) return null;
  const pct = (x) => (x / ideal) * 100;
  let remaining = ideal;
  const rows = steps.map((s) => {
    const from = remaining;
    remaining -= s.kwh;
    return { ...s, from, to: remaining };
  });
  return (
    <div className="waterfall" role="table" aria-label="Solar losses from ideal to actual output">
      <div className="wf-row total" role="row">
        <div className="wf-label" role="cell">
          <b>
            Ideal output
            <Tip term="ideal" />
          </b>
          <small>Perfect, cool panel under a clear sky</small>
        </div>
        <div className="wf-track" role="cell">
          <i style={{ left: 0, width: '100%', background: '#e7dfcc' }} />
        </div>
        <div className="wf-val" role="cell">
          <b>{ideal.toFixed(1)} kWh</b>
          <small>100%</small>
        </div>
      </div>
      {rows.map((r) => {
        const gain = r.kwh < 0;
        const left = pct(Math.min(r.from, r.to));
        const width = Math.max(0.6, Math.abs(pct(r.kwh)));
        return (
          <div className="wf-row" role="row" key={r.key} title={r.note}>
            <div className="wf-label" role="cell">
              <b>
                <span className="wf-dot" style={{ background: COLORS[r.key] }} />
                {r.label}
                {TIP[r.key] && <Tip term={TIP[r.key]} />}
              </b>
              <small>{r.key === 'dust' && soil ? `${soil.dryDays} dry day${soil.dryDays === 1 ? '' : 's'} since rain${soil.assumed ? ' (assumed)' : ''}` : r.short || r.note}</small>
            </div>
            <div className="wf-track" role="cell">
              <i style={{ left: `${left}%`, width: `${width}%`, background: COLORS[r.key], opacity: gain ? 0.45 : 1 }} />
            </div>
            <div className="wf-val" role="cell">
              <b>
                {gain ? '+' : '−'}
                {Math.abs(r.kwh).toFixed(1)} kWh
              </b>
              <small>{Math.abs(pct(r.kwh)).toFixed(0)}%</small>
            </div>
          </div>
        );
      })}
      <div className="wf-row total final" role="row">
        <div className="wf-label" role="cell">
          <b>Your panels make</b>
          <small>Forecast output for the day</small>
        </div>
        <div className="wf-track" role="cell">
          <i style={{ left: 0, width: `${pct(final)}%`, background: 'var(--sun)' }} />
        </div>
        <div className="wf-val" role="cell">
          <b>{final.toFixed(1)} kWh</b>
          <small>{pct(final).toFixed(0)}%</small>
        </div>
      </div>
      <p className="small muted" style={{ margin: '4px 0 0' }}>
        Percentages are shares of the ideal output. The haze figure in the headline ({hazeShare(steps, ideal, final)}) compares with the
        same day without haze instead, so it is larger.
      </p>
    </div>
  );
}

function hazeShare(steps, ideal, final) {
  const haze = steps.find((s) => s.key === 'haze')?.kwh || 0;
  const dust = steps.find((s) => s.key === 'dust')?.kwh || 0;
  const withHaze = final + dust; // output before dust
  const noHaze = withHaze + haze;
  return noHaze > 0 ? `${((haze / noHaze) * 100).toFixed(0)}%` : '0%';
}
