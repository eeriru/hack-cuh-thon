import { useEffect, useState } from 'react';
import AirQualityPage from './components/AirQualityPage.jsx';
import ForecastPage from './components/ForecastPage.jsx';
import PlannerPage from './components/PlannerPage.jsx';
import MethodPage from './components/MethodPage.jsx';
import { LocationBar } from './components/common.jsx';
import { Welcome } from './components/Friendly.jsx';
import { loadEngine } from './lib/model.js';
import { DEFAULT_HOME } from './lib/battery.js';
import { DEFAULT_PLACE } from './lib/places.js';
import { DEFAULT_EV } from './lib/ev.js';
import { tr, getLang, setLang } from './lib/i18n.js';

const TABS = [
  { id: 'air', label: 'Air quality' },
  { id: 'forecast', label: 'Weather & solar' },
  { id: 'planner', label: 'Planner' },
  { id: 'method', label: 'How it works' },
];

const DEFAULT_SETTINGS = { kwp: 5, batteryKwh: DEFAULT_HOME.battery.capacityKwh, dailyKwh: DEFAULT_HOME.dailyKwh, home: DEFAULT_HOME, ev: DEFAULT_EV };

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

// Weather and solar used to be two pages; old links and bookmarks open the combined page.
const OLD_TABS = { weather: 'forecast', solar: 'forecast', rankings: 'air' };

const tabFromHash = () => {
  const raw = window.location.hash.replace('#/', '');
  const id = OLD_TABS[raw] || raw;
  return TABS.some((t) => t.id === id) ? id : 'air';
};

export default function App() {
  const [tab, setTab] = useState(tabFromHash);
  const [place, setPlace] = useState(() => load('sh-place', DEFAULT_PLACE));
  const [settings, setSettings] = useState(() => {
    const s = load('sh-settings', DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...s, home: { ...DEFAULT_HOME, ...s.home, tariff: { ...DEFAULT_HOME.tariff, ...s.home?.tariff }, battery: { ...DEFAULT_HOME.battery, ...s.home?.battery } }, ev: { ...DEFAULT_EV, ...s.ev } };
  });
  const [engine, setEngine] = useState(null);
  const [lang, setLangState] = useState(getLang);
  const switchLang = (l) => {
    setLang(l);
    setLangState(l);
  };
  useEffect(() => setLang(lang), []); // eslint-disable-line react-hooks/exhaustive-deps

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
              <small className="brand-tag">{tr('Solar & weather assistant')}</small>
            </span>
          </a>
          <nav className="nav" aria-label="Main">
            {TABS.map((t) => (
              <a key={t.id} href={`#/${t.id}`} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {tr(t.label)}
              </a>
            ))}
          </nav>
          <div className="lang-switch" role="group" aria-label={tr('Language')}>
            <button className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => switchLang('en')}>EN</button>
            <button className={lang === 'ms' ? 'active' : ''} aria-pressed={lang === 'ms'} onClick={() => switchLang('ms')}>BM</button>
          </div>
        </div>
      </header>
      <main className="shell">
        {(tab === 'air' || tab === 'forecast' || tab === 'planner') && <LocationBar place={place} onChange={setPlace} />}
        {(tab === 'air' || tab === 'forecast') && <Welcome go={go} />}
        {tab === 'air' && <AirQualityPage place={place} engine={engine} go={go} />}
        {tab === 'forecast' && <ForecastPage place={place} engine={engine} settings={settings} go={go} />}
        {tab === 'planner' && <PlannerPage place={place} engine={engine} settings={settings} setSettings={setSettings} />}
        {tab === 'method' && <MethodPage engine={engine} />}
        <footer className="footer">
          {tr(
            'SuriaHaze — a hackathon prototype for the Township of Tomorrow. Air quality: IQAir (US AQI) and the Department of Environment (DOE) official API via MyEQMS. Weather, haze and sunlight: Open-Meteo (weather models, Copernicus CAMS, JMA/JAXA Himawari). Fire hotspots: NASA FIRMS. Solar figures are model estimates.'
          )}
        </footer>
      </main>
    </>
  );
}
