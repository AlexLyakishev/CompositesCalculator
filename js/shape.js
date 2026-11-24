"use strict";
// Shape Beam page: an STL of a slender shape's surface, a layup laid on it, supports and loads, solved as a
// composite beam by composites_shape_lib.py (through py/bridge.py + py/shape_bridge.py), shown in 3D.

const FILES = { lib: "composites_calculator_lib.py", shape: "composites_shape_lib.py", db: "materials_database.csv",
  bridge: "py/bridge.py", shapeBridge: "py/shape_bridge.py" };
const CRIT = { max: "maximum stress", quad: "Tsai-Wu", hashin: "Hashin" };
const MODE = { FT: "fibre tension", FC: "fibre compression", MT: "matrix tension", MC: "matrix compression", S: "shear" };

let pyodide = null, pyApi = null;
const S = { mesh: null, res: null, supports: [], pls: [], lls: [], view: "R", unit: "mm" };
function call(name, payload) { return JSON.parse(pyApi(name, JSON.stringify(payload))); }
const AX = { x: 0, y: 1, z: 2 };
const axisIdx = () => AX[$("axis").value];
const unitName = () => ({ "0.001": "mm", "1": "m", "0.0254": "in" }[$("unit").value]);

// ---------------------------------------------------------------- start-up
async function boot() {
  const status = $("status");
  try {
    const resp = await Promise.all(Object.values(FILES).map((f) => fetch(f)));
    resp.forEach((r, i) => { if (!r.ok) throw new Error(`Could not load ${Object.values(FILES)[i]} (${r.status}).`); });
    const [lib, shape, db, bridge, shapeBridge] = await Promise.all(resp.map((r) => r.text()));
    pyodide = await loadPyodide();
    status.textContent = "Loading numpy and pandas…";
    await pyodide.loadPackage(["numpy", "pandas", "micropip"]);
    try { await pyodide.runPythonAsync('import micropip\nawait micropip.install("tabulate")'); }
    catch (e) { pyodide.runPython('import sys, types\n_t = types.ModuleType("tabulate")\n_t.tabulate = lambda data, *a, **k: str(data)\nsys.modules["tabulate"] = _t'); }
    pyodide.FS.writeFile(FILES.lib, lib);
    pyodide.FS.writeFile(FILES.shape, shape);
    pyodide.runPython(bridge);
    pyodide.runPython(shapeBridge);
    pyApi = pyodide.globals.get("api");
    const r = call("materials", { csv: db, custom: [] });
    if (!r.ok) throw new Error(r.error);
    $("mat").innerHTML = r.result.materials.map((m) => `<option${m.name === "Graphite_Epoxy_T300_N5208" ? " selected" : ""}>${esc(m.name)}</option>`).join("");
    S.materials = r.result.materials;
    status.textContent = "Ready"; status.className = "ready";
    $("foot").textContent = `composites_calculator_lib v${r.result.version} · composites_shape_lib · Python runs locally in the browser via Pyodide`;
    loadMesh({ source: "example", kind: "tube" });
  } catch (e) {
    status.textContent = "Failed to start: " + (e.message || e) + (location.protocol === "file:" ? " Open this page through a web server, not as a file." : "");
    status.className = "error";
  }
}

// ---------------------------------------------------------------- model
function loadMesh(src) {
  const r = call("shape_mesh", { ...src, unit: parseFloat($("unit").value) });
  if (!r.ok) { showError(r.error); return; }
  const m = r.result;
  S.mesh = { V: Float32Array.from(m.vertices), F: Uint32Array.from(m.faces), min: m.min, max: m.max, n: m.n_faces, src: src.source, name: src.name };
  S.unit = src.source === "example" ? "mm" : unitName();
  if (src.source === "example") $("unit").value = "0.001";
  $("axis").value = m.axis;
  if (src.kind === "wing" || src.kind === "tube" || src.kind === "arm" || src.source === "stl") $("surface").value = "outer";
  defaultBCs();
  const ext = m.max.map((v, i) => v - m.min[i]);
  $("meshInfo").textContent = `${src.source === "example" ? "Example" : src.name} · ${m.n_faces.toLocaleString()} triangles · ` +
    `${ext.map((v) => fmt(v)).join(" × ")} ${S.unit}`;
  buildScene();
  fitView();
  run();
}
// the "up" direction for default loads: z, unless the span runs along z
const upIdx = () => (axisIdx() === 2 ? 1 : 2);
function centreAt(spanPos) {
  const a = axisIdx(), p = S.mesh.min.map((v, i) => (v + S.mesh.max[i]) / 2);
  p[a] = spanPos;
  return p;
}
function defaultBCs() {
  const a = axisIdx(), lo = S.mesh.min[a], hi = S.mesh.max[a], up = upIdx();
  const F = [0, 0, 0]; F[up] = -50;
  S.supports = [{ s: trim6(lo), kind: "fixed" }];
  S.pls = [{ at: centreAt(hi).map(trim6), F, M: 0 }];
  S.lls = [];
  renderRows();
}

// ---------------------------------------------------------------- input rows
const numIn = (path, v, label) => `<div class="fld"><input type="number" step="any" data-p="${path}" value="${trim6(v)}" aria-label="${label}"></div>`;
const AXN = ["x", "y", "z"];
function renderRows() {
  const u = S.unit, ax = $("axis").value;
  $("supRows").innerHTML = S.supports.map((s, i) => `<div class="row"><div class="row-h">Support ${i + 1}<button class="btn ghost" type="button" data-del="supports.${i}" aria-label="Remove">✕</button></div>
    <div class="prm"><label>At ${ax} <span class="q">${u}</span></label>${numIn(`supports.${i}.s`, s.s, "position")}</div>
    <div class="prm"><label>Type <i class="tip" tabindex="0" data-tip="Fixed: holds every movement and rotation. Pinned: holds movement and twist, free to rotate in bending. Roller: holds sideways movement only."></i></label><div class="fld"><select data-p="supports.${i}.kind">${["fixed", "pinned", "roller"].map((k) => `<option${k === s.kind ? " selected" : ""}>${k}</option>`).join("")}</select></div></div></div>`).join("");
  $("plRows").innerHTML = S.pls.map((p, i) => `<div class="row"><div class="row-h">Load ${i + 1}<button class="btn ghost" type="button" data-del="pls.${i}" aria-label="Remove">✕</button></div>
    <div class="trio"><span></span>${AXN.map((a) => `<span style="text-align:center">${a}</span>`).join("")}</div>
    <div class="trio"><span>At ${u}</span>${p.at.map((v, k) => numIn(`pls.${i}.at.${k}`, v, "position " + AXN[k])).join("")}</div>
    <div class="trio"><span>Force N</span>${p.F.map((v, k) => numIn(`pls.${i}.F.${k}`, v, "force " + AXN[k])).join("")}</div>
    <div class="prm" style="margin-top:3px"><label>Torque about the span axis</label><div class="fld"><input type="number" step="any" data-p="pls.${i}.M" value="${trim6(p.M)}"><span class="u">N·m</span></div></div></div>`).join("");
  $("llRows").innerHTML = S.lls.map((l, i) => `<div class="row"><div class="row-h">Line load ${i + 1}<button class="btn ghost" type="button" data-del="lls.${i}" aria-label="Remove">✕</button></div>
    <div class="trio"><span></span>${AXN.map((a) => `<span style="text-align:center">${a}</span>`).join("")}</div>
    <div class="trio"><span>Load N/m</span>${l.q.map((v, k) => numIn(`lls.${i}.q.${k}`, v, "load per length " + AXN[k])).join("")}</div>
    <div class="trio"><span>Through ${u}</span>${l.through.map((v, k) => numIn(`lls.${i}.through.${k}`, v, "line through " + AXN[k])).join("")}</div>
    <div class="prm" style="margin-top:3px"><label>From ${ax} <span class="q">${u}</span></label>${numIn(`lls.${i}.s0`, l.s0, "from")}</div>
    <div class="prm"><label>To ${ax} <span class="q">${u}</span></label>${numIn(`lls.${i}.s1`, l.s1, "to")}</div></div>`).join("");
}
function setPath(path, value) {
  const keys = path.split("."), key = { supports: "supports", pls: "pls", lls: "lls" }[keys[0]];
  let o = S[key];
  for (const k of keys.slice(1, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}
document.querySelector(".inputs").addEventListener("input", (e) => {
  const p = e.target.dataset.p;
  if (!p) return;
  const v = e.target.tagName === "SELECT" ? e.target.value : parseFloat(e.target.value);
  if (e.target.tagName !== "SELECT" && !Number.isFinite(v)) return;
  setPath(p, v);
  schedule();
});
document.querySelector(".inputs").addEventListener("click", (e) => {
  const d = e.target.closest("[data-del]");
  if (!d) return;
  const [k, i] = d.dataset.del.split(".");
  S[k].splice(+i, 1);
  renderRows(); run();
});
$("addSup").addEventListener("click", () => { if (!S.mesh) return; S.supports.push({ s: trim6(S.mesh.max[axisIdx()]), kind: "pinned" }); renderRows(); run(); });
$("addPl").addEventListener("click", () => {
  if (!S.mesh) return;
  const a = axisIdx(), F = [0, 0, 0]; F[upIdx()] = -50;
  S.pls.push({ at: centreAt(trim6((S.mesh.min[a] + S.mesh.max[a]) / 2)).map(trim6), F, M: 0 }); renderRows(); run();
});
$("addLl").addEventListener("click", () => {
  if (!S.mesh) return;
  const a = axisIdx(), q = [0, 0, 0]; q[upIdx()] = -100;
  S.lls.push({ s0: trim6(S.mesh.min[a]), s1: trim6(S.mesh.max[a]), through: centreAt(0).map(trim6), q }); renderRows(); run();
});
document.querySelectorAll(".live").forEach((el) => el.addEventListener("input", schedule));
$("axis").addEventListener("change", () => { defaultBCs(); buildScene(); fitView(); run(); });
document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => loadMesh({ source: "example", kind: b.dataset.ex })));
$("stlBtn").addEventListener("click", () => $("stlFile").click());
$("stlFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !pyodide) return;
  pyodide.FS.writeFile("/tmp/model.stl", new Uint8Array(await f.arrayBuffer()));
  loadMesh({ source: "stl", name: f.name });
});
$("unit").addEventListener("change", () => { if (S.mesh && S.mesh.src === "stl") loadMesh({ source: "stl", name: S.mesh.name }); });

let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 350); }

// ---------------------------------------------------------------- solve
function layupSpec() { return { template: $("seq").value.trim(), material: $("mat").value, overrides: {} }; }
function run() {
  if (!pyApi || !S.mesh) return;
  const g = $("grav").value, gf = parseFloat($("gfac").value) || 0;
  const payload = {
    layup: layupSpec(), axis: $("axis").value, surface: $("surface").value,
    n_elements: Math.max(4, Math.min(200, parseInt($("nel").value) || 40)),
    n_points: Math.max(16, Math.min(256, parseInt($("npt").value) || 64)),
    supports: S.supports, point_loads: S.pls, line_loads: S.lls,
    gravity: g ? g.split(",").map((v) => +v * 9.81 * gf) : null,
  };
  $("status").textContent = "Solving…"; $("status").className = "";
  setTimeout(() => {
    const t0 = performance.now();
    const r = call("shape_run", payload);
    $("solveTime").textContent = `solved in ${Math.round(performance.now() - t0)} ms`;
    $("status").textContent = "Ready"; $("status").className = "ready";
    if (!r.ok) { S.res = null; showError(r.error); paint(); drawOverlays(); renderPlots(); return; }
    S.res = r.result;
    renderResults(); paint(); drawOverlays(); renderPlots();
  }, 20);
}
function showError(msg) {
  $("resTag").textContent = "Error"; $("resTag").className = "tag bad";
  $("results").innerHTML = `<div class="isec">${msgs([errHTML(msg)])}</div>`;
}

// ---------------------------------------------------------------- results panel
function renderResults() {
  const r = S.res, u = S.unit, w = r.worst, ax = $("axis").value;
  const ok = w && w.R >= 1;
  $("resTag").textContent = !w ? "No load" : ok ? "Pass" : "Fail";
  $("resTag").className = "tag " + (!w ? "" : ok ? "good" : "bad");
  const where = w ? `${CRIT[w.criterion]}${w.mode ? ", " + MODE[w.mode] : ""} · layer ${w.layer} (${w.location === "Top" ? "surface side" : "inner side"}) at ${ax} = ${fmt(w.s)} ${u}` : "";
  const secs = r.sections, root = secs[0], tip = secs[secs.length - 1];
  const reac = r.reactions.map((q, i) => ({ name: `Support at ${ax} = ${fmt(q.s)}`, value: q.F.map((v) => fmt(Math.abs(v) < 1e-9 * Math.max(...q.F.map(Math.abs)) ? 0 : v)).join(", "), unit: "N", note: Math.abs(q.M_axis) > 1e-9 ? `x, y, z · torque ${fmt(q.M_axis)} N·m` : "x, y, z" }));
  $("results").innerHTML =
    (w ? verdict({ tone: ok ? "good" : "bad", R: w.R, text: where, tip: "Load multiplier to first-ply failure: all the loads times R just fail the first ply, anywhere on the shape." })
       : verdict({ tone: "none", text: "No ply is loaded" })) +
    isec("", primary([
      { name: "Largest deflection", value: fmt(r.max_disp), unit: u, note: `at ${ax} = ${fmt(r.max_disp_at)} ${u}` },
      { name: "Largest twist", value: fmt(r.max_twist_deg < 1e-9 ? 0 : r.max_twist_deg), unit: "°" },
      { name: "Mass", value: fmt(r.mass * 1000), unit: "g", note: `wall ${fmt(r.h * 1000)} mm` },
    ])) +
    (w ? isec("At the critical point", secondary([
      { name: "Axial wall force N₁", value: fmt(w.N1 / 1000), unit: "N/mm" },
      { name: "Wall bending moment M₁", value: fmt(w.M1), unit: "N·m/m" },
      { name: "Shear flow N₆", value: fmt(w.N6 / 1000), unit: "N/mm", note: `${fmt(w.N6_shear / 1000)} from shear force + ${fmt(w.N6_torsion / 1000)} from torsion` },
    ]), "Wall loads where the lowest safety factor occurs. Shear flow is positive counter-clockwise looking along the span axis.") : "") +
    isec("Sections", secondary([
      { name: "EI, first section", value: `${fmt(root.EI_y)} / ${fmt(root.EI_z)}`, unit: "N·m²", note: "bending in the two cross axes" },
      { name: "EI, last section", value: `${fmt(tip.EI_y)} / ${fmt(tip.EI_z)}`, unit: "N·m²" },
      { name: "GJ, first / last", value: `${fmt(root.GJ)} / ${fmt(tip.GJ)}`, unit: "N·m²" },
      { name: "EA, first / last", value: `${fmt(root.EA)} / ${fmt(tip.EA)}`, unit: "N" },
      { name: "Shear centre, first section", value: r.shear_centre[0].filter((_, i) => i !== AX[ax]).map((v) => fmt(Math.abs(v) < 1e-9 * S.size ? 0 : v)).join(", "), unit: u, note: `${["y, z", "z, x", "x, y"][AX[ax]]} in model coordinates; the dotted line in the view` },
      { name: "Shear centre, last section", value: r.shear_centre[r.shear_centre.length - 1].filter((_, i) => i !== AX[ax]).map((v) => fmt(Math.abs(v) < 1e-9 * S.size ? 0 : v)).join(", "), unit: u },
    ])) +
    isec("Reactions", secondary(reac)) +
    isec("Model limits", `<p class="hint" style="margin:0">Beam theory along a straight axis with sections cut square to it. Bending, torsion about each section's shear centre and shear flow from shear force (single cell, uniform wall) are checked in every ply round every section; local load introduction, warping restraint at supports, buckling, internal webs and ribs are not. Use it for sizing; confirm critical parts with a shell or solid FE model.</p>`);
}

// ---------------------------------------------------------------- 3D view
const V3 = {};
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function initThree() {
  const box = $("view3d");
  V3.renderer = new THREE.WebGLRenderer({ antialias: true });
  V3.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.prepend(V3.renderer.domElement);
  V3.scene = new THREE.Scene();
  V3.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1e7);
  V3.camera.up.set(0, 0, 1);
  V3.controls = new THREE.OrbitControls(V3.camera, V3.renderer.domElement);
  V3.controls.enableDamping = true;
  V3.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(0.4, 0.6, 1);
  V3.camera.add(key);
  V3.scene.add(V3.camera);
  V3.overlay = new THREE.Group();
  V3.scene.add(V3.overlay);
  new ResizeObserver(resize).observe(box);
  resize();
  setTheme();
  (function loop() { requestAnimationFrame(loop); V3.controls.update(); V3.renderer.render(V3.scene, V3.camera); })();
}
function resize() {
  const box = $("view3d"), w = box.clientWidth, h = box.clientHeight;
  V3.renderer.setSize(w, h, false);
  V3.camera.aspect = w / Math.max(h, 1);
  V3.camera.updateProjectionMatrix();
}
function setTheme() { V3.scene.background = new THREE.Color(css("--surface-3") || "#F8F9FB"); paint(); drawOverlays(); }
function buildScene() {
  if (V3.mesh) { V3.scene.remove(V3.mesh); V3.mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(S.mesh.V.slice(), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(S.mesh.V.length).fill(0.7), 3));
  g.setIndex(new THREE.BufferAttribute(S.mesh.F, 1));
  g.computeVertexNormals();
  V3.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  V3.scene.add(V3.mesh);
  S.size = Math.max(...S.mesh.max.map((v, i) => v - S.mesh.min[i]));
}
function fitView() {
  if (!S.mesh) return;
  const c = S.mesh.min.map((v, i) => (v + S.mesh.max[i]) / 2), d = S.size * 1.6;
  V3.controls.target.set(...c);
  V3.camera.position.set(c[0] + d * 0.55, c[1] - d * 0.85, c[2] + d * 0.5);
  V3.camera.near = S.size / 1000; V3.camera.far = S.size * 100;
  V3.camera.updateProjectionMatrix();
}
$("fitBtn").addEventListener("click", fitView);

// colour scales: safety factor, one warm hue from dark (R = 1, critical) to pale (R >= 10); R < 1 is the fail colour
const R_STOPS = [[0, [0.47, 0.17, 0.05]], [0.35, [0.80, 0.42, 0.12]], [0.7, [0.95, 0.72, 0.42]], [1, [0.97, 0.91, 0.80]]];
const D_STOPS = [[0, [0.88, 0.92, 0.98]], [0.5, [0.45, 0.62, 0.88]], [1, [0.12, 0.27, 0.55]]];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0);
    return a.map((x, k) => x + f * (b[k] - x));
  }
  return stops[stops.length - 1][1];
}
const hexRGB = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
// the pale end of the scale: 10, or a round number at least 5 times the lowest R, so a lightly loaded part still shows where it is worst
function rTop() {
  const w = S.res && S.res.worst, need = w ? w.R * 5 : 10;
  return [10, 20, 50, 100, 200, 500, 1000].find((v) => v >= need) || 1000;
}
function rColour(R, top) {
  if (R === null || !Number.isFinite(R)) return ramp(R_STOPS, 1);
  if (R < 1) return hexRGB(css("--bad"));
  return ramp(R_STOPS, Math.log10(R) / Math.log10(top));
}
// nodal results at each vertex, interpolated along the span
function vertexField(f) {
  const r = S.res, a = axisIdx(), x = r.x, V = S.mesh.V, n = V.length / 3, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = V[3 * i + a];
    let e = 0;
    while (e < x.length - 2 && s > x[e + 1]) e++;
    const t = Math.max(0, Math.min(1, (s - x[e]) / (x[e + 1] - x[e])));
    out[i] = f(e, t);
  }
  return out;
}
function paint() {
  if (!V3.mesh) return;
  const col = V3.mesh.geometry.getAttribute("color"), pos = V3.mesh.geometry.getAttribute("position");
  const n = S.mesh.V.length / 3, r = S.res;
  const grey = hexRGB(css("--core") || "#A7ADB6");
  let rgb = () => grey;
  let legend = "";
  if (r && S.view === "R") {
    const top = rTop();
    rgb = (i) => rColour(r.R_vertex[i], top);
    const grad = [0, 0.25, 0.5, 0.75, 1].map((t) => { const c = ramp(R_STOPS, t).map((x) => Math.round(x * 255)); return `rgb(${c}) ${t * 100}%`; }).join(",");
    legend = `<div>First-ply safety factor <var>R</var> · <span style="color:var(--bad-ink)">■</span> below 1 fails</div><div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ticks">${[0, 0.25, 0.5, 0.75].map((t) => `<span>${fmt(10 ** (t * Math.log10(top)), 2)}</span>`).join("")}<span>≥ ${top}</span></div>`;
  } else if (r && S.view === "d") {
    const d = vertexField((e, t) => { const a = r.disp[e], b = r.disp[e + 1]; return Math.hypot(...a.map((v, k) => v + t * (b[k] - v))); });
    const m = Math.max(...d, 1e-30);
    rgb = (i) => ramp(D_STOPS, d[i] / m);
    const grad = [0, 0.5, 1].map((t) => { const c = ramp(D_STOPS, t).map((x) => Math.round(x * 255)); return `rgb(${c}) ${t * 100}%`; }).join(",");
    legend = `<div>Deflection</div><div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ticks"><span>0</span><span>${fmt(m / 2)}</span><span>${fmt(m)} ${S.unit}</span></div>`;
  }
  for (let i = 0; i < n; i++) col.setXYZ(i, ...rgb(i));
  col.needsUpdate = true;
  $("legend").innerHTML = legend; $("legend").hidden = !legend;

  // deformed shape: span-interpolated displacement plus the twist about the span axis
  const P = S.mesh.V, def = $("deform").checked && r;
  let k = 0;
  if (r) {
    const span = S.mesh.max[axisIdx()] - S.mesh.min[axisIdx()];
    k = r.max_disp > 0 ? (0.1 * span) / r.max_disp : 0;
    const twistMax = r.max_twist_deg * Math.PI / 180;
    if (twistMax * k > 0.5) k = 0.5 / twistMax;  // keep the drawn twist readable
    $("deformScale").textContent = fmt(k, 2);
  }
  if (def) {
    const a = axisIdx(), b = (a + 1) % 3, c = (a + 2) % 3, tw = vertexField((e, t) => {
      const d0 = r.disp[e], d1 = r.disp[e + 1], p0 = r.twist_deg[e], p1 = r.twist_deg[e + 1];
      return [...d0.map((v, j) => v + t * (d1[j] - v)), (p0 + t * (p1 - p0)) * Math.PI / 180];
    });
    for (let i = 0; i < n; i++) {
      const [dx, dy, dz, ph] = tw[i], p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]], q = [dx, dy, dz];
      q[b] += -p[c] * ph; q[c] += p[b] * ph;
      pos.setXYZ(i, p[0] + k * q[0], p[1] + k * q[1], p[2] + k * q[2]);
    }
  } else for (let i = 0; i < n; i++) pos.setXYZ(i, P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  pos.needsUpdate = true;
  V3.mesh.geometry.computeVertexNormals();
}
function drawOverlays() {
  if (!V3.overlay || !S.mesh) return;
  V3.overlay.children.slice().forEach((o) => V3.overlay.remove(o));
  const a = axisIdx(), sz = S.size, ink = new THREE.Color(css("--ink-2") || "#3A424D"), acc = new THREE.Color(css("--accent") || "#356AC3");
  // reference axis
  const p0 = centreAt(S.mesh.min[a]), p1 = centreAt(S.mesh.max[a]);
  p0.forEach((_, i) => { if (i !== a) { p0[i] = 0; p1[i] = 0; } });
  const axLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p0), new THREE.Vector3(...p1)]),
    new THREE.LineDashedMaterial({ color: ink, dashSize: sz / 60, gapSize: sz / 80, depthTest: false, transparent: true, opacity: 0.6 }));
  axLine.computeLineDistances();
  axLine.renderOrder = 2;
  V3.overlay.add(axLine);
  // shear centre of each section, dotted
  if (S.res && S.res.shear_centre) {
    const pts = S.res.shear_centre.map((p) => new THREE.Vector3(...p));
    const scLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: new THREE.Color(css("--accent") || "#356AC3"), dashSize: sz / 200, gapSize: sz / 150, depthTest: false }));
    scLine.computeLineDistances();
    scLine.renderOrder = 3;
    V3.overlay.add(scLine);
  }
  // supports: a block on the reference axis
  for (const s of S.supports) {
    const p = centreAt(s.s); p.forEach((_, i) => { if (i !== a) p[i] = 0; });
    const dim = [sz * 0.03, sz * 0.03, sz * 0.03]; dim[a] = sz * (s.kind === "fixed" ? 0.012 : 0.006);
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dim), new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: s.kind === "roller" ? 0.35 : 0.7 }));
    m.position.set(...p);
    V3.overlay.add(m);
  }
  // loads: arrows ending at the load point
  const L = sz * 0.12;
  for (const p of S.pls) {
    const v = new THREE.Vector3(...p.F);
    if (v.length() === 0) continue;
    v.normalize();
    const tip = new THREE.Vector3(...p.at);
    V3.overlay.add(new THREE.ArrowHelper(v, tip.clone().addScaledVector(v, -L), L, acc, L * 0.25, L * 0.12));
  }
  for (const l of S.lls) {
    const v = new THREE.Vector3(...l.q);
    if (v.length() === 0) continue;
    v.normalize();
    for (let j = 0; j <= 6; j++) {
      const p = l.through.slice(); p[a] = l.s0 + (j / 6) * (l.s1 - l.s0);
      const tip = new THREE.Vector3(...p);
      V3.overlay.add(new THREE.ArrowHelper(v, tip.clone().addScaledVector(v, -L * 0.6), L * 0.6, acc, L * 0.15, L * 0.08));
    }
  }
  // the lowest safety factor
  if (S.res && S.res.worst && S.view === "R") {
    const m = new THREE.Mesh(new THREE.SphereGeometry(sz * 0.008, 16, 12), new THREE.MeshBasicMaterial({ color: ink }));
    m.position.set(...S.res.worst.at);
    V3.overlay.add(m);
  }
}
document.querySelectorAll("#viewMode button").forEach((b) => b.addEventListener("click", () => {
  S.view = b.dataset.v;
  document.querySelectorAll("#viewMode button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  paint(); drawOverlays();
}));
$("deform").addEventListener("change", paint);
$("themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("composites_calculator_theme", document.documentElement.dataset.theme); } catch (e) { /* this visit only */ }
  setTheme(); renderPlots();
});

// ---------------------------------------------------------------- span plots (one series each, shared span axis)
function plotSVG(id, title, xs, ys, unit, { ref = null, logY = false } = {}) {
  const W = 320, H = 130, l = 44, rgt = 8, t = 8, b = 22;
  const pts = xs.map((x, i) => [x, ys[i]]).filter((p) => p[1] !== null && Number.isFinite(p[1]));
  if (!pts.length) return `<div class="plot"><h3>${title}</h3><p class="hint">—</p></div>`;
  const tf = (v) => (logY ? Math.log10(Math.max(v, 1e-6)) : v);
  let y0 = Math.min(...pts.map((p) => tf(p[1]))), y1 = Math.max(...pts.map((p) => tf(p[1])));
  if (ref !== null) { y0 = Math.min(y0, tf(ref)); y1 = Math.max(y1, tf(ref)); }
  if (!logY) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  if (y1 - y0 < 1e-12) { y1 += 1; y0 -= logY ? 0 : 1; }
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = (x) => l + ((x - x0) / (x1 - x0 || 1)) * (W - l - rgt), Y = (v) => t + (1 - (tf(v) - y0) / (y1 - y0)) * (H - t - b);
  const lab = (v) => fmt(logY ? 10 ** v : v, 3);
  const ticks = [y0, (y0 + y1) / 2, y1];
  const grid = ticks.map((v) => { const yy = t + (1 - (v - y0) / (y1 - y0)) * (H - t - b); return `<line x1="${l}" x2="${W - rgt}" y1="${yy}" y2="${yy}" stroke="var(--line-soft)"/><text x="${l - 5}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)" class="mono">${lab(v)}</text>`; }).join("");
  const xt = [x0, (x0 + x1) / 2, x1].map((x, i) => `<text x="${X(x)}" y="${H - 6}" text-anchor="${["start", "middle", "end"][i]}" font-size="10" fill="var(--muted)" class="mono">${fmt(x, 3)}</text>`).join("");
  const refL = ref !== null ? `<line x1="${l}" x2="${W - rgt}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="var(--bad)" stroke-dasharray="4 3"/><text x="${W - rgt}" y="${Y(ref) - 3}" text-anchor="end" font-size="10" fill="var(--bad-ink)">R = 1</text>` : "";
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  S.plotData = S.plotData || {};
  S.plotData[id] = { pts, X, Y, unit, W, H, l, rgt, t, b };
  return `<div class="plot"><h3>${title}</h3><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-plot="${id}" role="img" aria-label="${title} along the span">${grid}${xt}${refL}` +
    `<path d="${path}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><g class="xh"></g>` +
    `<rect x="${l}" y="${t}" width="${W - l - rgt}" height="${H - t - b}" fill="transparent"/></svg></div>`;
}
function renderPlots() {
  const r = S.res;
  if (!r) { $("plots").innerHTML = ""; return; }
  const ax = $("axis").value, u = S.unit;
  $("plots").innerHTML =
    plotSVG("d", `Deflection, ${u} · along ${ax}`, r.x, r.disp.map((d) => Math.hypot(...d)), u) +
    plotSVG("t", `Twist, ° · along ${ax}`, r.x, r.twist_deg, "°") +
    plotSVG("R", `Lowest safety factor R per section · along ${ax}`, r.x_mid, r.R_min_section, "", { ref: 1, logY: true });
}
// hover: crosshair on the nearest point with a read-out
$("plots").addEventListener("mousemove", (e) => {
  const svg = e.target.closest("svg[data-plot]");
  if (!svg) return;
  const d = S.plotData[svg.dataset.plot], box = svg.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * d.W;
  let best = d.pts[0];
  for (const p of d.pts) if (Math.abs(d.X(p[0]) - x) < Math.abs(d.X(best[0]) - x)) best = p;
  const cx = d.X(best[0]), cy = d.Y(best[1]);
  svg.querySelector(".xh").innerHTML = `<line x1="${cx}" x2="${cx}" y1="${d.t}" y2="${d.H - d.b}" stroke="var(--line-strong)"/><circle cx="${cx}" cy="${cy}" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>`;
  hoverTip(`<span class="mono">${$("axis").value} = ${fmt(best[0])} ${S.unit}</span><br><b>${svg.dataset.plot === "R" ? "R " + fmtR(best[1]) : fmt(best[1]) + " " + d.unit}</b>`, e);
});
$("plots").addEventListener("mouseleave", () => { document.querySelectorAll("#plots .xh").forEach((g) => (g.innerHTML = "")); hoverTip(null); });

initThree();
boot();
