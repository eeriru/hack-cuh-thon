import { useEffect, useState } from 'react';
import AirQualityPage from './components/AirQualityPage.jsx';
import ForecastPage from './components/ForecastPage.jsx';
import PlannerPage from './components/PlannerPage.jsx';
import MethodPage from './components/MethodPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import HomeSetup from './components/HomeSetup.jsx';
import { LocationBar } from './components/common.jsx';
import { Welcome } from './components/Friendly.jsx';
import { SkyBackground } from './components/Dashboard.jsx';
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
  { id: 'settings', label: 'Settings', foot: true },
];

// New users start on the flat tariff: TNB's time-of-use tariff is optional.
const DEFAULT_SETTINGS = { kwp: 5, batteryKwh: DEFAULT_HOME.battery.capacityKwh, dailyKwh: DEFAULT_HOME.dailyKwh, home: { ...DEFAULT_HOME, tariff: { ...DEFAULT_HOME.tariff, mode: 'flat' } }, ev: DEFAULT_EV };

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
    return { ...DEFAULT_SETTINGS, ...s, home: { ...DEFAULT_HOME, ...s.home, tariff: { ...DEFAULT_SETTINGS.home.tariff, ...s.home?.tariff }, battery: { ...DEFAULT_HOME.battery, ...s.home?.battery } }, ev: { ...DEFAULT_EV, ...s.ev } };
  });
  const [engine, setEngine] = useState(null);
  const [homeSetupDone, setHomeSetupDone] = useState(() => load('sh-home-setup', false));
  const finishHomeSetup = () => {
    save('sh-home-setup', true);
    setHomeSetupDone(true);
  };
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

  const hour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 19 ? 'Good afternoon' : 'Good evening';
  const langSwitch = (
    <div className="lang-switch" role="group" aria-label={tr('Language')}>
      <button className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => switchLang('en')}>EN</button>
      <button className={lang === 'ms' ? 'active' : ''} aria-pressed={lang === 'ms'} onClick={() => switchLang('ms')}>BM</button>
    </div>
  );

  // Settings sits at the bottom of the sidebar on a computer, and in the bottom bar on a phone.
  const navLink = (t, extra = '') => (
    <a key={t.id} href={`#/${t.id}`} className={`${tab === t.id ? 'active' : ''} ${extra}`.trim() || undefined} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
      <NavIcon id={t.id} />
      <span className="side-label">{tr(t.label)}</span>
    </a>
  );

  return (
    <>
      <SkyBackground />
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <a className="side-brand" href="#/air" onClick={() => go('air')} aria-label="SuriaMF">
            <BrandMark />
            <span>
              Suria<b>MF</b>
            </span>
          </a>
          <div className="side-nav">
            {TABS.map((t) => navLink(t, t.foot ? 'only-phone' : ''))}
          </div>
          <div className="side-foot">
            <div className="side-nav">{TABS.filter((t) => t.foot).map((t) => navLink(t))}</div>
            {langSwitch}
          </div>
        </nav>

        <main className="shell">
          <header className="page-head">
            <div className="hello">
              <span className="hello-mark">
                <BrandMark />
              </span>
              <div>
                <span className="hello-hi">{tr(greeting)} 👋</span>
                <h2 className="hello-name">{tab === 'method' ? 'SuriaMF' : tab === 'settings' ? tr('Settings') : place.name}</h2>
              </div>
              <div className="head-lang">{langSwitch}</div>
            </div>
            {tab !== 'method' && tab !== 'settings' && (
              <div className="head-search">
                <LocationBar place={place} onChange={setPlace} />
              </div>
            )}
          </header>
          {(tab === 'air' || tab === 'forecast') && <Welcome go={go} />}
          {tab === 'air' && <AirQualityPage place={place} />}
          {tab === 'forecast' && <ForecastPage place={place} engine={engine} settings={settings} go={go} />}
          {tab === 'planner' && <PlannerPage place={place} engine={engine} settings={settings} setSettings={setSettings} go={go} />}
          {tab === 'method' && <MethodPage engine={engine} />}
          {tab === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} go={go} />}
          {tab === 'planner' && !homeSetupDone && <HomeSetup settings={settings} setSettings={setSettings} onDone={finishHomeSetup} />}
          <footer className="footer">
            {tr(
              'SuriaMF — a hackathon prototype for the Township of Tomorrow. Air quality: IQAir (US AQI) and the Department of Environment (DOE) official API via MyEQMS. Weather, haze and sunlight: Open-Meteo (weather models, Copernicus CAMS, JMA/JAXA Himawari). Fire hotspots: NASA FIRMS. Solar figures are model estimates.'
            )}
          </footer>
        </main>
      </div>
    </>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#1d2433" />
      <circle cx="32" cy="30" r="12" fill="#f5a524" />
      <path d="M12 44h40M16 51h32" stroke="#c9b9a0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// Simple line icons for the sidebar.
function NavIcon({ id }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg className="nav-ic" viewBox="0 0 24 24" aria-hidden="true">
      {id === 'air' && (
        <g {...p}>
          <path d="M3 8h11a3 3 0 1 0-3-3" />
          <path d="M3 12h16a3 3 0 1 1-3 3" />
          <path d="M3 16h7" />
        </g>
      )}
      {id === 'forecast' && (
        <g {...p}>
          <circle cx="9" cy="9" r="3.2" />
          <path d="M9 2.5v1.3M3.8 4.6l.9.9M2.5 9h1.3M14.2 4.6l-.9.9" />
          <path d="M8 20h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.6A2.8 2.8 0 0 0 8 20z" />
        </g>
      )}
      {id === 'planner' && (
        <g {...p}>
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M8 17h6" />
        </g>
      )}
      {id === 'settings' && (
        <g {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </g>
      )}
      {id === 'method' && (
        <g {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v.5" />
        </g>
      )}
    </svg>
  );
}
