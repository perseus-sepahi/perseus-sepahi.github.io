#!/usr/bin/env node
// Kelvin–Helmholtz instability of a stably stratified shear layer, in two dimensions.
//
// Solves the non-dimensional Boussinesq Navier–Stokes equations in vorticity–streamfunction form:
//
//   ∂ω/∂t + u·∇ω = Ri ∂θ/∂x + Re⁻¹ ∇²ω,        u = (∂ψ/∂y, −∂ψ/∂x),   ω = −∇²ψ
//   ∂θ/∂t + u·∇θ = (Re Pr)⁻¹ ∇²θ,               θ = y + θ′
//
// Lengths are scaled by the shear-layer half-thickness, velocities by half the velocity difference,
// and θ so that the background stratification has unit gradient; the bulk Richardson number Ri is
// then the squared buoyancy frequency. The base flow is U = tanh(y) in the middle of a doubly
// periodic box, returning through two broad layers at the top and bottom edges whose Richardson
// number stays above 1/4, so only the central layer can roll up.
//
// Numerics: Fourier pseudo-spectral in both directions, Hou–Li exponential filter for dealiasing,
// classical fourth-order Runge–Kutta with an integrating factor for viscosity and diffusion,
// adaptive time step. Snapshots of θ and ψ in a window around the layer are written as JSON.
//
// Usage: node scripts/simulate-kh.js --out file.json [--re 1000] [--pr 0.71] [--ri 0.07]
//        [--nx 512] [--ny 128] [--t-end 80] [--save 20,25,30] [--seed 7]
'use strict';
const fs = require('fs');

const arg = parseArgs(process.argv.slice(2));
const P = {
  nx: +(arg.nx ?? 512),
  ny: +(arg.ny ?? 128),
  billows: +(arg.billows ?? 4),
  ly: +(arg.ly ?? 16),
  returnThickness: +(arg['return-thickness'] ?? 3),
  Re: +(arg.re ?? 1000),
  Pr: +(arg.pr ?? 0.71),
  Ri: +(arg.ri ?? 0.07),
  tEnd: +(arg['t-end'] ?? 80),
  save: String(arg.save ?? '20,25,30,35,40,45,50,55,60,65,70,75,80').split(',').map(Number),
  window: +(arg.window ?? 6.5),
  seed: +(arg.seed ?? 7),
  safety: 0.7,
};
if (!arg.out) { console.error('usage: simulate-kh.js --out file.json [options]'); process.exit(1); }

// Most unstable wavenumber of the inviscid tanh shear layer (Michalke 1964): α ≈ 0.4446.
P.lx = (P.billows * 2 * Math.PI) / 0.4446;

const { nx, ny, lx, ly } = P;
const n = nx * ny;
const dx = lx / nx, dy = ly / ny;
const nu = 1 / P.Re, kappa = 1 / (P.Re * P.Pr);

// ---------- FFT ----------
function fft1(size) {
  const half = size >> 1;
  const cos = new Float64Array(half), sinF = new Float64Array(half), sinI = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sinF[i] = Math.sin((2 * Math.PI * i) / size);
    sinI[i] = -sinF[i];
  }
  const bits = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  return (re, im, off, inverse) => {
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[off + i]; re[off + i] = re[off + j]; re[off + j] = t;
        t = im[off + i]; im[off + i] = im[off + j]; im[off + j] = t;
      }
    }
    const sin = inverse ? sinI : sinF;
    for (let len = 2; len <= size; len <<= 1) {
      const h = len >> 1, step = size / len;
      for (let start = off, end = off + size; start < end; start += len) {
        for (let j = 0, t = 0; j < h; j++, t += step) {
          const a = start + j, b = a + h, c = cos[t], s = sin[t];
          const xr = re[b] * c + im[b] * s, xi = im[b] * c - re[b] * s;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) {
      const k = 1 / size;
      for (let i = off, end = off + size; i < end; i++) { re[i] *= k; im[i] *= k; }
    }
  };
}

const fx = fft1(nx), fy = fft1(ny);
const colR = new Float64Array(ny), colI = new Float64Array(ny);
function fft2(re, im, inverse) {
  for (let j = 0; j < ny; j++) fx(re, im, j * nx, inverse);
  for (let i = 0; i < nx; i++) {
    for (let j = 0, p = i; j < ny; j++, p += nx) { colR[j] = re[p]; colI[j] = im[p]; }
    fy(colR, colI, 0, inverse);
    for (let j = 0, p = i; j < ny; j++, p += nx) { re[p] = colR[j]; im[p] = colI[j]; }
  }
}

// ---------- wavenumbers, filter ----------
const KX = new Float64Array(n), KY = new Float64Array(n), K2 = new Float64Array(n), INVK2 = new Float64Array(n), FILTER = new Float64Array(n);
for (let j = 0; j < ny; j++) {
  const jj = j <= ny / 2 ? j : j - ny;
  for (let i = 0; i < nx; i++) {
    const ii = i <= nx / 2 ? i : i - nx;
    const p = j * nx + i;
    const kx = (2 * Math.PI * ii) / lx, ky = (2 * Math.PI * jj) / ly;
    K2[p] = kx * kx + ky * ky;
    INVK2[p] = K2[p] > 0 ? 1 / K2[p] : 0;
    // Odd derivatives of the Nyquist mode are set to zero to keep fields real.
    KX[p] = i === nx / 2 ? 0 : kx;
    KY[p] = j === ny / 2 ? 0 : ky;
    FILTER[p] = Math.exp(-36 * Math.pow(Math.abs(ii) / (nx / 2), 36)) * Math.exp(-36 * Math.pow(Math.abs(jj) / (ny / 2), 36));
  }
}
const KX_EFF = 0.85 * Math.PI / dx, KY_EFF = 0.85 * Math.PI / dy;

// ---------- state ----------
const alloc = () => new Float64Array(n);
let wR = alloc(), wI = alloc(), tR = alloc(), tI = alloc();

const rand = mulberry32(P.seed);
const D = P.returnThickness, H = ly / 2;
const sech2 = z => { const c = Math.cosh(z); return 1 / (c * c); };

// Base vorticity ω = −U′ with U = tanh(s) − tanh((s − H)/D) − tanh((s + H)/D), s = y − H.
// Perturbation streamfunction localised at the layer, dominated by the most unstable mode.
const modes = [
  { m: P.billows, a: 0.02 },
  { m: P.billows - 1, a: 0.006 },
  { m: P.billows + 1, a: 0.006 },
  { m: P.billows / 2, a: 0.003 },
  { m: P.billows + 2, a: 0.002 },
].map(md => ({ ...md, phase: 2 * Math.PI * rand() }));
for (let m = 1; m <= 24; m++) modes.push({ m, a: 2e-4 * rand(), phase: 2 * Math.PI * rand() });

const psiR = alloc(), psiI = alloc();
for (let j = 0; j < ny; j++) {
  const s = j * dy - H;
  const base = -sech2(s) + sech2((s - H) / D) / D + sech2((s + H) / D) / D;
  const envelope = Math.exp(-0.5 * s * s);
  for (let i = 0; i < nx; i++) {
    const x = i * dx, p = j * nx + i;
    wR[p] = base;
    let psi = 0;
    for (const md of modes) psi += md.a * Math.cos((2 * Math.PI * md.m * x) / lx + md.phase);
    psiR[p] = psi * envelope;
  }
}
fft2(wR, wI, false);
fft2(psiR, psiI, false);
for (let p = 0; p < n; p++) { wR[p] += K2[p] * psiR[p]; wI[p] += K2[p] * psiI[p]; }

// ---------- right-hand side ----------
const sPsR = alloc(), sPsI = alloc();
const uR = alloc(), uI = alloc(), vR = alloc(), vI = alloc(), aR = alloc(), aI = alloc(), bR = alloc(), bI = alloc();
const q1R = alloc(), q1I = alloc(), q2R = alloc(), q2I = alloc(), q3R = alloc(), q3I = alloc(), q4R = alloc(), q4I = alloc();
let umax = 0, vmax = 0;

function rhs(wr, wi, tr, ti, oWr, oWi, oTr, oTi, measure) {
  for (let p = 0; p < n; p++) {
    const ps = INVK2[p], pr = wr[p] * ps, pi = wi[p] * ps;
    sPsR[p] = pr; sPsI[p] = pi;
    uR[p] = -KY[p] * pi; uI[p] = KY[p] * pr;
    vR[p] = KX[p] * pi; vI[p] = -KX[p] * pr;
    aR[p] = wr[p]; aI[p] = wi[p];
    bR[p] = tr[p]; bI[p] = ti[p];
  }
  fft2(uR, uI, true); fft2(vR, vI, true); fft2(aR, aI, true); fft2(bR, bI, true);
  if (measure) { umax = 0; vmax = 0; }
  for (let p = 0; p < n; p++) {
    const u = uR[p], v = vR[p], w = aR[p], th = bR[p];
    if (measure) { const au = Math.abs(u), av = Math.abs(v); if (au > umax) umax = au; if (av > vmax) vmax = av; }
    q1R[p] = u * w; q1I[p] = 0;
    q2R[p] = v * w; q2I[p] = 0;
    q3R[p] = u * th; q3I[p] = 0;
    q4R[p] = v * th; q4I[p] = 0;
  }
  fft2(q1R, q1I, false); fft2(q2R, q2I, false); fft2(q3R, q3I, false); fft2(q4R, q4I, false);
  const Ri = P.Ri;
  for (let p = 0; p < n; p++) {
    const kx = KX[p], ky = KY[p];
    // Nω = −(i kx F[uω] + i ky F[vω]) + Ri i kx θ̂ ;  Nθ = −(i kx F[uθ] + i ky F[vθ]) − v̂
    oWr[p] = kx * q1I[p] + ky * q2I[p] - Ri * kx * ti[p];
    oWi[p] = -(kx * q1R[p] + ky * q2R[p]) + Ri * kx * tr[p];
    oTr[p] = kx * q3I[p] + ky * q4I[p] - kx * sPsI[p];
    oTi[p] = -(kx * q3R[p] + ky * q4R[p]) + kx * sPsR[p];
  }
}

// ---------- time stepping: IF-RK4 ----------
const k1 = [alloc(), alloc(), alloc(), alloc()], k2 = [alloc(), alloc(), alloc(), alloc()];
const k3 = [alloc(), alloc(), alloc(), alloc()], k4 = [alloc(), alloc(), alloc(), alloc()];
const s1 = [alloc(), alloc(), alloc(), alloc()];
const EW = alloc(), EW2 = alloc(), ET = alloc(), ET2 = alloc();

function step(dt, measureFirst) {
  for (let p = 0; p < n; p++) {
    EW[p] = Math.exp(-nu * K2[p] * dt); EW2[p] = Math.exp(-0.5 * nu * K2[p] * dt);
    ET[p] = Math.exp(-kappa * K2[p] * dt); ET2[p] = Math.exp(-0.5 * kappa * K2[p] * dt);
  }
  const X = [wR, wI, tR, tI];
  const E = [EW, EW, ET, ET], E2 = [EW2, EW2, ET2, ET2];
  rhs(wR, wI, tR, tI, k1[0], k1[1], k1[2], k1[3], measureFirst);
  for (let c = 0; c < 4; c++) { const x = X[c], e2 = E2[c], k = k1[c], o = s1[c]; for (let p = 0; p < n; p++) o[p] = e2[p] * (x[p] + 0.5 * dt * k[p]); }
  rhs(s1[0], s1[1], s1[2], s1[3], k2[0], k2[1], k2[2], k2[3], false);
  for (let c = 0; c < 4; c++) { const x = X[c], e2 = E2[c], k = k2[c], o = s1[c]; for (let p = 0; p < n; p++) o[p] = e2[p] * x[p] + 0.5 * dt * k[p]; }
  rhs(s1[0], s1[1], s1[2], s1[3], k3[0], k3[1], k3[2], k3[3], false);
  for (let c = 0; c < 4; c++) { const x = X[c], e = E[c], e2 = E2[c], k = k3[c], o = s1[c]; for (let p = 0; p < n; p++) o[p] = e[p] * x[p] + dt * e2[p] * k[p]; }
  rhs(s1[0], s1[1], s1[2], s1[3], k4[0], k4[1], k4[2], k4[3], false);
  for (let c = 0; c < 4; c++) {
    const x = X[c], e = E[c], e2 = E2[c], a = k1[c], b = k2[c], cc = k3[c], d = k4[c];
    for (let p = 0; p < n; p++) x[p] = FILTER[p] * (e[p] * x[p] + (dt / 6) * (e[p] * a[p] + 2 * e2[p] * (b[p] + cc[p]) + d[p]));
  }
}

// ---------- snapshots ----------
const j0 = Math.ceil((H - P.window) / dy), j1 = Math.floor((H + P.window) / dy);
const rows = j1 - j0 + 1;

function physical(srcR, srcI) {
  const r = Float64Array.from(srcR), i = Float64Array.from(srcI);
  fft2(r, i, true);
  return r;
}

function quantise(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const q = new Uint16Array(values.length);
  const scale = hi > lo ? 65535 / (hi - lo) : 0;
  for (let k = 0; k < values.length; k++) q[k] = Math.round((values[k] - lo) * scale);
  return { min: lo, max: hi, data: Buffer.from(q.buffer).toString('base64') };
}

function snapshot(t) {
  const theta = physical(tR, tI);
  const psR = new Float64Array(n), psI = new Float64Array(n);
  for (let p = 0; p < n; p++) { psR[p] = wR[p] * INVK2[p]; psI[p] = wI[p] * INVK2[p]; }
  fft2(psR, psI, true);
  const th = new Float64Array(nx * rows), ps = new Float64Array(nx * rows);
  for (let r = 0; r < rows; r++) {
    const j = j0 + r, s = j * dy - H;
    for (let i = 0; i < nx; i++) {
      th[r * nx + i] = s + theta[j * nx + i];
      ps[r * nx + i] = psR[j * nx + i];
    }
  }
  return { t: +t.toFixed(3), theta: quantise(th), psi: quantise(ps) };
}

// ---------- run ----------
const saves = P.save.filter(t => t <= P.tEnd).sort((a, b) => a - b);
const out = {
  model: 'Two-dimensional Boussinesq Navier–Stokes; Fourier pseudo-spectral, Hou–Li filter, IF-RK4',
  params: { Re: P.Re, Pr: P.Pr, Ri: P.Ri, nx, ny, lx, ly, billows: P.billows, returnThickness: D, seed: P.seed },
  grid: { nx, rows, dx, dy, y0: j0 * dy - H },
  snapshots: [],
};

let t = 0, steps = 0;
const started = Date.now();
rhs(wR, wI, tR, tI, k1[0], k1[1], k1[2], k1[3], true);
while (saves.length) {
  const lambda = KX_EFF * umax + KY_EFF * vmax;
  let dt = Math.min(0.08, (2.83 * P.safety) / Math.max(lambda, 1e-9));
  const next = saves[0];
  if (t + dt >= next - 1e-9) dt = next - t;
  step(dt, true);
  t += dt; steps++;
  if (!Number.isFinite(umax) || umax > 50) { console.error(`blow-up at t=${t.toFixed(2)}`); process.exit(2); }
  if (Math.abs(t - next) < 1e-9) {
    saves.shift();
    out.snapshots.push(snapshot(t));
    console.log(`t=${t.toFixed(1)}  steps=${steps}  dt=${dt.toFixed(4)}  umax=${umax.toFixed(3)}  vmax=${vmax.toFixed(3)}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}
fs.writeFileSync(arg.out, JSON.stringify(out));
console.log(`wrote ${out.snapshots.length} snapshots to ${arg.out} (${(fs.statSync(arg.out).size / 1024).toFixed(0)} KB)`);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] === undefined || a[i + 1].startsWith('--') ? true : a[++i];
  return o;
}
