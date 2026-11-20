"use strict";
// Beam module: deflection and strength of a beam made from the current tube (closed-form cases in calc.js).

function fillSource(id, options) {
  const sel = $(id), prev = sel.value;
  sel.innerHTML = options.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join("") + '<option value="custom">Custom value…</option>';
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : sel.options[0].value;
  sel._values = Object.fromEntries(options.map((o) => [o.key, o.value]));
}
function sourceValue(id, customId) { const sel = $(id); return sel.value === "custom" ? numVal(customId) : sel._values[sel.value]; }
function tubeSummary() {
  const s = state.sec;
  if (!s) return "none";
  if (s.type === "circ") return `circular, ${fmt(s.d_in * 1000)} mm inner diameter`;
  if (s.type === "rect") return `rectangular, ${fmt(s.height * 1000)} × ${fmt(s.width * 1000)} mm inside`;
  return `arbitrary outline, ${s.surface} surface`;
}
// distance from the neutral axis to the mid-wall at the point of the section furthest from that axis [m]
function extremeFibre(key) {
  const s = state.sec, b = state.bend, h = state.lam ? state.lam.h_total : 0;
  if (!s || !b) return null;
  if (key === "circ") return s.d_in / 2 + h / 2;
  if (key === "rect") return (s.height + h) / 2;
  const pts = parsePoints(s.csv);
  if (!pts) return null;
  const th = (b.principal_angle_deg * Math.PI) / 180, [xc, yc] = b.centroid;
  const dist = { EI_2: (x, y) => y, EI_3: (x, y) => x, EI_max: (x, y) => -x * Math.sin(th) + y * Math.cos(th), EI_min: (x, y) => x * Math.cos(th) + y * Math.sin(th) }[key];
  const far = Math.max(...pts.map((p) => Math.abs(dist(p[0] - xc, p[1] - yc))));
  return Math.max(far + (s.surface === "inner" ? h / 2 : -h / 2), 0);
}

function renderBeam() {
  const b = state.bend, eiOpts = [];
  if (b && b.type === "circ") eiOpts.push({ key: "circ", label: `Current tube: Dx = ${fmt(b.Dx, 5)} N·m²`, value: b.Dx });
  if (b && b.type === "rect") eiOpts.push({ key: "rect", label: `Current tube: EI = ${fmt(b.EI, 5)} N·m²`, value: b.EI });
  if (b && b.type === "arb") for (const [k, n] of [["EI_2", "EI₂ about x2"], ["EI_3", "EI₃ about x3"], ["EI_min", "EI min"], ["EI_max", "EI max"]])
    eiOpts.push({ key: k, label: `Current tube: ${n} = ${fmt(b[k], 5)} N·m²`, value: b[k] });
  fillSource("eiSrc", eiOpts);
  $("eiCustomWrap").hidden = $("eiSrc").value !== "custom";
  const edit = ' <button class="btn sm" type="button" data-goto="tube">Edit tube</button>';
  $("eiNote").innerHTML = "<div>" + ($("eiSrc").value === "custom"
    ? "Custom EI: the beam results do not use the layup or the tube." + (eiOpts.length ? "" : " No tube stiffness is available right now." + edit)
    : `EI comes from the tube in the <b>Tube Stiffness</b> module (${esc(tubeSummary())}), built from the current layup.` + edit) + "</div>";

  const kind = $("bCase").value, udl = kind.endsWith("udl"), hasA = kind === "ss_point" || kind === "cant_point";
  $("bPWrap").hidden = udl; $("bWWrap").hidden = !udl; $("bAWrap").hidden = !hasA;
  $("bALabel").textContent = kind === "cant_point" ? "Load position from fixed end" : "Load position from left support";
  $("bA").placeholder = kind === "cant_point" ? "free end" : "centre";
  $("beamDragHint").hidden = !hasA;

  const EI = sourceValue("eiSrc", "eiCustom"), L = numVal("bL") / 1000, F = udl ? numVal("bW") : numVal("bP");
  state.beamGeom = null;
  if (!(EI > 0) || !(L > 0) || !Number.isFinite(F)) {
    $("beamDiagram").innerHTML = ""; $("beamPlot").innerHTML = ""; $("beamDetail").innerHTML = "";
    $("iBeam").innerHTML = isec("Messages", msgs([errHTML(!(EI > 0) ? "No bending stiffness available. Fix the tube section, or choose a custom EI." : "Enter a length greater than zero and a load.")]));
    setStatus("beam", "bad", "Input error");
    return;
  }
  const { a, ys, im, dmax, xmax, Mmax, Vmax } = beamSolve(kind, EI, L, F, numVal("bA") / 1000);
  let checked = false, low = null, wall = null, rHint = "A safety factor needs a tube from the Tube Stiffness module; it is not available for a custom EI.", rErr = "";
  const eiKey = $("eiSrc").value, c = eiKey === "custom" ? null : extremeFibre(eiKey), spec = layupSpec();
  if (c !== null && spec) {
    const kappa = Math.abs(Mmax) / EI;
    const w = call("wall_bending", { layup: spec, strain: kappa * c, curvature: kappa });
    if (w.ok) {
      checked = true; low = w.result.lowest; wall = w.result;
      rHint = "R checks the tube wall where the bending moment is largest, at the point furthest from the neutral axis, on both the tension and compression sides, using the lowest of the three criteria in the Failure module. Transverse shear, buckling and crushing under the load points are not checked.";
    } else rErr = "Safety factor: " + w.error;
  }
  $("beamDiagram").innerHTML = beamSVG(kind, L, a, ys, im);
  state.beamGeom = hasA ? { L, x0: 46, x1: 514 } : null;
  $("beamPlot").innerHTML = beamPlot(L, ys, im, a, hasA);
  const fails = low && low.R < 1;
  setStatus("beam", fails ? "bad" : checked && low ? "good" : "none", fails || (checked && low) ? undefined : "Not checked");
  $("iBeam").innerHTML =
    (checked ? lowestVerdict(low, low ? ` · ${low.side} side` : "", rHint) : verdict({ tone: "none", word: "Not checked", text: rHint })) +
    (rErr ? `<div class="isec">${msgs([errHTML(rErr)])}</div>` : "") +
    isec("", primary([
      { name: "Maximum deflection", sym: "δ<sub>max</sub>", value: fmt(Math.abs(dmax) * 1000), unit: "mm", note: `at x = ${fmt(xmax * 1000)} mm` },
      low ? { name: "Load at first-ply failure", sym: udl ? "w<sub>fpf</sub>" : "P<sub>fpf</sub>", value: fmt(Math.abs(F) * low.R), unit: udl ? "N/m" : "N" } : null,
    ])) +
    isec("Internal forces", secondary([
      { name: "Maximum bending moment", sym: "M<sub>max</sub>", value: fmt(Math.abs(Mmax), 4), unit: "N·m" },
      { name: "Maximum shear force", sym: "V<sub>max</sub>", value: fmt(Math.abs(Vmax), 4), unit: "N" },
      { name: "Span / deflection", sym: "L/δ", value: dmax ? fmt(L / Math.abs(dmax), 3) : "—" },
      { name: "Position of maximum deflection", sym: "x", value: fmt(xmax * 1000), unit: "mm" },
    ]));
  $("beamDetail").innerHTML = tabsHTML("beam", [
    { id: "more", title: "Detail", html: secondary([
      { name: "Bending stiffness used", sym: "EI", value: fmt(EI), unit: "N·m²" },
      c !== null ? { name: "Mid-wall distance from the neutral axis", sym: "c", value: fmt(c * 1000), unit: "mm" } : null,
      wall ? { name: "Wall load at that point, tension side", sym: "N<sub>1</sub>", value: fmt(wall.N1), unit: "N/m" } : null,
      wall ? { name: "Wall moment at that point, tension side", sym: "M<sub>1</sub>", value: fmt(wall.M1), unit: "N·m/m" } : null,
    ], "cols2") },
    { id: "assume", title: "Assumptions", html: `<p class="hint" style="max-width:90ch">${rHint}</p><p class="hint" style="max-width:90ch">Small-deflection beam theory; shear deformation is ignored, which under-predicts deflection for short beams and sandwich sections.</p>` },
  ]);
}

function beamSVG(kind, L, a, ys, im) {
  // a negative load lifts the beam, so the load is drawn pushing up from below and the deflected shape above
  // the elevation shows supports and load only: the deflected shape is the Deflection plot's job
  const up = ys[im] < 0, dir = up ? -1 : 1, H = up ? 160 : 124, yb = up ? 62 : 52;
  const x0 = 46, x1 = 514, X = (x) => x0 + ((x1 - x0) * x) / L;
  const pin = (x) => `<polygon points="${x},${yb + 3} ${x - 9},${yb + 18} ${x + 9},${yb + 18}" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.4"/><line x1="${x - 13}" y1="${yb + 21}" x2="${x + 13}" y2="${yb + 21}" stroke="var(--ink)" stroke-width="1"/>`;
  const wall = (x, side) => `<line x1="${x}" y1="${yb - 24}" x2="${x}" y2="${yb + 24}" stroke="var(--ink)" stroke-width="3"/>` +
    [-18, -6, 6, 18].map((d) => `<line x1="${x}" y1="${yb + d}" x2="${x + side * 8}" y2="${yb + d + 8}" stroke="var(--ink)" stroke-width="1"/>`).join("");
  const arrow = (x, tail) => svgArrow(x, tail, x, yb - dir * 5, "var(--bad)");
  let sup = "", load = "";
  if (kind.startsWith("ss")) sup = pin(x0) + pin(x1);
  if (kind.startsWith("cant")) sup = wall(x0, -1);
  if (kind.startsWith("ff")) sup = wall(x0, -1) + wall(x1, 1);
  if (kind.endsWith("udl")) {
    const base = yb - dir * 30, inset = up && kind.startsWith("ss") ? 16 : 0;  // keep clear of the supports when drawn below
    load = `<line x1="${x0 + inset}" y1="${base}" x2="${x1 - inset}" y2="${base}" stroke="var(--bad)" stroke-width="1.6"/>`;
    for (let i = 0; i <= 12; i++) load += arrow(x0 + inset + ((x1 - x0 - 2 * inset) * i) / 12, base);
  } else {
    // the point load arrow, with a wide invisible handle for dragging
    load = `<g class="${kind === "ff_point" ? "" : "beam-drag"}" id="beamLoad">${arrow(X(a), yb - dir * 40)}` +
      `<rect x="${X(a) - 10}" y="${Math.min(yb - dir * 44, yb)}" width="20" height="44" fill="transparent"/></g>`;
  }
  // span dimension under the beam
  const yd = H - 10;
  const dims = svgExt(x0, yb + 24, x0, yd + 4) + svgExt(x1, yb + 24, x1, yd + 4) + svgDim(x0, yd, x1, yd, `L = ${fmt(L * 1000)} mm`, { dy: -4 }) +
    (!kind.endsWith("udl") && kind !== "ff_point" && a > 0 && a < L ? svgDim(x0, yd - 16, X(a), yd - 16, `a = ${fmt(a * 1000)}`, { dy: -4 }) : "");
  return `<span class="vp-cap">Elevation</span><svg viewBox="0 0 560 ${H}" role="img" aria-label="Beam diagram with supports and load">` +
    `<line x1="${x0}" y1="${yb}" x2="${x1}" y2="${yb}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>` +
    sup + load + dims + "</svg>";
}

// deflection along the span, to scale on its own axis
function beamPlot(L, ys, im, a, hasA) {
  const W = 760, H = 210, P0 = 64, P1 = 740, T = 16, B = 172;
  const peak = Math.abs(ys[im]) * 1000 || 1, sgn = ys[im] < 0 ? -1 : 1;
  // nice axis maximum
  const mag = 10 ** Math.floor(Math.log10(peak)), steps = [1, 2, 2.5, 5, 10];
  const top = steps.map((s) => s * mag).find((v) => v >= peak) || peak;
  const X = (i) => P0 + ((P1 - P0) * i) / (ys.length - 1), Y = (v) => T + ((v * 1000 * sgn) / top) * (B - T);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const yy = T + ((B - T) * k) / 4;
    g += `<line x1="${P0}" y1="${yy}" x2="${P1}" y2="${yy}" stroke="var(--line)" stroke-width="${k ? 0.7 : 1}"/>` +
      `<text x="${P0 - 6}" y="${yy + 3.5}" font-size="10" fill="var(--muted)" text-anchor="end">${fmt((sgn * top * k) / 4, 3)}</text>`;
  }
  for (let k = 0; k <= 10; k++) {
    const xx = P0 + ((P1 - P0) * k) / 10;
    g += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${B}" stroke="var(--line-soft)" stroke-width="0.7"/>` +
      `<text x="${xx}" y="${B + 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${fmt((L * 1000 * k) / 10, 4)}</text>`;
  }
  const path = ys.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  g += `<path d="${path}L${P1} ${T}L${P0} ${T}Z" fill="var(--accent)" fill-opacity="0.08"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>`;
  g += `<circle cx="${X(im)}" cy="${Y(ys[im])}" r="3.5" fill="var(--accent)"/><text x="${X(im) + (im > ys.length / 2 ? -8 : 8)}" y="${Y(ys[im]) - 7}" font-size="10.5" fill="var(--ink)" text-anchor="${im > ys.length / 2 ? "end" : "start"}">δmax ${fmt(ys[im] * 1000, 4)} mm</text>`;
  if (hasA) g += `<line x1="${P0 + ((P1 - P0) * a) / L}" y1="${T}" x2="${P0 + ((P1 - P0) * a) / L}" y2="${B}" stroke="var(--bad)" stroke-width="1" stroke-dasharray="3 3"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="Deflection along the beam">${g}` +
    `<text x="${(P0 + P1) / 2}" y="${H - 4}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="var(--sans)">x (mm)</text>` +
    `<text x="14" y="${(T + B) / 2}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="var(--sans)" transform="rotate(-90 14 ${(T + B) / 2})">δ (mm), + downward</text></svg>`;
}

// drag the point load along the span: updates the load position input
(function wireBeamDrag() {
  let dragging = false;
  const toA = (ev) => {
    const g = state.beamGeom, svg = $("beamDiagram").querySelector("svg");
    if (!g || !svg) return null;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return Math.min(Math.max((p.x - g.x0) / (g.x1 - g.x0), 0), 1) * g.L;
  };
  $("beamDiagram").addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest(".beam-drag")) return;
    dragging = true; ev.target.setPointerCapture?.(ev.pointerId); ev.preventDefault();
  });
  $("beamDiagram").addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const a = toA(ev);
    if (a === null) return;
    $("bA").value = trim6(Math.round(a * 1000 * 10) / 10);
    renderBeam();
  });
  const end = () => { dragging = false; };
  $("beamDiagram").addEventListener("pointerup", end);
  $("beamDiagram").addEventListener("pointercancel", end);
})();
