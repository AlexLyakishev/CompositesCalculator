"use strict";
// Calculations that run in the page rather than in Python. The formulas are copied unchanged from the
// original single-file page; only their packaging into functions is new, so the views can share them.
// Everything else (laminate theory, tube sections, failure criteria, clamp ring frame) runs in
// composites_calculator_lib.py through the Python bridge (py/bridge.py).

// ---------- beam: closed-form Euler–Bernoulli cases ----------
// kind: ss_point | ss_udl | cant_point | cant_udl | ff_point | ff_udl; EI [N·m²], L [m], F [N or N/m], aIn [m] or NaN
function beamSolve(kind, EI, L, F, aIn) {
  let a = aIn;
  if (!Number.isFinite(a)) a = kind === "cant_point" ? L : L / 2;
  if (kind === "ff_point") a = L / 2;
  a = Math.min(Math.max(a, 0), L);
  const bb = L - a;
  let y, Mmax, Vmax;
  if (kind === "ss_point") { y = (x) => (x <= a ? (F * bb * x * (L * L - bb * bb - x * x)) / (6 * EI * L) : (F * a * (L - x) * (L * L - a * a - (L - x) ** 2)) / (6 * EI * L)); Mmax = (F * a * bb) / L; Vmax = (F * Math.max(a, bb)) / L; }
  if (kind === "ss_udl") { y = (x) => (F * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI); Mmax = (F * L * L) / 8; Vmax = (F * L) / 2; }
  if (kind === "cant_point") { y = (x) => (x <= a ? (F * x * x * (3 * a - x)) / (6 * EI) : (F * a * a * (3 * x - a)) / (6 * EI)); Mmax = F * a; Vmax = F; }
  if (kind === "cant_udl") { y = (x) => (F * x * x * (6 * L * L - 4 * L * x + x * x)) / (24 * EI); Mmax = (F * L * L) / 2; Vmax = F * L; }
  if (kind === "ff_point") { y = (x) => { const u = x <= L / 2 ? x : L - x; return (F * u * u * (3 * L - 4 * u)) / (48 * EI); }; Mmax = (F * L) / 8; Vmax = F / 2; }
  if (kind === "ff_udl") { y = (x) => (F * x * x * (L - x) ** 2) / (24 * EI); Mmax = (F * L * L) / 12; Vmax = (F * L) / 2; }
  const n = 400, ys = Array.from({ length: n + 1 }, (_, i) => y((i * L) / n));
  let im = 0; ys.forEach((v, i) => { if (Math.abs(v) > Math.abs(ys[im])) im = i; });
  const dmax = ys[im], xmax = (im * L) / n;
  return { a, bb, ys, im, dmax, xmax, Mmax, Vmax };
}

// ---------- bolted joint: bearing, net-tension (Hart-Smith) and shear-out ----------
// r: result of the Python "bolt" call (laminate strengths in the load axes, Pa); inputs in mm, N, MPa
function boltJoint(r, { d, e, w, P, kFit, kCon, kCl, C, kBr, refIn }) {
  const t = r.t * 1000;  // mm, plies only
  const sT = r.tension.stress / 1e6, sC = r.compression.stress / 1e6, sS = r.shear.stress / 1e6;  // MPa
  // bearing: reference strength for a smooth pin in a tight, unclamped hole, scaled by the fit, contact and clamping
  const brRef = refIn !== null ? refIn : kBr * sC, sBr = brRef * kFit * kCon * kCl;
  const Pbr = sBr * d * t;
  // net-tension (Hart-Smith): elastic stress concentration of a loaded hole, relieved by the notch sensitivity C
  const wd = w / d, ew = e / w, theta = ew < 1 ? 1.5 - 0.5 / ew : 1;
  const kte = 2 + (wd - 1) - 1.5 * ((wd - 1) / (wd + 1)) * theta, ktc = 1 + C * (kte - 1);
  const Pnt = (sT * (w - d) * t) / ktc;
  // shear-out: two shear planes from the hole to the free edge
  const Pso = 2 * (e - d / 2) * t * sS;
  const modes = [
    { key: "br", name: "Bearing", P: Pbr, what: "the hole wall crushes under the bolt and the hole elongates. Gradual and usually the preferred failure." },
    { key: "nt", name: "Net-tension", P: Pnt, what: "the laminate snaps across the hole, through the width beside it. Sudden." },
    { key: "so", name: "Shear-out", P: Pso, what: "a plug between the hole and the free edge shears out. Sudden." },
  ];
  const gov = modes.reduce((a, m) => (m.P < a.P ? m : a)), R = P > 0 ? gov.P / P : null, ok = R === null || R >= 1;
  return { t, sT, sC, sS, brRef, sBr, kte, ktc, modes, gov, R, ok };
}

// ---------- failure: load converter to stress and moment resultants ----------
// v(id, fallback) reads an input; midD and lamT are the defaults from the tube and laminate [mm]
function helperResultants(type, v, midD, lamT) {
  let N = [0, 0, 0], M = [0, 0, 0], how = "", err = "";
  if (type === "panel") {
    const b = v("hB", NaN) / 1000, a = v("hA", NaN) / 1000;
    if (!(b > 0) || !(a > 0)) err = "Enter a width and a length greater than zero.";
    else { N = [v("hF1") / b, v("hF2") / a, v("hV") / b]; M = [v("hMb1") / b, v("hMb2") / a, 0]; how = "N₁ = F₁ / b,  N₂ = F₂ / a,  N₆ = V / b,  M₁ = moment / b,  M₂ = moment / a"; }
  } else if (type === "tube") {
    const d = v("hD", midD) / 1000, p = v("hPr") * 1e6;
    if (!(d > 0)) err = "Enter the mid-wall diameter of the tube.";
    else { N = [v("hP") / (Math.PI * d) + (4 * v("hMb")) / (Math.PI * d * d) + (p * d) / 4, (p * d) / 2, (2 * v("hT")) / (Math.PI * d * d)]; how = "N₁ = P / (π d) + 4 M / (π d²) + p d / 4,  N₂ = p d / 2,  N₆ = 2 T / (π d²)"; }
  } else {
    const t = v("hTh", lamT) / 1000;
    if (!(t > 0)) err = "Enter the laminate thickness.";
    else { N = [v("hS1"), v("hS2"), v("hS6")].map((x) => x * 1e6 * t); how = "N = σ × t"; }
  }
  return { N, M, how, err };
}

// ---------- clamp: preload from screw torque, F = n T / (K d) ----------
function torquePreload(n, d, T, K) { return { perScrew: T / (K * d), total: n * T / (K * d) }; }
