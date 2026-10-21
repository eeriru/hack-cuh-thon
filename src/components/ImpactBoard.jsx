import { townshipImpact } from '../lib/impact.js';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

const n0 = (x) => Math.round(x).toLocaleString();

// Township impact board: what rooftop solar makes, saves and avoids in each township
// tomorrow, and what the haze takes away.
export default function ImpactBoard({ rows, homes, setHomes, settings, rate, group, onPick }) {
  const imp = townshipImpact(
    rows.map((r) => ({ place: r.place, output: r.output, lossKwh: r.loss.lossKwh })),
    { homes, rate, co2PerKwh: settings.home.gridKgCo2PerKwh }
  );
  const T = imp.total;
  const max = Math.max(0.001, ...imp.list.map((x) => x.mwh));
  const many = group === 'townships';
  return (
    <div className="card section">
      <div className="spread">
        <div>
          <h2>
            🏘 {tr(many ? 'Township impact board' : 'City impact board')} · {tr('tomorrow')}
            <Tip text="Tomorrow's forecast output for one home with your solar size, multiplied by the number of solar homes. Money uses your electricity rate; CO₂ uses the grid factor in your home settings. A mature tree absorbs about 22 kg of CO₂ a year; a petrol car gives off about 0.17 kg per km." />
          </h2>
          <p className="lede" style={{ margin: 0 }}>
            {tr(many ? 'If {homes} homes in each township have a {kwp} kW rooftop system.' : 'If {homes} homes in each city have a {kwp} kW rooftop system.', { homes: homes.toLocaleString(), kwp: settings.kwp })}
          </p>
        </div>
        <div className="field" style={{ width: 180 }}>
          <label htmlFor="homes">{tr(many ? 'Solar homes per township' : 'Solar homes per city')}</label>
          <input id="homes" type="number" min={1} max={100000} value={homes} onChange={(e) => setHomes(Math.max(1, parseInt(e.target.value || '1', 10)))} />
        </div>
      </div>

      <div className="savings" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div>
          <div className="v" style={{ color: 'var(--sun-deep)' }}>{T.mwh.toFixed(1)} MWh</div>
          <div className="k">{tr('Clean power made ({n} homes)', { n: T.homes.toLocaleString() })}</div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--good)' }}>RM {n0(T.rm)}</div>
          <div className="k">{tr('Saved on electricity bills at ~RM {rate}/kWh', { rate: rate.toFixed(2) })}</div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--good)' }}>{(T.co2Kg / 1000).toFixed(1)} t CO₂</div>
          <div className="k">
            {tr('Avoided in one day · what {trees} trees absorb in a year, or {km} km not driven by car', { trees: n0(T.treeYears), km: n0(T.carKm) })}
          </div>
        </div>
        <div>
          <div className="v" style={{ color: 'var(--loss)' }}>{T.lostMwh.toFixed(1)} MWh</div>
          <div className="k">{tr('Lost to haze (RM {rm})', { rm: n0(T.lostRm) })}</div>
        </div>
      </div>

      <div className="impact-list">
        {imp.list.map((x, i) => (
          <button key={x.place.name} className="impact-row" onClick={() => onPick(x.place)} title={tr('Open {name}', { name: x.place.name })}>
            <span className="rank">{i + 1}</span>
            <span className="name">
              {x.place.name}
              <small>{tr('{kwh} kWh per home', { kwh: x.kwhPerHome.toFixed(1) })}</small>
            </span>
            <span className="bar">
              <i style={{ width: `${(x.mwh / max) * 100}%` }} />
            </span>
            <span className="num">
              {x.mwh.toFixed(1)} MWh
              <small>RM {n0(x.rm)} · {(x.co2Kg / 1000).toFixed(1)} t CO₂</small>
            </span>
            <span className="num loss">
              −{x.lostMwh.toFixed(2)} MWh
              <small>{tr('haze')}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
