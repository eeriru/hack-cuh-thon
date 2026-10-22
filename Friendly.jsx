import { useEffect, useId, useRef, useState } from 'react';
import { GLOSSARY } from '../lib/glossary.js';
import { tr } from '../lib/i18n.js';

/** Small ⓘ button that explains a term in plain words. Tap/click to open, tap outside or Esc to close. */
export function Tip({ term, text, label = 'What does this mean?' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const id = useId();
  const body = tr(text || GLOSSARY[term]);
  // Keep the bubble inside the screen, centred under the button where possible
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, b.left + b.width / 2 - width / 2));
    const below = b.bottom + 8;
    const top = below + 140 > window.innerHeight && b.top > 160 ? null : below;
    setPos({ left, width, top, bottom: top === null ? window.innerHeight - b.top + 8 : null });
  };
  useEffect(() => {
    if (!open) return undefined;
    place();
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    // Close on a real scroll only (small jumps happen when tapping, or when a phone's address bar moves)
    const y0 = window.scrollY;
    const hide = (e) => {
      if (e.type === 'resize' || Math.abs(window.scrollY - y0) > 60) setOpen(false);
      else place();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', hide);
      window.removeEventListener('resize', hide);
    };
  }, [open]);
  if (!body) return null;
  return (
    <span className="tipwrap" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="tipbtn"
        aria-label={tr(label)}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        i
      </button>
      {open && (
        <span
          className="tippop"
          id={id}
          role="note"
          style={pos ? { position: 'fixed', left: pos.left, width: pos.width, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', transform: 'none' } : undefined}
        >
          {body}
        </span>
      )}
    </span>
  );
}

/** "In short": the two or three things to know, in plain sentences. items: [{ icon, text, tone }] */
export function InShort({ items, title = 'In short' }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <section className="inshort section" aria-label={tr(title)}>
      <div className="inshort-title">{tr(title)}</div>
      <ul>
        {list.map((it, i) => (
          <li key={i} className={it.tone ? `tone-border-${it.tone}` : ''}>
            <span className="inshort-icon" aria-hidden="true">{it.icon}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A section that starts folded, for details most people don't need. */
export function More({ title, hint, children, defaultOpen = false }) {
  return (
    <details className="more card section" open={defaultOpen}>
      <summary>
        <span>
          <b>{tr(title)}</b>
          {hint && <small>{tr(hint)}</small>}
        </span>
        <span className="more-chev" aria-hidden="true">⌄</span>
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

// How SuriaHaze works, as four pictures instead of paragraphs.
const FLOW = [
  { icon: '🌫️', title: 'Haze & clouds', text: 'We read the air and sky' },
  { icon: '☀️', title: 'Less sunlight', text: 'AI works out what gets through' },
  { icon: '🏠', title: 'Your roof', text: 'kWh your panels make' },
  { icon: '📅', title: 'Your plan', text: 'Best time for chores, car & cleaning' },
];
export function HowFlow({ dark = false }) {
  return (
    <ol className={`flow ${dark ? 'dark' : ''}`} aria-label={tr('How SuriaHaze works')}>
      {FLOW.map((s, i) => (
        <li key={s.title}>
          <span className="flow-icon" aria-hidden="true">{s.icon}</span>
          <b>{tr(s.title)}</b>
          <small>{tr(s.text)}</small>
          {i < FLOW.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  );
}

const WELCOME_KEY = 'sh-welcome-dismissed';
/** One-time welcome card explaining what the app does, as a picture plus page shortcuts. */
export function Welcome({ go }) {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!show) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* fine: it will show again next visit */
    }
  };
  return (
    <section className="welcome section" aria-label={tr('Welcome')}>
      <button className="welcome-x" onClick={close} aria-label={tr('Close welcome message')}>×</button>
      <h2>{tr('Welcome to SuriaHaze')} 👋</h2>
      <HowFlow dark />
      <div className="welcome-go">
        <button className="welcome-tile" onClick={() => go('air')}>😷 {tr('Air quality')}</button>
        <button className="welcome-tile" onClick={() => go('forecast')}>🌦️ {tr('Weather & solar')}</button>
        <button className="welcome-tile" onClick={() => go('planner')}>🏠 {tr('Personal Planner')}</button>
      </div>
      <p className="small muted">
        📍 {tr('Pick your place above')} · <span className="tipbtn static" aria-hidden="true">i</span> = {tr('explain this')}
      </p>
      <button className="btn" onClick={close}>{tr('Got it')}</button>
    </section>
  );
}
