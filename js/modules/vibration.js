"use strict";
// Vibration module: natural frequencies of the current tube as a beam (bending, torsion, axial) and of a flat
// rectangular plate of the current layup, simply supported on all edges.

const VIB_BC = {
  "clamped-free": ["clamped", "free"], "pinned-pinned": ["pinned", "pinned"], "clamped-clamped": ["clamped", "clamped"],
  "free-free": ["free", "free"], "clamped-pinned": ["clamped", "pinned"],
};
const SERIES_DASH = ["", "6 4", "2 3", "10 3 2 3", "1 2", "8 2"];

// Euler-Bernoulli mode shape of mode with root B = beta*L at x/L = u, for the supports
function beamModeShape(bc, B, u) {
  const x = B * u, ch = Math.cosh(x), c = Math.cos(x), sh = Math.sinh(x), s = Math.sin(x);
  if (bc === "pinned-pinned") return Math.sin(x);
  if (bc === "clamped-free") { const k = (Math.cosh(B) + Math.cos(B)) / (Math.sinh(B) + Math.sin(B)); return ch - c - k * (sh - s); }
  const k = (Math.cosh(B) - Math.cos(B)) / (Math.sinh(B) - Math.sin(B));
  if (bc === "free-free") return ch + c - k * (sh + s);
  return ch - c - k * (sh - s);  // clamped-clamped, clamped-pinned
}

function vibTubeSVG(bc, roots) {
  const W = 560, H = 190, x0 = 50, x1 = 510, yc = 92, amp = 52;
  const [left, right] = VIB_BC[bc];
  const pin = (x) => `<polygon points="${x},${yc + 3} ${x - 9},${yc + 18} ${x + 9},${yc + 18}" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.4"/><line x1="${x - 13}" y1="${yc + 21}" x2="${x + 13}" y2="${yc + 21}" stroke="var(--ink)" stroke-width="1"/>`;
  const wall = (x, side) => `<line x1="${x}" y1="${yc - 30}" x2="${x}" y2="${yc + 30}" stroke="var(--ink)" stroke-width="3"/>` +
    [-24, -12, 0, 12, 24].map((d) => `<line x1="${x}" y1="${yc + d}" x2="${x + side * 8}" y2="${yc + d + 8}" stroke="var(--ink)" stroke-width="1"/>`).join("");
  const end = (kind, x, side) => (kind === "clamped" ? wall(x, side) : kind === "pinned" ? pin(x) : "");
  let g = `<line x1="${x0}" y1="${yc}" x2="${x1}" y2="${yc}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 3"/>`;
  const shown = roots.slice(0, 3);
  shown.forEach((B, i) => {
    const N = 120, us = Array.from({ length: N + 1 }, (_, k) => k / N), ws = us.map((u) => beamModeShape(bc, B, u));
    const peak = Math.max(...ws.map(Math.abs)) || 1;
    // draw each mode with the same sign at the end that moves most, so they are easy to compare
    const im = ws.reduce((b, w, k) => (Math.abs(w) > Math.abs(ws[b]) ? k : b), 0), sgn = ws[im] < 0 ? -1 : 1;
    const X = (u) => x0 + (x1 - x0) * u, Y = (w) => yc - (sgn * w / peak) * amp;
    const d = us.map((u, k) => `${k ? "L" : "M"}${X(u).toFixed(1)} ${Y(ws[k]).toFixed(1)}`).join("");
    g += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="${i ? 1.3 : 2}" stroke-opacity="${1 - i * 0.22}"${SERIES_DASH[i] ? ` stroke-dasharray="${SERIES_DASH[i]}"` : ""}/>`;
    // label at the mode's largest swing away from the ends, where the modes do not overlap
    let il = 6;
    for (let k = 6; k <= N - 10; k++) if (Math.abs(ws[k]) > Math.abs(ws[il])) il = k;
    const up = sgn * ws[il] > 0;
    g += `<text x="${X(us[il])}" y="${Y(ws[il]) + (up ? -7 : 15)}" font-size="10.5" fill="var(--ink-2)" text-anchor="middle">${i + 1}</text>`;
  });
  g += end(left, x0, -1) + end(right, x1, 1);
  const leg = shown.map((_, i) => `<line x1="${x0 + i * 82}" y1="${H - 12}" x2="${x0 + i * 82 + 26}" y2="${H - 12}" stroke="var(--accent)" stroke-width="${i ? 1.3 : 2}" stroke-opacity="${1 - i * 0.22}"${SERIES_DASH[i] ? ` stroke-dasharray="${SERIES_DASH[i]}"` : ""}/>` +
    `<text x="${x0 + i * 82 + 31}" y="${H - 8}" font-size="10.5" fill="var(--muted)">mode ${i + 1}</text>`).join("");
  return `<span class="vp-cap">Bending mode shapes · ${bc.replace("-", " – ")}</span><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="First bending mode shapes of the tube for ${bc} supports">${g}${leg}</svg>`;
}

function vibPlateSVG(a, b, modes, freqs) {
  // one small panel per mode: the half-waves shaded alternately, nodal lines dashed
  const list = modes.slice(0, 6), cols = Math.min(3, list.length), rows = Math.ceil(list.length / cols);
  const cellW = 170, cellH = 128, W = cols * cellW, H = rows * cellH;
  const s = Math.min((cellW - 24) / a, (cellH - 40) / b), pw = a * s, ph = b * s;
  let g = "";
  list.forEach(([m, n], i) => {
    const ox = (i % cols) * cellW + (cellW - pw) / 2, oy = Math.floor(i / cols) * cellH + 8;
    for (let p = 0; p < m; p++) for (let q = 0; q < n; q++)
      g += `<rect x="${(ox + (p * pw) / m).toFixed(1)}" y="${(oy + (q * ph) / n).toFixed(1)}" width="${(pw / m).toFixed(1)}" height="${(ph / n).toFixed(1)}" fill="var(--accent)" fill-opacity="${(p + q) % 2 ? 0.06 : 0.26}"/>`;
    for (let p = 1; p < m; p++) g += `<line x1="${ox + (p * pw) / m}" y1="${oy}" x2="${ox + (p * pw) / m}" y2="${oy + ph}" stroke="var(--ink-2)" stroke-width="0.9" stroke-dasharray="3 2"/>`;
    for (let q = 1; q < n; q++) g += `<line x1="${ox}" y1="${oy + (q * ph) / n}" x2="${ox + pw}" y2="${oy + (q * ph) / n}" stroke="var(--ink-2)" stroke-width="0.9" stroke-dasharray="3 2"/>`;
    g += `<rect x="${ox}" y="${oy}" width="${pw}" height="${ph}" fill="none" stroke="var(--ink)" stroke-width="1.3"/>`;
    g += `<text x="${ox + pw / 2}" y="${oy + ph + 16}" font-size="10.5" fill="var(--ink-2)" text-anchor="middle">(${m},${n}) · ${fmt(freqs[i], 4)} Hz</text>`;
  });
  return `<span class="vp-cap">Plate mode shapes · a along 0°, dashed = nodal lines</span><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nodal patterns of the lowest plate modes">${g}</svg>`;
}

const logWarnings = (log) => (log || "").split("\n").filter((l) => l.startsWith("Warning: ")).map((l) => l.slice(9));

function renderVibration(spec) {
  const warns = [], items = [], plateItems = [];
  let tubeTable = "", plateTable = "", logs = [];
  const nT = Math.min(Math.max(Math.round(numVal("vN")) || 3, 1), 6), L = numVal("vL") / 1000, bc = $("vBC").value;
  const edit = ' <button class="btn sm" type="button" data-goto="tube">Edit tube</button>';
  $("vTubeNote").innerHTML = "<div>" + (state.sec ? `Section from the <b>Tube Stiffness</b> module (${esc(tubeSummary())}), with the current layup.` : "The tube section in the Tube Stiffness module is not valid.") + edit + "</div>";

  // ----- tube -----
  let tubeErr = "";
  if (!state.sec) tubeErr = "Fix the tube section in the Tube Stiffness module.";
  else if (!(L > 0)) tubeErr = "Enter a tube length greater than zero.";
  if (tubeErr) { $("vTubeViz").innerHTML = ""; warns.push(errHTML("Tube: " + tubeErr)); }
  else {
    const t = call("vib_tube", { layup: spec, section: state.sec, length: L, boundary: bc, n_modes: nT });
    if (!t.ok) { $("vTubeViz").innerHTML = ""; warns.push(errHTML("Tube: " + t.error)); }
    else {
      const r = t.result; logs.push(t.log);
      logWarnings(t.log).forEach((w) => warns.push(msgHTML("warn", "Tube: " + esc(w))));
      $("vTubeViz").innerHTML = vibTubeSVG(bc, r.beta_L);
      const first = r.bending[0];
      items.push({ name: r.bending.length > 1 ? first.label : "First bending frequency", sym: "f<sub>1</sub>", value: fmt(first.f[0], 4), unit: "Hz" });
      if (r.bending[1]) items.push({ name: r.bending[1].label, sym: "f<sub>1</sub>", value: fmt(r.bending[1].f[0], 4), unit: "Hz" });
      if (r.torsion) items.push({ name: "First torsion frequency", sym: "f<sub>T1</sub>", value: fmt(r.torsion[0], 4), unit: "Hz" });
      if (r.axial) items.push({ name: "First axial frequency", sym: "f<sub>A1</sub>", value: fmt(r.axial[0], 4), unit: "Hz" });
      const cols = [...r.bending.map((s) => [s.label, s.f]), r.torsion ? ["Torsion", r.torsion] : null, r.axial ? ["Axial", r.axial] : null].filter(Boolean);
      tubeTable = '<div class="tw"><table class="tbl"><thead><tr><th>Mode</th><th class="n">β<sub>n</sub>L</th>' +
        cols.map(([h]) => `<th class="n">${esc(h)} (Hz)</th>`).join("") + "</tr></thead><tbody>" +
        r.beta_L.map((B, i) => `<tr><td>${i + 1}</td><td class="n">${fmt(B, 5)}</td>` + cols.map(([, f]) => `<td class="n">${fmt(f[i], 4)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>" +
        secondary([
          { name: "Mass per unit length", sym: "m", value: fmt(r.mass_per_length * 1000, 4), unit: "g/m" },
          ...r.bending.map((s) => ({ name: s.label + " stiffness", sym: "EI", value: fmt(s.EI, 4), unit: "N·m²" })),
          { name: "Slenderness", sym: "L/D", value: fmt(L / r.outer_size, 3) },
        ], "cols2");
      if (!r.torsion) tubeTable += '<p class="hint">Torsion modes need the polar mass inertia of the section, which the library works out for circular tubes only.</p>';
    }
  }

  // ----- plate -----
  const a = numVal("vA") / 1000, b = numVal("vB") / 1000, nP = Math.min(Math.max(Math.round(numVal("vPN")) || 6, 1), 12);
  if (!(a > 0 && b > 0)) { $("vPlateViz").innerHTML = ""; warns.push(errHTML("Plate: enter a length and width greater than zero.")); }
  else {
    const p = call("vib_plate", { layup: spec, a, b, n_modes: nP });
    if (!p.ok) { $("vPlateViz").innerHTML = ""; warns.push(errHTML("Plate: " + p.error)); }
    else {
      const r = p.result; logs.push(p.log);
      logWarnings(p.log).forEach((w) => warns.push(msgHTML("warn", "Plate: " + esc(w))));
      $("vPlateViz").innerHTML = vibPlateSVG(a, b, r.modes, r.frequencies);
      plateItems.push({ name: "Fundamental frequency", sym: `f<sub>${r.modes[0].join(",")}</sub>`, value: fmt(r.frequencies[0], 4), unit: "Hz" });
      if (r.frequencies[1] !== undefined) plateItems.push({ name: "Second mode", sym: `f<sub>${r.modes[1].join(",")}</sub>`, value: fmt(r.frequencies[1], 4), unit: "Hz" });
      plateTable = '<div class="tw"><table class="tbl"><thead><tr><th>Mode</th><th class="n">m</th><th class="n">n</th><th class="n">Frequency (Hz)</th></tr></thead><tbody>' +
        r.modes.map(([m, n], i) => `<tr><td>${i + 1}</td><td class="n">${m}</td><td class="n">${n}</td><td class="n">${fmt(r.frequencies[i], 4)}</td></tr>`).join("") +
        "</tbody></table></div>" +
        secondary([
          { name: "Mass per unit area", sym: "ρ<sub>A</sub>", value: fmt(r.areal_mass, 4), unit: "kg/m²" },
          { name: "Bending-twisting coupling", sym: "|D<sub>16</sub>|/√(D<sub>11</sub>D<sub>22</sub>)", value: fmt(r.D16_ratio, 3) },
          { name: "Bending-twisting coupling", sym: "|D<sub>26</sub>|/√(D<sub>11</sub>D<sub>22</sub>)", value: fmt(r.D26_ratio, 3) },
          { name: "Smaller side / thickness", sym: "min(a,b)/h", value: fmt(Math.min(a, b) / r.h, 3) },
        ], "cols2") + '<p class="hint">m and n are the number of half-waves along a (the 0° direction) and along b.</p>';
    }
  }

  const hasErr = warns.some((w) => w.includes('class="msg bad"')), hasWarn = warns.length > 0;
  setStatus("vibration", hasErr ? "bad" : hasWarn ? "warn" : "none", hasErr ? "Input error" : hasWarn ? "Check" : "Calculated");
  $("iVib").innerHTML = (warns.length ? `<div class="isec">${msgs(warns)}</div>` : "") +
    isec(`Tube · ${esc($("vBC").selectedOptions[0].textContent)}`, items.length ? primary(items) : "") +
    isec("Plate · simply supported", plateItems.length ? primary(plateItems) : "");
  $("vibDetail").innerHTML = tabsHTML("vib", [
    { id: "tube", title: "Tube modes", html: tubeTable },
    { id: "plate", title: "Plate modes", html: plateTable },
    assumeTab("vib",
      '<p class="hint" style="max-width:100ch">Tube: Euler–Bernoulli beam for bending, uniform shaft and bar for torsion and axial modes. Shear deformation, rotary inertia, damping and added mass are ignored, and the supports are ideal. Below an L/D of about 10 the bending frequencies run high. For torsion and axial modes a pinned end is taken to hold twist and axial motion. Rectangular tubes use a thin-wall mass and EA = A<sub>11</sub> × mid-wall perimeter.</p>' +
      '<p class="hint" style="max-width:100ch">Plate: classical laminated plate theory, Navier solution for a plate simply supported on all four edges. It is exact for symmetric cross-ply layups. Bending-twisting coupling (D<sub>16</sub>, D<sub>26</sub>) and an unsymmetric layup (B ≠ 0) make the real plate softer, so the frequencies are then an upper estimate. Thick plates and sandwich cores also run high.</p>' +
      '<p class="hint" style="max-width:100ch">Core layers have zero density in the library, so a core adds no mass.</p>',
      logs.filter(Boolean).join("\n")),
  ]);
}
