"use strict";
// Tube Clamp module: a tube gripped by two clamp halves screwed together. The ring-frame model and the
// failure checks run in Python (py/bridge.py, _clamp); this file draws and presents them.

function clampSVG(shape, t, dims, plug, contact, L) {
  const cx = 200, cy = 128, g = 4, jaw = 12, ink = "var(--ink)";
  let tube, upper, Fx, s, Wo, Ho, dimHTML = "";
  if (shape === "round") {
    const Rr = dims.d_in / 2 + t; s = 62 / Rr;
    const Ro = Rr * s, Ri = Math.max((dims.d_in / 2) * s, 1), Rc = Ro + jaw; Wo = Ho = 2 * Ro; Fx = Ro + 46;
    const xo = Math.sqrt(Rc * Rc - (g + jaw) ** 2);
    upper = `M${cx - Fx},${cy - g} V${cy - g - jaw} H${cx - xo} A${Rc} ${Rc} 0 0 1 ${cx + xo},${cy - g - jaw} H${cx + Fx} V${cy - g} Z`;
    tube = `<circle cx="${cx}" cy="${cy}" r="${Ro}" fill="var(--ply)" stroke="${ink}" stroke-width="1.2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${Ri}" fill="${plug ? "var(--warn-soft)" : "var(--surface-3)"}" stroke="${ink}" stroke-width="1.2"/>`;
    const a = -Math.PI / 4;
    dimHTML = svgDim(cx - Ri * Math.cos(a), cy - Ri * Math.sin(a), cx + Ri * Math.cos(a), cy + Ri * Math.sin(a), "") +
      `<text x="${cx + 5}" y="${cy + 14}" font-size="10.5" fill="var(--ink-2)" class="mtext">Ø ${fmt(dims.d_in * 1000)}</text>`;
  } else {
    const W = dims.width + 2 * t, H = dims.height + 2 * t; s = Math.min(170 / W, 120 / H);
    Wo = W * s; Ho = H * s; Fx = Wo / 2 + jaw + 34;
    const wi = dims.width * s, hi = dims.height * s, ro = (dims.radius + t) * s, ri = dims.radius * s;
    upper = `M${cx - Fx},${cy - g} V${cy - g - jaw} H${cx - Wo / 2 - jaw} V${cy - Ho / 2 - jaw} H${cx + Wo / 2 + jaw} V${cy - g - jaw} H${cx + Fx} V${cy - g} Z`;
    tube = `<rect x="${cx - Wo / 2}" y="${cy - Ho / 2}" width="${Wo}" height="${Ho}" rx="${ro}" fill="var(--ply)" stroke="${ink}" stroke-width="1.2"/>` +
      `<rect x="${cx - wi / 2}" y="${cy - hi / 2}" width="${wi}" height="${hi}" rx="${ri}" fill="${plug ? "var(--warn-soft)" : "var(--surface-3)"}" stroke="${ink}" stroke-width="1.2"/>`;
    dimHTML = svgDim(cx - wi / 2, cy, cx + wi / 2, cy, `${fmt(dims.width * 1000)}`, { dy: -4 }) +
      svgDim(cx + wi / 2 - 14, cy - hi / 2, cx + wi / 2 - 14, cy + hi / 2, `${fmt(dims.height * 1000)}`, { dx: -9 });
  }
  const clamp = (flip) => `<path d="${upper}" fill="var(--line)" stroke="${ink}" stroke-width="1.2"${flip ? ` transform="translate(0 ${2 * cy}) scale(1 -1)"` : ""}/>`;
  const screw = (x) => `<line x1="${x}" y1="${cy - g - jaw - 6}" x2="${x}" y2="${cy + g + jaw + 10}" stroke="${ink}" stroke-width="3"/>` +
    `<rect x="${x - 6}" y="${cy - g - jaw - 11}" width="12" height="5" fill="${ink}"/>` +
    svgArrow(x, cy - g - jaw - 40, x, cy - g - jaw - 14, "var(--bad)");
  // where the clamp presses: whole contact face, or the line a rigid clamp touches first
  let marks = "";
  const top = cy - Ho / 2;
  if (contact === "line") {
    const xs = shape === "round" ? [cx] : [cx - Wo / 2 + (dims.radius + t) * s, cx, cx + Wo / 2 - (dims.radius + t) * s];
    marks = xs.map((x) => `<circle cx="${x}" cy="${top}" r="3.5" fill="var(--bad)"/><circle cx="${x}" cy="${cy + Ho / 2}" r="3.5" fill="var(--bad)"/>`).join("");
  } else if (shape === "round") {
    const R = Wo / 2 + 1.5;
    marks = [-1, 1].map((d) => `<path d="M${cx - R} ${cy} A${R} ${R} 0 0 ${d > 0 ? 1 : 0} ${cx + R} ${cy}" fill="none" stroke="var(--bad)" stroke-width="2.5" opacity="0.5"/>`).join("");
  } else {
    marks = [top - 1.5, cy + Ho / 2 + 1.5].map((y) => `<line x1="${cx - Wo / 2 + (dims.radius + t) * s}" y1="${y}" x2="${cx + Wo / 2 - (dims.radius + t) * s}" y2="${y}" stroke="var(--bad)" stroke-width="2.5" opacity="0.5"/>`).join("");
  }
  return `<span class="vp-cap">Section across the tube</span><svg viewBox="0 0 400 ${cy * 2 + 30}" role="img" aria-label="Tube cross-section with two clamp halves, screws and preload">` +
    clamp(false) + clamp(true) + tube + marks + dimHTML + screw(cx - Fx + 16) + screw(cx + Fx - 16) +
    `<text x="${cx}" y="${cy * 2 + 8}" font-size="10.5" fill="var(--muted)" text-anchor="middle">${plug ? "Plug fills the bore · " : ""}red: where the clamp presses · contact length L = ${fmt(L * 1000)} mm</text>` +
    `<text x="${cx}" y="${cy * 2 + 22}" font-size="10.5" fill="var(--faint)" text-anchor="middle">dimensions in mm, inner surface</text>` +
    `<text x="${cx - Fx + 16}" y="${cy - g - jaw - 44}" font-size="11" fill="var(--bad)" text-anchor="middle" class="mtext">F/2</text>` +
    `<text x="${cx + Fx - 16}" y="${cy - g - jaw - 44}" font-size="11" fill="var(--bad)" text-anchor="middle" class="mtext">F/2</text></svg>`;
}
function renderTorqueHelper() {
  const n = numVal("cnS"), d = numVal("cdS") / 1000, T = numVal("cTq"), K = numVal("cK");
  const { perScrew, total: F } = torquePreload(n, d, T, K);
  state.clampTorqueF = Number.isFinite(F) && F > 0 ? F : null;
  $("cTqOut").innerHTML = state.clampTorqueF ? `Preload ≈ <span class="mono">${fmt(perScrew, 4)} N</span> per screw, <span class="mono">F ≈ ${fmt(F, 4)} N</span> in total (F = n T / (K d)). ` +
    "K is about 0.2 for dry steel screws and 0.15 lubricated; the real preload scatters by roughly ±25 % for a given torque." : "Enter positive numbers.";
  $("cTqApply").disabled = !state.clampTorqueF;
}
function renderClamp(spec) {
  const shape = $("cShape").value, plug = $("cPlug").value === "1";
  $("cRound").hidden = shape !== "round"; $("cRect").hidden = shape !== "rect"; $("cPlugWrap").hidden = !plug;
  const p = { layup: spec, shape, plug, contact: $("cContact").value, length: numVal("cL") / 1000, preload: numVal("cF"),
    friction: numVal("cMu"), plug_strength: numVal("cPlugS") * 1e6, d_in: numVal("cD") / 1000,
    width: numVal("cW") / 1000, height: numVal("cH") / 1000, radius: numVal("cR") / 1000 };
  const bad = [];
  if (shape === "round" && !(p.d_in > 0)) bad.push("Enter an inner diameter greater than zero.");
  if (shape === "rect" && !(p.width > 0 && p.height > 0 && p.radius >= 0)) bad.push("Enter an inner width and height greater than zero and a corner radius of zero or more.");
  if (shape === "rect" && p.radius * 2 >= Math.min(p.width, p.height)) bad.push("The corner radius must be less than half the smaller inner side; use the round shape for a round tube.");
  if (!(p.length > 0) || !(p.preload > 0)) bad.push("Enter a contact length and a preload greater than zero.");
  if (!(p.friction >= 0)) bad.push("Enter a friction coefficient of zero or more.");
  if (plug && !(p.plug_strength > 0)) bad.push("Enter the plug's compressive strength.");
  const t = state.lam ? state.lam.h_total : 0;
  $("clampDiagram").innerHTML = bad.length ? "" : clampSVG(shape, t, p, plug, p.contact, p.length);
  const failOut = (html, tone, text) => { $("iClamp").innerHTML = html; $("clampDetail").innerHTML = ""; setStatus("clamp", tone, text); };
  if (bad.length) { failOut(isec("Messages", msgs(bad.map(errHTML))), "bad", "Input error"); return; }
  const res = call("clamp", p);
  if (!res.ok) { failOut(isec("Messages", msgs([errHTML(res.error)])), "bad", "Error"); return; }
  const r = res.result, F = p.preload;
  if (!r.modes.length) { failOut(emptyHTML("No ply is loaded."), "none"); return; }
  const gov = r.modes.reduce((a, m) => (m.R < a.R ? m : a)), R = gov.R, ok = R >= 1;
  const modeTxt = (m) => MODE_NAMES[m] || "combined stress";
  const plyTxt = (x) => `Layer ${x.layer}, ${x.location.toLowerCase()} surface, at the ${x.region}` + (p.contact === "line" && shape === "rect" ? ` (contact on ${x.case})` : "");
  const fpf = r.modes.find((m) => m.key === "fpf");
  const detail = (m) => ({
    fpf: () => `${plyTxt(m.ply)}: ${modeTxt(m.ply.mode)} by ${CRIT_NAMES[m.ply.criterion]}. Hoop force N₂ = ${fmt(m.ply.N2, 4)} N/m, hoop moment M₂ = ${fmt(m.ply.M2, 4)} N·m/m there.`,
    buckle: () => `Hoop compression in the wall beside the clamp ${fmt(m.N, 4)} N/m, buckling at ${fmt(m.N_cr, 4)} N/m: ${m.what}.`,
    crush: () => `Contact pressure ${fmt(m.pressure / 1e6, 4)} MPa against ${fmt(m.strength / 1e6, 4)} MPa, the lowest transverse compressive strength Y<sub>c</sub> of the plies, taken as the through-thickness strength.`,
    plug: () => `Pressure on the plug ${fmt(m.pressure / 1e6, 4)} MPa against its strength ${fmt(m.strength / 1e6, 4)} MPa.`,
  }[m.key]());
  const warn = [];
  if (r.has_core) warn.push(["Core not checked", "The whole sandwich is taken as the tube wall. Crushing of the core under the clamp is not checked."]);
  if (plug && p.contact === "line") warn.push(["Rough estimate: line contact on a plug", "The line load is taken to spread at 45° through the wall, over about one wall thickness at mid-wall and two on the plug. This is a rough estimate; fit the clamp to the tube or use a liner."]);
  if (!plug && fpf && fpf === gov && fpf.ply.region === "top face" && p.contact === "even") warn.push(["The clamped face bends and fails", "Even pressure bends the wide clamped face between the side walls, and that is what fails. A clamp face relieved in the middle, so it bears only near the corners, puts the load straight into the side walls; a plug stops the face bending."]);
  const tone = ok ? (warn.length ? "warn" : "good") : "bad";
  setStatus("clamp", tone);
  const notes = warn.map(([sum, why]) => noteHTML("warn", sum, why));
  $("iClamp").innerHTML =
    verdict({ tone, R, text: gov.name + (ok ? "" : ` · keep the preload below ${fmt(F * R)} N`) + (warn.length ? ` · ${warn.length} note${warn.length > 1 ? "s" : ""} to check` : "") }) +
    isec("", primary([
      { name: "Highest preload", sym: "F<sub>max</sub>", value: fmt(F * R), unit: "N", note: `slide force there ${fmt(r.slide * R)} N` },
      { name: "Force to slide the clamp", sym: "F<sub>slide</sub>", value: fmt(r.slide), unit: "N", note: "μ × total contact force" },
      r.squash !== null ? (r.squash < 0.5 * (shape === "round" ? p.d_in : p.height)
        ? { name: "Tube squash", sym: "δ", value: fmt(r.squash * 1000, 3), unit: "mm", note: `closing between the clamped faces; ${fmt(r.squash * R * 1000, 3)} mm at F<sub>max</sub>` }
        : { name: "Tube squash", sym: "δ", value: "—", note: `far past failure, the tube would collapse; ${fmt(r.squash * R * 1000, 3)} mm at F<sub>max</sub>` })
        : { name: "Plug pressure", value: fmt(r.modes.find((m) => m.key === "plug").pressure / 1e6), unit: "MPa" },
    ])) +
    (notes.length ? `<div class="isec">${msgs(notes)}</div>` : "") +
    (fpf ? isec("Critical ply", secondary([{ name: "First-ply failure of the wall", value: `Layer ${fpf.ply.layer}`, text: true, note: `${plyTxt(fpf.ply)}. ${cap(modeTxt(fpf.ply.mode))} by ${CRIT_NAMES[fpf.ply.criterion]}, R = ${fmtR(fpf.R)}` }])) : "") +
    isec("Grip", secondary([
      { name: "Clamp line load on each face", sym: "q", value: fmt(r.q / 1000, 4), unit: "N/mm", note: "F / contact length" },
      { name: "Total contact force on the tube", value: fmt(r.normal, 4), unit: "N", note: shape === "round" && p.contact === "even" ? "8F/π: a fitted C presses at an angle round the tube, so the contact force exceeds F (wedge effect)" : "2F: F on each clamp half" },
      r.torque_arm ? { name: "Torque to turn the clamp round the tube", value: fmt(r.slide * r.torque_arm, 4), unit: "N·m" } : null,
    ]));

  const modesTable = '<div class="tw"><table class="tbl"><thead><tr><th>Failure mode</th><th class="n">R</th><th class="n">Preload at failure (N)</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
    r.modes.map((m) => `<tr${m === gov ? ' class="gov"' : ""}><td><b>${m.name}</b></td><td class="n${m.R < 1 ? " fail" : ""}">${fmtR(m.R)}</td><td class="n">${fmt(F * m.R, 4)}</td>` +
      `<td>${m.R < 1 ? chip("bad", "Fail") : m === gov ? chip("info", "Governs") : chip("good", "Pass")}</td><td class="wrap" style="min-width:320px">${detail(m)}</td></tr>`).join("") + "</tbody></table></div>";
  $("clampDetail").innerHTML = tabsHTML("clamp", [
    { id: "modes", title: "Failure modes", flush: true, html: modesTable },
    assumeTab("clamp", `<p class="hint" style="max-width:100ch">${plug ? "With a plug, the wall cannot bend or buckle: it is squeezed between clamp and plug. The plug is taken to be stiff enough to carry the whole clamp load; a soft foam plug lets the wall bend, so check the hollow case too." :
        "The quarter cross-section is solved as a 2D ring frame with the wall's hoop stiffnesses A₂₂ and D₂₂ (per metre of tube), loaded by the clamp line load F/L on each face. Every point of the ring is checked for first-ply failure by maximum stress, Tsai-Wu and Hashin. The tube is taken as clamped uniformly along the contact length; the stiffening from the tube beyond the clamp ends is ignored, which is conservative."}` +
      ` Even contact on a round tube is a pressure that falls off as the cosine of the angle from the top. Concentrated contact is a line load at the crown (round). On a rectangular tube a rigid clamp touches first at the face centre if the face bulges out, or near the corners if it dishes in; both are solved and the worse is used. ` +
      `The slide force is μ times the contact force: it is the static friction limit with no other loads on the clamp, and preload scatter and creep of the composite under the clamp will reduce it in service.</p>`, res.log),
  ]);
}
