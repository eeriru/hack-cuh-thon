// A soft ripple where you tap or click a button, card or chip. One listener for the
// whole app; it skips everything when the visitor prefers reduced motion.
const TARGETS = '.btn, .welcome-tile, .chip, .sp-day, .day-pill, .plan-scene, .side-nav a, .lang-switch button, .mode-btns button, .aq-bar, .mini-chip.solar, .linkish, .search-results button, .more summary';

export function installRipple() {
  if (typeof window === 'undefined' || window.__ripple) return;
  window.__ripple = true;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  document.addEventListener('pointerdown', (e) => {
    if (calm?.matches || e.button > 0) return;
    const el = e.target.closest?.(TARGETS);
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.left = `${e.clientX - r.left - size / 2}px`;
    dot.style.top = `${e.clientY - r.top - size / 2}px`;
    el.classList.add('has-ripple');
    el.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
    setTimeout(() => dot.remove(), 900); // in case the animation never runs
  });
}
