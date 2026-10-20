import { useEffect, useMemo, useState } from 'react';
import { getManyPlaces, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { computeHazeLoss } from '../lib/model.js';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { DEFAULT_SYSTEM } from '../lib/solar.js';
import { aqiLevel } from '../lib/aqi.js';
import { getIqair, iqairPausedUntil } from '../lib/iqair.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_SYMBOLS, DOE_SOURCE_URL } from '../lib/doe.js';
import { TOWNSHIPS, CITIES } from '../lib/places.js';
import { useAsync, Loading, DemoBanner, fmtTime } from './common.jsx';

// IQAir's free plan allows 5 lookups a minute. Readings go through the shared queue in
// lib/iqair.js (spaced out, paused when IQAir is busy, remembered for 30 minutes) and
// fill in as they arrive. Nearby townships share one reading.
function useIqairQueue(places, active) {
  const [results, setResults] = useState({});
  const [pausedUntil, setPausedUntil] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const tick = setInterval(() => setPausedUntil(iqairPausedUntil()), 1000);
    (async () => {
      for (const p of places) {
        const r = await getIqair(p, { background: true });
        if (cancelled) return;
        setResults((m) => ({ ...m, [p.name]: r }));
        if (r.notConfigured) return; // no key on the server: stop asking
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [places, active]);
  return { results, pausedUntil };
}

export default function RankingsPage({ engine, settings, onPick }) {
  const [group, setGroup] = useState('townships');
  const [sortBy, setSortBy] = useState('doe');
  const [homes, setHomes] = useState(500);
  const today = todayMY();
  const tomorrow = addDays(today, 1);
  const places = group === 'cities' ? CITIES : TOWNSHIPS;
  const doe = useAsync(() => tryDoeStations(), [today]);
  const { results: iqResults, pausedUntil: iqPausedUntil } = useIqairQueue(places, group !== 'stations');
  const { data, loading } = useAsync(
    () => (group === 'stations' ? Promise.resolve([]) : getManyPlaces(places, { startDate: today, endDate: tomorrow })),
    [group, today]
  );

  const rows = useMemo(() => {
    if (!data || !engine || group === 'stations') return [];
    const system = { ...DEFAULT_SYSTEM, kwp: settings.kwp };
    const list = data.map((d) => {
      const loss = computeHazeLoss(dayModelHours(d, tomorrow), { ...d.place, engine, system });
      const output = lossBreakdown(loss, { system, soilingPct: soilingForDate(d, tomorrow).pct }).final;
      const near = doe.data ? nearestStation(doe.data, d.place) : null;
      const iq = iqResults[d.place.name];
      return {
        place: d.place,
        official: near,
        api: near?.station.latest.api ?? null,
        iq: iq && !iq.error ? iq : null,
        iqState: iq ? (iq.error ? (iq.limited ? 'busy' : 'error') : 'ok') : 'waiting',
        loss,
        output,
        source: d.source,
      };
    });
    const key = {
      doe: (r) => r.api ?? -1,
      iqair: (r) => r.iq?.aqius ?? -1,
      loss: (r) => r.loss.lossPct,
      output: (r) => r.output,
    }[sortBy];
    list.sort((a, b) => key(b) - key(a));
    return list;
  }, [data, engine, settings.kwp, sortBy, tomorrow, doe.data, group, iqResults]);
  const iqDone = rows.filter((r) => r.iqState !== 'waiting').length;

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
            Official DOE readings could not be loaded right now. Check{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a>.
          </span>
        </div>
      )}
      <div className="place-title">
        <h1>Rankings</h1>
        <span className="sub">Air quality now from IQAir and the DOE, and tomorrow's solar output and haze loss</span>
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
            <button className={`chip ${sortBy === 'doe' ? 'active' : ''}`} onClick={() => setSortBy('doe')}>DOE API</button>
            <button className={`chip ${sortBy === 'iqair' ? 'active' : ''}`} onClick={() => setSortBy('iqair')}>IQAir</button>
            <button className={`chip ${sortBy === 'output' ? 'active' : ''}`} onClick={() => setSortBy('output')}>Solar output</button>
            <button className={`chip ${sortBy === 'loss' ? 'active' : ''}`} onClick={() => setSortBy('loss')}>Haze loss</button>
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
                    <th>DOE API (official)</th>
                    <th>IQAir US AQI</th>
                    <th>Solar tomorrow</th>
                    <th style={{ minWidth: 170 }}>Lost to haze ({settings.kwp} kW)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const dl = doeLevel(r.api);
                    const il = aqiLevel(r.iq?.aqius);
                    return (
                      <tr key={r.place.name} className="clickable" onClick={() => onPick(r.place)} title="Open this location">
                        <td className="rank">{i + 1}</td>
                        <td>
                          <b>{r.place.name}</b>
                          <div className="small muted">{r.place.area}</div>
                        </td>
                        <td>
                          {r.official ? (
                            <>
                              <span className="badge" style={{ background: dl.color, color: dl.ink }}>{r.api}</span>
                              <div className="small muted">
                                {dl.label} · {r.official.station.name}, {Math.round(r.official.distanceKm)} km
                              </div>
                            </>
                          ) : (
                            <span className="small muted">{doe.data ? 'No station nearby' : 'Unavailable'}</span>
                          )}
                        </td>
                        <td>
                          {r.iq ? (
                            <>
                              <span className="badge" style={{ background: il.color, color: il.ink }}>{Math.round(r.iq.aqius)}</span>
                              <div className="small muted">
                                {il.short || il.label} · {r.iq.city}
                              </div>
                            </>
                          ) : (
                            <span className="small muted">
                              {r.iqState === 'waiting' ? 'Waiting for IQAir…' : r.iqState === 'busy' ? 'IQAir busy' : 'Unavailable'}
                            </span>
                          )}
                        </td>
                        <td>
                          <b>{r.output.toFixed(1)}</b> <span className="small muted">kWh</span>
                        </td>
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
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              DOE: latest hourly reading from the nearest official station. IQAir: nearest IQAir city
              {iqDone < rows.length
                ? ` (${iqDone}/${rows.length} loaded${
                    iqPausedUntil ? `, IQAir is busy, resuming in ${Math.max(1, Math.ceil((iqPausedUntil - Date.now()) / 1000))} s` : ''
                  }; the free plan allows 5 lookups a minute, so the rest fill in over the next few minutes)`
                : ''}
              . Solar: weather, haze and sunlight forecast model (output after clouds, heat, haze and dust).
            </p>
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
