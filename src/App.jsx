import { useEffect, useState } from 'react';
import AirQualityPage from './components/AirQualityPage.jsx';
import SolarPage from './components/SolarPage.jsx';
import RankingsPage from './components/RankingsPage.jsx';
import MethodPage from './components/MethodPage.jsx';
import { LocationBar } from './components/common.jsx';
import { loadEngine } from './lib/model.js';
import { DEFAULT_HOME } from './lib/battery.js';
import { DEFAULT_PLACE } from './lib/places.js';

const TABS = [
  { id: 'air', label: 'Air quality' },
  { id: 'solar', label: 'Solar haze loss' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'method', label: 'How it works' },
];

const DEFAULT_SETTINGS = { kwp: 5, batteryKwh: DEFAULT_HOME.battery.capacityKwh, dailyKwh: DEFAULT_HOME.dailyKwh, home: DEFAULT_HOME };

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

const tabFromHash = () => {
  const id = window.location.hash.replace('#/', '');
  return TABS.some((t) => t.id === id) ? id : 'air';
};

export default function App() {
  const [tab, setTab] = useState(tabFromHash);
  const [place, setPlace] = useState(() => load('sh-place', DEFAULT_PLACE));
  const [settings, setSettings] = useState(() => {
    const s = load('sh-settings', DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...s, home: { ...DEFAULT_HOME, ...s.home, tariff: { ...DEFAULT_HOME.tariff, ...s.home?.tariff }, battery: { ...DEFAULT_HOME.battery, ...s.home?.battery } } };
  });
  const [engine, setEngine] = useState(null);

  useEffect(() => {
    loadEngine().then(setEngine);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => save('sh-place', place), [place]);
  useEffect(() => save('sh-settings', settings), [settings]);

  const go = (id) => {
    window.location.hash = `/${id}`;
    setTab(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/air" onClick={() => go('air')}>
            <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="16" fill="#1d2433" />
              <circle cx="32" cy="30" r="12" fill="#f5a524" />
              <path d="M12 44h40M16 51h32" stroke="#c9b9a0" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <span className="brand-name">
              Suria<span>Haze</span>
            </span>
          </a>
          <nav className="nav" aria-label="Main">
            {TABS.map((t) => (
              <a key={t.id} href={`#/${t.id}`} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell">
        {(tab === 'air' || tab === 'solar') && <LocationBar place={place} onChange={setPlace} />}
        {tab === 'air' && <AirQualityPage place={place} engine={engine} go={go} />}
        {tab === 'solar' && <SolarPage place={place} engine={engine} settings={settings} setSettings={setSettings} />}
        {tab === 'rankings' && (
          <RankingsPage
            engine={engine}
            settings={settings}
            onPick={(p) => {
              setPlace(p);
              go('air');
            }}
          />
        )}
        {tab === 'method' && <MethodPage engine={engine} />}
        <footer className="footer">
          SuriaHaze — a hackathon prototype for the Township of Tomorrow. Air quality: IQAir (US AQI) and the Department of Environment (DOE) official API via MyEQMS. Forecasts, haze and
          sunlight: Open-Meteo (Copernicus CAMS, JMA/JAXA Himawari). Solar figures are model estimates.
        </footer>
      </main>
    </>
  );
}
