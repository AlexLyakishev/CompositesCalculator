"use strict";
// Layup definition shared by every analysis module: the sequence notation, stacking, per-ply edits,
// the ply table, the through-thickness cross-section and the off-the-shelf presets.

const LIB_URL = "composites_calculator_lib.py";
const DB_URL = "materials_database.csv";
const BRIDGE_URL = "py/bridge.py";
const CUSTOM_KEY = "composites_calculator_custom_materials";

// UI state. overrides: {layer number: {material, thickness [m], orientation}} exactly as before.
const state = { mode: "so", overrides: {}, materials: [], lam: null, layers: null, rows: [], selRow: null, selTok: null, bend: null, tor: null };
let pyApi = null;
function call(name, payload) { return JSON.parse(pyApi(name, JSON.stringify(payload))); }

// ---------- materials ----------
function loadCustom() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (e) { return []; } }
function saveCustom(list) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* stays for this visit only */ } }
function matByName(n) { return state.materials.find((m) => m.name === n); }
function matOptions(sel) { return state.materials.map((m) => `<option value="${esc(m.name)}"${m.name === sel ? " selected" : ""}>${esc(m.name)}</option>`).join(""); }
function applyMaterials(res, first) {
  state.materials = res.materials;
  const base = $("baseMat");
  const keep = first ? "Graphite_Epoxy_T300_N5208" : base.value;
  base.innerHTML = matOptions(matByName(keep) ? keep : state.materials[0].name);
  renderMaterials();
}
function refreshMaterials(custom) {
  saveCustom(custom);
  const r = call("materials", { csv: null, custom });
  if (r.ok) applyMaterials(r.result, false);
  // drop per-layer edits that point at a material which no longer exists
  for (const ov of Object.values(state.overrides)) if (ov.material && !matByName(ov.material)) delete ov.material;
  recalc();
}

// ---------- layup spec ----------
function tokens() { return $("seq").value.split("/").map((t) => t.trim()).filter(Boolean); }
function layupSpec() {
  const toks = tokens();
  if (!toks.length) return null;
  return { template: toks.join("/") + "/" + state.mode, material: $("baseMat").value, overrides: state.overrides };
}
const MODE_HINT = {
  s: "<b>Symmetric</b>: the sequence is followed by its mirror image, 0/45 becomes 0/45/45/0. A core entered last appears twice.",
  so: "<b>Symmetric, odd</b>: mirrored about the last entry, which is not repeated, 0/45/zc1 becomes 0/45/core/45/0.",
  t: "<b>Total</b>: the sequence is the whole laminate, exactly as typed.",
};
function setMode(m) {
  state.mode = m;
  document.querySelectorAll("#mode button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
  $("modeTip").dataset.tip = MODE_HINT[m];
}
function normaliseSeq() {
  // a trailing s / so / t typed into the sequence selects the stacking instead
  const toks = tokens();
  const last = (toks[toks.length - 1] || "").toLowerCase();
  if (["s", "so", "t"].includes(last)) { toks.pop(); $("seq").value = toks.join("/"); setMode(last); }
}
function layupWarnings(layers) {
  const out = [], toks = tokens(), last = (toks[toks.length - 1] || "").toLowerCase();
  if (state.mode === "so" && last.startsWith("+-")) {
    out.push("The last entry is a woven ply. “Symmetric, odd” mirrors about one of its four sub-layers rather than the whole ply, " +
      "so the mirrored half gets a woven ply with only three sub-layers. Use Symmetric to repeat the whole woven ply, or Total and type the full sequence.");
  }
  const cores = layers.filter((l) => l.is_core).length;
  if (cores > 1) {
    out.push(`This layup has ${cores} core layers.` + (state.mode === "s" && last.startsWith("zc")
      ? " “Symmetric” repeats a core entered last, giving two cores back to back; use “Symmetric, odd” for a single core in the middle."
      : " Check that this is what you intend; a sandwich normally has one core."));
  }
  return out;
}

// ---------- sequence entry behind each layer (follows layup_create's expansion) ----------
function expandTokens(toks, mode) {
  const out = [];
  toks.forEach((t, i) => { const n = t.toLowerCase().startsWith("+-") ? 4 : 1; for (let k = 0; k < n; k++) out.push({ tok: i, mirror: false }); });
  const back = out.slice().reverse().map((e) => ({ tok: e.tok, mirror: true }));
  if (mode === "so") return out.concat(back.slice(1));
  if (mode === "s") return out.concat(back);
  return out;
}
// table rows: one per layer, except that the sub-layers of one woven ply share a row
function plyRows(layers) {
  const map = expandTokens(tokens(), state.mode), rows = [], n = layers.length;
  for (let i = 0; i < n; ) {
    const l = layers[i], start = i++;
    const woven = !l.is_core && l.woven !== null && l.woven !== undefined;
    while (woven && i < n && layers[i].woven === l.woven) i++;
    const idx = Array.from({ length: i - start }, (_, k) => start + k);
    const src = map.length === n ? map[start] : { tok: null, mirror: false };
    rows.push({ idx, members: idx.map((k) => layers[k]), core: l.is_core, woven, tok: src.tok, mirror: src.mirror && !(state.mode === "so" && idx.includes((n - 1) / 2)) });
  }
  rows.forEach((r) => { r.partner = state.mode === "t" ? -1 : rows.findIndex((q) => q.idx.includes(n - 1 - r.idx[0])); });
  return rows;
}
// materials are told apart by a letter tag and a slightly different grey fill, never by orientation colours
function materialKeys(layers) {
  const map = {};
  for (const l of layers) if (!l.is_core && !(l.material in map)) { const i = Object.keys(map).length; map[l.material] = { tag: String.fromCharCode(65 + (i % 26)), shade: (i % 4) * 0.07 }; }
  return map;
}

// ---------- ply table ----------
function renderLayerTable(layers, lam) {
  state.layers = layers;
  const rows = plyRows(layers);
  state.rows = rows;
  if (state.selTok !== null) { const k = rows.findIndex((r) => r.tok === state.selTok && !r.mirror); state.selRow = k >= 0 ? k : null; state.selTok = null; }
  if (state.selRow !== null && state.selRow >= rows.length) state.selRow = null;
  const z = (i) => (lam && lam.layers[i] ? lam.layers[i] : null);
  const mats = materialKeys(layers), multiMat = Object.keys(mats).length > 1;
  const partner = state.selRow !== null ? rows[state.selRow].partner : -1;
  const body = rows.map((r, ri) => {
    const l = r.members[0], nums = r.members.map((m) => m.num), last = nums[nums.length - 1];
    const zt = z(r.idx[0]), zb = z(r.idx[r.idx.length - 1]);
    const zcell = zt && zb ? `<td class="n c-z">${fmt(zt.z_top * 1000, 3)} … ${fmt(zb.z_bottom * 1000, 3)}</td>` : '<td class="n c-z">—</td>';
    const src = r.tok === null ? "" : r.mirror ? `Mirror image of sequence entry ${r.tok + 1}` : `Sequence entry ${r.tok + 1}`;
    const cls = [ri === state.selRow ? "sel" : "", r.core ? "core-row" : "", "click"].filter(Boolean).join(" ");
    const pmark = ri === partner && ri !== state.selRow ? ' style="box-shadow:inset 2px 0 0 var(--line-strong)"' : "";
    if (r.core) {
      return `<tr class="${cls}" data-row="${ri}"${pmark}><td class="idx" title="${src}">—</td><td class="sw">${fibreGlyph(0, { core: true })}</td><td>Core</td><td class="n">—</td>` +
        `<td class="c-t"><input class="cin n" type="number" step="any" min="0" data-f="core" value="${trim6(l.thickness * 1000)}" aria-label="Core thickness, mm" title="Core thickness; edits the sequence entry"></td>${zcell}</tr>`;
    }
    const ed = (f) => (nums.some((n) => (state.overrides[n] || {})[f] !== undefined) ? " edited" : "");
    const lead = r.members.find((m) => m.role === 0) || l, thick = r.members.reduce((sum, m) => sum + m.thickness, 0);
    const name = r.woven ? `Woven ply (layers ${nums[0]} to ${last})` : `Layer ${l.num}`;
    const sw = `<span title="Fibre direction ${r.woven ? `${angleText(lead.orientation)} and ${angleText(lead.orientation - 90)} (woven)` : angleText(l.orientation)}, seen from the top">${fibreGlyph(lead.orientation, { woven: r.woven })}</span>`;
    const mtag = multiMat ? `<span class="mtag" title="${esc(l.material)}">${mats[l.material].tag}</span>` : "";
    return `<tr class="${cls}" data-row="${ri}"${pmark}${r.woven ? ` title="One woven ply, calculated as ${nums.length} sub-layers at θ and θ−90"` : ""}>` +
      `<td class="idx" title="${src}">${r.woven ? `${nums[0]}–${last}` : l.num}${r.mirror ? '<span class="src"> ↕</span>' : ""}</td><td class="sw">${sw}</td>` +
      `<td class="c-mat"><div style="display:flex;align-items:center">${mtag}<select class="cin${ed("material")}" data-f="material" aria-label="${name} material">${matOptions(l.material)}</select></div></td>` +
      `<td class="c-ang"><input class="cin n${ed("orientation")}" type="number" step="any" data-f="orientation" value="${trim6(lead.orientation)}" aria-label="${name} angle, degrees"></td>` +
      `<td class="c-t"><input class="cin n${ed("thickness")}" type="number" step="any" min="0" data-f="thickness" value="${trim6(thick * 1000)}" aria-label="${name} thickness, mm"></td>` +
      `${zcell}</tr>`;
  }).join("");
  $("layerTable").innerHTML = `<thead><tr><th>#</th><th></th><th>Material</th><th class="n">Angle (°)</th><th class="n">t (mm)</th><th class="n" title="z of the top and bottom faces from the mid-plane">z, top … bottom (mm)</th></tr></thead><tbody>${body}</tbody>`;
  const edited = Object.values(state.overrides).some((o) => Object.keys(o).length);
  $("resetEdits").hidden = !edited;
  const nPly = layers.filter((l) => !l.is_core).length, nCore = layers.length - nPly;
  $("plyMeta").textContent = `${nPly} ${nPly === 1 ? "layer" : "layers"}${nCore ? ` + ${nCore} core` : ""} · top to bottom`;
  $("plyLegend").innerHTML =
    [0, 45, -45, 90].map((a) => `<span>${fibreGlyph(a, { size: 14 })}${angleText(a)}</span>`).join("") +
    `<span>${fibreGlyph(45, { size: 14, woven: true })}woven ±θ</span><span>${fibreGlyph(0, { size: 14, core: true })}core</span>` +
    (edited ? '<span><i style="--c:var(--warn);width:2px"></i>edited ply</span>' : "") +
    (multiMat ? Object.entries(mats).map(([n, m]) => `<span><span class="mtag">${m.tag}</span>${esc(n)}</span>`).join("") : "") +
    '<span class="conv" style="flex-basis:100%">Lines show the fibre direction seen from the top: θ is measured from the 1 axis (0° fibres), positive counter-clockwise. θ and θ ± 180° are the same fibre.</span>';
  updateOpButtons();
}
function updateOpButtons() {
  const sel = state.selRow !== null ? state.rows[state.selRow] : null, n = tokens().length;
  document.querySelectorAll("[data-op]").forEach((b) => {
    const op = b.dataset.op;
    b.disabled = ["up", "down", "dup", "del"].includes(op) ? !sel || sel.tok === null || (op === "up" && sel.tok === 0) || (op === "down" && sel.tok === n - 1) || (op === "del" && n < 2) : n === 0;
  });
}
function selectRow(ri) {
  state.selRow = ri;
  document.querySelectorAll("#layerTable tbody tr").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.row === ri));
  const partner = ri !== null && state.rows[ri] ? state.rows[ri].partner : -1;
  document.querySelectorAll("#layerTable tbody tr").forEach((tr) => (tr.style.boxShadow = +tr.dataset.row === partner && partner !== ri ? "inset 2px 0 0 var(--line-strong)" : ""));
  renderStack(state.layers, state.lam);
  updateOpButtons();
}

// a per-ply edit: a row is one ply, a single layer or all the sub-layers of a woven ply. With "link mirrored
// plies" the same edit goes to the mirror image too, so a symmetric layup stays symmetric.
function applyRowEdit(ri, f, raw) {
  const row = state.rows[ri];
  if (!row) return;
  if (f === "core") {
    const v = parseFloat(raw);
    if (!(v > 0) || row.tok === null) { recalc(); return; }
    const toks = tokens(); toks[row.tok] = "zc" + trim6(v / 10);
    $("seq").value = toks.join("/"); state.overrides = {}; recalc(); return;
  }
  const targets = [row];
  if ($("linkMirror").checked && row.partner >= 0 && row.partner !== ri) targets.push(state.rows[row.partner]);
  const ovOf = (m) => (state.overrides[m.num] = state.overrides[m.num] || {});
  if (f === "material") {
    // keep each layer's thickness in proportion to the new material's ply thickness (a woven sub-layer stays a quarter)
    const newM = matByName(raw);
    for (const t of targets) for (const m of t.members) {
      const oldM = matByName(m.material), ov = ovOf(m);
      if (oldM && newM && oldM.h0 > 0) ov.thickness = (m.thickness / oldM.h0) * newM.h0;
      ov.material = raw;
    }
  } else {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || (f === "thickness" && v <= 0)) { recalc(); return; }
    // thickness is shared equally between the sub-layers; the weave angle gives fibres at θ and θ−90
    for (const t of targets) for (const m of t.members) ovOf(m)[f] = f === "thickness" ? v / 1000 / t.members.length : m.role === 1 ? v - 90 : v;
  }
  recalc();
}
// structural edits rewrite the sequence; like typing a new sequence, they clear per-ply edits
function editSequence(fn) {
  const toks = tokens(), sel = state.selRow !== null && state.rows[state.selRow] ? state.rows[state.selRow].tok : null;
  const res = fn(toks, sel);
  if (!res) return;
  $("seq").value = res.toks.join("/");
  state.overrides = {}; state.selTok = res.sel ?? null; state.selRow = null;
  clearPreset(); recalc();
}
function insertToken(tok) {
  editSequence((toks, sel) => { const at = sel === null ? toks.length : sel + 1; toks.splice(at, 0, tok); return { toks, sel: at }; });
}
const SEQ_OPS = {
  up: (t, s) => (s > 0 ? ([t[s - 1], t[s]] = [t[s], t[s - 1]], { toks: t, sel: s - 1 }) : null),
  down: (t, s) => (s !== null && s < t.length - 1 ? ([t[s + 1], t[s]] = [t[s], t[s + 1]], { toks: t, sel: s + 1 }) : null),
  dup: (t, s) => (s !== null ? (t.splice(s + 1, 0, t[s]), { toks: t, sel: s + 1 }) : null),
  del: (t, s) => (s !== null && t.length > 1 ? (t.splice(s, 1), { toks: t, sel: Math.min(s, t.length - 1) }) : null),
  rev: (t, s) => ({ toks: t.reverse(), sel: s === null ? null : t.length - 1 - s }),
  rep: (t, s) => ({ toks: t.concat(t), sel: s }),
};

// ---------- cross-section through the thickness ----------
function renderStack(layers, lam) {
  const el = $("stackViz");
  if (!layers || !layers.length) { el.innerHTML = ""; return; }
  const plyT = layers.filter((l) => !l.is_core).reduce((s, l) => s + l.thickness, 0) || 1;
  const s = 240 / plyT, minH = 6, coreMax = 56;
  const hOf = (l) => (l.is_core ? Math.min(Math.max(l.thickness * s, 28), coreMax) : Math.max(l.thickness * s, minH));
  const broken = (l) => l.is_core && l.thickness * s > coreMax;
  const mats = materialKeys(layers), multiMat = Object.keys(mats).length > 1;
  const top = 26, X0 = 84, X1 = 300;
  let y = top;
  const geo = layers.map((l) => { const g = { y0: y, h: hOf(l) }; y += g.h; return g; });
  const H = Math.max(y + 26, top + 90), W = 610;
  // z of each interface: from the laminate result if there is one, otherwise from the thicknesses
  const ht = layers.reduce((a, l) => a + l.thickness, 0);
  let zc = ht / 2;
  const zs = layers.map((l, i) => { const zl = lam && lam.layers[i] ? [lam.layers[i].z_top, lam.layers[i].z_bottom] : [zc, zc - l.thickness]; zc -= l.thickness; return zl; });
  const rows = state.rows, sel = state.selRow !== null && rows[state.selRow] ? rows[state.selRow] : null;
  const partner = sel && sel.partner >= 0 && rows[sel.partner] !== sel ? rows[sel.partner] : null;
  const rowOf = (i) => rows.findIndex((r) => r.idx.includes(i));
  const pats = {};
  const pat = (a) => {
    const k = trim6(a), id = "hp" + String(k).replace(/[^0-9a-z]/gi, "_");
    if (!pats[k]) pats[k] = fibrePatternSVG(id, k);
    return id;
  };
  let g = "", labels = "", ticks = "";
  layers.forEach((l, i) => {
    const { y0, h } = geo[i], ri = rowOf(i), r = rows[ri];
    const isSel = sel && sel.idx.includes(i), isPar = partner && partner.idx.includes(i);
    const hov = l.is_core ? `<b>Core</b><br><span class="mono">t = ${fmt(l.thickness * 1000)} mm</span>`
      : `<b>Layer ${l.num}</b>${r && r.woven ? " (woven sub-layer)" : ""}<br>${esc(l.material)}<br><span class="mono">θ = ${angleText(l.orientation)} · t = ${fmt(l.thickness * 1000)} mm<br>z = ${fmt(zs[i][0] * 1000, 4)} … ${fmt(zs[i][1] * 1000, 4)} mm</span>`;
    g += `<g class="ply" data-row="${ri}" data-hover="${esc(hov)}">`;
    if (l.is_core) {
      g += `<rect class="b" x="${X0}" y="${y0}" width="${X1 - X0}" height="${h}" fill="var(--core)" fill-opacity="0.22" stroke="var(--core)" stroke-width="1"/>`;
      for (let k = 0; k < 9; k++) g += `<circle cx="${X0 + 14 + k * 29}" cy="${y0 + h / 2 + (k % 2 ? 6 : -6)}" r="1.4" fill="var(--core)"/>`;
      if (broken(l)) {
        const ym = y0 + h / 2;
        g += `<path d="M${X0 - 6} ${ym - 3} l6 -4 l0 8 l6 -4 M${X1 - 6} ${ym - 3} l6 -4 l0 8 l6 -4" fill="none" stroke="var(--muted)" stroke-width="1"/>`;
      }
    } else {
      g += `<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${h}" fill="var(--ply)"/>` +
        (multiMat && mats[l.material].shade ? `<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${h}" fill="var(--ink)" fill-opacity="${mats[l.material].shade}"/>` : "") +
        `<rect class="b" x="${X0}" y="${y0}" width="${X1 - X0}" height="${h}" fill="url(#${pat(l.orientation)})" stroke="var(--line-strong)" stroke-width="0.8"/>`;
    }
    if (isSel) g += `<rect x="${X0 - 1}" y="${y0 + 0.5}" width="${X1 - X0 + 2}" height="${h - 1}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    else if (isPar) g += `<rect x="${X0 - 1}" y="${y0 + 0.5}" width="${X1 - X0 + 2}" height="${h - 1}" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    g += "</g>";
  });
  // labels: one per table row, where there is room
  rows.forEach((r) => {
    const a = geo[r.idx[0]], b = geo[r.idx[r.idx.length - 1]], y0 = a.y0, y1 = b.y0 + b.h, l = r.members[0];
    const isSel = sel === r, col = isSel ? "var(--accent-ink)" : "var(--ink-2)", wt = isSel ? ' font-weight="600"' : "";
    if (r.woven) labels += `<path d="M${X1 + 5} ${y0 + 1}h4V${y1 - 1}h-4" fill="none" stroke="var(--muted)" stroke-width="1"/>`;
    if (y1 - y0 < 11) return;
    const ym = (y0 + y1) / 2 + 3.5, lead = r.members.find((m) => m.role === 0) || l;
    const txt = r.core ? `core · ${fmt(l.thickness * 1000)} mm${broken(l) ? " (compressed)" : ""}`
      : `${angleText(lead.orientation)}${r.woven ? " woven" : ""}`;
    const num = r.core ? "" : r.woven ? `${r.members[0].num}–${r.members[r.members.length - 1].num}` : l.num;
    labels += `<text x="${X1 + 16}" y="${ym}" font-size="10.5" fill="var(--faint)" class="mtext">${num}</text>` +
      fibreGlyphSVG(X1 + 44, ym - 10.5, 12, lead.orientation, { woven: r.woven, core: r.core }) +
      `<text x="${X1 + 62}" y="${ym}" font-size="11" fill="${col}"${wt} class="mtext">${txt}</text>` +
      (r.core || !multiMat ? "" : `<text x="${X1 + 196}" y="${ym}" font-size="10.5" fill="var(--muted)" class="mtext">${mats[l.material].tag}<title>${esc(l.material)}</title></text>`);
  });
  // z axis: top, bottom, mid-plane and core faces
  const zAt = new Map();
  zAt.set(top, zs[0][0]); zAt.set(H - 26, zs[zs.length - 1][1]);
  layers.forEach((l, i) => { if (l.is_core) { zAt.set(geo[i].y0, zs[i][0]); zAt.set(geo[i].y0 + geo[i].h, zs[i][1]); } });
  // mid-plane: where z crosses zero inside a drawn layer
  let yMid = null;
  layers.forEach((l, i) => { const [a, b] = zs[i]; if (yMid === null && a >= 0 && b <= 0 && a !== b) yMid = geo[i].y0 + (a / (a - b)) * geo[i].h; });
  for (const [yy, zz] of zAt) ticks += `<line x1="${X0 - 14}" y1="${yy}" x2="${X0 - 18}" y2="${yy}" stroke="var(--muted)"/><text x="${X0 - 21}" y="${yy + 3.5}" font-size="10" fill="var(--muted)" text-anchor="end" class="mtext">${fmt(zz * 1000, 4)}</text>`;
  if (yMid !== null) {
    ticks += `<line x1="${X0 - 18}" y1="${yMid}" x2="${X1 + 2}" y2="${yMid}" stroke="var(--ink-2)" stroke-width="0.8" stroke-dasharray="6 3 2 3"/>` +
      `<text x="${X0 - 21}" y="${yMid + 3.5}" font-size="10" fill="var(--ink-2)" text-anchor="end" class="mtext">0</text>`;
  }
  ticks += `<line x1="${X0 - 16}" y1="${top}" x2="${X0 - 16}" y2="${H - 26}" stroke="var(--muted)" stroke-width="0.8"/>` +
    `<text x="${X0 - 16}" y="${top - 10}" font-size="10" fill="var(--muted)" text-anchor="middle" class="mtext">z (mm)</text>` +
    `<text x="${(X0 + X1) / 2}" y="${top - 10}" font-size="10" fill="var(--faint)" text-anchor="middle">TOP · z = +h/2</text>` +
    `<text x="${(X0 + X1) / 2}" y="${H - 9}" font-size="10" fill="var(--faint)" text-anchor="middle">BOTTOM · z = −h/2</text>`;
  // reference for the hatch: fibre direction seen from the top, θ from the 1 axis, positive counter-clockwise
  const conv = `<text x="${W - 96}" y="${top + 2}" font-size="9.5" fill="var(--faint)">FIBRES, TOP VIEW</text>` + fibreConventionSVG(W - 84, top + 52);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Laminate cross-section, top to bottom, ply heights to scale; the hatch in each ply runs along its fibre direction seen from the top">` +
    `<defs>${Object.values(pats).join("")}</defs>${ticks}${g}${labels}${conv}</svg>`;
}

// overview strip in the layup bar: one fibre glyph per ply, top of the laminate on the left
function renderMiniStack(layers) {
  const svg = $("miniStack");
  if (!layers || !layers.length) { svg.innerHTML = ""; svg.setAttribute("viewBox", "0 0 1 16"); svg.setAttribute("width", 0); return; }
  const rows = state.rows && state.rows.length ? state.rows : plyRows(layers), max = 16, step = 16;
  const shown = rows.slice(0, max);
  let out = shown.map((r, i) => {
    const lead = r.members.find((m) => m.role === 0) || r.members[0];
    return fibreGlyphSVG(i * step, 0.5, 15, lead.orientation, { woven: r.woven, core: r.core });
  }).join("");
  let w = shown.length * step;
  if (rows.length > max) { out += `<text x="${w + 2}" y="12" font-size="11" fill="var(--muted)">+${rows.length - max}</text>`; w += 26; }
  svg.setAttribute("viewBox", `0 0 ${w} 16`); svg.setAttribute("width", w);
  svg.innerHTML = out;
}

// ---------- read-only layup line, shown outside the Laminate module ----------
function renderLayupRead() {
  const el = $("layupRead"), toks = tokens();
  if (!toks.length) { el.innerHTML = '<span class="q">No layup</span>'; return; }
  const mode = document.querySelector("#mode [aria-pressed='true']");
  const edits = Object.values(state.overrides || {}).filter((o) => Object.keys(o).length).length;
  el.innerHTML = `<span class="lr-mat" title="${esc($("baseMat").value)}">${esc($("baseMat").value)}</span>` +
    `<span class="mono" title="Stacking: ${mode ? mode.textContent : ""}">[${esc(toks.join("/")).replace(/\+-/g, "±").replace(/-/g, "−")}]<sub>${state.mode === "t" ? "" : state.mode}</sub></span>` +
    (edits ? `<span class="q">${edits} ply edit${edits > 1 ? "s" : ""}</span>` : "");
}

// ---------- presets: off-the-shelf parts ----------
// inner outline of a rectangular tube with rounded corners, as x2,x3 points in metres (width along x2)
function roundedRectPoints(width, height, radius, stepDeg = 3) {
  const a = width / 2 - radius, b = height / 2 - radius, n = Math.round(90 / stepDeg), rows = ["x2,x3"];
  [[a, b, 0], [-a, b, 90], [-a, -b, 180], [a, -b, 270]].forEach(([cx, cy, start]) => {
    for (let i = 0; i <= n; i++) {
      const th = ((start + (90 * i) / n) * Math.PI) / 180;
      rows.push(`${(cx + radius * Math.cos(th)).toFixed(6)},${(cy + radius * Math.sin(th)).toFixed(6)}`);
    }
  });
  return rows.join("\n");
}
// A preset names a database material, the ply sequence and stacking, optional per-layer overrides
// ({layer number: {material, thickness [m], orientation}}) and the tube section as sectionSpec() would return it.
const PRESETS = [
  {
    id: "dragonplate_braided_rect_2x1_050",
    name: "DragonPlate braided rectangular tube 2″ × 1″, 0.050″ wall",
    // layer 5 is the 0° uni, thinner than the braid plies (the material's h0)
    material: "DragonPlate_TR30S_Epoxy_UD", seq: "+-45/0", mode: "so", overrides: { 5: { thickness: 0.0000733 } },
    section: { type: "arb", surface: "inner", csv: roundedRectPoints(0.050184, 0.025004, 0.0035687) },
    clamp: { width: 0.050184, height: 0.025004, radius: 0.0035687 },
    note: "Fitted to DragonPlate's published data (SKU FDPBT-R*2x1x48T) and to measurements on four tubes: ±45° braid / 0° uni / ±45° braid, " +
      "1.06 mm wall, 52.31 × 27.13 mm outside, 3.57 mm inside corner radius. The uni layer (0.07 mm, about 7 % of the wall) is set so the " +
      "flat bending stiffness matches a 3-point bend test (EI about 575 N·m²). Ply strengths are estimates, so treat strength results as " +
      "approximate. EI₂ is the tube bent flat, EI₃ on edge.",
  },
];
$("preset").insertAdjacentHTML("beforeend", PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join(""));
function clearPreset() { $("preset").value = ""; $("presetNote").hidden = true; }
function applyPreset(id) {
  const p = PRESETS.find((x) => x.id === id), note = $("presetNote");
  if (!p) { clearPreset(); return; }
  if (!matByName(p.material)) {
    $("preset").value = ""; note.hidden = false;
    note.textContent = `This preset needs the material “${p.material}”, which is not in the material database.`;
    return;
  }
  $("preset").value = p.id;  // also when chosen from Simple mode
  $("baseMat").value = p.material;
  $("seq").value = p.seq;
  setMode(p.mode);
  state.overrides = JSON.parse(JSON.stringify(p.overrides || {}));
  const s = p.section;
  $("secType").value = s.type;
  if (s.type === "circ") $("dIn").value = trim6(s.d_in * 1000);
  if (s.type === "rect") { $("rH").value = trim6(s.height * 1000); $("rW").value = trim6(s.width * 1000); }
  if (s.type === "arb") { $("pts").value = s.csv; $("surface").value = s.surface; }
  if (p.clamp) { $("cShape").value = "rect"; $("cW").value = trim6(p.clamp.width * 1000); $("cH").value = trim6(p.clamp.height * 1000); $("cR").value = trim6(p.clamp.radius * 1000); }
  note.innerHTML = `<div><b>${esc(p.name)}</b><br>${esc(p.note)}</div>`; note.hidden = !p.note;
  state.selRow = null;
  recalc();
}
