import HomeSettings, { homeSummary } from './HomeSettings.jsx';
import { tr } from '../lib/i18n.js';

// Settings: the home details every solar figure and plan uses. Saved on this device.
export default function SettingsPage({ settings, setSettings, go }) {
  return (
    <>
      <h1 className="sr-only">{tr('Settings')}</h1>
      <section className="card section">
        <div className="settings-head">
          <span className="welcome-badge" aria-hidden="true">🏠</span>
          <div>
            <h2 style={{ margin: 0 }}>{tr('Your home')}</h2>
            <p className="sec-lead" style={{ margin: '2px 0 0' }}>{tr('Used for every solar figure and plan in the app. Saved on this device only.')}</p>
          </div>
        </div>
        <p className="small muted settings-now">{homeSummary(settings)}</p>
        <HomeSettings settings={settings} setSettings={setSettings} />
      </section>
      <section className="card section settings-note">
        <span aria-hidden="true">🚗</span>
        <p className="small" style={{ margin: 0 }}>
          {tr('Your car details are on the EV charging card in the Planner.')}{' '}
          <button className="linkish" onClick={() => go('planner')}>{tr('Open the Planner')}</button>
        </p>
      </section>
    </>
  );
}
