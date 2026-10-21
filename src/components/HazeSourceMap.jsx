import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFires, hazeSources, destination, REGION_BBOX } from '../lib/fires.js';
import { compass } from '../lib/weather.js';
import { useAsync } from './common.jsx';
import { Tip } from './Friendly.jsx';
import { tr } from '../lib/i18n.js';

const SECTOR = 35; // degrees either side of the upwind direction
const REACH_KM = 1500;

// Haze source map: satellite fire hotspots, your location, and the upwind wedge the
// wind is carrying smoke from.
export default function HazeSourceMap({ place, windFromDeg, windKmh }) {
  const fires = useAsync(() => getFires(), []);
  const list = useMemo(() => fires.data?.fires || [], [fires.data]);
  const src = useMemo(() => hazeSources(place, list, { windFromDeg, windKmh, sectorDeg: SECTOR, maxKm: REACH_KM }), [place, list, windFromDeg, windKmh]);
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!el.current || mapRef.current) return undefined;
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).fitBounds([
      [REGION_BBOX.south, REGION_BBOX.west],
      [REGION_BBOX.north, REGION_BBOX.east],
    ]);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 10,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO · Fires: NASA FIRMS',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layerRef.current;
    if (!g) return;
    g.clearLayers();
    const hasWind = windFromDeg !== null && windFromDeg !== undefined;
    if (hasWind) {
      const pts = [[place.lat, place.lon]];
      for (let a = -SECTOR; a <= SECTOR; a += 5) {
        const p = destination(place, windFromDeg + a, REACH_KM);
        pts.push([p.lat, p.lon]);
      }
      L.polygon(pts, { color: '#e0703e', weight: 1, fillColor: '#f6c3a8', fillOpacity: 0.25, dashArray: '4 4' })
        .bindTooltip(tr('Upwind: the wind blows from the {dir}', { dir: compass(windFromDeg) }))
        .addTo(g);
    }
    const upwindSet = new Set(src.upwind.map((f) => `${f.lat},${f.lon}`));
    for (const f of list) {
      const up = upwindSet.has(`${f.lat},${f.lon}`);
      L.circleMarker([f.lat, f.lon], {
        radius: Math.min(7, 2 + Math.sqrt(f.frp || 1) / 2),
        color: up ? '#b3261e' : '#e88b3a',
        weight: 1,
        fillOpacity: up ? 0.85 : 0.5,
      })
        .bindTooltip(`${tr('Fire hotspot')}${f.date ? ` · ${f.date}` : ''}${f.frp ? ` · ${Math.round(f.frp)} MW` : ''}${up ? ` · ${tr('upwind of you')}` : ''}`)
        .addTo(g);
    }
    L.circleMarker([place.lat, place.lon], { radius: 8, color: '#1d2433', weight: 3, fillColor: '#f5a524', fillOpacity: 1 })
      .bindTooltip(place.name, { permanent: true, direction: 'right', offset: [8, 0] })
      .addTo(g);
  }, [list, src, place, windFromDeg]);

  const top = src.regions[0];
  let headline;
  if (fires.loading) headline = tr('Loading fire hotspots…');
  else if (fires.data?.notConfigured) headline = tr('Fire hotspots need a free NASA FIRMS key (see the README). The wedge shows where the wind is coming from.');
  else if (fires.data?.error) headline = tr('Fire hotspots could not be loaded right now ({err}).', { err: tr(fires.data.error) });
  else if (!src.hasWind) headline = tr('{n} fire hotspots in the region in the last 2 days. Wind direction is not available.', { n: src.total });
  else if (top) {
    headline = tr('Most likely source: {n} hotspots in {region}, about {km} km to the {dir}.', {
      n: top.count,
      region: top.name,
      km: Math.round(top.km),
      dir: compass((windFromDeg + 360) % 360),
    });
    if (top.hours)
      headline += ` ${
        top.hours < 36
          ? tr("At today's wind, smoke takes roughly {n} hours to reach you.", { n: Math.round(top.hours) })
          : tr("At today's wind, smoke takes roughly {n} days to reach you.", { n: Math.round(top.hours / 24) })
      }`;
  } else
    headline = tr('No fire hotspots upwind of you right now ({n} in the region in the last 2 days). Haze today is more likely local: traffic, industry or open burning nearby.', { n: src.total });

  return (
    <div className="card section">
      <h2>
        🔥 {tr('Where is the haze coming from?')}
        <Tip text="Red and orange dots are fires spotted by NASA satellites in the last 2 days. The shaded wedge points to where the wind is blowing from: smoke from fires inside it can reach you. Wind near the ground is a rough guide; smoke also travels higher up, where the wind can differ." />
      </h2>
      <p className="lede">{headline}</p>
      <div ref={el} className="haze-map" role="img" aria-label={tr('Map of fire hotspots and the upwind direction')} />
      <div className="legend">
        <span><i style={{ background: '#b3261e', borderRadius: 99, width: 10 }} />{tr('Fire upwind of you')}</span>
        <span><i style={{ background: '#e88b3a', borderRadius: 99, width: 10 }} />{tr('Other fire')}</span>
        <span><i style={{ background: '#f6c3a8', border: '1px dashed #e0703e' }} />{tr('Upwind (wind from the {dir})', { dir: `${compass(windFromDeg) || '—'}${windKmh ? `, ${Math.round(windKmh)} km/h` : ''}` })}</span>
        {src.nearby > 0 && <span className="tone-bad">{tr('{n} fires within 100 km', { n: src.nearby })}</span>}
      </div>
      {src.regions.length > 1 && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {tr('Other upwind fire areas:')} {src.regions.slice(1, 4).map((r) => `${r.name} (${r.count})`).join(', ')}.
        </p>
      )}
    </div>
  );
}
