import { useEffect, useRef, useState } from 'react';
import { searchPlaces } from '../lib/api.js';
import { TOWNSHIPS } from '../lib/places.js';

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

export function LocationBar({ place, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      searchPlaces(q)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

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

  return (
    <div className="locbar">
      <div className="search" ref={boxRef}>
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search any town or city…"
          aria-label="Search location"
        />
        {open && results.length > 0 && (
          <div className="search-results">
            {results.map((r) => (
              <button
                key={`${r.lat},${r.lon}`}
                onClick={() => {
                  onChange(r);
                  setQ('');
                  setOpen(false);
                }}
              >
                {r.name}
                <small>{r.area}</small>
              </button>
            ))}
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
