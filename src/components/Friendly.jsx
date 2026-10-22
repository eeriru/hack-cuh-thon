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

const WELCOME_KEY = 'sh-welcome-dismissed';
/** One-time welcome card explaining what the app does, in three steps. */
// The four pages, as tiles on the welcome card.
const WELCOME_PAGES = [
  { id: 'air', icon: '😷', label: 'Air quality', text: 'Safe to go out? IQAir and DOE readings, and where the haze comes from.', tone: 'wt-blue' },
  { id: 'forecast', icon: '🌤️', label: 'Weather & solar', text: "Today's weather, the week ahead and how much power your panels will make.", tone: 'wt-sun' },
  { id: 'planner', icon: '📅', label: 'Planner', text: 'Spare solar, ideas for the day, battery & chores and EV charging.', tone: 'wt-lime' },
  { id: 'method', icon: 'ⓘ', label: 'How it works', text: 'How the solar model and every number are worked out.', tone: 'wt-plain' },
];

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
      <div className="welcome-head">
        <span className="welcome-badge" aria-hidden="true">☀️</span>
        <div>
          <h2>{tr('Welcome to SuriaMF')} 👋</h2>
          <p>{tr("Your township's air, weather and solar power in one place. Pick your place at the top, then start here:")}</p>
        </div>
      </div>
      <div className="welcome-grid">
        {WELCOME_PAGES.map((pg) => (
          <button key={pg.id} className={`welcome-tile ${pg.tone}`} onClick={() => go(pg.id)}>
            <span className="wt-ic" aria-hidden="true">{pg.icon}</span>
            <b>{tr(pg.label)}</b>
            <small>{tr(pg.text)}</small>
          </button>
        ))}
      </div>
      <div className="welcome-foot">
        <span className="small muted">
          {tr('Tap any')} <span className="tipbtn static" aria-hidden="true">i</span> {tr('for a plain-language explanation.')}
        </span>
        <button className="btn" onClick={close}>{tr('Got it')}</button>
      </div>
    </section>
  );
}

// A rounded, tinted tile: icon, one big value, a short label and an optional ⓘ in the corner.
// tone: sun | sky | loss | haze | good | plain (colours from the app's own palette).
export function Tile({ icon, value, unit, label, sub, subTone, tone = 'plain', tip, term, wide = false, valueSmall = false }) {
  return (
    <div className={`tile tone-${tone} ${wide ? 'wide' : ''}`}>
      {(tip || term) && (
        <span className="tile-tip">
          <Tip text={tip} term={term} />
        </span>
      )}
      {icon && (
        <span className="tile-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className={`tile-v ${valueSmall ? 'sm' : ''}`}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="tile-k">{label}</div>
      {sub && <div className={`tile-s ${subTone ? `tone-${subTone}` : ''}`}>{sub}</div>}
    </div>
  );
}
