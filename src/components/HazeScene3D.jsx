import { useEffect, useMemo, useRef, useState } from 'react';
import { aerosolTransmission } from '../lib/model.js';
import { hazeLevel } from '../lib/aqi.js';

// A small dependency-free 3D scene (canvas + perspective projection):
// a row of terrace homes with rooftop solar panels, the sun, sunlight rays and haze
// particles. The haze density follows the aerosol optical depth (AOD); the panels
// glow and the rays reach them in proportion to how much sunlight gets through.

const REF_AOD = 0.3;
const sunShare = (aod) =>
  Math.min(1, aerosolTransmission(Math.max(0, aod), 0.85, 0) / aerosolTransmission(REF_AOD, 0.85, 0));

// ---------- geometry ----------
const v = (x, y, z) => ({ x, y, z });
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixRgb = (c1, c2, t) => c1.map((c, i) => Math.round(mix(c, c2[i], t)));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function box(x0, y0, z0, x1, y1, z1, color, kind = 'solid') {
  const p = [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)];
  return [
    [p[4], p[5], p[6], p[7]], // front (+z)
    [p[1], p[0], p[3], p[2]], // back
    [p[0], p[4], p[7], p[3]], // left
    [p[5], p[1], p[2], p[6]], // right
    [p[3], p[7], p[6], p[2]], // top
  ].map((pts) => ({ pts, color, kind }));
}

function buildScene() {
  const faces = [];
  // ground and road
  faces.push({ pts: [v(-11, 0, -8), v(11, 0, -8), v(11, 0, 8), v(-11, 0, 8)], color: [196, 210, 168], kind: 'ground' });
  faces.push({ pts: [v(-11, 0.01, 3.4), v(11, 0.01, 3.4), v(11, 0.01, 5.6), v(-11, 0.01, 5.6)], color: [150, 150, 146], kind: 'ground' });
  // a row of four terrace homes (one block, roof pitched along x)
  const W = 2.5;
  const n = 4;
  const x0 = (-W * n) / 2;
  const d0 = -1.8;
  const d1 = 1.8;
  const h = 2.0;
  const ridge = 3.3;
  const walls = [[244, 236, 220], [236, 226, 206], [244, 236, 220], [236, 226, 206]];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * W;
    const b = a + W;
    faces.push(...box(a, 0, d0, b, h, d1, walls[i]).filter((f, k) => k !== 4));
    // door and window on the front wall
    faces.push({ pts: [v(a + 0.35, 0.02, d1 + 0.01), v(a + 0.95, 0.02, d1 + 0.01), v(a + 0.95, 1.25, d1 + 0.01), v(a + 0.35, 1.25, d1 + 0.01)], color: [120, 86, 60], kind: 'solid' });
    faces.push({ pts: [v(a + 1.3, 0.7, d1 + 0.01), v(a + 2.15, 0.7, d1 + 0.01), v(a + 2.15, 1.5, d1 + 0.01), v(a + 1.3, 1.5, d1 + 0.01)], color: [150, 190, 215], kind: 'solid' });
    // roof slopes
    faces.push({ pts: [v(a, h, d1 + 0.3), v(b, h, d1 + 0.3), v(b, ridge, 0), v(a, ridge, 0)], color: [180, 92, 64], kind: 'solid' });
    faces.push({ pts: [v(b, h, d0 - 0.3), v(a, h, d0 - 0.3), v(a, ridge, 0), v(b, ridge, 0)], color: [168, 84, 58], kind: 'solid' });
    // gable ends only on the outer houses
    if (i === 0) faces.push({ pts: [v(a, h, d1), v(a, ridge, 0), v(a, h, d0)], color: walls[i], kind: 'solid' });
    if (i === n - 1) faces.push({ pts: [v(b, h, d0), v(b, ridge, 0), v(b, h, d1)], color: walls[i], kind: 'solid' });
    // solar panels on the sunny (front) slope, lifted slightly off the roof
    for (let k = 0; k < 2; k++) {
      const pa = a + 0.2 + k * 1.08;
      const pb = pa + 0.98;
      const t0 = 0.18;
      const t1 = 0.82;
      const at = (t) => ({ y: mix(h, ridge, t) + 0.04, z: mix(d1 + 0.3, 0, t) + 0.03 });
      const s = at(t0);
      const e = at(t1);
      faces.push({ pts: [v(pa, s.y, s.z), v(pb, s.y, s.z), v(pb, e.y, e.z), v(pa, e.y, e.z)], color: [28, 48, 92], kind: 'panel' });
    }
  }
  // Township entrance signboard by the road: hedge planter, two posts and a board.
  // The board's front face (kind 'signface') gets its lettering drawn in the render loop.
  // Placed on the lawn beside the homes (not at the front edge) so it stays in frame.
  faces.push(...box(-9.9, 0, 2.45, -5.2, 0.32, 3.1, [96, 138, 78]));
  faces.push(...box(-9.35, 0.3, 2.66, -9.1, 1.1, 2.78, [70, 72, 78]));
  faces.push(...box(-6.0, 0.3, 2.66, -5.75, 1.1, 2.78, [70, 72, 78]));
  const board = box(-9.7, 1.05, 2.58, -5.4, 2.6, 2.82, [30, 52, 44]);
  board[0].kind = 'signface';
  faces.push(...board);
  // trees: trunk + pyramid canopy
  for (const [tx, tz] of [[-8.2, 1], [7.8, -1.5], [-6.5, -5], [5.5, 6.8], [-3, 6.9]]) {
    faces.push(...box(tx - 0.15, 0, tz - 0.15, tx + 0.15, 0.9, tz + 0.15, [110, 80, 55]));
    const top = v(tx, 3.1, tz);
    const r = 1.05;
    const base = [v(tx - r, 0.8, tz - r), v(tx + r, 0.8, tz - r), v(tx + r, 0.8, tz + r), v(tx - r, 0.8, tz + r)];
    for (let k = 0; k < 4; k++) faces.push({ pts: [base[(k + 1) % 4], base[k], top], color: [76, 140, 72], kind: 'solid' });
  }
  return faces;
}

const SUN = v(-6.5, 10.5, 7);
const SUN_DIR = norm(SUN);

function makeParticles(count, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => ({ x: mix(-11, 11, rnd()), y: mix(0.3, 9, rnd() ** 1.3), z: mix(-8, 8, rnd()), r: mix(0.6, 1.8, rnd()), p: rnd() * 6.28 }));
}

// Air-quality mode: when an IQAir US AQI and/or DOE API is given instead of an AOD, the
// haze you see is driven by that reading (visual only; no sunlight figure is claimed).
const hazeFromIndex = (idx) => Math.min(1, Math.max(0, (idx - 30) / 220));

// Lettering for the signboard, mapped onto the board's projected front face.
// Only drawn when the face points towards the viewer (otherwise it would appear mirrored).
const BW = 480;
const BH = 156;
function drawSignText(ctx, pr, dpr, lines, haze) {
  const o = pr[3]; // top-left
  const ux = pr[2].x - o.x, uy = pr[2].y - o.y; // across the board
  const vx = pr[0].x - o.x, vy = pr[0].y - o.y; // down the board
  if (ux * vy - uy * vx <= 0) return;
  ctx.save();
  ctx.setTransform((dpr * ux) / BW, (dpr * uy) / BW, (dpr * vx) / BH, (dpr * vy) / BH, dpr * o.x, dpr * o.y);
  ctx.globalAlpha = 1 - 0.3 * haze;
  ctx.strokeStyle = 'rgba(214,182,110,0.9)';
  ctx.lineWidth = 5;
  ctx.strokeRect(12, 12, BW - 24, BH - 24);
  ctx.fillStyle = '#e9d9a8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 25px "Figtree", system-ui, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  ctx.fillText(lines[0], BW / 2, 50);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#ffffff';
  let size = 50;
  ctx.font = `800 ${size}px "Bricolage Grotesque", "Figtree", system-ui, sans-serif`;
  while (ctx.measureText(lines[1]).width > BW - 60 && size > 24) {
    size -= 2;
    ctx.font = `800 ${size}px "Bricolage Grotesque", "Figtree", system-ui, sans-serif`;
  }
  ctx.fillText(lines[1], BW / 2, 104);
  ctx.restore();
}

export default function HazeScene3D({
  aod: aodIn = 0.3,
  aqi = null,
  doeApi = null,
  label,
  signTitle = null,
  interactive = true,
  height = 340,
}) {
  const airMode = aqi !== null || doeApi !== null;
  const aodToday = airMode ? 0.2 + 1.8 * hazeFromIndex(aqi ?? doeApi) : aodIn;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const signRef = useRef(null);
  signRef.current = ['SIME DARBY PROPERTY', signTitle || 'Township of Tomorrow'];
  const [aod, setAod] = useState(aodToday);
  const view = useRef({ yaw: -0.45, pitch: 0.42, dragging: false, lastX: 0, lastY: 0, userMoved: false });
  const faces = useMemo(buildScene, []);
  const particles = useMemo(() => makeParticles(900), []);

  useEffect(() => setAod(aodToday), [aodToday]);

  const share = sunShare(aod);
  const haze = Math.min(1, Math.max(0, (aod - 0.2) / 1.8));
  const level = hazeLevel(aod);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let running = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();

    const draw = (now) => {
      const t = (now - start) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vw = view.current;
      const yaw = vw.yaw + (reduce || vw.userMoved ? 0 : 0.28 * Math.sin(t * 0.25));
      const pitch = vw.pitch;
      const dist = 21;
      const f = Math.min(w, h * 1.6) * (w < 520 ? 0.82 : 1.05); // zoom out a little on phones so the signboard fits
      const cx = w / 2;
      const cy = h * 0.58;
      const cy0 = Math.cos(yaw), sy0 = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const proj = (p) => {
        const x = p.x, y = p.y - 1.4, z = p.z;
        const x1 = x * cy0 - z * sy0;
        const z1 = x * sy0 + z * cy0;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const depth = dist - z2;
        return { x: cx + (f * x1) / depth, y: cy - (f * y2) / depth, d: depth };
      };

      // sky
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgb(mixRgb([120, 182, 232], [181, 166, 138], haze)));
      g.addColorStop(1, rgb(mixRgb([222, 240, 251], [232, 220, 196], haze)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // sun with glow, dimmed by haze
      const sp2 = proj(SUN);
      const glow = ctx.createRadialGradient(sp2.x, sp2.y, 2, sp2.x, sp2.y, 90);
      glow.addColorStop(0, `rgba(255,236,170,${0.75 * share})`);
      glow.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sp2.x, sp2.y, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(mixRgb([255, 196, 60], [230, 170, 110], haze), mix(1, 0.7, haze));
      ctx.beginPath();
      ctx.arc(sp2.x, sp2.y, 17, 0, Math.PI * 2);
      ctx.fill();

      // faces, painter's algorithm
      const drawn = faces
        .map((fc) => {
          const pr = fc.pts.map(proj);
          const n = norm(cross(sub(fc.pts[1], fc.pts[0]), sub(fc.pts[2], fc.pts[0])));
          return { fc, pr, n, d: pr.reduce((s, q) => s + q.d, 0) / pr.length };
        })
        .sort((a, b) => b.d - a.d);
      const panelCenters = [];
      for (const { fc, pr, n } of drawn) {
        const lambert = Math.max(0, dot(n, SUN_DIR));
        const light = 0.55 + 0.45 * lambert * mix(1, share, 0.8);
        let col = fc.color.map((c) => Math.min(255, c * light));
        if (fc.kind === 'panel') {
          col = mixRgb([22, 34, 64], [96, 168, 238], share * share);
          const c = fc.pts.reduce((s, q) => v(s.x + q.x / 4, s.y + q.y / 4, s.z + q.z / 4), v(0, 0, 0));
          panelCenters.push(c);
        }
        col = mixRgb(col, [200, 186, 160], haze * 0.25); // haze washes colours out
        ctx.fillStyle = rgb(col);
        ctx.beginPath();
        pr.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fill();
        if (fc.kind === 'signface') drawSignText(ctx, pr, dpr, signRef.current, haze);
        if (fc.kind === 'panel') {
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * share})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (fc.kind !== 'ground') {
          ctx.strokeStyle = 'rgba(40,30,20,0.12)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      // sunlight rays: the part that gets through reaches the panels
      ctx.lineCap = 'round';
      panelCenters.forEach((c, i) => {
        if (i % 2) return;
        const a = proj(SUN);
        const b = proj(c);
        const reach = 0.25 + 0.75 * share; // haze stops rays part-way
        const ex = mix(a.x, b.x, reach);
        const ey = mix(a.y, b.y, reach);
        ctx.strokeStyle = `rgba(255,214,90,${0.25 + 0.55 * share})`;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = reduce ? 0 : -t * 40;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (reach < 0.98) {
          // scattered light: a little puff where the ray dies
          ctx.setLineDash([]);
          ctx.fillStyle = `rgba(255,214,90,${0.25 * (1 - share)})`;
          ctx.beginPath();
          ctx.arc(ex, ey, 7, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.setLineDash([]);

      // haze particles, drifting with the wind
      const count = Math.round(40 + 860 * haze);
      const pts = [];
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        let x = p.x + (reduce ? 0 : t * 0.35);
        x = ((((x + 11) % 22) + 22) % 22) - 11;
        const q = proj(v(x, p.y + 0.15 * Math.sin(t * 0.6 + p.p), p.z));
        if (q.d > 1) pts.push({ q, r: p.r });
      }
      pts.sort((a, b) => b.q.d - a.q.d);
      for (const { q, r } of pts) {
        const size = (r * f) / q.d / 9;
        ctx.fillStyle = `rgba(150,128,96,${0.1 + 0.22 * haze})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(0.8, size), 0, Math.PI * 2);
        ctx.fill();
      }
      // overall veil
      ctx.fillStyle = `rgba(205,188,155,${0.28 * haze})`;
      ctx.fillRect(0, 0, w, h);

      if (running && !reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const redraw = () => !raf && (raf = requestAnimationFrame(draw));
    view.current.redraw = () => {
      if (reduce) requestAnimationFrame(draw);
    };
    window.addEventListener('resize', redraw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', redraw);
    };
  }, [faces, particles, share, haze]);

  const onDown = (e) => {
    const vw = view.current;
    vw.dragging = true;
    vw.userMoved = true;
    vw.lastX = e.clientX;
    vw.lastY = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const vw = view.current;
    if (!vw.dragging) return;
    vw.yaw += (e.clientX - vw.lastX) * 0.008;
    vw.pitch = Math.min(1.1, Math.max(0.12, vw.pitch + (e.clientY - vw.lastY) * 0.005));
    vw.lastX = e.clientX;
    vw.lastY = e.clientY;
    vw.redraw?.();
  };
  const onUp = () => (view.current.dragging = false);

  return (
    <div className="scene3d" ref={wrapRef}>
      <div className="scene3d-stage" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="scene3d-canvas"
          role="img"
          aria-label={
            airMode
              ? `3D view of terrace homes and a Sime Darby Property signboard, with haze matching the current air quality reading`
              : `3D view of terrace homes with solar panels in ${level.label.toLowerCase()}; panels receive about ${Math.round(share * 100)}% of normal sunlight`
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <div className="scene3d-badge">3D · drag to rotate</div>
        {airMode ? (
          <div className="scene3d-readout">
            <div className="k">{label || 'Air right now'}</div>
            {aqi !== null && (
              <div className="v">
                {Math.round(aqi)}
                <small> US AQI · IQAir</small>
              </div>
            )}
            {doeApi !== null && (
              <div className={aqi !== null ? 'k' : 'v'}>
                {doeApi}
                <small> API · DOE</small>
              </div>
            )}
            <div className="k">Haze shown to match the reading</div>
          </div>
        ) : (
          <div className="scene3d-readout">
            <div className="k">{label || 'Haze over your roof'}</div>
            <div className="v">
              {Math.round(share * 100)}%<small> of normal sunlight reaches the panels</small>
            </div>
            <div className="k">
              {level.label} · AOD {aod.toFixed(2)}
            </div>
          </div>
        )}
      </div>
      {interactive && (
        <div className="scene3d-controls">
          <label htmlFor="haze-slider">Try a haze level</label>
          <div className="scene3d-slider">
            <span className="small muted">Clear</span>
            <input
              id="haze-slider"
              type="range"
              min="0.1"
              max="3"
              step="0.05"
              value={aod}
              onChange={(e) => setAod(parseFloat(e.target.value))}
            />
            <span className="small muted">Severe</span>
            <button className="chip" onClick={() => setAod(aodToday)} disabled={Math.abs(aod - aodToday) < 0.01}>
              Reset to today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
