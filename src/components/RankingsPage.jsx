import { useMemo, useState } from 'react';
import { getManyPlaces, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { aqiLevel, hazeLevel } from '../lib/aqi.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_SYMBOLS, DOE_SOURCE_URL } from '../lib/doe.js';
import { TOWNSHIPS, CITIES } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtTime } from './common.jsx';

export default function RankingsPage({ engine, settings, onPick }) {
  const [group, setGroup] = useState('townships');
  const [sortBy, setSortBy] = useState('air');
  const [homes, setHomes] = useState(500);
  const today = todayMY();
  const tomorrow = addDays(today, 1);
  const places = group === 'cities' ? CITIES : TOWNSHIPS;
  const doe = useAsync(() => tryDoeStations(), [today]);
  const { data, loading } = useAsync(
    () => (group === 'stations' ? Promise.resolve([]) : getManyPlaces(places, { startDate: today, endDate: tomorrow })),
    [group, today]
  );

  const rows = useMemo(() => {
    if (!data || !engine || group === 'stations') return [];
    const system = { ...DEFAULT_SYSTEM, kwp: settings.kwp };
    const list = data.map((d) => {
      const loss = computeHazeLoss(dayModelHours(d, tomorrow), { ...d.place, engine, system });
      const near = doe.data ? nearestStation(doe.data, d.place) : null;
      return {
        place: d.place,
        official: near,
        api: near?.station.latest.api ?? null,
        usAqi: d.current.us_aqi,
        aod: d.current.aod,
        loss,
        source: d.source,
      };
    });
    const airKey = (r) => (doe.data ? r.api ?? -1 : r.usAqi ?? -1);
    list.sort((a, b) => (sortBy === 'air' ? airKey(b) - airKey(a) : b.loss.lossPct - a.loss.lossPct));
    return list;
  }, [data, engine, settings.kwp, sortBy, tomorrow, doe.data, group]);

  const stations = useMemo(() => {
    if (!doe.data) return [];
    const now = Date.now() / 1000;
    return doe.data
      .filter((s) => s.latest && now - s.latest.t < 6 * 3600)
      .sort((a, b) => b.latest.api - a.latest.api);
  }, [doe.data]);

  const maxLoss = Math.max(5, ...rows.map((r) => r.loss.lossPct));
  const avgLossKwh = rows.length ? rows.reduce((s, r) => s + r.loss.lossKwh, 0) / rows.length : 0;
  const rate = settings.home.tariff.mode === 'flat' ? settings.home.tariff.flatRate : (settings.home.tariff.peakRate + settings.home.tariff.offPeakRate) / 2;
  const busy = doe.loading || (group !== 'stations' && (loading || !data));

  return (
    <>
      {group !== 'stations' && data && data.length > 0 && <DemoBanner source={data[0]?.source} />}
      {!doe.loading && !doe.data && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            Official DOE readings could not be loaded right now, so air quality below is a model estimate (US AQI). Official readings:{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a>.
          </span>
        </div>
      )}
      <div className="place-title">
        <h1>Rankings</h1>
        <span className="sub">Official air quality now, and how much solar the haze will take tomorrow</span>
      </div>
      <div className="spread section">
        <div className="chips">
          <button className={`chip ${group === 'townships' ? 'active' : ''}`} onClick={() => setGroup('townships')}>Sime Darby townships</button>
          <button className={`chip ${group === 'cities' ? 'active' : ''}`} onClick={() => setGroup('cities')}>Malaysian cities</button>
          <button className={`chip ${group === 'stations' ? 'active' : ''}`} onClick={() => setGroup('stations')}>All DOE stations</button>
        </div>
        {group !== 'stations' && (
          <div className="chips">
            <span className="small muted" style={{ alignSelf: 'center' }}>Sort by</span>
            <button className={`chip ${sortBy === 'air' ? 'active' : ''}`} onClick={() => setSortBy('air')}>Air quality</button>
            <button className={`chip ${sortBy === 'loss' ? 'active' : ''}`} onClick={() => setSortBy('loss')}>Solar loss</button>
          </div>
        )}
      </div>

      {busy ? (
        <Loading />
      ) : group === 'stations' ? (
        <StationsTable stations={stations} onPick={onPick} />
      ) : (
        <>
          <div className="card section">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{group === 'townships' ? 'Township' : 'City'}</th>
                    <th>{doe.data ? 'Official API (DOE)' : 'US AQI (model)'}</th>
                    <th>Haze</th>
                    <th style={{ minWidth: 180 }}>Solar lost tomorrow ({settings.kwp} kW)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const official = doe.data && r.official;
                    const l = official ? doeLevel(r.api) : aqiLevel(r.usAqi);
                    const value = official ? r.api : r.usAqi;
                    return (
                      <tr key={r.place.name} className="clickable" onClick={() => onPick(r.place)} title="Open this location">
                        <td className="rank">{i + 1}</td>
                        <td>
                          <b>{r.place.name}</b>
                          <div className="small muted">{r.place.area}</div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: l.color, color: l.ink }}>
                            {value !== undefined && value !== null ? Math.round(value) : '–'}
                          </span>
                          <div className="small muted">
                            {official
                              ? `${l.label} · ${r.official.station.name} station, ${Math.round(r.official.distanceKm)} km`
                              : doe.data
                                ? 'No DOE station reporting nearby'
                                : l.short || l.label}
                          </div>
                        </td>
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
            {doe.data && (
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                Air quality: latest hourly reading from the nearest DOE station (IQAir's free plan allows only 5 lookups a minute, too few for a ranking). Haze level and solar loss: model forecast.
              </p>
            )}
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

function StationsTable({ stations, onPick }) {
  if (!stations.length) {
    return (
      <div className="card section">
        Official DOE readings are not available right now. Check{' '}
        <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a> directly.
      </div>
    );
  }
  const latestT = Math.max(...stations.map((s) => s.latest.t));
  const counts = stations.reduce((m, s) => {
    const k = doeLevel(s.latest.api).label;
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  return (
    <div className="card section">
      <div className="spread">
        <div>
          <h2>All {stations.length} DOE monitoring stations</h2>
          <p className="lede">
            Official Air Pollutant Index, latest hour ({fmtTime(latestT, 8 * 3600, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}).
            Source: <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">DOE MyEQMS</a>.
          </p>
        </div>
        <div className="chips">
          {Object.entries(counts).map(([k, n]) => {
            const l = doeLevel(stations.find((s) => doeLevel(s.latest.api).label === k).latest.api);
            return (
              <span key={k} className="badge" style={{ background: l.color, color: l.ink, fontSize: 12.5 }}>
                {n} {k}
              </span>
            );
          })}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Station</th>
              <th>API</th>
              <th>Status</th>
              <th>Dominant pollutant</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s, i) => {
              const l = doeLevel(s.latest.api);
              return (
                <tr
                  key={s.id}
                  className="clickable"
                  title="Open this location"
                  onClick={() => onPick({ name: s.name, area: `${s.state} · DOE station`, lat: s.lat, lon: s.lon })}
                >
                  <td className="rank">{i + 1}</td>
                  <td>
                    <b>{s.name}</b>
                    <div className="small muted">{s.state}</div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: l.color, color: l.ink }}>{s.latest.api}</span>
                  </td>
                  <td className="small">{l.label}</td>
                  <td className="small">{DOE_SYMBOLS[s.latest.symbol] || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
