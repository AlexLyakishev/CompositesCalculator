"use strict";
// Simple mode: pick a part, define one load case, and read how far it deforms and whether it holds.
// It uses the same calculations as Full mode and only combines and words them for a reader new to composites:
//   beam   bending stiffness, torsion, wall bending and failure, with every load acting on the wall together
//   clamp  the Tube Clamp ring model (bridge _clamp), plus a slip check against a force along the tube
//   bolt   the Bolted Joint laminate strengths (bridge _bolt) and joint formulas (calc.js boltJoint)

const SIMPLE_HOW = {
  FT: "the fibres snap in tension",
  FC: "the fibres crush or kink in compression",
  MT: "the resin between the fibres cracks as it is pulled apart",
  MC: "the resin between the fibres crushes",
  S: "the resin between the fibres cracks in shear",
};
const SIMPLE_CASES = {
  beam: "the tube as a beam: bending, with optional twisting and pulling",
  clamp: "two clamp halves screwed together around the tube",
  bolt: "one bolt or pin through a drilled hole in the wall",
};
const SIMPLE_CASE_KEY = "composites_calculator_simple_case";
let simpleCase = "beam";

// ---------- wording ----------
// fibre direction of a layer in words, for someone who has not met ply angles before
function plainAngle(a) {
  const f = foldAngle(a);
  if (Math.abs(f) < 0.5) return "fibres along the tube";
  if (Math.abs(Math.abs(f) - 90) < 0.5) return "fibres around the tube";
  return `fibres at ${angleText(f)} to the tube axis`;
}
const plainMode = (mode) => SIMPLE_HOW[String(mode || "").split("_").pop()] || "the combined stresses exceed the layer's strength";
const plainMaterial = (name) => String(name || "").replace(/_/g, " ");
// a layer as the part list shows it (a woven ply is one layer, though calculated as four), from a layer number
function plainLayer(num) {
  const lam = state.lam, plies = (state.rows || []).filter((r) => !r.core);
  const pi = plies.findIndex((r) => r.members.some((m) => m.num === num));
  const layer = lam && lam.layers.find((l) => !l.is_core && l.num === num);
  const lead = pi >= 0 ? plies[pi].members.find((m) => m.role === 0) || plies[pi].members[0] : null;
  const kind = lead && plies[pi].woven ? `woven, fibres at ${angleText(lead.orientation)} and ${angleText(lead.orientation - 90)} to the tube axis`
    : layer ? plainAngle(layer.orientation) : "";
  return `${pi >= 0 ? `layer ${pi + 1} of ${plies.length}` : `layer ${num}`}, counted from the outside${kind ? ` (${kind})` : ""}`;
}
// verdict shared by the three cases: Holds / Marginal / Fails, the factor, and what gives way first
function simpleVerdict(R, scaleTxt, first) {
  const tone = R < 1 ? "bad" : R < 1.5 ? "warn" : "good";
  const what = R < 1 ? `It fails at about ${fmt(R * 100, 3)} % of ${scaleTxt}.` : `It can take about ${fmtR(R)} times ${scaleTxt} before it fails.`;
  return verdict({ tone, word: R < 1 ? "Fails" : R < 1.5 ? "Marginal" : "Holds", R,
    tip: "Safety factor: how many times the load could be multiplied before the part fails.",
    text: `${what}<br><b>First to fail:</b> ${first}` });
}
const MARGINAL = "This holds on paper, but composite parts are normally designed to a safety factor of at least 1.5 to 2: their strength scatters more than a metal's and drops after impacts or with holes.";

// ---------- the part ----------
// inside extents of the section along x2 and x3 [m]
function sectionExtents(sec) {
  if (!sec) return null;
  if (sec.type === "circ") return [sec.d_in, sec.d_in];
  if (sec.type === "rect") return [sec.width, sec.height];
  const pts = parsePoints(sec.csv);
  if (!pts) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
function shapeText(sec) {
  const e = sectionExtents(sec);
  if (!e) return "—";
  if (sec.type === "circ") return `Round, ${fmt(sec.d_in * 1000)} mm inside diameter`;
  return `${sec.type === "rect" ? "Rectangular" : "Box section"}, ${fmt(e[0] * 1000)} × ${fmt(e[1] * 1000)} mm inside`;
}
function partHTML(lam, sec, perimeter) {
  const rows = state.rows || [];
  const seq = rows.map((r) => {
    if (r.core) return "core";
    const lead = r.members.find((m) => m.role === 0) || r.members[0];
    return r.woven ? `${angleText(lead.orientation)}/${angleText(lead.orientation - 90)} woven` : angleText(lead.orientation);
  });
  const nLayers = rows.length ? rows.filter((r) => !r.core).length : lam.layers.filter((l) => !l.is_core).length;
  const per = perimeter || (sec && sec.type === "circ" ? Math.PI * (sec.d_in + lam.h_total) : sec && sec.type === "rect" ? 2 * (sec.width + sec.height + 2 * lam.h_total) : null);
  return secondary([
    { name: "Shape", value: esc(shapeText(sec)), text: true },
    { name: "Wall", value: `${fmt(lam.h_total * 1000)}`, unit: `mm, ${nLayers} layer${nLayers === 1 ? "" : "s"}` },
    { name: "Material", value: esc(plainMaterial($("baseMat").value)), text: true },
    seq.length ? { name: "Layers, outside to inside", value: esc(seq.join(" · ")), text: true, note: "0° fibres run along the tube, 90° around it" } : null,
    per ? { name: "Mass", value: fmt(lam.areal_mass * per * 1000), unit: "g/m" } : null,
  ]);
}

// ---------- beam ----------
// the ways the tube can be bent, each with the stiffness and the key extremeFibre() understands
function simpleDirections() {
  const b = state.bend, s = state.sec;
  if (!b || !s) return [];
  if (b.type === "circ") return [{ key: "circ", label: "Any direction (round tube)", EI: b.Dx }];
  if (b.type === "rect") return [{ key: "rect", label: `Pushing on the ${fmt(s.width * 1000)} mm faces`, EI: b.EI }];
  const e = sectionExtents(s);
  if (!e) return [];
  const flat = b.EI_2 <= b.EI_3;
  return [
    { key: "EI_2", label: `Pushing on the ${fmt(e[0] * 1000)} mm face (${flat ? "bends flat, the softer way" : "the stiffer way"})`, EI: b.EI_2 },
    { key: "EI_3", label: `Pushing on the ${fmt(e[1] * 1000)} mm face (${flat ? "bends on edge, the stiffer way" : "the softer way"})`, EI: b.EI_3 },
  ];
}
// torsion needs a closed outline; a rectangle goes through the arbitrary-section function, as in the Tube module
function torsionSection(sec) {
  if (sec.type !== "rect") return sec;
  return { type: "arb", surface: "inner", csv: "x2,x3\n" + rectCorners(sec.width, sec.height).map((p) => p.join(",")).join("\n") };
}
function beamInputs() {
  const support = $("sSupport").value, spread = $("sLoadType").value === "udl";
  const opt = (id) => { const v = $(id).value.trim(); return v === "" ? 0 : numVal(id); };
  const a = $("sA").value.trim() === "" ? NaN : numVal("sA") / 1000;
  return { support, spread, kind: `${support}_${spread ? "udl" : "point"}`, L: numVal("sL") / 1000, W: numVal("sF"), a, T: opt("sT"), P: opt("sP") };
}
function simpleBeam(ctx) {
  const { sec, spec } = ctx;
  const { support, spread, kind, L, W, a, T, P } = beamInputs();
  const hasA = kind === "cant_point" || kind === "ss_point";
  $("sFLabel").textContent = spread ? "Total load, spread evenly" : !hasA ? "Load at the middle" : "Point load";
  $("sAWrap").hidden = !hasA;
  $("sALabel").textContent = support === "cant" ? "Position from the fixed end" : "Position from the left support";
  $("sA").placeholder = support === "cant" ? "free end" : "middle";

  const dirs = simpleDirections();
  if (!dirs.length) return { error: "This part has no bending stiffness. Check its tube section in Full mode." };
  const dsel = $("sDir"), prev = dsel.value;
  dsel.innerHTML = dirs.map((d) => `<option value="${d.key}">${esc(d.label)}</option>`).join("");
  dsel.value = dirs.some((d) => d.key === prev) ? prev : dirs[0].key;
  $("sDirWrap").hidden = dirs.length < 2;
  const dir = dirs.find((d) => d.key === dsel.value);
  if (!(L > 0) || ![W, T, P].every(Number.isFinite)) return { error: "Enter a length greater than zero and a number for each load." };
  if (hasA && Number.isFinite(a) && (a < 0 || a > L)) return { error: "The load position must be between 0 and the length." };

  // bending: closed-form beam case, then the wall at the point furthest from the bending axis
  const F = spread ? W / L : W;  // N/m for a spread load, N for a point load
  const beam = beamSolve(kind, dir.EI, L, F, a);
  const kappa = Math.abs(beam.Mmax) / dir.EI, c = extremeFibre(dir.key);
  let N1b = 0, M1b = 0;
  if (kappa > 0 && c !== null) {
    const w = call("wall_bending", { layup: spec, strain: kappa * c, curvature: kappa });
    if (!w.ok) return { error: "Could not check the wall in bending: " + w.error };
    N1b = w.result.N1; M1b = w.result.M1;
  }
  // torque and axial force: shear flow and axial load spread round the wall
  const tr = call("torsion", { layup: spec, section: torsionSection(sec), torque: T, axial: P });
  if (!tr.ok) return { error: "Could not check the tube in torsion: " + tr.error };
  const tor = tr.result, Na = tor.wall_N[0], q = tor.wall_N[2];

  // every load together, on the tension and the compression side of the bend
  let low = null;
  const bending = N1b !== 0 || M1b !== 0;
  for (const [side, s] of bending ? [["tension", 1], ["compression", -1]] : [[null, 1]]) {
    const N = [s * N1b + Na, 0, q], M = [s * M1b, 0, 0];
    if (N.every((v) => v === 0) && M.every((v) => v === 0)) continue;
    const f = call("failure", { layup: spec, N, M });
    if (!f.ok) return { error: "Could not check the wall: " + f.error };
    for (const [k, v] of Object.entries(f.result.summary)) if (v && (!low || v.R < low.R)) low = { ...v, criterion: k, side };
  }

  const any = W !== 0;
  const diagram = beamSVG(kind, L, beam.a, beam.ys, beam.im).replace(/<g class="[^"]*" id="beamLoad">/, "<g>");
  const plot = any ? beamPlot(L, beam.ys, beam.im, beam.a, hasA) : '<p class="hint c">No bending load, so the tube stays straight.</p>';
  const dmax = Math.abs(beam.dmax), twist = (tor.twist_rate * L * 180) / Math.PI, dL = tor.axial_strain * L;
  const notes = [];
  if (P < 0) notes.push(noteHTML("warn", "Buckling is not checked", "Under compression a long or thin-walled tube can buckle sideways, or its wall can wrinkle, at a load well below the one that breaks the material. Check buckling separately."));
  if (any && dmax > 0.1 * L) notes.push(noteHTML("warn", "Very large deflection", "The deflection is over a tenth of the length. Small-deflection beam theory underestimates it, and the part may be outside its useful range."));

  let head = verdict({ tone: "none", word: "No load", text: "Enter a load to check the part." });
  if (low) {
    head = simpleVerdict(low.R, "these loads", `${cap(plainMode(low.mode))}. ${cap(plainLayer(low.layer))}, on its ${low.location === "Top" ? "outer" : "inner"} face${low.side ? `, on the ${low.side} side of the bend` : ""}.`);
    if (low.R >= 1 && low.R < 1.5) notes.unshift(msgHTML("warn", MARGINAL));
  }
  const from = { cant: "from the fixed end", ss: "from the left support", ff: "from the left end" }[support];
  const results = head + (notes.length ? `<div class="isec">${msgs(notes)}</div>` : "") +
    isec("Deformation", primary([
      { name: "Largest deflection", sym: "δ", value: fmt(dmax * 1000), unit: "mm", note: any ? `${fmt(beam.xmax * 1000)} mm ${from} · length / deflection = ${dmax ? fmt(L / dmax, 3) : "—"}` : "no bending load" },
      T ? { name: "Twist over the length", sym: "φ", value: fmt(Math.abs(twist)), unit: "°" } : null,
      P ? { name: P > 0 ? "Stretch over the length" : "Shortening over the length", sym: "ΔL", value: fmt(Math.abs(dL) * 1000), unit: "mm" } : null,
    ])) +
    (low ? isec("Strength", primary([
      { name: "Safety factor", sym: "R", value: fmtR(low.R), note: "lowest of three standard composite failure criteria" },
      any ? { name: spread ? "Total load at first failure" : "Load at first failure", value: `${fmt(Math.abs(W) * low.R)} N`, note: T || P ? "with the torque and axial force scaled up by the same factor" : "" } : null,
    ])) : "") +
    isec("Beam", secondary([
      { name: "Largest bending moment", sym: "M", value: fmt(Math.abs(beam.Mmax), 4), unit: "N·m" },
      !spread && any && dmax ? { name: "Stiffness at the largest deflection", sym: "P/δ", value: fmt(Math.abs(W) / (dmax * 1000)), unit: "N/mm" } : null,
      { name: "Bending stiffness", sym: "EI", value: fmt(dir.EI, 4), unit: "N·m²" },
      { name: "Torsional stiffness", sym: "GJ", value: fmt(tor.GJ_eq, 4), unit: "N·m²" },
    ]));
  return { diagram, plot, results, perimeter: tor.perimeter, help: BEAM_HELP };
}

// ---------- clamp ----------
// the tube's outside shape as the clamp sees it: the preset's clamp size, or the round or rectangular tube section
function clampGeometry(sec) {
  const p = PRESETS.find((x) => x.id === $("preset").value);
  if (p && p.clamp) return { shape: "rect", width: p.clamp.width, height: p.clamp.height, radius: p.clamp.radius };
  if (sec.type === "circ") return { shape: "round", d_in: sec.d_in };
  if (sec.type === "rect") return { shape: "rect", width: sec.width, height: sec.height, radius: 0 };
  return null;
}
function clampInputs(sec) {
  const g = clampGeometry(sec);
  if (!g) return null;
  if (g.shape === "rect") {
    const wideFirst = g.width >= g.height, narrow = $("sCFaces").value === "narrow";
    // the clamped faces are the "width"; gripping the other pair swaps the two sides
    if (wideFirst === narrow) [g.width, g.height] = [g.height, g.width];
  }
  const plug = $("sCPlug").value === "1";
  return { ...g, plug, contact: $("sCFit").value, length: numVal("sCL") / 1000, preload: numVal("sCF"), friction: parseFloat($("sCMu").value),
    plug_strength: numVal("sCPlugS") * 1e6, pull: $("sCS").value.trim() === "" ? 0 : numVal("sCS") };
}
const CLAMP_WHAT = {
  fpf: (m) => `the tube wall cracks where the clamp bends it most, at the ${m.ply.region}: ${plainMode(m.ply.mode)} in ${plainLayer(m.ply.layer)}, on its ${m.ply.location.toLowerCase()} face.`,
  buckle: () => "the tube wall buckles beside the clamp, squeezed around the tube.",
  crush: () => "the wall is crushed through its thickness between the clamp and the plug.",
  plug: () => "the plug inside the tube is crushed.",
  slip: () => "the clamp slides along the tube.",
};
function simpleClamp(ctx) {
  const { lam, sec, spec } = ctx;
  const g0 = clampGeometry(sec);
  $("sCFacesWrap").hidden = !g0 || g0.shape !== "rect";
  $("sCPlugWrap").hidden = $("sCPlug").value !== "1";
  const p = clampInputs(sec);
  if (!p) return { error: "A clamp check needs a round or rectangular tube. Choose such a part, or set the tube size in Full mode." };
  if (!(p.length > 0) || !(p.preload > 0)) return { error: "Enter a clamp length and a preload greater than zero." };
  if (!(p.pull >= 0)) return { error: "Enter the force on the clamp as zero or a positive number." };
  if (p.plug && !(p.plug_strength > 0)) return { error: "Enter the plug's crushing strength." };
  const res = call("clamp", { layup: spec, ...p });
  if (!res.ok) return { error: res.error };
  const r = res.result, F = p.preload;
  const modes = r.modes.slice();
  if (p.pull > 0) modes.push({ key: "slip", name: "Clamp slips", R: r.slide / p.pull });
  if (!modes.length) return { error: "No part of the wall is loaded." };
  const gov = modes.reduce((a, m) => (m.R < a.R ? m : a)), wall = r.modes.length ? r.modes.reduce((a, m) => (m.R < a.R ? m : a)) : null;
  const scaleTxt = gov.key === "slip" ? "the force on the clamp" : "this preload";
  const notes = [];
  if (gov.R >= 1 && gov.R < 1.5) notes.push(msgHTML("warn", MARGINAL));
  if (wall && wall.R < 1) notes.push(msgHTML("bad", `Keep the screw preload below about ${fmt(F * wall.R)} N.`));
  if (p.pull > 0 && r.slide < p.pull && wall && wall.R > 1) notes.push(msgHTML("info", `More preload helps the grip: up to ${fmt(F * wall.R)} N preload the wall holds and the clamp grips about ${fmt(r.slide * wall.R)} N.`));
  if (r.has_core) notes.push(noteHTML("warn", "Core not checked", "The whole sandwich is taken as the tube wall. Crushing of the core under the clamp is not checked."));
  const squash = r.squash !== null && r.squash < 0.5 * (p.shape === "round" ? p.d_in : p.height) ? r.squash : null;
  const results = simpleVerdict(gov.R, scaleTxt, cap(CLAMP_WHAT[gov.key](gov))) + (notes.length ? `<div class="isec">${msgs(notes)}</div>` : "") +
    isec("Deformation", primary([
      r.squash !== null ? { name: "Tube squashed by", sym: "δ", value: squash === null ? "—" : fmt(squash * 1000, 3), unit: squash === null ? "" : "mm", note: squash === null ? "far past failure: the tube would collapse" : "closing between the clamped faces" }
        : { name: "Tube squash", value: "≈ 0", text: true, note: "the plug stops the wall from bending" },
    ])) +
    isec("Strength", primary([
      wall ? { name: "Highest preload the wall takes", sym: "F<sub>max</sub>", value: fmt(F * wall.R), unit: "N" } : null,
      { name: "Force to slide the clamp", sym: "F<sub>slide</sub>", value: fmt(r.slide), unit: "N", note: "friction × contact force, with no other load on the clamp" },
      r.torque_arm ? { name: "Torque to turn it round the tube", value: fmt(r.slide * r.torque_arm, 4), unit: "N·m" } : null,
    ]));
  return { diagram: clampSVG(p.shape, lam.h_total, p, p.plug, p.contact, p.length), results, help: CLAMP_HELP };
}

// ---------- bolt ----------
function boltInputs() {
  const ang = $("sBAng").value === "custom" ? numVal("sBAngC") : parseFloat($("sBAng").value);
  return { d: numVal("sBD"), e: numVal("sBE"), w: numVal("sBW"), Ptot: numVal("sBP"), ang, walls: parseFloat($("sBWalls").value),
    kFit: parseFloat($("sBFit").value), kCon: parseFloat($("sBThr").value), kCl: parseFloat($("sBCl").value) };
}
const BOLT_WHAT = {
  br: "the bolt crushes the edge of the hole, which stretches into a slot (bearing). This is gradual, and the safest way for a joint to fail.",
  nt: "the wall snaps across the hole, through the material beside it (net-tension). This is sudden: a wider wall or a smaller hole helps.",
  so: "a strip of wall between the hole and the end shears out (shear-out). This is sudden: move the hole further from the end.",
};
function simpleBolt(ctx) {
  const { spec } = ctx;
  const i = boltInputs(), P = i.Ptot / i.walls, along = i.ang === 0, around = i.ang === 90;
  $("sBAngCWrap").hidden = $("sBAng").value !== "custom";
  // the free edge the load pulls towards is the tube's end, or the edge of the face when pulling around the tube
  $("sBELabel").textContent = along ? "Hole centre to the end of the tube" : around ? "Hole centre to the edge of the face" : "Hole centre to the free edge, in the load direction";
  $("sBWLabel").textContent = along ? "Wall width beside the hole" : around ? "Wall length beside the hole, along the tube" : "Wall width across the load";
  if (!Number.isFinite(i.ang)) return { error: "Enter the load angle in degrees." };
  if (![i.d, i.e, i.w, i.Ptot].every(Number.isFinite) || i.d <= 0) return { error: "Enter a number for every field and a diameter above zero." };
  if (i.e <= i.d / 2) return { error: "The hole is closer to the end than its radius: it breaks the edge." };
  if (i.w <= i.d) return { error: "The wall width must be larger than the hole." };
  if (i.Ptot < 0) return { error: "Enter the load as a positive number." };
  const res = call("bolt", { layup: spec, angle: i.ang });
  if (!res.ok) return { error: res.error };
  const j = boltJoint(res.result, { d: i.d, e: i.e, w: i.w, P, kFit: i.kFit, kCon: i.kCon, kCl: i.kCl, C: 0.25, kBr: 1.2, refIn: null });
  const notes = [];
  if (j.R !== null && j.R >= 1 && j.R < 1.5) notes.push(msgHTML("warn", MARGINAL));
  if (i.e / i.d < 3) notes.push(noteHTML("warn", `Hole close to the end: ${fmt(i.e / i.d, 3)} diameters`, "Below 3 diameters the material between hole and end tends to shear out or split. Aim for at least 3."));
  if (i.w / i.d < 4) notes.push(noteHTML("warn", `Narrow wall: ${fmt(i.w / i.d, 3)} diameters wide`, "Below 4 diameters the wall tends to snap across the hole. Aim for 4 to 5 so the gradual bearing failure governs."));
  if (i.kCon < 1 && i.kCl === 1) notes.push(noteHTML("warn", "Threads bear on an unclamped wall", "Under vibration the thread crests saw into the hole. Use a bolt with a plain shank through the wall where possible."));
  if (res.result.has_core) notes.push(noteHTML("warn", "Core not checked", "The bolt is taken to bear on the face skins only; core crushing is not checked. Use a potted insert or solid core around the bolt."));
  const head = j.R === null ? verdict({ tone: "none", word: "No load", text: "Enter a load to check the joint." }) : simpleVerdict(j.R, "this load", cap(BOLT_WHAT[j.gov.key]));
  const results = head + (notes.length ? `<div class="isec">${msgs(notes)}</div>` : "") +
    isec("Strength", primary([
      { name: "Joint strength", sym: "P<sub>max</sub>", value: fmt(j.gov.P * i.walls), unit: "N", note: i.walls > 1 ? `${fmt(j.gov.P)} N per wall, two walls` : "" },
      P > 0 ? { name: "Bearing stress on the hole", sym: "σ<sub>br</sub>", value: fmt(P / (i.d * j.t)), unit: "MPa", note: `allowable ${fmt(j.sBr)} MPa on a ${fmt(j.t)} mm wall` } : null,
    ])) +
    isec("Each way it can fail", secondary(j.modes.map((m) => ({ name: m.name, value: fmt(m.P * i.walls), unit: "N", note: m === j.gov ? "lowest: governs" : "" })))) +
    isec("Deformation", `<p class="hint" style="margin:0">Not calculated for a bolted joint. Before it fails in bearing the hole stretches gradually, which you would see as play in the joint.</p>`);
  const caption = along ? "Load pulls along the tube, towards its end" : around ? "Load pulls around the tube" : `Load pulls at ${fmt(i.ang)}° to the tube axis, counter-clockwise`;
  return { diagram: boltSVG(i.d, i.e, i.w, i.ang, P, { axis: "tube axis (0° fibres)", caption }), results, help: BOLT_HELP };
}

// ---------- render ----------
function renderSimple() {
  if (!pyApi) return;
  document.querySelectorAll("#sCase button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.case === simpleCase)));
  for (const k of Object.keys(SIMPLE_CASES)) $("sc-" + k).hidden = k !== simpleCase;
  $("sCaseMeta").textContent = SIMPLE_CASES[simpleCase];
  $("sPlotPanel").hidden = simpleCase !== "beam";

  // keep the part picker in step with the preset chosen anywhere in the app
  const preset = PRESETS.find((p) => p.id === $("preset").value);
  $("sPreset").value = preset ? preset.id : "";
  $("sPartNote").innerHTML = preset
    ? esc(preset.note)
    : 'This is the layup and tube set up in Full mode. Change them there: <button class="btn sm" type="button" data-full="tube">Edit in Full mode</button>';

  const lam = state.lam, sec = state.sec, spec = layupSpec(), out = $("iSimple");
  $("sSection").innerHTML = sec ? $("secPreview").innerHTML : "";
  const stop = (msg) => {
    $("sPart").innerHTML = lam ? partHTML(lam, sec, null) : "";
    $("sDiagram").innerHTML = ""; $("sPlot").innerHTML = "";
    out.innerHTML = verdict({ tone: "none", word: "Not checked", text: esc(msg) });
  };
  if (!lam || !sec || !spec) { stop("This part cannot be analysed as it is set up. Check its layup and tube section in Full mode."); return; }

  const ctx = { lam, sec, spec };
  const r = simpleCase === "clamp" ? simpleClamp(ctx) : simpleCase === "bolt" ? simpleBolt(ctx) : simpleBeam(ctx);
  if (r.error) { stop(r.error); return; }
  $("sPart").innerHTML = partHTML(lam, sec, r.perimeter);
  $("sDiagram").innerHTML = r.diagram;
  $("sPlot").innerHTML = r.plot || "";
  const lamNote = lam.symmetric ? "" : `<div class="isec">${msgs([noteHTML("warn", "Unsymmetric layup", "The layup is not mirrored about its middle, which these formulas assume. Treat the results with care.")])}</div>`;
  out.innerHTML = r.results + lamNote +
    `<div class="isec">${more("simple-help-" + simpleCase, "How to read this", r.help)}` +
    `<button class="btn sm" type="button" id="sToFull" style="margin-top:10px">Open this load case in Full mode</button></div>`;
}

const SF_HELP = '<p class="hint" style="margin-top:0"><b>Safety factor.</b> How many times the load could be multiplied before the part fails. Below 1 it fails under this load. Composite parts are normally designed to at least 1.5 to 2: their strength scatters more than a metal\'s and drops after impacts, with holes and with heat.</p>';
const BEAM_HELP = SF_HELP +
  '<p class="hint"><b>Why layers?</b> A composite wall is a stack of thin layers of fibres held in resin. Each layer is very strong and stiff along its fibres and much weaker across them, where only the resin holds it, so the wall is checked layer by layer and the first layer to fail sets the result (first-ply failure), by the worst of three standard criteria.</p>' +
  '<p class="hint"><b>Is first-ply failure the end?</b> Not always: the first failure is often a crack in the resin and the part may still carry load. But those cracks let fatigue and moisture in, so designs normally stay below it.</p>' +
  '<p class="hint"><b>What is assumed.</b> The bending, torque and axial force act together at the most loaded section. The tube is a straight beam with small deflections. Not checked: buckling, crushing at the supports or under the load, holes and joints, fatigue, temperature.</p>';
const CLAMP_HELP = SF_HELP +
  '<p class="hint"><b>What is checked.</b> The clamp squeezes the tube, bending its wall around the cross-section. The wall is checked layer by layer for the first crack, and for buckling beside the clamp; with a plug, for crushing of the wall and the plug instead. The clamp slips when the force along the tube exceeds friction × contact force.</p>' +
  '<p class="hint"><b>What is assumed.</b> The tube beyond the clamp, which stiffens it, is ignored, so this is on the safe side. Screw preload scatters by about ±25 % for a given torque, and composites creep under a clamp, so the grip drops in service.</p>';
const BOLT_HELP = SF_HELP +
  '<p class="hint"><b>Three ways to fail.</b> A bolted joint fails the weakest of three ways: the hole crushes and stretches (bearing, gradual), the wall snaps beside the hole (net-tension, sudden), or the strip to the end shears out (shear-out, sudden). Keep the hole 3 or more diameters from the end and the wall 4 or more diameters wide so bearing governs.</p>' +
  '<p class="hint"><b>What is assumed.</b> One bolt, the wall held square to it (double shear). In single shear the bolt tilts and the strength drops by 10 to 20 %. Fatigue, hot/wet conditions and bolt failure are not checked; test critical joints.</p>';

// ---------- wiring ----------
(function wireSimple() {
  try { const c = localStorage.getItem(SIMPLE_CASE_KEY); if (SIMPLE_CASES[c]) simpleCase = c; } catch (e) { /* default case */ }
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(renderSimple, 200); };
  document.querySelectorAll(".slive").forEach((el) => el.addEventListener("input", later));
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input.slive")) { e.preventDefault(); clearTimeout(t); renderSimple(); } });
  document.querySelectorAll("#sCase button").forEach((b) => b.addEventListener("click", () => {
    simpleCase = b.dataset.case;
    try { localStorage.setItem(SIMPLE_CASE_KEY, simpleCase); } catch (e) { /* this visit only */ }
    renderSimple();
  }));
  $("sPreset").insertAdjacentHTML("beforeend", PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join(""));
  $("sPreset").addEventListener("change", (e) => { if (e.target.value) applyPreset(e.target.value); else { clearPreset(); renderSimple(); } });
})();

// carry the simple load case over to the matching Full module; returns that module's name
function simpleToFull() {
  if (simpleCase === "clamp") {
    const p = state.sec && clampInputs(state.sec);
    if (p) {
      $("cShape").value = p.shape;
      if (p.shape === "round") $("cD").value = trim6(p.d_in * 1000);
      else { $("cW").value = trim6(p.width * 1000); $("cH").value = trim6(p.height * 1000); $("cR").value = trim6(p.radius * 1000); }
      if (p.preload > 0) $("cF").value = trim6(p.preload);
      if (p.length > 0) $("cL").value = trim6(p.length * 1000);
      $("cMu").value = p.friction; $("cContact").value = p.contact; $("cPlug").value = p.plug ? "1" : "0";
      if (p.plug_strength > 0) $("cPlugS").value = trim6(p.plug_strength / 1e6);
    }
    return "clamp";
  }
  if (simpleCase === "bolt") {
    const i = boltInputs();
    [["bD", i.d], ["bE", i.e], ["bWd", i.w], ["bLoad", i.Ptot / i.walls], ["bAng", i.ang]].forEach(([id, v]) => { if (Number.isFinite(v)) $(id).value = trim6(v); });
    $("bFit").value = $("sBFit").value; $("bCon").value = $("sBThr").value; $("bClamp").value = $("sBCl").value;
    return "bolt";
  }
  const i = beamInputs();
  $("bCase").value = i.kind;
  if (i.L > 0) $("bL").value = trim6(i.L * 1000);
  if (i.spread) { if (i.L > 0 && Number.isFinite(i.W)) $("bW").value = trim6(i.W / i.L); }
  else if (Number.isFinite(i.W)) $("bP").value = trim6(i.W);
  $("bA").value = Number.isFinite(i.a) ? trim6(i.a * 1000) : "";
  $("torque").value = trim6(i.T); $("axial").value = trim6(i.P);
  if ([...$("eiSrc").options].some((o) => o.value === $("sDir").value)) $("eiSrc").value = $("sDir").value;
  return "beam";
}
