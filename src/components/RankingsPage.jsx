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
import { InShort, Tip } from './Friendly.jsx';
import ImpactBoard from './ImpactBoard.jsx';
import { tr } from '../lib/i18n.js';

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
  const rate = settings.home.tariff.mode === 'flat' ? settings.home.tariff.flatRate : (settings.home.tariff.peakRate + settings.home.tariff.offPeakRate) / 2;
  const busy = doe.loading || (group !== 'stations' && (loading || !data));

  return (
    <>
      {group !== 'stations' && data && data.length > 0 && <DemoBanner source={data[0]?.source} />}
      {!doe.loading && !doe.data && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            {tr('Official DOE readings could not be loaded right now. Check')}{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a>.
          </span>
        </div>
      )}
      <div className="place-title">
        <h1>{tr('Rankings')}</h1>
        <span className="sub">{tr('Compare places: air quality right now, and how much solar power each will make tomorrow')}</span>
      </div>
      {group !== 'stations' && rows.length > 0 && (
        <InShort
          items={(() => {
            const withApi = rows.filter((r) => r.api !== null);
            const worstAir = withApi.length ? withApi.reduce((a, b) => (b.api > a.api ? b : a)) : null;
            const bestAir = withApi.length ? withApi.reduce((a, b) => (b.api < a.api ? b : a)) : null;
            const bestSun = rows.reduce((a, b) => (b.output > a.output ? b : a));
            const hazy = rows.reduce((a, b) => (b.loss.lossPct > a.loss.lossPct ? b : a));
            return [
              worstAir && {
                icon: '😷',
                text: tr('Worst air now: {worst} (official API {api}, {level}). Cleanest: {best} ({bestApi}).', {
                  worst: worstAir.place.name,
                  api: worstAir.api,
                  level: tr(doeLevel(worstAir.api).label).toLowerCase(),
                  best: bestAir.place.name,
                  bestApi: bestAir.api,
                }),
              },
              { icon: '⚡', text: tr('Most solar tomorrow: {name}, about {kwh} kWh for a {kwp} kW system.', { name: bestSun.place.name, kwh: bestSun.output.toFixed(0), kwp: settings.kwp }) },
              hazy.loss.lossPct >= 3 && { icon: '🌫️', text: tr('Haze hits {name} hardest tomorrow (−{pct}% solar).', { name: hazy.place.name, pct: hazy.loss.lossPct.toFixed(0) }) },
              { icon: '👆', text: tr('Tap any row to see that place in detail.') },
            ];
          })()}
        />
      )}
      <div className="spread section">
        <div className="chips">
          <button className={`chip ${group === 'townships' ? 'active' : ''}`} onClick={() => setGroup('townships')}>{tr('Sime Darby townships')}</button>
          <button className={`chip ${group === 'cities' ? 'active' : ''}`} onClick={() => setGroup('cities')}>{tr('Malaysian cities')}</button>
          <button className={`chip ${group === 'stations' ? 'active' : ''}`} onClick={() => setGroup('stations')}>{tr('All DOE stations')}</button>
        </div>
        {group !== 'stations' && (
          <div className="chips">
            <span className="small muted" style={{ alignSelf: 'center' }}>{tr('Sort by')}</span>
            <button className={`chip ${sortBy === 'doe' ? 'active' : ''}`} onClick={() => setSortBy('doe')}>DOE API</button>
            <button className={`chip ${sortBy === 'iqair' ? 'active' : ''}`} onClick={() => setSortBy('iqair')}>IQAir</button>
            <button className={`chip ${sortBy === 'output' ? 'active' : ''}`} onClick={() => setSortBy('output')}>{tr('Solar output')}</button>
            <button className={`chip ${sortBy === 'loss' ? 'active' : ''}`} onClick={() => setSortBy('loss')}>{tr('Haze loss')}</button>
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
                    <th>{tr(group === 'townships' ? 'Township' : 'City')}</th>
                    <th>
                      {tr('DOE API (official)')}
                      <Tip term="doeApi" />
                    </th>
                    <th>
                      IQAir US AQI
                      <Tip term="usAqi" />
                    </th>
                    <th>
                      {tr('Solar tomorrow')}
                      <Tip term="kwh" label="What is a kWh?" />
                    </th>
                    <th style={{ minWidth: 170 }}>{tr('Lost to haze')} ({settings.kwp} kW)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const dl = doeLevel(r.api);
                    const il = aqiLevel(r.iq?.aqius);
                    return (
                      <tr key={r.place.name} className="clickable" onClick={() => onPick(r.place)} title={tr('Open this location')}>
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
                                {tr(dl.label)} · {r.official.station.name}, {Math.round(r.official.distanceKm)} km
                              </div>
                            </>
                          ) : (
                            <span className="small muted">{doe.data ? tr('No station nearby') : tr('Unavailable')}</span>
                          )}
                        </td>
                        <td>
                          {r.iq ? (
                            <>
                              <span className="badge" style={{ background: il.color, color: il.ink }}>{Math.round(r.iq.aqius)}</span>
                              <div className="small muted">
                                {tr(il.short || il.label)} · {r.iq.city}
                              </div>
                            </>
                          ) : (
                            <span className="small muted">
                              {r.iqState === 'waiting' ? tr('Waiting for IQAir…') : r.iqState === 'busy' ? tr('IQAir busy') : tr('Unavailable')}
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
              {tr('DOE: latest hourly reading from the nearest official station. IQAir: nearest IQAir city')}
              {iqDone < rows.length
                ? ` (${tr('{done}/{total} loaded', { done: iqDone, total: rows.length })}${
                    iqPausedUntil ? `, ${tr('IQAir is busy, resuming in {s} s', { s: Math.max(1, Math.ceil((iqPausedUntil - Date.now()) / 1000)) })}` : ''
                  }; ${tr('the free plan allows 5 lookups a minute, so the rest fill in over the next few minutes')})`
                : ''}
              . {tr('Solar: weather, haze and sunlight forecast model (output after clouds, heat, haze and dust).')}
            </p>
          </div>

          <ImpactBoard rows={rows} homes={homes} setHomes={setHomes} settings={settings} rate={rate} group={group} onPick={onPick} />
        </>
      )}
    </>
  );
}

function StationsTable({ stations, onPick }) {
  if (!stations.length) {
    return (
      <div className="card section">
        {tr('Official DOE readings are not available right now. Check')}{' '}
        <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a> {tr('directly.')}
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
          <h2>{tr('All {n} DOE monitoring stations', { n: stations.length })}</h2>
          <p className="lede">
            {tr('Official Air Pollutant Index, latest hour ({time}).', { time: fmtTime(latestT, 8 * 3600, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })}{' '}
            {tr('Source:')} <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">DOE MyEQMS</a>.
          </p>
        </div>
        <div className="chips">
          {Object.entries(counts).map(([k, n]) => {
            const l = doeLevel(stations.find((s) => doeLevel(s.latest.api).label === k).latest.api);
            return (
              <span key={k} className="badge" style={{ background: l.color, color: l.ink, fontSize: 12.5 }}>
                {n} {tr(k)}
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
              <th>{tr('Station')}</th>
              <th>API</th>
              <th>{tr('Status')}</th>
              <th>{tr('Dominant pollutant')}</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s, i) => {
              const l = doeLevel(s.latest.api);
              return (
                <tr
                  key={s.id}
                  className="clickable"
                  title={tr('Open this location')}
                  onClick={() => onPick({ name: s.name, area: `${s.state} · ${tr('DOE station')}`, lat: s.lat, lon: s.lon })}
                >
                  <td className="rank">{i + 1}</td>
                  <td>
                    <b>{s.name}</b>
                    <div className="small muted">{s.state}</div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: l.color, color: l.ink }}>{s.latest.api}</span>
                  </td>
                  <td className="small">{tr(l.label)}</td>
                  <td className="small">{tr(DOE_SYMBOLS[s.latest.symbol]) || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
