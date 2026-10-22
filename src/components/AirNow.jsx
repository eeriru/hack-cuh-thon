import { useMemo } from 'react';
import { aqiLevel } from '../lib/aqi.js';
import { tryDoeStations, nearestStation, doeLevel } from '../lib/doe.js';
import { getIqair } from '../lib/iqair.js';
import { useAsync, fmtTime } from './common.jsx';
import { tr } from '../lib/i18n.js';

/** Compact strip: IQAir US AQI and DOE official API for a place, side by side. */
export default function AirNow({ place, go }) {
  const iq = useAsync(() => getIqair(place), [place.lat, place.lon]);
  const doe = useAsync(() => tryDoeStations(), []);
  const near = useMemo(() => (doe.data ? nearestStation(doe.data, place) : null), [doe.data, place]);
  const iqa = iq.data && !iq.data.error ? iq.data : null;
  const st = near?.station;
  if (iq.loading && doe.loading) return null;
  if (!iqa && !st) return null;
  const il = aqiLevel(iqa?.aqius);
  const dl = doeLevel(st?.latest?.api);
  return (
    <div className="airnow section" role="group" aria-label={tr('Air quality right now')}>
      <span className="airnow-k">{tr('Air right now')}</span>
      {iqa && (
        <span className="airnow-item">
          <span className="badge" style={{ background: il.color, color: il.ink }}>{Math.round(iqa.aqius)}</span>
          <span>
            <b>US AQI</b> · IQAir, {iqa.city} · {tr(il.short || il.label)}
          </span>
        </span>
      )}
      {st && (
        <span className="airnow-item">
          <span className="badge" style={{ background: dl.color, color: dl.ink }}>{st.latest.api}</span>
          <span>
            <b>API</b> · DOE, {st.name} · {tr(dl.label)} · {fmtTime(st.latest.t, 8 * 3600)}
          </span>
        </span>
      )}
      {go && (
        <button className="chip" onClick={() => go('air')}>
          {tr('Details')} ›
        </button>
      )}
    </div>
  );
}
