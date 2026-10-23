import { useEffect, useRef, useState } from 'react';
import HomeSettings from './HomeSettings.jsx';
import { tr } from '../lib/i18n.js';

// First visit to the Planner: ask for the home details once, so the plans fit this home.
// "Use defaults for now" keeps the example values. Both choices are remembered on this device.
export default function HomeSetup({ settings, setSettings, onDone }) {
  const [draft, setDraft] = useState(settings);
  const box = useRef(null);

  useEffect(() => {
    // Focus the popup itself, not a box, so a phone keyboard doesn't jump up straight away.
    box.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onDone();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAndClose = () => {
    setSettings(draft);
    onDone();
  };

  return (
    <div className="setup-backdrop">
      <div className="card setup-box" role="dialog" aria-modal="true" aria-labelledby="setup-title" tabIndex={-1} ref={box}>
        <div className="settings-head">
          <span className="welcome-badge" aria-hidden="true">🏠</span>
          <div>
            <h2 id="setup-title" style={{ margin: 0 }}>{tr('Tell us about your home')}</h2>
            <p className="sec-lead" style={{ margin: '2px 0 0' }}>{tr('The Planner uses these to work out your spare solar, battery and savings. Check your electricity bill for the rates.')}</p>
          </div>
        </div>
        <HomeSettings settings={draft} setSettings={setDraft} />
        <p className="small muted setup-later">{tr('You can change these any time under ⚙ Settings.')}</p>
        <div className="setup-actions">
          <button className="btn ghost" onClick={onDone}>{tr('Use defaults for now')}</button>
          <button className="btn setup-save" onClick={saveAndClose}>{tr('Save')}</button>
        </div>
      </div>
    </div>
  );
}
