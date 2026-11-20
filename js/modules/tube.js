"use strict";
// Tube Stiffness module: bending stiffness of the tube section and torsion by thin-walled shear flow.

function examplePoints(kind) {
  const rows = ["x2,x3"];
  const p = (x, y) => rows.push(`${trim6(x)},${trim6(y)}`);
  if (kind === "rect") { p(-0.02, -0.01); p(0.02, -0.01); p(0.02, 0.01); p(-0.02, 0.01); }
  if (kind === "ellipse") for (let i = 0; i < 72; i++) p(0.03 * Math.cos((i * Math.PI) / 36), 0.015 * Math.sin((i * Math.PI) / 36));
  if (kind === "naca") {
    const c = 0.2, n = 40;
    const yt = (x) => 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    for (let i = 0; i <= n; i++) { const x = (1 + Math.cos((Math.PI * i) / n)) / 2; p(x * c, yt(x) * c); }
    for (let i = 1; i < n; i++) { const x = (1 - Math.cos((Math.PI * i) / n)) / 2; p(x * c, -yt(x) * c); }
  }
  return rows.join("\n");
}
function parsePoints(text) {
  const lines = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  if (lines.length < 2) return null;
  const head = lines[0].map((c) => c.toLowerCase());
  const polar = head.includes("theta_deg") && head.includes("r");
  const i = head.indexOf(polar ? "theta_deg" : "x2"), j = head.indexOf(polar ? "r" : "x3");
  if (i < 0 || j < 0) return null;
  const pts = [];
  for (const l of lines.slice(1)) {
    const a = parseFloat(l[i]), b = parseFloat(l[j]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    pts.push(polar ? [b * Math.cos((a * Math.PI) / 180), b * Math.sin((a * Math.PI) / 180)] : [a, b]);
  }
  return pts.length >= 3 ? pts : null;
}
function rectCorners(w, h) { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; }
function sectionSpec() {
  const type = $("secType").value;
  if (type === "circ") { const d = numVal("dIn") / 1000; return d > 0 ? { type, d_in: d } : { error: "Enter an inner diameter greater than zero." }; }
  if (type === "rect") {
    const h = numVal("rH") / 1000, w = numVal("rW") / 1000;
    return h > 0 && w > 0 ? { type, height: h, width: w } : { error: "Enter an inner height and width greater than zero." };
  }
  return { type, csv: $("pts").value, surface: $("surface").value };
}
function renderSectionPreview(sec) {
  // The wall is drawn between the surface the dimensions describe (dark line) and the other surface, which the
  // layup thickness puts outside it (inner surface given) or inside it (outer surface given).
  const circle = (r) => Array.from({ length: 72 }, (_, i) => [r * Math.cos((i * Math.PI) / 36), r * Math.sin((i * Math.PI) / 36)]);
  const inner = sec.type !== "arb" || sec.surface === "inner", label = (inner ? "inner" : "outer") + " surface";
  let datum = null;
  if (sec.type === "circ") datum = circle(sec.d_in / 2);
  else if (sec.type === "rect") datum = rectCorners(sec.width, sec.height);
  else datum = parsePoints(sec.csv);
  if (!datum) { $("secPreview").innerHTML = '<p class="hint c">No valid outline to draw.</p>'; return; }
  const box = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const [dx0, dx1, dy0, dy1] = box(datum);
  // wall thickness to scale, but never so thin that it cannot be seen
  const hReal = state.lam ? state.lam.h_total : 0, d = hReal > 0 ? Math.max(hReal, 0.025 * Math.max(dx1 - dx0, dy1 - dy0)) : 0;
  const exaggerated = hReal > 0 && d > hReal * 1.001;
  let other = null, marks = sec.type === "arb" ? datum : [];
  if (d > 0) {
    if (sec.type === "circ") other = circle(sec.d_in / 2 + d);
    else if (sec.type === "rect") other = rectCorners(sec.width + 2 * d, sec.height + 2 * d);
    else { const o = call("outline", { section: sec, d }); if (o.ok) { datum = o.result.datum; other = o.result.other; } }
  }
  const [x0, x1, y0, y1] = box(inner && other && other.length ? other : datum);
  // room on the right and below for dimensions, and a strip for the axis triad
  const W = 520, H = 330, padL = 30, padR = 96, padT = 28, padB = 64;
  const s = Math.min((W - padL - padR) / (x1 - x0 || 1), (H - padT - padB) / (y1 - y0 || 1));
  const cxp = padL + (W - padL - padR) / 2, cyp = padT + (H - padT - padB) / 2;
  const X = (x) => cxp + (x - (x0 + x1) / 2) * s, Y = (y) => cyp - (y - (y0 + y1) / 2) * s;
  const ring = (pts) => (pts && pts.length ? "M" + pts.map((p) => X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("L") + "Z" : "");
  // the points that were entered, unless they are too closely spaced to tell apart
  let dots = "", lx = null, ly = null;
  for (const p of marks) {
    const px = X(p[0]), py = Y(p[1]);
    if (lx !== null && Math.hypot(px - lx, py - ly) < 7) { dots = ""; break; }
    dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.1"/>`; lx = px; ly = py;
  }
  // dimensions
  let dims = "";
  const mm = (v) => fmt(v * 1000);
  if (sec.type === "circ") {
    const r = sec.d_in / 2, ro = r + hReal, a = -Math.PI / 4;
    dims += svgDim(X(-r * Math.cos(a)), Y(-r * Math.sin(a)), X(r * Math.cos(a)), Y(r * Math.sin(a)), "", {});
    dims += `<text x="${X(0) + 6}" y="${Y(0) - 6}" font-size="10.5" fill="var(--ink-2)" class="mtext">Ø ${mm(sec.d_in)}</text>`;
    const yb = Y(-(r + d)) + 22;
    dims += svgExt(X(-ro), Y(0), X(-ro), yb + 4) + svgExt(X(ro), Y(0), X(ro), yb + 4);
    dims += svgDim(X(-(r + d)), yb, X(r + d), yb, `Ø ${mm(sec.d_in + 2 * hReal)} outer`, { dy: 13 });
  } else if (sec.type === "rect") {
    const w = sec.width, h = sec.height, xr = X(w / 2 + d) + 18, yb = Y(-h / 2 - d) + 20;
    dims += svgExt(X(w / 2), Y(h / 2), xr + 4, Y(h / 2)) + svgExt(X(w / 2), Y(-h / 2), xr + 4, Y(-h / 2));
    dims += svgDim(xr, Y(h / 2), xr, Y(-h / 2), `${mm(h)}`, { dx: 12 });
    dims += svgExt(X(-w / 2), Y(-h / 2), X(-w / 2), yb + 4) + svgExt(X(w / 2), Y(-h / 2), X(w / 2), yb + 4);
    dims += svgDim(X(-w / 2), yb, X(w / 2), yb, `${mm(w)}`, { dy: 13 });
  } else {
    const xr = X(x1) + 18, yb = Y(y0) + 20;
    dims += svgExt(X(x1), Y(y1), xr + 4, Y(y1)) + svgExt(X(x1), Y(y0), xr + 4, Y(y0)) + svgDim(xr, Y(y1), xr, Y(y0), `${mm(y1 - y0)}`, { dx: 12 });
    dims += svgExt(X(x0), Y(y0), X(x0), yb + 4) + svgExt(X(x1), Y(y0), X(x1), yb + 4) + svgDim(X(x0), yb, X(x1), yb, `${mm(x1 - x0)}`, { dy: 13 });
  }
  // wall thickness call-out on the right of the section
  if (hReal > 0) {
    const yc = (y0 + y1) / 2, xw = sec.type === "circ" ? sec.d_in / 2 + d / 2 : sec.type === "rect" ? sec.width / 2 + d / 2 : null;
    if (xw !== null) dims += `<line x1="${X(xw)}" y1="${Y(yc)}" x2="${X(xw) + 30}" y2="${Y(yc) - 26}" stroke="var(--muted)" stroke-width="0.8"/>` +
      `<text x="${X(xw) + 33}" y="${Y(yc) - 28}" font-size="10.5" fill="var(--ink-2)" class="mtext">t = ${fmt(hReal * 1000)}${exaggerated ? "*" : ""}</text>`;
  }
  // centreline marks
  const cl = sec.type === "arb" ? "" : `<path d="M${X(0) - 10} ${Y(0)}H${X(0) + 10}M${X(0)} ${Y(0) - 10}V${Y(0) + 10}" stroke="var(--faint)" stroke-width="0.8" stroke-dasharray="4 2"/>`;
  const ox = 16, oy = H - 14, ax = "var(--muted)";
  $("secPreview").innerHTML = `<span class="vp-cap">Section · ${label} given</span><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tube cross-section: the wall is shaded and the ${label}, which the dimensions describe, is the dark line. The x2 axis points right and the x3 axis points up">` +
    (other ? `<path d="${ring(datum)}${ring(other)}" fill="var(--ink)" fill-opacity="0.13" fill-rule="evenodd"/>` +
      `<path d="${ring(other)}" fill="none" stroke="var(--ink-2)" stroke-width="1" stroke-linejoin="round"/>` : "") +
    `<path d="${ring(datum)}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round"/>` + dots + cl + dims +
    svgArrow(ox, oy, ox + 30, oy, ax) + svgArrow(ox, oy, ox, oy - 30, ax) + svgText(ox + 35, oy + 4, "x2", ax, "start", 10.5) + svgText(ox + 6, oy - 24, "x3", ax, "start", 10.5) + "</svg>" +
    `<p class="hint c">Dimensions in mm · ${label} ${fmt((dx1 - dx0) * 1000)} × ${fmt((dy1 - dy0) * 1000)} mm${exaggerated ? " · *wall drawn thicker than scale" : ""}</p>`;
}

function renderTube(spec) {
  const type = $("secType").value;
  $("secCirc").hidden = type !== "circ"; $("secRect").hidden = type !== "rect"; $("secArb").hidden = type !== "arb";
  const sec = sectionSpec();
  state.bend = null; state.tor = null; state.sec = sec.error ? null : sec;
  const warns = state.lam && !state.lam.symmetric ? [noteHTML("warn", "Unsymmetric layup", "The tube calculations assume a symmetric layup, so treat these results with care.")] : [];
  if (sec.error) { $("secPreview").innerHTML = ""; $("iTube").innerHTML = isec("Messages", msgs([errHTML(sec.error)])); $("tubeDetail").innerHTML = ""; setStatus("tube", "bad", "Input error"); return; }
  renderSectionPreview(sec);

  let bendHTML = "", bendSec = "", bendExtra = "", bendLog = "";
  const b = call("bending", { layup: spec, section: sec });
  if (!b.ok) bendHTML = errHTML(b.error);
  else {
    const r = b.result; state.bend = r; bendLog = b.log;
    if (r.type === "circ") bendHTML = primary([{ name: "Equivalent bending stiffness", sym: "D<sub>x</sub>", value: fmt(r.Dx, 4), unit: "N·m²", note: "EI of the circular tube, the same about every axis" }]);
    else if (r.type === "rect") bendHTML = primary([{ name: "Equivalent bending stiffness", sym: "EI", value: fmt(r.EI, 4), unit: "N·m²", note: "bending about the width axis" }]);
    else {
      bendHTML = primary([
        { name: "Bending stiffness about x2", sym: "EI<sub>2</sub>", value: fmt(r.EI_2, 4), unit: "N·m²" },
        { name: "Bending stiffness about x3", sym: "EI<sub>3</sub>", value: fmt(r.EI_3, 4), unit: "N·m²" },
      ]);
      bendSec = secondary([
        { name: "Coupling stiffness", sym: "EI<sub>23</sub>", value: fmt(Math.abs(r.EI_23) < 1e-9 * r.EI_max ? 0 : r.EI_23, 4), unit: "N·m²" },
        { name: "Maximum principal stiffness", sym: "EI<sub>max</sub>", value: fmt(r.EI_max, 4), unit: "N·m²" },
        { name: "Minimum principal stiffness", sym: "EI<sub>min</sub>", value: fmt(r.EI_min, 4), unit: "N·m²" },
        { name: "Principal axis orientation", value: fmt(r.principal_angle_deg), unit: "°", note: "EI max axis, from x2 toward x3" },
      ]);
      bendExtra = secondary([
        { name: "Axial stiffness", sym: "EA", value: fmt(r.EA, 4), unit: "N" },
        { name: "Centroid", sym: "(x2, x3)", value: r.centroid.map((c) => fmt(Math.abs(c) < 1e-9 * Math.sqrt(r.EI_max / r.EA) ? 0 : c * 1000)).join(", "), unit: "mm" },
      ]);
    }
  }

  const T = numVal("torque"), P = numVal("axial");
  let torHTML = "", torSec = "", torDetail = "", torLog = "", note = "", verd = "", status = ["none", "No load"];
  if (!Number.isFinite(T) || !Number.isFinite(P)) { torHTML = errHTML("Enter a torque and an axial load (0 for none)."); status = ["bad", "Input error"]; }
  else {
    let tsec = sec;
    if (sec.type === "rect") {
      // the library has no dedicated rectangular torsion function; its arbitrary-section one is exact for a polygon
      tsec = { type: "arb", surface: "inner", csv: "x2,x3\n" + rectCorners(sec.width, sec.height).map((p) => p.join(",")).join("\n") };
      note = "Rectangular sections use the arbitrary-section torsion function with the four inner corners.";
    }
    const t = call("torsion", { layup: spec, section: tsec, torque: T, axial: P });
    if (!t.ok) { torHTML = errHTML(t.error); status = ["bad", "Error"]; }
    else {
      const r = t.result, low = r.lowest; state.tor = r; torLog = t.log;
      if (low) status = [low.R < 1 ? "bad" : "good"];
      verd = lowestVerdict(low, "", TUBE_R_TIP);
      torHTML = primary([
        { name: "Equivalent torsional rigidity", sym: "GJ", value: fmt(r.GJ_eq), unit: "N·m²" },
        low ? { name: P ? "Torque at first-ply failure (P scaled with it)" : "Torque at first-ply failure", sym: "T<sub>fpf</sub>", value: fmt(T * low.R), unit: "N·m" } : null,
      ]);
      torSec = secondary([
        { name: "Twist per unit length", sym: "dφ/dx", value: fmt((r.twist_rate * 180) / Math.PI, 4), unit: "°/m" },
        { name: "Shear flow", sym: "q", value: fmt(r.shear_flow, 4), unit: "N/m" },
      ]);
      torDetail = secondary([
        { name: "Axial strain", sym: "ε<sub>1</sub>", value: fmt(r.axial_strain * 1e6, 4), unit: "µε" },
        r.enclosed_area !== undefined ? { name: "Mid-wall enclosed area", sym: "A<sub>m</sub>", value: fmt(r.enclosed_area * 1e6, 4), unit: "mm²" } : null,
        r.perimeter !== undefined ? { name: "Mid-wall perimeter", sym: "S", value: fmt(r.perimeter * 1000, 4), unit: "mm" } : null,
        { name: "Wall axial load (axial load spread around the wall)", sym: "N<sub>1</sub>", value: fmt(r.wall_N[0]), unit: "N/m" },
        { name: "Wall shear load (the shear flow)", sym: "N<sub>6</sub>", value: fmt(r.wall_N[2]), unit: "N/m" },
      ], "cols2");
    }
  }
  if (!b.ok && status[0] !== "bad") status = ["bad", "Error"];
  setStatus("tube", status[0], status[1]);
  $("iTube").innerHTML = verd + (warns.length ? `<div class="isec">${msgs(warns)}</div>` : "") +
    isec("Bending", bendHTML) +
    isec("Torsion", torHTML + (torSec ? `<div style="margin-top:10px">${torSec}</div>` : ""));
  const detail = [bendSec || bendExtra ? `<div class="h3">Section</div>` + [bendSec, bendExtra].filter(Boolean).join("") : "",
    torDetail ? `<div class="h3"${bendSec || bendExtra ? ' style="margin-top:14px"' : ""}>Wall under torsion and axial load</div>` + torDetail : ""].join("");
  $("tubeDetail").innerHTML = tabsHTML("tube", [
    { id: "detail", title: "Detail", html: detail },
    assumeTab("tube", `<p class="hint" style="max-width:100ch">${TUBE_R_TIP}${note ? " " + note : ""} Torsion is by thin-walled shear flow.</p>`, [bendLog, torLog].filter(Boolean).join("\n")),
  ]);
}

// shared by the tube and beam modules
const CRIT_NAMES = { max: "maximum stress", quad: "Tsai-Wu", hashin: "Hashin" };
const MODE_NAMES = { FT: "fibre tension", FC: "fibre compression", MT: "matrix tension", MC: "matrix compression", S: "shear" };
const TUBE_R_TIP = "R treats the tube wall as the laminate under the wall loads in the Detail tab, and is the lowest of the three criteria in the Failure module. Buckling is not checked.";
// verdict line from the lowest first-ply safety factor of the wall
function lowestVerdict(low, extra = "", tip = "") {
  if (!low) return verdict({ tone: "none", text: "No ply is loaded" });
  const mode = MODE_NAMES[low.mode.split("_")[1]];
  return verdict({ tone: low.R >= 1 ? "good" : "bad", R: low.R, tip,
    text: `${cap(CRIT_NAMES[low.criterion])} · layer ${low.layer} ${low.location.toLowerCase()}${mode ? " · " + mode : ""}${extra}` });
}
