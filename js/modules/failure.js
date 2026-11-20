"use strict";
// Failure Analysis module: ply-by-ply safety factors under applied stress and moment resultants,
// by maximum stress, Tsai-Wu and Hashin (all from composites_calculator_lib.calculate_safety_factors).

const FAIL_CRIT = [["max", "Maximum stress", "var(--s1)"], ["quad", "Tsai-Wu", "var(--s2)"], ["hashin", "Hashin", "var(--s3)"]];
const FAIL_COLS = { max: ["Max_FT", "Max_FC", "Max_MT", "Max_MC", "Max_S"], quad: ["Quad"], hashin: ["Hash_FT", "Hash_FC", "Hash_MT", "Hash_MC"] };
state.failSel = null;  // layer number selected in the ply table or the plot

function renderFailure(spec) {
  const N = ["N1", "N2", "N6"].map(numVal), M = ["M1", "M2", "M6"].map(numVal);
  const fail = (html, tone, text) => { $("iFail").innerHTML = html; $("failDetail").innerHTML = ""; $("failPlot").innerHTML = ""; setStatus("failure", tone, text); };
  if ([...N, ...M].some((v) => !Number.isFinite(v))) { fail(isec("Messages", msgs([errHTML("Enter a number for every load (0 for none).")])), "bad", "Input error"); return; }
  const f = call("failure", { layup: spec, N, M });
  if (!f.ok) { fail(isec("Messages", msgs([errHTML(f.error)])), "bad", "Error"); return; }
  const r = f.result, s = r.summary;
  const crit = [["max", "Maximum stress"], ["quad", "Tsai-Wu quadratic"], ["hashin", "Hashin"]];
  const loaded = crit.filter(([k]) => s[k]);
  if (!loaded.length) { fail(emptyHTML("No ply is loaded. Enter a non-zero load."), "none"); return; }
  const minR = Math.min(...loaded.map(([k]) => s[k].R));
  const gov = loaded.reduce((a, c) => (s[c[0]].R < s[a[0]].R ? c : a)), g = s[gov[0]], ok = minR >= 1;
  const modeOf = (x) => MODE_NAMES[x.mode.split("_")[1]];
  setStatus("failure", ok ? "good" : "bad");

  $("iFail").innerHTML =
    verdict({ tone: ok ? "good" : "bad", R: minR, tip: "Load multiplier to first-ply failure: the applied loads times R just fail the first ply.",
      text: `${gov[1]} · layer ${g.layer} ${g.location.toLowerCase()} · ${modeOf(g) || "combined stress"}` }) +
    isec("", primary([
      { name: "Stress resultants at failure", value: N.map((v) => fmt(v * minR)).join(", "), unit: "N/m", note: "N₁, N₂, N₆: the applied loads × R" },
      { name: "Moment resultants at failure", value: M.map((v) => fmt(v * minR)).join(", "), unit: "N·m/m", note: "M₁, M₂, M₆" },
    ])) +
    isec("First-ply failure by criterion", secondary(crit.map(([k, n]) => ({ name: n, sym: "R", value: s[k] ? fmtR(s[k].R) : "—",
      note: s[k] ? `layer ${s[k].layer}, ${s[k].location.toLowerCase()}${modeOf(s[k]) ? ", " + modeOf(s[k]) : ""}` : "not loaded" }))));

  // ply results table: every ply surface, every mode
  const head = { Max_FT: "FT", Max_FC: "FC", Max_MT: "MT", Max_MC: "MC", Max_S: "S", Quad: "R", Hash_FT: "FT", Hash_FC: "FC", Hash_MT: "MT", Hash_MC: "MC" };
  const headTip = { FT: "Fibre tension", FC: "Fibre compression", MT: "Matrix tension", MC: "Matrix compression", S: "In-plane shear", R: "Tsai-Wu does not separate modes" };
  const isMin = (ri, c) => crit.some(([k]) => s[k] && s[k].row === ri && s[k].mode === c);
  const lowOf = (row) => { const v = r.cols.map((c) => row[c]).filter((x) => x !== null && x !== undefined); return v.length ? Math.min(...v) : null; };
  const zOf = layerZ();
  const table = '<div class="tw" style="max-height:440px"><table class="tbl" id="failTable"><thead><tr class="grp"><th colspan="4"></th><th colspan="5">Maximum stress</th><th>Tsai-Wu</th><th colspan="4">Hashin</th></tr>' +
    '<tr><th data-sort="n">Layer</th><th data-sort="s">Surface</th><th class="n" data-sort="n" title="z of this surface from the mid-plane">z (mm)</th><th class="n" data-sort="n" title="Lowest R of all modes and criteria">min R</th>' +
    r.cols.map((c) => `<th class="n" data-sort="n" title="${headTip[head[c]]}. Empty: this mode is not loaded.">${head[c]}</th>`).join("") + "</tr></thead><tbody>" +
    r.rows.map((row, ri) => {
      const lo = lowOf(row), z = zOf[row.layer] ? zOf[row.layer][row.loc === "Top" ? 0 : 1] : null;
      return `<tr class="click${state.failSel === row.layer ? " sel" : ""}" data-layer="${row.layer}"><td class="n" style="text-align:left">${row.layer}</td><td>${row.loc}</td>` +
        `<td class="n" data-v="${z ?? ""}">${z === null ? "—" : fmt(z * 1000, 4)}</td><td class="n lo${lo !== null && lo < 1 ? " fail" : ""}" data-v="${lo ?? ""}">${fmtR(lo)}</td>` +
        r.cols.map((c) => {
          const v = row[c], has = v !== null && v !== undefined, gov = isMin(ri, c);
          const cls = ["n", has && v < 1 ? "fail" : "", gov ? "min" : "", has && !gov && v !== lo && v >= 1 ? "dim" : ""].filter(Boolean).join(" ");
          return `<td class="${cls}" data-v="${has ? v : ""}">${has ? fmtR(v) : ""}</td>`;
        }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  $("failDetail").innerHTML = tabsHTML("fail", [
    { id: "plies", title: `Ply results (${r.rows.length} surfaces)`, flush: true, html: table +
      '<p class="hint" style="padding:0 12px 10px">Highlighted cells govern each criterion; red is below 1. Hover a column heading for its failure mode. Click a row to mark the ply in the plot.</p>' },
    assumeTab("fail", '<p class="hint" style="max-width:100ch">Safety factor R is the multiple of the applied loads at which a ply fails. Layer 1 is at the top (z = +h/2); core layers are skipped. Each surface of every ply is checked by maximum stress, Tsai-Wu and Hashin.</p>', f.log),
  ]);
  resort("failTable");
  state.failRes = { r, s, minR };
  renderFailPlot();
}
// z of each ply's top and bottom face by layer number, from the laminate result [m]
function layerZ() {
  const out = {};
  if (state.lam) for (const l of state.lam.layers) if (!l.is_core) out[l.num] = [l.z_top, l.z_bottom];
  return out;
}

// safety factor through the thickness: one band per layer, log R across
function renderFailPlot() {
  const el = $("failPlot"), fr = state.failRes;
  if (!fr || !state.lam) { el.innerHTML = ""; return; }
  const { r, s } = fr, layers = state.lam.layers;
  const plyT = layers.filter((l) => !l.is_core).reduce((a, l) => a + l.thickness, 0) || 1;
  const sc = 250 / plyT, top = 34, X0 = 30, X1 = 50, P0 = 70, P1 = 500;
  let y = top;
  const geo = layers.map((l) => { const h = l.is_core ? Math.min(Math.max(l.thickness * sc, 18), 40) : Math.max(l.thickness * sc, 5); const g = { y0: y, h }; y += h; return g; });
  const H = y + 36, W = 520;
  const yOf = {};  // layer number -> [y top, y bottom]
  layers.forEach((l, i) => { if (!l.is_core) yOf[l.num] = [geo[i].y0, geo[i].y0 + geo[i].h]; });
  // per layer and surface: lowest R of each criterion
  const pts = { max: [], quad: [], hashin: [] };
  let lo = Infinity, hi = -Infinity;
  for (const row of r.rows) for (const [k] of FAIL_CRIT) {
    const v = FAIL_COLS[k].map((c) => row[c]).filter((x) => x !== null && x !== undefined && x > 0);
    if (!v.length || !yOf[row.layer]) continue;
    const R = Math.min(...v);
    pts[k].push({ layer: row.layer, top: row.loc === "Top", R });
    lo = Math.min(lo, R); hi = Math.max(hi, R);
  }
  if (!Number.isFinite(lo)) { el.innerHTML = ""; return; }
  let d0 = Math.floor(Math.log10(Math.min(lo, 0.5))), d1 = Math.ceil(Math.log10(Math.max(hi, 2)));
  if (d1 - d0 > 6) d1 = d0 + 6;
  const X = (R) => P0 + ((Math.min(Math.max(Math.log10(R), d0), d1) - d0) / (d1 - d0)) * (P1 - P0);
  let g = "";
  // grid and axis
  for (let d = d0; d <= d1; d++) {
    const x = X(10 ** d);
    g += `<line x1="${x}" y1="${top}" x2="${x}" y2="${y}" stroke="var(--line)" stroke-width="0.8"/>` +
      `<text x="${x}" y="${y + 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${d >= 0 && d <= 3 ? 10 ** d : "1e" + d}</text>`;
    for (let k = 2; k < 10 && d < d1; k++) { const xm = X(k * 10 ** d); g += `<line x1="${xm}" y1="${y}" x2="${xm}" y2="${y + 3}" stroke="var(--line-strong)"/>`; }
  }
  g += `<text x="${(P0 + P1) / 2}" y="${y + 30}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="var(--sans)">safety factor R (log scale)</text>`;
  // ply bands, hatched along the fibre direction as in the Laminate cross-section
  const pats = {};
  const pat = (a) => { const k = trim6(a), id = "fp" + String(k).replace(/[^0-9a-z]/gi, "_"); if (!pats[k]) pats[k] = fibrePatternSVG(id, k, 5); return id; };
  layers.forEach((l, i) => {
    const { y0, h } = geo[i];
    const sel = !l.is_core && state.failSel === l.num;
    g += l.is_core ? `<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${h}" fill="var(--core)" fill-opacity="0.3"/><rect x="${P0}" y="${y0}" width="${P1 - P0}" height="${h}" fill="var(--core)" fill-opacity="0.08"/>`
      : `<rect x="${X0}" y="${y0 + 0.5}" width="${X1 - X0}" height="${h - 1}" fill="var(--ply)"/><rect x="${X0}" y="${y0 + 0.5}" width="${X1 - X0}" height="${h - 1}" fill="url(#${pat(l.orientation)})" stroke="var(--line-strong)" stroke-width="0.6" data-layer="${l.num}" style="cursor:pointer" data-hover="${esc(`<b>Layer ${l.num}</b> · θ = ${angleText(l.orientation)}<br>${esc(l.material)}`)}"/>` +
        (sel ? `<rect x="${P0}" y="${y0}" width="${P1 - P0}" height="${h}" fill="var(--accent)" fill-opacity="0.12"/><rect x="${X0 - 2}" y="${y0}" width="${X1 - X0 + 4}" height="${h}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>` : "") +
        (i % 2 ? "" : `<rect x="${P0}" y="${y0}" width="${P1 - P0}" height="${h}" fill="var(--ink)" fill-opacity="0.025"/>`);
  });
  g += `<rect x="${P0}" y="${top}" width="${P1 - P0}" height="${y - top}" fill="none" stroke="var(--line-strong)" stroke-width="0.8"/>`;
  // R = 1
  const x1 = X(1);
  g += `<rect x="${P0}" y="${top}" width="${Math.max(x1 - P0, 0)}" height="${y - top}" fill="var(--bad)" fill-opacity="0.06"/>` +
    `<line x1="${x1}" y1="${top - 4}" x2="${x1}" y2="${y}" stroke="var(--bad)" stroke-width="1.2" stroke-dasharray="4 3"/>` +
    `<text x="${x1 + 3}" y="${top - 6}" font-size="10" fill="var(--bad)">R = 1</text>`;
  // series: a segment through each ply from its top to its bottom surface
  for (const [k, name, col] of FAIL_CRIT) {
    const byLayer = {};
    for (const p of pts[k]) (byLayer[p.layer] = byLayer[p.layer] || {})[p.top ? "t" : "b"] = p.R;
    for (const [ln, v] of Object.entries(byLayer)) {
      const [ya, yb] = yOf[ln];
      if (v.t !== undefined && v.b !== undefined) g += `<line x1="${X(v.t)}" y1="${ya}" x2="${X(v.b)}" y2="${yb}" stroke="${col}" stroke-width="1.6"/>`;
      for (const [R, yy] of [[v.t, ya], [v.b, yb]]) if (R !== undefined) g += `<circle cx="${X(R)}" cy="${yy}" r="2.3" fill="${col}" data-hover="${esc(`<b>${name}</b> · layer ${ln}<br><span class='mono'>R = ${fmtR(R)}</span>`)}"/>`;
    }
  }
  // governing point
  const ks = FAIL_CRIT.map(([k]) => k).filter((k) => s[k]);
  const gs = ks.length ? s[ks.reduce((a, k) => (s[k].R < s[a].R ? k : a), ks[0])] : null;
  if (gs && yOf[gs.layer]) {
    const gx = X(gs.R), gy = yOf[gs.layer][gs.location === "Top" ? 0 : 1];
    g += `<circle cx="${gx}" cy="${gy}" r="6" fill="none" stroke="var(--ink)" stroke-width="1.3"/>` +
      `<text x="${gx + (gx > (P0 + P1) / 2 ? -9 : 9)}" y="${gy - 8}" font-size="10" fill="var(--ink)" text-anchor="${gx > (P0 + P1) / 2 ? "end" : "start"}">min R ${fmtR(gs.R)}</text>`;
  }
  const legend = FAIL_CRIT.map(([, n, c], i) => `<line x1="${P0 + i * 120}" y1="14" x2="${P0 + i * 120 + 16}" y2="14" stroke="${c}" stroke-width="2"/><circle cx="${P0 + i * 120 + 8}" cy="14" r="2.3" fill="${c}"/><text x="${P0 + i * 120 + 22}" y="17.5" font-size="10.5" fill="var(--ink-2)" font-family="var(--sans)">${n}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="plot" role="img" aria-label="Lowest safety factor of each criterion at the top and bottom of every ply, through the laminate thickness"><defs>${Object.values(pats).join("")}</defs>${legend}` +
    `<text x="${(X0 + X1) / 2}" y="${top - 6}" font-size="9.5" fill="var(--faint)" text-anchor="middle" font-family="var(--sans)">TOP</text>` +
    `<text x="${(X0 + X1) / 2}" y="${y + 14}" font-size="9.5" fill="var(--faint)" text-anchor="middle" font-family="var(--sans)">BOT</text>${g}</svg>`;
}

// ---------- load converter ----------
function plateDiagram(f1, f2, v, full) {
  // top view of the laminate: 1 (0 deg fibres) runs left to right, 2 runs up the page
  const load = "var(--bad)", shear = "var(--warn)", dim = "var(--muted)", W = full ? 520 : 340;
  let g = `<rect x="110" y="50" width="160" height="100" fill="var(--ply)" stroke="var(--ink-2)" stroke-width="1.2"/>`;
  for (let y = 62; y <= 138; y += 12.6) g += `<line x1="118" y1="${y}" x2="262" y2="${y}" stroke="var(--fibre)" stroke-width="1" opacity="0.6"/>`;
  g += svgText(190, 96, "0° fibres run along 1", dim, "middle", 10) + svgText(190, 122, "top view", dim, "middle", 10);
  for (const y of [70, 100, 130]) g += svgArrow(274, y, 308, y, load);
  for (const x of [150, 190, 230]) g += svgArrow(x, 46, x, 14, load);
  g += svgText(314, 104, f1, load, "start", 12) + svgText(240, 22, f2, load, "start", 12);
  g += svgArrow(262, 142, 262, 58, shear) + svgText(256, 86, v, shear, "end", 12);
  if (!full) { for (const y of [70, 100, 130]) g += svgArrow(106, y, 72, y, load); for (const x of [150, 190, 230]) g += svgArrow(x, 154, x, 186, load); g += svgArrow(118, 58, 118, 142, shear); }
  else {
    g += `<path d="M110 163H270M110 158V168M270 158V168M97 50V150M92 50H102M92 150H102" stroke="${dim}" fill="none"/>` + svgText(190, 177, "a", dim) + svgText(86, 104, "b", dim);
    // side view of the same panel being bent
    g += `<path d="M366 118Q431 84 496 118" fill="none" stroke="var(--ink-2)" stroke-width="4" stroke-linecap="round"/>` +
      svgArc(366, 118, 15, 300, 80, load) + svgArc(496, 118, 15, 240, 460, load) +
      svgText(431, 62, "bending moment across b", load, "middle", 11) + svgText(431, 150, "side view, looking along 2", dim, "middle", 10) +
      svgArrow(405, 168, 457, 168, dim) + svgText(462, 172, "1", dim, "start");
  }
  g += svgArrow(24, 190, 58, 190, dim) + svgArrow(24, 190, 24, 156, dim) + svgText(63, 194, "1", dim, "start") + svgText(24, 150, "2", dim);
  return `<svg viewBox="0 0 ${W} 204" role="img" aria-label="Laminate seen from above: direction 1 follows the 0 degree fibres, direction 2 is across them, with the loads acting on the edges" style="max-width:${W}px">${g}</svg>`;
}
function tubeDiagram() {
  const load = "var(--bad)", dim = "var(--muted)", ink = "var(--ink)";
  let g = `<path d="M130 60H360A12 40 0 0 1 360 140H130A12 40 0 0 1 130 60Z" fill="var(--ply)" stroke="var(--ink-2)" stroke-width="1.2"/>` +
    `<ellipse cx="360" cy="100" rx="12" ry="40" fill="none" stroke="var(--ink-2)" stroke-width="1.2"/>` +
    `<line x1="88" y1="100" x2="374" y2="100" stroke="${dim}" stroke-dasharray="7 4 2 4"/>`;
  g += svgArrow(378, 100, 432, 100, load, 2) + svgText(440, 104, "P", load, "start", 12);
  g += `<path d="M330 50A14 50 0 0 1 335 149" fill="none" stroke="${load}" stroke-width="1.6"/>` + svgHead(326, 150, Math.PI * 1.05, load) + svgText(352, 46, "T", load, "start", 12);
  g += svgArc(112, 100, 30, 250, 110, load) + svgText(70, 104, "M", load, "end", 12);
  g += svgArrow(215, 94, 215, 66, load) + svgArrow(215, 106, 215, 134, load) + svgText(224, 90, "p", load, "start", 12);
  g += `<path d="M165 60V140M160 60H170M160 140H170" stroke="${dim}" fill="none"/>` + svgText(172, 126, "d", dim, "start");
  g += `<rect x="262" y="70" width="24" height="24" fill="none" stroke="${ink}"/>` + svgArrow(274, 82, 312, 82, ink) + svgArrow(274, 82, 274, 40, ink) +
    svgText(316, 86, "1", ink, "start") + svgText(274, 34, "2 (around the hoop)", ink, "middle") + svgText(274, 112, "wall element", dim, "middle", 10);
  return `<svg viewBox="0 0 470 170" role="img" aria-label="Tube seen from the side: direction 1 runs along the tube axis and direction 2 around the hoop, with axial force, torque, bending moment and internal pressure" style="max-width:470px">${g}</svg>`;
}
function helperDiagram(type) {
  if (type === "tube") return tubeDiagram();
  return type === "panel" ? plateDiagram("F₁", "F₂", "V", true) : plateDiagram("σ₁", "σ₂", "τ₆", false);
}
function renderHelper() {
  const type = $("hType").value;
  for (const k of ["panel", "tube", "stress"]) $("h_" + k).hidden = k !== type;
  $("hDiagram").innerHTML = helperDiagram(type);
  const v = (id, fallback = 0) => { const x = parseFloat($(id).value); return Number.isFinite(x) ? x : fallback; };
  const midD = state.sec && state.sec.type === "circ" && state.lam ? (state.sec.d_in + state.lam.h_total) * 1000 : NaN;
  const lamT = state.lam ? state.lam.h_total * 1000 : NaN;
  $("hD").placeholder = Number.isFinite(midD) ? `${fmt(midD)} (Tube tab)` : "";
  $("hTh").placeholder = Number.isFinite(lamT) ? `${fmt(lamT)} (laminate)` : "";
  const { N, M, how, err } = helperResultants(type, v, midD, lamT);
  state.helper = err ? null : { N, M };
  $("hApply").disabled = !!err;
  $("hOut").innerHTML = err ? errHTML(err) : secondary([{ name: "Stress resultants", sym: "N₁, N₂, N₆", value: N.map((x) => fmt(x)).join(", "), unit: "N/m" }, { name: "Moment resultants", sym: "M₁, M₂, M₆", value: M.map((x) => fmt(x)).join(", "), unit: "N·m/m" }]) + `<p class="hint mono">${how}</p>`;
}
