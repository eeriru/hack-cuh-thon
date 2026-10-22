import { useMemo } from 'react';
import { getPlaceData, addDays, todayMY, dayModelHours } from '../lib/api.js';
import { aqiLevel, AQI_LEVELS, ADVICE } from '../lib/aqi.js';
import { computeHazeLoss } from '../lib/model.js';
import { lossBreakdown, soilingForDate } from '../lib/losses.js';
import { tryDoeStations, nearestStation, doeLevel, DOE_LEVELS, DOE_ADVICE, DOE_SYMBOLS, DOE_SOURCE_URL } from '../lib/doe.js';
import { getIqair, IQAIR_POLLUTANTS, IQAIR_URL, IQAIR_CONDITIONS } from '../lib/iqair.js';
import { AqiBars } from './charts.jsx';
import { Tip } from './Friendly.jsx';
import { Cloud, WeatherCard } from './Dashboard.jsx';
import { airSummary } from '../lib/summary.js';
import HazeScene3D from './HazeScene3D.jsx';
import { TOWNSHIPS } from '../lib/places.js';
import { useAsync, Loading, fmtTime } from './common.jsx';
import { tr } from '../lib/i18n.js';
import { lazy, Suspense } from 'react';

// The map library is large, so it loads only when the Air quality page needs it.
const HazeSourceMap = lazy(() => import('./HazeSourceMap.jsx'));

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

const ADVICE_ICON = { 'Outdoor exercise': '🏃', Windows: '🪟', Mask: '😷', 'Air purifier': '🌀', 'Sensitive groups': '👶' };

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

  // Weather right now for the sky card (same source as the Weather & solar page).
  const wxNow = useMemo(() => {
    const d = solarData.data;
    if (!d?.current) return null;
    const now = Date.now() / 1000;
    const next = d.hours.filter((h) => h.t >= now - 1800).slice(0, 24);
    return { c: d.current, rainNext24: next.reduce((t, h) => t + (h.rain || 0), 0), hi: null };
  }, [solarData.data]);

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
            {iq.data.error}. {st ? tr('Showing the official DOE reading as the main number.') : ''}
          </span>
        </div>
      )}
      <h1 className="sr-only">{tr('Air quality')}</h1>


      {!iqa && !st ? (
        <div className="card section">
          <h2>{tr('Air quality readings unavailable')}</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            {tr('Neither IQAir nor the DOE has a current reading for this location')}
            {doe.data ? ` ${tr('(the nearest DOE station is more than 60 km away or has not reported in 6 hours)')}` : ''}. {tr('Check')}{' '}
            <a href={IQAIR_URL} target="_blank" rel="noreferrer">IQAir</a> {tr('or')}{' '}
            <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">MyEQMS (DOE)</a> {tr('directly.')}
          </p>
        </div>
      ) : (
        <div className="dash section">
          <div className="dash-main">
            <div className="scene-row">
              <section className="scene-card scene-blue aq-scene" aria-label={tr('Current air quality')}>
                <div className="scene-art" aria-hidden="true">
                  <Cloud className="sc1" />
                  <Cloud className="sc4" />
                </div>
                <div className="scene-head">
                  <span className="scene-badge" aria-hidden="true">{iqa ? il.face : '🏛️'}</span>
                  <span>
                    <b>
                      {iqa ? `US AQI · IQAir` : tr('Official API · Department of Environment')}
                      <Tip term={iqa ? 'usAqi' : 'doeApi'} />
                    </b>
                    <small>{iqa ? iqa.city : st.name}</small>
                  </span>
                </div>
                <div className="scene-big">
                  <span className="num">{iqa ? Math.round(iqa.aqius) : reading.api}</span>
                  <span className="mini-chip" style={{ background: (iqa ? il : dl).color, color: (iqa ? il : dl).ink }}>
                    {tr((iqa ? il : dl).label)}
                  </span>
                </div>
                <div className="scene-cond">
                  {iqa
                    ? IQAIR_POLLUTANTS[iqa.mainus]
                      ? `${tr('Main pollutant')}: ${tr(IQAIR_POLLUTANTS[iqa.mainus])}`
                      : ''
                    : DOE_SYMBOLS[reading.symbol]
                      ? `${tr('Dominant pollutant')}: ${tr(DOE_SYMBOLS[reading.symbol])}`
                      : ''}
                </div>
                <div className="aq-scale-panel">{iqa ? <AqiScale aqi={iqa.aqius} /> : <DoeScale api={reading.api} />}</div>
              </section>
              {wxNow ? <WeatherCard W={wxNow} night={wxNow.c.isDay === 0} placeName={place.name} /> : <div className="scene-card scene-warm" />}
            </div>

            <section className="card">
              <HazeScene3D
                aqi={iqa ? iqa.aqius : null}
                doeApi={st ? reading.api : null}
                label={`${tr('Right now')} · ${place.name}`}
                signTitle={TOWNSHIPS.some((t) => t.name === place.name) ? place.name : null}
                interactive={false}
                height={300}
                weatherCode={solarData.data?.current?.weather_code ?? null}
              />
            </section>

            <div className="two-col">
          <div className="card">
            <h2>
              ⚖ {tr('IQAir and DOE side by side')}
              <Tip term="twoScales" label="Why are the numbers different?" />
            </h2>
            <div className="compare">
              <div className="cmp">
                <div className="cmp-src">IQAir · US AQI</div>
                {iqa ? (
                  <>
                    <span className="badge big-badge" style={{ background: il.color, color: il.ink }}>{Math.round(iqa.aqius)}</span>
                    <div className="cmp-cat">{tr(il.label)}</div>
                    <div className="small muted">
                      {iqa.city}, {iqa.state}
                      {IQAIR_POLLUTANTS[iqa.mainus] ? ` · ${tr(IQAIR_POLLUTANTS[iqa.mainus])}` : ''}
                      {iqaTs ? ` · ${fmtTime(iqaTs, MY)}` : ''}
                    </div>
                  </>
                ) : (
                  <div className="small muted">{tr('Not available right now')}</div>
                )}
              </div>
              <div className="cmp">
                <div className="cmp-src">DOE · Malaysian API</div>
                {st ? (
                  <>
                    <span className="badge big-badge" style={{ background: dl.color, color: dl.ink }}>{reading.api}</span>
                    <div className="cmp-cat">{tr(dl.label)}</div>
                    <div className="small muted">
                      {tr('{name} station, {km} km', { name: st.name, km: km(official.distanceKm) })}
                      {DOE_SYMBOLS[reading.symbol] ? ` · ${tr(DOE_SYMBOLS[reading.symbol])}` : ''} · {fmtTime(reading.t, MY)}
                    </div>
                  </>
                ) : (
                  <div className="small muted">{tr('No DOE station within 60 km')}</div>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <h2>
              🩺 {tr('Health advice')}
              {st && <Tip label="DOE advice:" text={DOE_ADVICE[dl.key]} />}
            </h2>
            <div className="advice">
              {(ADVICE[tipsKey] || ADVICE.good).map(([k, v]) => (
                <div key={k}>
                  <b>
                    <span aria-hidden="true">{ADVICE_ICON[k] || '•'}</span> {tr(k)}
                  </b>
                  {tr(v)}
                </div>
              ))}
            </div>
          </div>
            </div>

            {st ? (
          <div className="card">
            <div className="spread">
              <h2>{tr('Past 24 hours (DOE)')}</h2>
              <span className="badge" style={{ background: dl.color, color: dl.ink }}>API {reading.api}</span>
            </div>
            <p className="small muted">
              {st.name} · <a href={DOE_SOURCE_URL} target="_blank" rel="noreferrer">DOE MyEQMS</a>
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
            <h2>{tr('Past 24 hours')}</h2>
            <p className="lede" style={{ marginBottom: 0 }}>
              {tr('Hourly history comes from DOE stations in Malaysia; there is none within 60 km of this location.')}
            </p>
          </div>
        )}
          </div>

          <aside className="side-panel" aria-label={tr('Air quality')}>
            <div className="sp-head">
              <div>
                <b>{tr('Air right now')}</b>
                <small>📍 {place.name}</small>
              </div>
              <span className="sp-temp" style={{ color: (iqa ? il : dl).color === '#f6d24c' ? 'var(--sun-deep)' : undefined }}>{iqa ? Math.round(iqa.aqius) : reading.api}</span>
            </div>
            {st && (
              <div className="uv-card">
                <span className="uv-ic" aria-hidden="true">🏛️</span>
                <div>
                  <div className="uv-top">
                    <b>API {reading.api}</b>
                    <span className="uv-badge" style={{ background: dl.color, color: dl.ink }}>{tr(dl.label)}</span>
                    <Tip term="doeApi" />
                  </div>
                  <small>
                    DOE · {st.name} · {tr('{km} km away', { km: km(official.distanceKm) })} · {fmtTime(reading.t, MY)}
                  </small>
                </div>
              </div>
            )}
            <h3 className="sp-title">{tr('In short')}</h3>
            <ul className="sp-days">
              {airSummary({
                iq: iqa,
                iqLevel: il,
                doe: st ? { api: reading.api, station: st.name } : null,
                doeLevel: { ...dl, key: st ? DOE_TO_TIPS[dl.key] || dl.key : null },
              }).map((it, i) => (
                <li key={i}>
                  <span className="sp-ic" aria-hidden="true">{it.icon}</span>
                  <span className="sp-mid">
                    <b>{it.text}</b>
                  </span>
                </li>
              ))}
            </ul>
            <SolarTeaser solar={solar} loading={solarData.loading || !engine} go={go} />
            <p className="small muted" style={{ margin: 0 }}>
              {iqa && iqaTs ? tr('IQAir updated {time}', { time: fmtTime(iqaTs, MY) }) : ''}
            </p>
          </aside>
        </div>
      )}

      <Suspense fallback={<div className="card section">{tr('Loading the haze source map…')}</div>}>
        <HazeSourceMap place={place} windFromDeg={solarData.data?.current?.windDir ?? (w.windDir ?? null)} windKmh={solarData.data?.current?.wind ?? (w.windMs ? w.windMs * 3.6 : null)} />
      </Suspense>
    </>
  );
}

function SolarTeaser({ solar, loading, go }) {
  const t = solar?.today;
  const m = solar?.tomorrow;
  const fmt = (x) => (x ? x.output.toFixed(1) : '–');
  return (
    <div className="big-hero solar-hero teaser">
      <div className="where">
        ☀ {tr('Solar forecast')} · 5 kW{solar?.source === 'demo' ? ` · ${tr('Simulated data.')}` : ''}
      </div>
      <div className="big-row">
        <span className="big-num">{loading ? '…' : fmt(t)}</span>
        <span className="big-unit">kWh {tr('today')}</span>
      </div>
      <div className="pills">
        <span>
          {tr('Tomorrow')}: {loading ? '…' : fmt(m)} kWh
        </span>
      </div>
      <button className="btn teaser-btn" onClick={() => go('forecast')}>
        {tr('Weather & solar')} →
      </button>
    </div>
  );
}

