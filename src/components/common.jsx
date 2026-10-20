import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPlaces } from '../lib/api.js';
import { TOWNSHIPS } from '../lib/places.js';
import { matchCountries, matchRegions, matchCities, iqairRegionName, wordMatch, getRegions, getCities, locateCity, FALLBACK_CITIES } from '../lib/browse.js';

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function Loading({ text = 'Loading live data…' }) {
  return (
    <div className="loading">
      <div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
        <div className="spinner" />
        <span>{text}</span>
      </div>
    </div>
  );
}

export function DemoBanner({ source }) {
  if (source !== 'demo') return null;
  return (
    <div className="banner" role="status">
      <span aria-hidden="true">⚠️</span>
      <span>
        <b>Simulated data.</b> Live data from Open-Meteo could not be reached, so you are seeing a simulated haze week.
        Numbers are illustrative only. Check your connection and refresh to load real readings.
      </span>
    </div>
  );
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
);

const flag = (code) => String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

export function LocationBar({ place, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // Browsing a country: { country, region?, items, kind: 'regions'|'cities'|'fallback', loading, error }
  const [browse, setBrowse] = useState(null);
  const [filter, setFilter] = useState('');
  const [busyCity, setBusyCity] = useState('');
  const boxRef = useRef(null);
  const countryMatches = useMemo(() => matchCountries(q), [q]);
  const regionMatches = useMemo(() => matchRegions(q), [q]);
  const cityMatches = useMemo(() => matchCities(q), [q]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setBrowse(null);
    setOpen(true);
    const id = setTimeout(() => {
      searchPlaces(q)
        .then((r) =>
          setResults(
            r.filter(
              (x) =>
                !countryMatches.some((c) => c.name === x.name) &&
                !cityMatches.some((c) => Math.abs(c.lat - x.lat) < 0.15 && Math.abs(c.lon - x.lon) < 0.15)
            )
          )
        )
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [q, countryMatches, cityMatches]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (p) => {
    onChange(p);
    setQ('');
    setBrowse(null);
    setFilter('');
    setOpen(false);
  };

  const openCountry = (country) => {
    setFilter('');
    setBrowse({ country, kind: 'regions', items: [], loading: true });
    getRegions(country)
      .then((items) => setBrowse({ country, kind: 'regions', items, loading: false }))
      .catch((e) => {
        const fb = FALLBACK_CITIES[country.code];
        setBrowse(
          fb
            ? { country, kind: 'fallback', items: fb, loading: false, note: 'Showing major cities (IQAir directory unavailable).' }
            : { country, kind: 'regions', items: [], loading: false, error: `Couldn't load regions (${e.message}). Type a city name instead, e.g. "${country.name === 'Indonesia' ? 'Pekanbaru' : 'capital city'}".` }
        );
      });
  };

  // Built-in cities in a region, used when IQAir's directory can't help
  const regionFallback = (country, region, why) => {
    const fb = (FALLBACK_CITIES[country.code] || []).filter((c) => wordMatch(region, c.area));
    setBrowse(
      fb.length
        ? { country, region, kind: 'fallback', items: fb, loading: false, note: why }
        : { country, region, kind: 'cities', items: [], loading: false, error: `${why} Type a city name in ${region} instead.` }
    );
  };

  const openRegion = (country, region, { fromSearch = false } = {}) => {
    setFilter('');
    setBrowse({ country, region, kind: 'cities', items: [], loading: true, fromSearch });
    // Names from our built-in list may be spelled differently in IQAir's directory
    const resolve = fromSearch
      ? getRegions(country).then((list) => iqairRegionName(region, list))
      : Promise.resolve(region);
    resolve
      .then((iqName) => {
        if (!iqName) return regionFallback(country, region, 'IQAir has no cities listed for this region yet.');
        return getCities(country, iqName).then((items) =>
          setBrowse({ country, region: iqName, kind: 'cities', items, loading: false, fromSearch })
        );
      })
      .catch(() => regionFallback(country, region, 'Showing major cities (IQAir directory unavailable).'));
  };

  const openCity = (country, region, city) => {
    setBusyCity(city);
    locateCity(country, region, city)
      .then(pick)
      .catch((e) => setBrowse((b) => ({ ...b, error: e.message })))
      .finally(() => setBusyCity(''));
  };

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ name: 'My location', area: `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`, lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => setLocating(false),
      { timeout: 10000 }
    );
  };

  const shownItems = browse
    ? browse.items.filter((it) => !filter.trim() || wordMatch(filter, typeof it === 'string' ? it : `${it.name} ${it.area}`))
    : [];
  const showSearch = !browse && (countryMatches.length > 0 || regionMatches.length > 0 || cityMatches.length > 0 || results.length > 0);

  return (
    <div className="locbar">
      <div className="search" ref={boxRef}>
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => (results.length || countryMatches.length || browse) && setOpen(true)}
          placeholder="Search a city or a country"
          aria-label="Search location"
        />
        {open && showSearch && (
          <div className="search-results">
            {countryMatches.length > 0 && <div className="sr-head">Browse a country</div>}
            {countryMatches.map((c) => (
              <button key={c.code} className="sr-country" onClick={() => openCountry(c)}>
                <span aria-hidden="true">{flag(c.code)}</span> {c.name}
                <small>regions & cities ›</small>
              </button>
            ))}
            {regionMatches.length > 0 && <div className="sr-head">Regions</div>}
            {regionMatches.map(({ country, region }) => (
              <button key={`${country.code}-${region}`} onClick={() => openRegion(country, region, { fromSearch: true })}>
                <span aria-hidden="true">{flag(country.code)}</span> {region}
                <small>{country.name} · cities ›</small>
              </button>
            ))}
            {cityMatches.length > 0 && <div className="sr-head">Major cities</div>}
            {cityMatches.map((c) => (
              <button key={`${c.name}-${c.lat}`} onClick={() => pick(c)}>
                {c.name}
                <small>{c.area}</small>
              </button>
            ))}
            {results.length > 0 && (countryMatches.length > 0 || regionMatches.length > 0 || cityMatches.length > 0) && (
              <div className="sr-head">Other places</div>
            )}
            {results.map((r) => (
              <button key={`${r.lat},${r.lon}`} onClick={() => pick(r)}>
                {r.name}
                <small>{r.area}</small>
              </button>
            ))}
          </div>
        )}
        {open && browse && (
          <div className="search-results browse">
            <div className="sr-nav">
              <button
                className="sr-back"
                onClick={() => (browse.region && !browse.fromSearch ? openCountry(browse.country) : setBrowse(null))}
                aria-label="Back"
              >
                ‹ Back
              </button>
              <b>
                {flag(browse.country.code)} {browse.region ? `${browse.region}, ${browse.country.name}` : browse.country.name}
              </b>
            </div>
            {browse.items.length > 10 && (
              <input
                className="sr-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={browse.kind === 'regions' ? 'Filter regions…' : 'Filter cities…'}
                aria-label="Filter list"
                autoFocus
              />
            )}
            <div className="sr-list">
              {browse.loading && <div className="sr-msg">Loading…</div>}
              {browse.error && <div className="sr-msg">{browse.error}</div>}
              {browse.note && <div className="sr-msg">{browse.note}</div>}
              {!browse.loading && !browse.error && shownItems.length === 0 && <div className="sr-msg">Nothing matches.</div>}
              {shownItems.map((it) =>
                browse.kind === 'fallback' ? (
                  <button key={it.name} onClick={() => pick(it)}>
                    {it.name}
                    <small>{it.area}</small>
                  </button>
                ) : browse.kind === 'regions' ? (
                  <button key={it} onClick={() => openRegion(browse.country, it)}>
                    {it}
                    <small>cities ›</small>
                  </button>
                ) : (
                  <button key={it} onClick={() => openCity(browse.country, browse.region, it)} disabled={!!busyCity}>
                    {it}
                    <small>{busyCity === it ? 'Locating…' : browse.region}</small>
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
      <button className="btn ghost" onClick={locate} disabled={locating}>
        {locating ? 'Locating…' : '◎ Use my location'}
      </button>
      <div className="chips" aria-label="Sime Darby townships">
        {TOWNSHIPS.slice(0, 6).map((t) => (
          <button key={t.name} className={`chip ${place.name === t.name ? 'active' : ''}`} onClick={() => onChange(t)}>
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export const fmtTime = (unix, offsetSec, opts = { hour: 'numeric', minute: '2-digit' }) =>
  new Date((unix + offsetSec) * 1000).toLocaleString('en-MY', { ...opts, timeZone: 'UTC' });

export const fmtDate = (dateStr, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-MY', { ...opts, timeZone: 'UTC' });
