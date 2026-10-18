import { useMemo, useState } from 'react';
import { getManyPlaces, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { aqiLevel, hazeLevel } from '../lib/aqi.js';
import { TOWNSHIPS, CITIES } from '../lib/places.js';
import { useAsync, Loading, DemoBanner } from './common.jsx';

export default function RankingsPage({ engine, settings, onPick }) {
  const [group, setGroup] = useState('townships');
  const [sortBy, setSortBy] = useState('aqi');
  const [homes, setHomes] = useState(500);
  const today = todayMY();
  const tomorrow = addDays(today, 1);
  const places = group === 'townships' ? TOWNSHIPS : CITIES;
  const { data, loading } = useAsync(() => getManyPlaces(places, { startDate: today, endDate: tomorrow }), [group, today]);

  const rows = useMemo(() => {
    if (!data || !engine) return [];
    const system = { ...DEFAULT_SYSTEM, kwp: settings.kwp };
    const list = data.map((d) => {
      const loss = computeHazeLoss(dayModelHours(d, tomorrow), { ...d.place, engine, system });
      return { place: d.place, aqi: d.current.us_aqi, pm: d.current.pm2_5, aod: d.current.aod, loss, source: d.source };
    });
    list.sort((a, b) => (sortBy === 'aqi' ? (b.aqi ?? -1) - (a.aqi ?? -1) : b.loss.lossPct - a.loss.lossPct));
    return list;
  }, [data, engine, settings.kwp, sortBy, tomorrow]);

  const maxLoss = Math.max(5, ...rows.map((r) => r.loss.lossPct));
  const avgLossKwh = rows.length ? rows.reduce((s, r) => s + r.loss.lossKwh, 0) / rows.length : 0;
  const rate = settings.home.tariff.mode === 'flat' ? settings.home.tariff.flatRate : (settings.home.tariff.peakRate + settings.home.tariff.offPeakRate) / 2;

  return (
    <>
      {data && <DemoBanner source={data[0]?.source} />}
      <div className="place-title">
        <h1>Rankings</h1>
        <span className="sub">Air quality now, and how much solar the haze will take tomorrow</span>
      </div>
      <div className="spread section">
        <div className="chips">
          <button className={`chip ${group === 'townships' ? 'active' : ''}`} onClick={() => setGroup('townships')}>Sime Darby townships</button>
          <button className={`chip ${group === 'cities' ? 'active' : ''}`} onClick={() => setGroup('cities')}>Malaysian cities</button>
        </div>
        <div className="chips">
          <span className="small muted" style={{ alignSelf: 'center' }}>Sort by</span>
          <button className={`chip ${sortBy === 'aqi' ? 'active' : ''}`} onClick={() => setSortBy('aqi')}>Air quality</button>
          <button className={`chip ${sortBy === 'loss' ? 'active' : ''}`} onClick={() => setSortBy('loss')}>Solar loss</button>
        </div>
      </div>

      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="card section">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{group === 'townships' ? 'Township' : 'City'}</th>
                    <th>US AQI now</th>
                    <th>PM2.5</th>
                    <th>Haze</th>
                    <th style={{ minWidth: 180 }}>Solar lost tomorrow ({settings.kwp} kW)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const l = aqiLevel(r.aqi);
                    return (
                      <tr key={r.place.name} className="clickable" onClick={() => onPick(r.place)} title="Open this location">
                        <td className="rank">{i + 1}</td>
                        <td>
                          <b>{r.place.name}</b>
                          <div className="small muted">{r.place.area}</div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: l.color, color: l.ink }}>{r.aqi !== undefined && r.aqi !== null ? Math.round(r.aqi) : '–'}</span>
                        </td>
                        <td>{r.pm !== undefined && r.pm !== null ? r.pm.toFixed(0) : '–'} <span className="small muted">µg/m³</span></td>
                        <td className="small">{hazeLevel(r.aod).label}</td>
                        <td>
                          <div className="lossbar">
                            <div className="track">
                              <i style={{ width: `${(r.loss.lossPct / maxLoss) * 100}%` }} />
                            </div>
                            <b>−{r.loss.lossPct.toFixed(0)}%</b>
                            <span className="small muted">{r.loss.lossKwh.toFixed(1)} kWh</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card section">
            <h2>{group === 'townships' ? 'Township-wide impact tomorrow' : 'Impact across these cities tomorrow'}</h2>
            <p className="lede">If this many homes in each location have a {settings.kwp} kW rooftop system:</p>
            <div className="row">
              <div className="field" style={{ width: 180 }}>
                <label htmlFor="homes">Solar homes per location</label>
                <input id="homes" type="number" min={1} max={100000} value={homes} onChange={(e) => setHomes(Math.max(1, parseInt(e.target.value || '1', 10)))} />
              </div>
            </div>
            <div className="savings">
              <div>
                <div className="v" style={{ color: 'var(--loss)' }}>{((avgLossKwh * homes * rows.length) / 1000).toFixed(1)} MWh</div>
                <div className="k">Solar energy lost to haze ({rows.length} locations × {homes} homes)</div>
              </div>
              <div>
                <div className="v" style={{ color: 'var(--loss)' }}>RM {Math.round(avgLossKwh * homes * rows.length * rate).toLocaleString()}</div>
                <div className="k">Extra grid electricity at ~RM {rate.toFixed(2)}/kWh</div>
              </div>
              <div>
                <div className="v" style={{ color: 'var(--loss)' }}>{((avgLossKwh * homes * rows.length * settings.home.gridKgCo2PerKwh) / 1000).toFixed(1)} t</div>
                <div className="k">Extra CO₂ when the grid makes up the shortfall</div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
