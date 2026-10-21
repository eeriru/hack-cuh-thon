import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { aqiLevel, AQI_LEVELS, ADVICE } from '../lib/aqi.js';
import { computeHazeLoss } from '../lib/model.js';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_LEVELS, DOE_ADVICE, DOE_SYMBOLS, DOE_SOURCE_URL } from '../lib/doe.js';
import { getIqair, IQAIR_POLLUTANTS, IQAIR_URL, IQAIR_CONDITIONS } from '../lib/iqair.js';
import { AqiBars } from './charts.jsx';
import { InShort, Tip } from './Friendly.jsx';
import { airSummary } from '../lib/summary.js';
import HazeScene3D from './HazeScene3D.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, fmtTime } from './common.jsx';

// Air quality comes only from IQAir and the Department of Environment (DOE).

const DOE_TO_TIPS = { good: 'good', moderate: 'moderate', unhealthy: 'usg', very: 'very', hazardous: 'hazardous', emergency: 'hazardous' };
const MY = 8 * 3600;

function DoeScale({ api }) {
  const segs = [50, 50, 100, 100, 200];
  const pos = Math.min(100, ((api ?? 0) / 500) * 100);
  return (
    <div className="scale-wrap">
      <div className="scale">
        {segs.map((w, i) => (
          <span key={i} style={{ flex: w, background: DOE_LEVELS[i].color }} />
        ))}
      </div>
      <div className="scale-marker" style={{ left: `${pos}%` }} />
      <div className="scale-labels">
        {[0, 50, 100, 200, 300, 500].map((v) => (
          <span key={v} style={{ left: `${(v / 500) * 100}%` }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

function AqiScale({ aqi }) {
  const segs = [50, 50, 50, 50, 100];
  const pos = Math.min(100, ((aqi ?? 0) / 300) * 100);
  return (
    <div className="scale-wrap">
      <div className="scale">
        {segs.map((w, i) => (
          <span key={i} style={{ flex: w, background: AQI_LEVELS[i].color }} />
        ))}
      </div>
      <div className="scale-marker" style={{ left: `${pos}%` }} />
      <div className="scale-labels">
        {[0, 50, 100, 150, 200, 300].map((v) => (
          <span key={v} style={{ left: `${(v / 300) * 100}%` }}>{v}</span>
        ))}
      </div>
    </div>
  );
}

const km = (d) => (d < 1 ? '<1' : Math.round(d));

export default function AirQualityPage({ place, engine, go }) {
  const today = todayMY();
  const doe = useAsync(() => tryDoeStations(), [today]);
  const iq = useAsync(() => getIqair(place), [place.lat, place.lon]);
  const official = useMemo(() => (doe.data ? nearestStation(doe.data, place) : null), [doe.data, place]);
  // Only the solar card below uses the haze/sunlight model data; it loads separately.
  const solarData = useAsync(() => getPlaceData(place, { startDate: addDays(today, -3), endDate: addDays(today, 1) }), [place.lat, place.lon, today]);
  const solar = useMemo(() => {
    if (!solarData.data || !engine) return null;
    const day = (d) => {
      const L = computeHazeLoss(dayModelHours(solarData.data, d), { ...place, engine });
      if (!L.rows.length) return null;
      return { ...L, output: lossBreakdown(L, { soilingPct: soilingForDate(solarData.data, d).pct }).final };
    };
    return { source: solarData.data.source, today: day(today), tomorrow: day(addDays(today, 1)) };
  }, [solarData.data, engine, place, today]);

  if (doe.loading || iq.loading) return <Loading text="Loading IQAir and DOE readings…" />;

  const st = official?.station;
  const reading = st?.latest;
  const dl = doeLevel(reading?.api);
  const iqa = iq.data && !iq.data.error ? iq.data : null;
  const il = aqiLevel(iqa?.aqius);
  const tipsKey = iqa ? il.key : st ? DOE_TO_TIPS[dl.key] : null;
  const iqaTs = iqa?.ts ? Date.parse(iqa.ts) / 1000 : null;
  const w = iqa?.weather || {};
  const past24 = st ? st.readings.slice(-24) : [];

  return (
    <>
      {iq.data?.error && !iq.data.notConfigured && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            {iq.data.error}. {st ? 'Showing the official DOE reading as the main number.' : ''}
          </span>
        </div>
      )}
      <div className="place-title">
        <h1>{place.name}</h1>
        <span className="sub">{place.area}</span>
        <span className="stamp">
          {iqa && iqaTs ? `IQAir updated ${fmtTime(iqaTs, MY)}` : ''}
          {iqa && iqaTs && st ? ' · ' : ''}
          {st ? `DOE reading for ${fmtTime(reading.t, MY)}` : ''}
        </span>
      </div>

      <InShort
        items={airSummary({
          iq: iqa,
          iqLevel: il,
          doe: st ? { api: reading.api, station: st.name } : null,
          doeLevel: { ...dl, key: st ? DOE_TO_TIPS[dl.key] || dl.key : null },
        })}
      />

      {!iqa && !st ? (
        <div className="card section">
          <h2>Air quality readings unavailable</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            Neither IQAir nor the DOE has a current reading for this location
            {doe.data ? ' (the nearest DOE station is more than 60 km away or has not reported in 6 hours)' : ''}. Check{' '}
            <a href={IQAIR_URL} target="_blank" rel="noreferrer">IQAir</a> or{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a> directly.
          </p>
        </div>
      ) : (
        <section className="hero section" aria-label="Current air quality">
          {iqa ? (
            <div className="hero-aqi" style={{ background: il.color, color: il.ink }}>
              <span className="label">
                US AQI · IQAir · {iqa.city}
                <Tip term="usAqi" />
              </span>
              <div className="big">
                <span className="num">{Math.round(iqa.aqius)}</span>
                <span className="cat">{il.label}</span>
                <span className="face" aria-hidden="true">{il.face}</span>
              </div>
              <span className="main-pol">
                {IQAIR_POLLUTANTS[iqa.mainus] ? `Main pollutant: ${IQAIR_POLLUTANTS[iqa.mainus]}` : ''}
              </span>
              <AqiScale aqi={iqa.aqius} />
            </div>
          ) : (
            <div className="hero-aqi" style={{ background: dl.color, color: dl.ink }}>
              <span className="label">
                Official API · Department of Environment
                <Tip term="doeApi" />
              </span>
              <div className="big">
                <span className="num">{reading.api}</span>
                <span className="cat">{dl.label}</span>
              </div>
              <span className="main-pol">
                {DOE_SYMBOLS[reading.symbol] ? `Dominant pollutant: ${DOE_SYMBOLS[reading.symbol]} · ` : ''}
                Station: {st.name} ({km(official.distanceKm)} km away)
              </span>
              <DoeScale api={reading.api} />
            </div>
          )}
          <div className="hero-side">
            {st && (
              <div className="stat" style={{ gridColumn: '1 / -1' }}>
                <div className="k">
                  Official DOE API · {st.name}
                  <Tip term="doeApi" />
                </div>
                <div className="v">
                  <span className="badge" style={{ background: dl.color, color: dl.ink, fontSize: 20, padding: '2px 10px' }}>{reading.api}</span>{' '}
                  {dl.label}
                  <small>{km(official.distanceKm)} km away</small>
                </div>
              </div>
            )}
            {iqa ? (
              <>
                <div className="stat">
                  <div className="k">Conditions</div>
                  <div className="v" style={{ fontSize: 18 }}>{IQAIR_CONDITIONS[(w.icon || '').slice(0, 2)] || '—'}</div>
                </div>
                <div className="stat">
                  <div className="k">Temperature</div>
                  <div className="v">
                    {w.tempC ?? '–'}
                    <small>°C</small>
                  </div>
                </div>
                <div className="stat">
                  <div className="k">Humidity</div>
                  <div className="v">
                    {w.humidity ?? '–'}
                    <small>%</small>
                  </div>
                </div>
                <div className="stat">
                  <div className="k">Wind</div>
                  <div className="v">
                    {w.windMs !== null && w.windMs !== undefined ? Math.round(w.windMs * 3.6) : '–'}
                    <small>km/h</small>
                  </div>
                </div>
              </>
            ) : (
              <div className="stat" style={{ gridColumn: '1 / -1' }}>
                <div className="k">IQAir</div>
                <div className="v" style={{ fontSize: 16 }}>No IQAir reading right now</div>
              </div>
            )}
          </div>
        </section>
      )}

      {(iqa || st) && (
        <div className="section">
          <HazeScene3D
            aqi={iqa ? iqa.aqius : null}
            doeApi={st ? reading.api : null}
            label={`Right now · ${place.name}`}
            signTitle={TOWNSHIPS.some((t) => t.name === place.name) ? place.name : null}
            interactive={false}
            height={300}
          />
        </div>
      )}

      {(iqa || st) && (
        <div className="grid grid-2 section">
          <div className="card">
            <h2>
              IQAir and DOE side by side
              <Tip term="twoScales" label="Why are the numbers different?" />
            </h2>
            <p className="lede">Two trusted sources, two scales. Look at the colour and the word, not just the number.</p>
            <div className="compare">
              <div className="cmp">
                <div className="cmp-src">IQAir · US AQI</div>
                {iqa ? (
                  <>
                    <span className="badge big-badge" style={{ background: il.color, color: il.ink }}>{Math.round(iqa.aqius)}</span>
                    <div className="cmp-cat">{il.label}</div>
                    <div className="small muted">
                      {iqa.city}, {iqa.state}
                      {IQAIR_POLLUTANTS[iqa.mainus] ? ` · ${IQAIR_POLLUTANTS[iqa.mainus]}` : ''}
                      {iqaTs ? ` · ${fmtTime(iqaTs, MY)}` : ''}
                    </div>
                  </>
                ) : (
                  <div className="small muted">Not available right now</div>
                )}
              </div>
              <div className="cmp">
                <div className="cmp-src">DOE · Malaysian API</div>
                {st ? (
                  <>
                    <span className="badge big-badge" style={{ background: dl.color, color: dl.ink }}>{reading.api}</span>
                    <div className="cmp-cat">{dl.label}</div>
                    <div className="small muted">
                      {st.name} station, {km(official.distanceKm)} km
                      {DOE_SYMBOLS[reading.symbol] ? ` · ${DOE_SYMBOLS[reading.symbol]}` : ''} · {fmtTime(reading.t, MY)}
                    </div>
                  </>
                ) : (
                  <div className="small muted">No DOE station within 60 km</div>
                )}
              </div>
            </div>
            <p className="small muted" style={{ margin: '12px 0 0' }}>
              The numbers differ because IQAir uses the US scale and adds its own sensors, while the DOE uses Malaysia's official
              scale at one government station. The DOE figure is the one quoted in official announcements, such as school closures.
            </p>
          </div>
          <div className="card">
            <h2>Health advice</h2>
            {st && (
              <p className="lede" style={{ color: 'var(--ink-2)' }}>
                <b>DOE advice:</b> {DOE_ADVICE[dl.key]}
              </p>
            )}
            <div className="advice">
              {(ADVICE[tipsKey] || ADVICE.good).map(([k, v]) => (
                <div key={k}>
                  <b>{k}</b>
                  {v}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-2 section">
        {st ? (
          <div className="card">
            <div className="spread">
              <h2>Past 24 hours (DOE)</h2>
              <span className="badge" style={{ background: dl.color, color: dl.ink }}>API {reading.api}</span>
            </div>
            <p className="lede">
              Official hourly API at {st.name}. Source:{' '}
              <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">DOE MyEQMS</a>.
            </p>
            <AqiBars
              level={doeLevel}
              unit="API"
              ticks={[0, 50, 100, 200, 300, 500]}
              points={past24.map((r) => ({
                key: r.t,
                aqi: r.api,
                label: fmtTime(r.t, MY, { hour: 'numeric' }),
                sub: fmtTime(r.t, MY, { weekday: 'short', hour: 'numeric' }),
              }))}
            />
          </div>
        ) : (
          <div className="card">
            <h2>Past 24 hours</h2>
            <p className="lede" style={{ marginBottom: 0 }}>
              Hourly history comes from DOE stations in Malaysia; there is none within 60 km of this location.
            </p>
          </div>
        )}
        <SolarTeaser solar={solar} loading={solarData.loading || !engine} go={go} />
      </div>
    </>
  );
}

function SolarTeaser({ solar, loading, go }) {
  const t = solar?.today;
  const m = solar?.tomorrow;
  const fmt = (x) => (x ? x.output.toFixed(1) : '–');
  return (
    <div className="card" style={{ background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }}>
      <h2 style={{ color: 'var(--paper)' }}>☀ Solar forecast</h2>
      <p className="lede" style={{ color: '#c7bfae' }}>
        For a 5 kW rooftop system here. Uses satellite haze, cloud and sunlight data.
        {solar?.source === 'demo' ? ' Simulated (live data unreachable).' : ''}
      </p>
      <div className="headline-stats">
        <div className="hs">
          <div className="k">Today</div>
          <div className="v">
            {loading ? '…' : fmt(t)}
            <small>{t ? ` kWh · haze −${t.lossPct.toFixed(0)}%` : ''}</small>
          </div>
        </div>
        <div className="hs">
          <div className="k">Tomorrow</div>
          <div className="v">
            {loading ? '…' : fmt(m)}
            <small>{m ? ` kWh · haze −${m.lossPct.toFixed(0)}%` : ''}</small>
          </div>
        </div>
      </div>
      <p style={{ color: '#d8d1c2', fontSize: 13.5 }}>
        Expected output after clouds, heat, haze and dust. See where your solar goes, the 7-day forecast and a battery plan.
      </p>
      <button className="btn" style={{ background: 'var(--sun)', borderColor: 'var(--sun)', color: 'var(--ink)' }} onClick={() => go('forecast')}>
        Open solar forecast →
      </button>
    </div>
  );
}
