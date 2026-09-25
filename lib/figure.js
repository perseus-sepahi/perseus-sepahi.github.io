'use strict';
// Fig. 1: Kelvin–Helmholtz billows, drawn from a snapshot written by scripts/simulate-kh.js.
//
// Isentropes (contours of potential temperature θ) are traced with marching squares, joined into
// polylines, smoothed and simplified. The domain is periodic in x, so one period is computed and
// drawn twice, side by side. Tracer dots ride instantaneous streamlines (contours of ψ): closed loops
// around billow cores and open lines above and below the layer. Their keyframes map elapsed time
// to arc length using the local speed |∇ψ|, so relative speeds are those of the simulated flow.

const fs = require('fs');

const DEFAULTS = {
  scale: 44,         // drawing units per shear-layer half-thickness
  halfHeight: 5,     // band shows |y| ≤ halfHeight
  spacing: 0.34,     // isentrope spacing, in units of the background θ gradient
  timeScale: 0.34,   // animation seconds per unit of flow time
  coreTracers: 3,    // tracer loops in the billows nearest the middle of the drawing
  openLines: [3.3, -3.5],
  minLength: 90,     // drop contour fragments shorter than this (drawing units)
};

function loadSnapshots(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const decode = f => {
    const bytes = Buffer.from(f.data, 'base64');
    const q = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    const out = new Float64Array(q.length);
    const k = (f.max - f.min) / 65535;
    for (let i = 0; i < q.length; i++) out[i] = f.min + q[i] * k;
    return out;
  };
  return {
    ...raw,
    snapshots: raw.snapshots.map(s => ({ t: s.t, theta: decode(s.theta), psi: decode(s.psi) })),
  };
}

// ---------- marching squares ----------

/**
 * Contours of `field` (nx columns, rows rows, periodic in x) at `level`.
 * Returns polylines in grid coordinates: x ∈ [0, nx], y ∈ [0, rows − 1].
 * Lines are left open where they cross the periodic boundary, so tiles join exactly.
 */
function contour(field, nx, rows, level) {
  const at = (i, r) => field[r * nx + (i === nx ? 0 : i)];
  const W = nx + 1;
  const hKey = (i, r) => (r * W + i) * 2;
  const vKey = (i, r) => (r * W + i) * 2 + 1;
  const segs = [];
  const lerp = (p, q) => (level - p) / (q - p);

  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, r), b = at(i + 1, r), c = at(i + 1, r + 1), d = at(i, r + 1);
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const E = {
        bottom: () => [hKey(i, r), i + lerp(a, b), r],
        right: () => [vKey(i + 1, r), i + 1, r + lerp(b, c)],
        top: () => [hKey(i, r + 1), i + lerp(d, c), r + 1],
        left: () => [vKey(i, r), i, r + lerp(a, d)],
      };
      const add = (e1, e2) => { const p = E[e1](), q = E[e2](); segs.push({ ka: p[0], pa: [p[1], p[2]], kb: q[0], pb: [q[1], q[2]] }); };
      const centre = (a + b + c + d) / 4 > level;
      switch (idx) {
        case 1: case 14: add('left', 'bottom'); break;
        case 2: case 13: add('bottom', 'right'); break;
        case 3: case 12: add('left', 'right'); break;
        case 4: case 11: add('right', 'top'); break;
        case 6: case 9: add('bottom', 'top'); break;
        case 7: case 8: add('left', 'top'); break;
        case 5: if (centre) { add('bottom', 'right'); add('top', 'left'); } else { add('left', 'bottom'); add('right', 'top'); } break;
        case 10: if (centre) { add('left', 'bottom'); add('right', 'top'); } else { add('bottom', 'right'); add('top', 'left'); } break;
      }
    }
  }
  return join(segs);
}

function join(segs) {
  const byKey = new Map();
  segs.forEach((s, n) => {
    for (const k of [s.ka, s.kb]) { const list = byKey.get(k); if (list) list.push(n); else byKey.set(k, [n]); }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  const walk = (key, sink) => {
    for (;;) {
      const next = (byKey.get(key) || []).find(n => !used[n]);
      if (next === undefined) return key;
      used[next] = 1;
      const s = segs[next];
      if (s.ka === key) { sink(s.pb); key = s.kb; } else { sink(s.pa); key = s.ka; }
    }
  };
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const s = segs[n];
    const fwd = [s.pa, s.pb];
    const end = walk(s.kb, p => fwd.push(p));
    if (end === s.ka) { fwd.pop(); lines.push({ pts: fwd, closed: true }); continue; }
    const back = [];
    walk(s.ka, p => back.push(p));
    lines.push({ pts: back.reverse().concat(fwd), closed: false });
  }
  return lines;
}

// ---------- geometry ----------

function chaikin(pts, closed, passes) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let worst = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const dist = len > 1e-9
        ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len
        : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (dist > dmax) { dmax = dist; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Compact path data: absolute points rounded to 0.1 first, then written as exact relative steps. */
function pathData(pts, closed) {
  const r = pts.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
  let d = `M${fmt(r[0][0])} ${fmt(r[0][1])}l`;
  const parts = [];
  for (let i = 1; i < r.length; i++) {
    const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1];
    if (dx === 0 && dy === 0) continue;
    parts.push(`${fmt(dx)}${dy < 0 ? '' : ' '}${fmt(dy)}`);
  }
  if (!parts.length) return null;                       // collapsed to a point after rounding
  d += parts.join(' ').replace(/ -/g, '-');
  return closed ? d + 'z' : d;
}
const fmt = v => {
  const s = (v / 10).toFixed(1).replace(/\.0$/, '');
  return s.replace(/^(-?)0\./, '$1.');
};

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- billow cores ----------

/** Local minima of ψ near the layer: the cores of the clockwise-rotating billows, sorted by x. */
function findCores(psi, grid) {
  const { nx, dx, dy, y0 } = grid;
  const at = (i, r) => psi[r * nx + (((i % nx) + nx) % nx)];
  const cores = [];
  const R = Math.round(4 / dx);
  const mid = Math.round(-y0 / dy);
  const band = Math.round(2 / dy);
  for (let i = 0; i < nx; i++) {
    for (let r = mid - band; r <= mid + band; r++) {
      const c = at(i, r);
      let isMin = true;
      for (let di = -R; di <= R && isMin; di += 2) for (let dr = -8; dr <= 8; dr += 2) if (at(i + di, r + dr) < c) { isMin = false; break; }
      if (isMin && !cores.some(k => Math.abs(k.i - i) < R || Math.abs(k.i - i) > nx - R)) cores.push({ i, r, psi: c });
    }
  }
  return cores.sort((a, b) => a.i - b.i);
}

/** Periodic shift of a (rows × nx) field so that column i moves to column i + shift. */
function roll(field, nx, shift) {
  const out = new Float64Array(field.length);
  const rows = field.length / nx;
  for (let r = 0; r < rows; r++) for (let i = 0; i < nx; i++) out[r * nx + ((i + shift) % nx)] = field[r * nx + i];
  return out;
}

// ---------- figure ----------

function renderFigure(sim, rawSnapshot, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const id = o.id || 'kh';
  const { nx, rows, dx, dy, y0 } = sim.grid;

  // The drawing is centred on the join between its two periods, which is also where narrow screens
  // crop to. Shift the periodic fields so the strongest billow core sits exactly there.
  const strongest = findCores(rawSnapshot.psi, sim.grid).sort((a, b) => a.psi - b.psi)[0];
  const shift = strongest ? (nx - strongest.i) % nx : 0;
  const snapshot = { t: rawSnapshot.t, theta: roll(rawSnapshot.theta, nx, shift), psi: roll(rawSnapshot.psi, nx, shift) };
  const S = o.scale;
  const period = nx * dx * S;
  const W = 2 * period, H = 2 * o.halfHeight * S;
  const X = gx => gx * dx * S;                            // grid x → drawing x
  const Y = gy => H / 2 - (y0 + gy * dy) * S;             // grid row → drawing y (up is up)

  // Isentropes: θ = y + θ′, so a level's undisturbed height is the level itself.
  const levels = [];
  const top = o.halfHeight + 0.2;
  for (let k = Math.ceil(-top / o.spacing); k * o.spacing <= top; k++) levels.push(k * o.spacing);

  const isoPaths = [];
  let bytes = 0;
  levels.forEach(level => {
    const inner = 1 - Math.abs(level) / top;         // 1 at the shear layer, 0 at the band edges
    for (const line of contour(snapshot.theta, nx, rows, level)) {
      if (line.pts.length < 4) continue;
      if (!line.closed && line.pts[0][0] > line.pts[line.pts.length - 1][0]) line.pts.reverse();
      const pts = simplify(chaikin(line.pts.map(([gx, gy]) => [X(gx), Y(gy)]), line.closed, 2), 0.22);
      let length = 0;
      for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (length < o.minLength) continue;
      const d = pathData(pts, line.closed);
      if (!d) continue;
      bytes += d.length;
      isoPaths.push(`<path class="iso" pathLength="1" style="--inner:${inner.toFixed(2)}" d="${d}"/>`);
    }
  });

  const tracers = buildTracers(sim, snapshot, o, { X, Y });
  // Tiles are real copies rather than <use> clones: page CSS (theme colours, draw-in animation)
  // does not reliably reach elements inside a <use> shadow tree. The left tile draws its lines
  // backwards and the right tile forwards, so the figure unfurls outward from the central billow.
  const tileGroups = `<g class="kh-tile kh-tile--left">${isoPaths.join('')}</g>`
    + `<g class="kh-tile kh-tile--right" transform="translate(${fmt(period * 10)} 0)">${isoPaths.join('')}</g>`;

  const svg = `<svg class="kh" viewBox="0 0 ${fmt(W * 10)} ${fmt(H * 10)}" preserveAspectRatio="xMidYMid slice" role="img" aria-labelledby="${id}-title">
<title id="${id}-title">Kelvin–Helmholtz billows: isentropes of a stratified shear layer from a numerical solution of the Navier–Stokes equations</title>
<defs><style>${tracers.map(t => `@keyframes ${t.name}{${t.keyframes}}`).join('')}</style></defs>
${tileGroups}
<g class="tracers">${tracers.map(t => `<path class="tracer" pathLength="1" style="animation:${t.name} ${t.seconds.toFixed(1)}s linear ${t.delay.toFixed(1)}s infinite" d="${t.d}"/>`).join('')}</g>
</svg>`;
  return { svg, stats: { levels: levels.length, paths: isoPaths.length, pathBytes: bytes, tracers: tracers.length, svgBytes: svg.length } };
}

function buildTracers(sim, snapshot, o, { X, Y }) {
  const { nx, rows, dx, dy, y0 } = sim.grid;
  const psi = snapshot.psi;
  const at = (i, r) => psi[r * nx + (((i % nx) + nx) % nx)];

  // Velocity in flow units at fractional grid position, by bilinear interpolation of centred differences.
  const vel = (gx, gy) => {
    const i = Math.floor(gx), r = Math.min(Math.max(Math.floor(gy), 1), rows - 3);
    const fx = gx - i, fy = gy - r;
    const u = (ii, rr) => (at(ii, rr + 1) - at(ii, rr - 1)) / (2 * dy);
    const v = (ii, rr) => -(at(ii + 1, rr) - at(ii - 1, rr)) / (2 * dx);
    const bil = f => (1 - fx) * (1 - fy) * f(i, r) + fx * (1 - fy) * f(i + 1, r) + (1 - fx) * fy * f(i, r + 1) + fx * fy * f(i + 1, r + 1);
    return [bil(u), bil(v)];
  };

  const tracers = [];
  const make = (gridPts, closed, name, delay) => {
    // Orient along the flow.
    const mid = Math.floor(gridPts.length / 2);
    const a = gridPts[mid], b = gridPts[(mid + 1) % gridPts.length];
    const [u, v] = vel(a[0] % nx, a[1]);
    if (u * (b[0] - a[0]) * dx + v * (b[1] - a[1]) * dy < 0) gridPts.reverse();

    let length = 0, time = 0;
    const L = [0], T = [0];
    const n = closed ? gridPts.length + 1 : gridPts.length;
    for (let k = 1; k < n; k++) {
      const p = gridPts[k - 1], q = gridPts[k % gridPts.length];
      const ds = Math.hypot((q[0] - p[0]) * dx, (q[1] - p[1]) * dy);
      const [mu, mv] = vel(((p[0] + q[0]) / 2) % nx, (p[1] + q[1]) / 2);
      length += ds;
      time += ds / Math.max(0.05, Math.hypot(mu, mv));
      L.push(length); T.push(time);
    }
    const STEPS = 72, frames = [];
    for (let j = 0, i = 0; j <= STEPS; j++) {
      const target = (time * j) / STEPS;
      while (i < T.length - 2 && T[i + 1] < target) i++;
      const f = (target - T[i]) / ((T[i + 1] - T[i]) || 1);
      const sigma = (L[i] + f * (L[i + 1] - L[i])) / length;
      const edge = closed ? 1 : Math.min(1, Math.min(j, STEPS - j) / STEPS / 0.06);
      frames.push(`${((100 * j) / STEPS).toFixed(2)}%{stroke-dashoffset:${(-sigma).toFixed(4)};stroke-opacity:${edge.toFixed(2)}}`);
    }
    const drawn = simplify(chaikin(gridPts.map(([gx, gy]) => [X(gx), Y(gy)]), closed, 2), 0.3);
    const d = pathData(drawn, closed);
    if (d) tracers.push({ d, name, keyframes: frames.join(''), seconds: time * o.timeScale, delay });
  };

  // Billow cores: local minima of ψ near the layer (clockwise vortices).
  const cores = findCores(psi, sim.grid);
  const allCores = [...cores, ...cores.map(c => ({ ...c, i: c.i + nx }))];

  // The cores nearest the middle of the two-period drawing are the ones visible on most screens.
  // Each is contoured in a copy of ψ rolled so the core sits mid-period, keeping its loops closed.
  const nearest = allCores.slice().sort((a, b) => Math.abs(a.i - nx) - Math.abs(b.i - nx)).slice(0, o.coreTracers);
  nearest.sort((a, b) => a.i - b.i).forEach((core, n) => {
    const rolled = roll(psi, nx, ((nx >> 1) - (core.i % nx) + nx) % nx);
    const home = [nx >> 1, core.r];
    const loopAt = level => contour(rolled, nx, rows, level)
      .filter(l => l.closed && pointInPolygon(home, l.pts))
      .sort((a, b) => a.pts.length - b.pts.length)[0];
    // Find the outermost closed streamline around the core, then ride one a little over halfway out.
    let reach = 0;
    for (let f = 0.05; f <= 1.5 && loopAt(core.psi + f); f += 0.05) reach = f;
    if (!reach) return;
    const loop = loopAt(core.psi + 0.55 * reach);
    if (!loop) return;
    make(loop.pts.map(([gx, gy]) => [core.i + (gx - (nx >> 1)), gy]), true, `${o.id || 'kh'}-core-${n}`, 3.2 + n * 0.9);
  });

  // Open streamlines above and below the layer, continued across both periods.
  o.openLines.forEach((height, n) => {
    const r = Math.round((height - y0) / dy);
    const level = at(0, r);
    // ψ is nearly even in y away from the layer, so the same level appears on both sides:
    // keep the full-period line whose mean height is closest to the requested one.
    const meanRow = l => l.pts.reduce((sum, p) => sum + p[1], 0) / l.pts.length;
    const line = contour(psi, nx, rows, level)
      .filter(l => !l.closed && Math.min(l.pts[0][0], l.pts[l.pts.length - 1][0]) < 0.5 && Math.max(l.pts[0][0], l.pts[l.pts.length - 1][0]) > nx - 0.5)
      .sort((a, b) => Math.abs(meanRow(a) - r) - Math.abs(meanRow(b) - r))[0];
    if (!line) return;
    let pts = line.pts;
    if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.slice().reverse();
    if (pts[0][0] > 0.5 || pts[pts.length - 1][0] < nx - 0.5) return;
    make([...pts, ...pts.slice(1).map(([gx, gy]) => [gx + nx, gy])], false, `${o.id || 'kh'}-open-${n}`, 4 + n * 3.5);
  });

  return tracers;
}

module.exports = { loadSnapshots, renderFigure, contour };
