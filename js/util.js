"use strict";
// Shared helpers: DOM access, number formatting and small SVG drawing primitives.
// Loaded first; everything here is global so the other classic scripts can use it.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- number formatting ----------
// Results carry at most 4 significant figures: more suggests a precision the analysis does not have.
// Five-digit and larger numbers are grouped in threes with a thin space (42 400).
const SIG_MAX = 4;
const group3 = (s) => s.replace(/^(-?\d+)/, (m) => (m.replace("-", "").length > 4 ? m.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : m));
function fmt(x, sig = SIG_MAX) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (x === 0) return "0";
  sig = Math.min(sig, SIG_MAX);
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) return x.toExponential(sig - 1).replace("e+", "e");
  return group3(String(parseFloat(x.toPrecision(sig))));
}
// safety factor: always two decimals, so a column of R values lines up; very large values are not worth reading exactly
function fmtR(R) {
  if (R === null || R === undefined || Number.isNaN(R)) return "—";
  return R > 100 ? "> 100" : R.toFixed(2);
}
const trim6 = (x) => parseFloat(Number(x).toPrecision(6));
function numVal(id) { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : NaN; }
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- SVG helpers (unchanged geometry) ----------
function svgHead(x, y, ang, col) {
  const c = Math.cos(ang), s = Math.sin(ang), pt = (dx, dy) => `${(x + dx * c - dy * s).toFixed(1)},${(y + dx * s + dy * c).toFixed(1)}`;
  return `<polygon points="${pt(0, 0)} ${pt(-8, -3.5)} ${pt(-8, 3.5)}" fill="${col}"/>`;
}
function svgArrow(x1, y1, x2, y2, col, w = 1.6) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  return `<line x1="${x1}" y1="${y1}" x2="${(x2 - 5 * Math.cos(ang)).toFixed(1)}" y2="${(y2 - 5 * Math.sin(ang)).toFixed(1)}" stroke="${col}" stroke-width="${w}"/>` + svgHead(x2, y2, ang, col);
}
// circular arc from angle a0 to a1 (degrees, clockwise on screen from the +x direction) ending in an arrow head
function svgArc(cx, cy, r, a0, a1, col) {
  const rad = (a) => (a * Math.PI) / 180, px = (a) => cx + r * Math.cos(rad(a)), py = (a) => cy + r * Math.sin(rad(a)), inc = a1 > a0;
  const tangent = rad(a1) + (inc ? Math.PI / 2 : -Math.PI / 2), back = a1 + (inc ? -1 : 1) * (5 / r) * (180 / Math.PI);
  return `<path d="M${px(a0).toFixed(1)} ${py(a0).toFixed(1)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${inc ? 1 : 0} ${px(back).toFixed(1)} ${py(back).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.6"/>` +
    svgHead(px(a1), py(a1), tangent, col);
}
const svgText = (x, y, t, col = "var(--ink)", anchor = "middle", size = 11) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${col}">${t}</text>`;

// small, filled arrow head used by dimension lines
function dimHead(x, y, ang, col) {
  const c = Math.cos(ang), s = Math.sin(ang), pt = (dx, dy) => `${(x + dx * c - dy * s).toFixed(1)},${(y + dx * s + dy * c).toFixed(1)}`;
  return `<polygon points="${pt(0, 0)} ${pt(-6, -2.2)} ${pt(-6, 2.2)}" fill="${col}"/>`;
}
// engineering dimension: extension-free line between two points with arrow heads and a label at its middle
function svgDim(x1, y1, x2, y2, label, opts = {}) {
  const col = opts.col || "var(--muted)", ang = Math.atan2(y2 - y1, x2 - x1);
  const mx = (x1 + x2) / 2 + (opts.dx || 0), my = (y1 + y2) / 2 + (opts.dy || 0);
  const vertical = Math.abs(Math.sin(ang)) > 0.9;
  const t = vertical
    ? `<text x="${mx}" y="${my}" font-size="10.5" fill="${col}" text-anchor="middle" class="mtext" transform="rotate(-90 ${mx} ${my})">${label}</text>`
    : `<text x="${mx}" y="${my}" font-size="10.5" fill="${col}" text-anchor="${opts.anchor || "middle"}" class="mtext">${label}</text>`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="0.9"/>` +
    dimHead(x2, y2, ang, col) + dimHead(x1, y1, ang + Math.PI, col) + t;
}
const svgExt = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--faint)" stroke-width="0.7"/>`;

// ---------- fibre orientation, drawn rather than colour-coded ----------
// Convention used everywhere: θ is measured from the 1 axis (0° fibres, pointing right), positive counter-clockwise
// seen from above the laminate (the top, layer 1 side). A fibre direction is an unoriented axis: θ and θ + 180° are the
// same line, so it is drawn as a plain line through the centre, never as an arrow.
function foldAngle(a) { let x = ((((a + 90) % 180) + 180) % 180) - 90; if (x <= -89.999) x = 90; return x; }
const angleText = (a) => { const v = trim6(a); return (v > 0 && v % 90 !== 0 ? "+" : "") + String(v).replace("-", "−") + "°"; };
// unit vector of the fibre line in screen coordinates (y down)
function fibreDir(a) { const r = (a * Math.PI) / 180; return [Math.cos(r), -Math.sin(r)]; }
// an SVG fragment: a square cell at (x, y) with the fibre line(s) through it; woven plies show θ and θ − 90
function fibreGlyphSVG(x, y, size, a, { woven = false, core = false, frame = true } = {}) {
  const c = size / 2, cx = x + c, cy = y + c, half = c * 0.82;
  let g = frame ? `<rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${size - 1}" fill="var(--ply)" stroke="var(--line-strong)" stroke-width="1"/>` : "";
  if (core) {
    for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) g += `<circle cx="${x + (i * size) / 4}" cy="${y + (j * size) / 4}" r="0.9" fill="var(--fibre)"/>`;
    return g;
  }
  for (const t of woven ? [a, a - 90] : [a]) {
    const [dx, dy] = fibreDir(t);
    // clip the line to the square cell so 45° lines run corner to corner
    const k = half / Math.max(Math.abs(dx), Math.abs(dy));
    g += `<line x1="${(cx - dx * k).toFixed(2)}" y1="${(cy - dy * k).toFixed(2)}" x2="${(cx + dx * k).toFixed(2)}" y2="${(cy + dy * k).toFixed(2)}" stroke="var(--fibre)" stroke-width="${size > 14 ? 1.6 : 1.3}" stroke-linecap="round"/>`;
  }
  return g;
}
function fibreGlyph(a, opts = {}) {
  const s = opts.size || 16;
  return `<svg class="glyph" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">${fibreGlyphSVG(0, 0, s, a, opts)}</svg>`;
}
// hatch pattern for a ply band: lines along the fibre direction, neutral grey
function fibrePatternSVG(id, a, gap = 6) {
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${gap}" height="${gap}" patternTransform="rotate(${-trim6(a)})">` +
    `<line x1="-1" y1="${gap / 2}" x2="${gap + 1}" y2="${gap / 2}" stroke="var(--fibre)" stroke-width="0.9"/></pattern>`;
}
// small reference: the 1 and 2 axes and the positive sense of θ (axes are vectors, so they keep their arrows)
function fibreConventionSVG(x, y) {
  const col = "var(--muted)", L = 30, [dx, dy] = fibreDir(30);
  return svgArrow(x, y, x + L, y, col, 1) + svgArrow(x, y, x, y - L, col, 1) +
    `<text x="${x + L + 3}" y="${y + 3.5}" font-size="10" fill="${col}">1 (0°)</text><text x="${x - 3}" y="${y - L - 4}" font-size="10" fill="${col}">2</text>` +
    `<line x1="${x}" y1="${y}" x2="${x + dx * L * 0.9}" y2="${y + dy * L * 0.9}" stroke="var(--fibre)" stroke-width="1.4"/>` +
    `<path d="M${x + 16} ${y} A16 16 0 0 0 ${x + 16 * dx} ${y + 16 * dy}" fill="none" stroke="${col}" stroke-width="0.9"/>` +
    `<text x="${x + 19}" y="${y - 4}" font-size="10" fill="${col}">+θ</text>`;
}
