"use strict";
// Bolted Joint module: in-plane load capacity of one fastener in a drilled hole (bearing, net-tension,
// shear-out). Laminate strengths come from Python; the joint formulas are in calc.js (boltJoint).

// a factor from a preset select, or the custom value typed next to it
function boltFactor(sel, customId) {
  const custom = $(sel).value === "custom";
  $(customId + "Wrap").hidden = !custom;
  return custom ? numVal(customId) : parseFloat($(sel).value);
}
// Plan view of the laminate with its 0° fibres (the 1 axis, or the tube axis) left to right and the free edge on the
// right. The strip and its dimensions stay put; the load arrow and the red arc where the bolt bears on the hole wall
// turn to the load angle θ, counter-clockwise from the 0° fibres. Used by the Bolted Joint module and Simple mode.
// opts: {axis: label of the left-right axis, caption: what the load does in words}
function boltSVG(d, e, w, ang, P, opts = {}) {
  const ink = "var(--ink)", mu = "var(--muted)", bad = "var(--bad)", Wd = 520;
  const s = Math.min(330 / (e + 1.5 * w), 150 / w);
  const r = Math.max((d / 2) * s, 3), rb = r + 2, la = Math.max(r + 40, 54);
  const xl = 40, hx = xl + 1.5 * w * s, xe = hx + e * s, yt = 72, yb = yt + w * s, hy = (yt + yb) / 2;
  const zig = Array.from({ length: 7 }, (_, i) => `${xl + (i % 2 ? 6 : 0)},${(yt + ((yb - yt) * i) / 6).toFixed(1)}`);
  const outline = `M${xl},${yt} L${xe},${yt} L${xe},${yb} L${zig.slice().reverse().join(" L")} Z`;
  // load direction on screen (y down); the bolt bears on the half of the hole it is pulled towards
  const th = ((Number.isFinite(ang) ? ang : 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
  const at = (rad, phi) => [hx + rad * Math.cos(phi), hy - rad * Math.sin(phi)].map((v) => v.toFixed(1)).join(" ");
  const ax = hx + la * c, ay = hy - la * sn;
  const arc = `M${at(rb, th + Math.PI / 2)} A${rb} ${rb} 0 0 1 ${at(rb, th - Math.PI / 2)}`;
  // load label just beyond the arrow head; a load pulling to the right is labelled outside the free edge
  const label = Number.isFinite(P) ? `P = ${fmt(P)} N` : "P";
  const pLabel = c > 0.2 ? `<text x="${Math.max(xe, ax) + 10}" y="${ay + 4}" font-size="11.5" fill="${bad}" class="mtext">${label}</text>`
    : c < -0.2 ? `<text x="${ax - 10}" y="${ay + (sn > 0 ? -8 : 14)}" font-size="11.5" fill="${bad}" text-anchor="end" class="mtext">${label}</text>`
    : `<text x="${ax + 10}" y="${ay + (sn > 0 ? 10 : 0)}" font-size="11.5" fill="${bad}" class="mtext">${label}</text>`;
  const dims = svgExt(hx, hy + rb, hx, yb + 22) + svgExt(xe, yb, xe, yb + 22) + svgDim(hx, yb + 18, xe, yb + 18, `e = ${fmt(e)}`, { dy: 13 }) +
    svgExt(xl - 2, yt, xl - 22, yt) + svgExt(xl - 2, yb, xl - 22, yb) + svgDim(xl - 18, yt, xl - 18, yb, `w = ${fmt(w)}`, { dx: -9 });
  // diameter call-out up and to the left, or up and to the right when the load arrow points that way
  const k = c < -0.2 && sn > 0.2 ? 1 : -1;
  const dLabel = `<line x1="${hx + k * r * 0.7}" y1="${hy - r * 0.7}" x2="${hx + k * (r + 26)}" y2="${yt - 12}" stroke="${mu}" stroke-width="0.8"/>` +
    `<text x="${hx + k * (r + 28)}" y="${yt - 15}" font-size="10.5" fill="var(--ink-2)" text-anchor="${k > 0 ? "start" : "end"}" class="mtext">Ø d = ${fmt(d)}</text>`;
  const ya = yb + 56, H = ya + 34;
  const axis = opts.axis || "0° fibres (the 1 axis)";
  const caption = opts.caption || `Load at θ = ${fmt(Number.isFinite(ang) ? ang : 0)}° from the 0° fibres, counter-clockwise`;
  return `<span class="vp-cap">Plan view</span><svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Laminate strip with a loaded bolt hole, edge distance and width dimensioned; ${esc(caption)}">` +
    `<path d="${outline}" fill="var(--ply)" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<circle cx="${hx}" cy="${hy}" r="${r}" fill="var(--surface)" stroke="${ink}" stroke-width="1.4"/>` +
    `<path d="${arc}" fill="none" stroke="${bad}" stroke-width="3.5" opacity="0.55"/>` +
    `<circle cx="${hx}" cy="${hy}" r="${Math.max(r - 2, 1.5)}" fill="var(--muted)" opacity="0.3"/>` +
    svgArrow(hx, hy, ax, ay, bad, 2) + pLabel + dims + dLabel +
    svgArrow(70, ya, 24, ya, mu, 1) + svgArrow(70, ya, 116, ya, mu, 1) + `<text x="124" y="${ya + 4}" font-size="10.5" fill="${mu}">${axis}</text>` +
    `<text x="24" y="${ya + 24}" font-size="10.5" fill="${mu}">${caption} · red arc: where the bolt bears · mm</text></svg>`;
}
function renderBolt(spec) {
  const d = numVal("bD"), e = numVal("bE"), w = numVal("bWd"), P = numVal("bLoad"), ang = numVal("bAng");
  const kFit = boltFactor("bFit", "bFitC"), kCon = boltFactor("bCon", "bConC"), kCl = parseFloat($("bClamp").value);
  const C = numVal("bC"), kBr = numVal("bBrK"), refIn = $("bBrRef").value.trim() === "" ? null : numVal("bBrRef");
  const bad = [];
  if (![d, e, w, P, ang].every(Number.isFinite)) bad.push("Enter a number for every geometry and load field.");
  else {
    if (d <= 0) bad.push("The diameter must be above zero.");
    if (e <= d / 2) bad.push("The edge distance must be more than half the diameter, or the hole breaks the edge.");
    if (w <= d) bad.push("The width must be larger than the diameter.");
    if (P < 0) bad.push("Enter the load as a positive number; its direction is set by the angle.");
  }
  if (![kFit, kCon, C, kBr].every((v) => Number.isFinite(v) && v >= 0) || (refIn !== null && !(refIn > 0))) bad.push("Factors and strengths must be positive numbers.");
  $("boltDiagram").innerHTML = bad.length && !(d > 0 && e > d / 2 && w > d) ? "" : boltSVG(d, e, w, Number.isFinite(ang) ? ang : 0, P);
  // design-rule ratios beside the fields they judge, updated as the user types
  const ratio = (id, v, min, lbl) => {
    const el = $(id), ok = !(v < min);
    el.textContent = Number.isFinite(v) && d > 0 ? `${lbl} ${fmt(v, 3)}` : "";
    el.classList.toggle("low", !ok);
    el.title = ok ? "" : `Below ${min}`;
  };
  ratio("bEdR", e / d, 3, "e/d"); ratio("bWdR", w / d, 4, "w/d");
  const failOut = (html, text) => { $("iBolt").innerHTML = html; $("boltDetail").innerHTML = ""; setStatus("bolt", "bad", text); };
  if (bad.length) { failOut(isec("Messages", msgs(bad.map(errHTML))), "Input error"); return; }
  const res = call("bolt", { layup: spec, angle: ang });
  if (!res.ok) { failOut(isec("Messages", msgs([errHTML(res.error)])), "Error"); return; }
  const r = res.result;
  const { t, sT, sC, sS, brRef, sBr, kte, ktc, modes, gov, R, ok } = boltJoint(r, { d, e, w, P, kFit, kCon, kCl, C, kBr, refIn });
  const basis = (x) => (x.basis === "fibre" ? "fibre failure once the matrix has cracked" : "first-ply failure");
  // which ply fails first: each joint mode rests on one laminate strength in the load axes
  const strOf = { br: r.compression, nt: r.tension, so: r.shear };
  const strName = { br: "compression along the load", nt: "tension along the load", so: "in-plane shear" };
  const scaled = (m) => !(m.key === "br" && refIn !== null);  // an entered bearing strength is not tied to the plies
  const modeTxt = (mode) => MODE_NAMES[mode.split("_")[1]] || "combined stress";
  const where = (s) => `Layer ${s.layer} ${s.location.toLowerCase()}`;
  const jointP = (m, stress) => (scaled(m) ? (m.P * stress) / strOf[m.key].stress : null);
  const critical = (m) => {
    const x = strOf[m.key], f = x.first;
    if (!f) return { value: "—", note: "no ply is loaded" };
    if (x.basis === "fibre" && x.fibre_at) {
      const pf = jointP(m, f.R / r.t);
      return { value: `${where(x.fibre_at)}, ${modeTxt(x.fibre_at.mode)}`,
        note: `fibre failure after the matrix has cracked. Cracking starts first in ${where(f).toLowerCase()} (${CRIT_NAMES[f.criterion]}, ${modeTxt(f.mode)})${pf !== null ? ` at ≈ ${fmt(pf, 3)} N` : ""}` };
    }
    return { value: `${where(f)}, ${modeTxt(f.mode)}`, note: `first-ply failure, ${CRIT_NAMES[f.criterion]}` };
  };
  const govCrit = critical(gov);
  const geo = [];
  if (e / d < 3) geo.push([`Edge distance e/d = ${fmt(e / d, 3)}, below 3`, "Shear-out and cleavage become likely. Aim for e/d ≥ 3."]);
  if (w / d < 4) geo.push([`Width w/d = ${fmt(w / d, 3)}, below 4`, "Net-tension will tend to govern. Aim for w/d ≥ 4–5 so bearing governs."]);
  if (r.has_core) geo.push(["Core not checked", `The bolt is taken to bear on the face skins only (${fmt(t)} mm of plies together); core crushing and skin pull-through are not checked. Use a potted insert or solid core around the bolt.`]);
  if (kCon < 1 && kCl === 1) geo.push(["Threads bear on an unclamped laminate", "The thread crests saw into the hole wall under vibration or cyclic load. Use a bolt with a plain shank through the laminate where possible."]);
  const tone = R === null ? "none" : ok ? (geo.length ? "warn" : "good") : "bad";
  setStatus("bolt", tone);

  const notes = geo.map(([sum, why]) => noteHTML("warn", sum, why));
  $("iBolt").innerHTML =
    verdict({ tone, R: R === null ? undefined : R, text: R === null ? "Enter a load"
      : `${gov.name} governs · ${gov.key === "br" ? "gradual, the preferred mode" : "sudden: change the geometry"}${geo.length ? ` · ${geo.length} note${geo.length > 1 ? "s" : ""} to check` : ""}` }) +
    isec("", primary([
      { name: "Joint strength", sym: "P<sub>max</sub>", value: fmt(gov.P), unit: "N", tip: `≈ ${fmt(gov.P / 9.81, 3)} kg hanging sideways on the bolt` },
      { name: "Bearing stress", sym: "σ<sub>br</sub>", value: fmt(P / (d * t)), unit: "MPa", note: `allowable ${fmt(sBr)} MPa · on t = ${fmt(t)} mm${r.has_core ? " of face skins" : ""}` },
    ])) +
    (notes.length ? `<div class="isec">${msgs(notes)}</div>` : "") +
    isec("Critical ply", secondary([{ name: `${gov.name}: laminate ${strName[gov.key]}`, value: govCrit.value, text: true,
      note: cap(govCrit.note) + (scaled(gov) ? "" : ". The bearing strength used is the one you entered, so the ply readout is for reference only.") }])) +
    "";

  // failure modes table: capacity, applied load, R, status
  const modesTable = '<div class="tw"><table class="tbl"><thead><tr><th>Failure mode</th><th class="n">Capacity P (N)</th><th class="n">Applied P (N)</th><th class="n">R</th><th>Status</th><th>Laminate strength used</th><th>What happens</th></tr></thead><tbody>' +
    modes.map((m) => {
      const Rm = P > 0 ? m.P / P : null, isGov = m === gov, x = strOf[m.key];
      const st = Rm === null ? chip("none", "No load") : Rm < 1 ? chip("bad", "Fail") : isGov ? chip("info", "Governs") : chip("good", "Pass");
      return `<tr${isGov ? ' class="gov"' : ""}><td><b>${m.name}</b></td><td class="n">${fmt(m.P, 4)}</td><td class="n">${fmt(P)}</td><td class="n${Rm !== null && Rm < 1 ? " fail" : ""}">${Rm === null ? "—" : fmtR(Rm)}</td>` +
        `<td>${st}</td><td class="wrap">${cap(strName[m.key])}<small>${basis(x)}</small></td><td class="wrap" style="min-width:220px">${cap(m.what)}</td></tr>`;
    }).join("") + "</tbody></table></div>";
  const plyTable = '<div class="tw"><table class="tbl"><thead><tr><th>Joint failure</th><th>Laminate loading</th>' +
    "<th>Maximum stress</th><th>Tsai-Wu</th><th>Hashin</th><th>Used for strength</th></tr></thead><tbody>" +
    modes.map((m) => {
      const x = strOf[m.key];
      const cell = (s) => {
        if (!s) return "<td>not loaded</td>";
        const pj = jointP(m, s.stress), low = x.first && x.first.R === s.R;
        return `<td class="wrap${low ? " min" : ""}">${where(s)}<small>${modeTxt(s.mode)}${pj !== null ? ` · P ≈ ${fmt(pj, 4)} N` : ""}</small></td>`;
      };
      const used = x.basis === "fibre" && x.fibre_at ? `${where(x.fibre_at)}<small>fibre failure, matrix cracked · P ≈ ${fmt(m.P, 4)} N</small>`
        : x.first ? `${where(x.first)}<small>first-ply failure · P ≈ ${fmt(m.P, 4)} N</small>` : "—";
      return `<tr${m === gov ? ' class="gov"' : ""}><td><b>${m.name}</b>${m === gov ? " " + chip("info", "Governs") : ""}</td><td>${strName[m.key]}</td>` +
        ["max", "quad", "hashin"].map((k) => cell(x.criteria[k])).join("") + `<td class="wrap">${used}</td></tr>`;
    }).join("") + "</tbody></table></div>";
  $("boltDetail").innerHTML = tabsHTML("bolt", [
    { id: "modes", title: "Failure modes", flush: true, html: modesTable },
    { id: "basis", title: "Calculation basis", html:
      '<div class="h3">Bearing strength</div>' + secondary([
      { name: "Reference bearing strength", value: fmt(brRef, 4), unit: "MPa", note: refIn !== null ? "entered" : `estimate: ${fmt(kBr)} × laminate compression strength` },
      { name: "Hole quality and fit", sym: "k<sub>fit</sub>", value: fmt(kFit, 3) },
      { name: "Contact", sym: "k<sub>contact</sub>", value: fmt(kCon, 3), note: kCon < 1 ? "threads" : "smooth" },
      { name: "Clamping", sym: "k<sub>clamp</sub>", value: fmt(kCl, 3) },
      { name: "Allowable bearing strength", sym: "σ<sub>br</sub>", value: fmt(sBr, 4), unit: "MPa", note: "reference × k<sub>fit</sub> × k<sub>contact</sub> × k<sub>clamp</sub>" },
    ], "cols2") +
      '<div class="h3" style="margin-top:14px">Laminate strengths along the load</div>' + secondary([
      { name: "Tension strength along the load", sym: "σ<sub>t</sub>", value: fmt(sT, 4), unit: "MPa", note: basis(r.tension) },
      { name: "Compression strength along the load", sym: "σ<sub>c</sub>", value: fmt(sC, 4), unit: "MPa", note: basis(r.compression) },
      { name: "In-plane shear strength", sym: "τ", value: fmt(sS, 4), unit: "MPa", note: basis(r.shear) },
      { name: "Elastic stress concentration, loaded hole", sym: "k<sub>te</sub>", value: fmt(kte, 4) },
      { name: "Effective stress concentration", sym: "k<sub>tc</sub>", value: fmt(ktc, 4), note: `1 + C (k<sub>te</sub> − 1), C = ${fmt(C)}` },
    ], "cols2") +
      '<div class="h3" style="margin-top:14px">Ply failure by criterion</div>' + plyTable +
      '<p class="hint" style="max-width:110ch">Each joint failure mode rests on one laminate strength in the load axes. A cell shows the ply that fails first under that loading by each criterion, and the bolt load P at which that happens. Highlighted cells are the lowest of the three criteria. “Used for strength” is what sets the joint strength: the higher of first-ply failure and fibre failure after the matrix has cracked.' +
      (refIn !== null ? " Bearing loads are not shown because the bearing strength is entered, not derived from the plies." : "") + "</p>" },
    assumeTab("bolt",       `<p class="hint" style="max-width:100ch">Bearing P = σ<sub>br</sub> · d · t. Net-tension P = σ<sub>t</sub> (w − d) t / k<sub>tc</sub>, with Hart-Smith's k<sub>te</sub> = 2 + (w/d − 1) − 1.5 θ (w/d − 1)/(w/d + 1), θ = 1 for e/w ≥ 1, else 1.5 − 0.5 w/e. ` +
      `Shear-out P = 2 (e − d/2) t τ. Laminate strengths come from the layup by laminate theory: each is the higher of first-ply failure and fibre failure after the matrix has cracked (ply stiffnesses E<sub>y</sub> and E<sub>s</sub> cut to 1 %), because the laminate around a hole keeps carrying load past matrix cracking.</p>` +
      `<p class="hint" style="max-width:100ch">These are engineering estimates for a bolt in double shear (the laminate between two plates, or the bolt held square). In single shear the bolt tilts and bearing strength drops by roughly 10–20 %. Cleavage, fatigue, hot/wet conditions and bolt bending are not checked; test critical joints.</p>`, res.log),
  ]);
}
