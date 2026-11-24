"use strict";
// Application shell: start-up, module navigation, recalculation and input wiring.

async function boot() {
  const status = $("status");
  try {
    const [libResp, dbResp, brResp] = await Promise.all([fetch(LIB_URL), fetch(DB_URL), fetch(BRIDGE_URL)]);
    if (!libResp.ok) throw new Error(`Could not load ${LIB_URL} (${libResp.status}). It must sit next to this page.`);
    if (!dbResp.ok) throw new Error(`Could not load ${DB_URL} (${dbResp.status}). It must sit next to this page.`);
    if (!brResp.ok) throw new Error(`Could not load ${BRIDGE_URL} (${brResp.status}).`);
    const [libSrc, dbCsv, bridgeSrc] = await Promise.all([libResp.text(), dbResp.text(), brResp.text()]);
    const pyodide = await loadPyodide();
    status.textContent = "Loading numpy and pandas…";
    await pyodide.loadPackage(["numpy", "pandas", "micropip"]);
    try {
      await pyodide.runPythonAsync('import micropip\nawait micropip.install("tabulate")');
    } catch (e) {
      // tabulate only formats the library's printed tables; fall back to plain text if it cannot be downloaded
      pyodide.runPython('import sys, types\n_t = types.ModuleType("tabulate")\n_t.tabulate = lambda data, *a, **k: data.to_string() if hasattr(data, "to_string") else str(data)\nsys.modules["tabulate"] = _t');
    }
    pyodide.FS.writeFile("composites_calculator_lib.py", libSrc);
    pyodide.runPython(bridgeSrc);
    pyApi = pyodide.globals.get("api");
    const r = call("materials", { csv: dbCsv, custom: loadCustom() });
    if (!r.ok) throw new Error(r.error);
    applyMaterials(r.result, true);
    $("preset").disabled = false; $("sPreset").disabled = false;
    status.textContent = "Ready";
    status.className = "ready";
    status.hidden = true; $("statusDiv").hidden = true;
    libVersion = r.result.version;
    $("foot").textContent = `composites_calculator_lib v${r.result.version} (${r.result.update_date}) · Python runs locally in the browser via Pyodide`;
    // Simple mode starts from a ready-made part, so there is something to load straight away
    if (uiMode === "simple" && !$("preset").value && PRESETS.length) applyPreset(PRESETS[0].id);
    else recalc();
  } catch (e) {
    status.textContent = "Failed to start: " + (e.message || e) + (location.protocol === "file:" ? " Open this page through a web server, not as a file." : "");
    status.className = "error";
    status.title = status.textContent;
  }
}

// ---------- recalculation: every module, as before ----------
function waitAll(text) {
  const w = emptyHTML(text);
  ["iLam", "iTube", "iFail", "iBolt", "iClamp", "iVib"].forEach((id) => ($(id).innerHTML = w));
  ["lamDetail", "tubeDetail", "failDetail", "boltDetail", "clampDetail", "failPlot", "vibDetail", "vTubeViz", "vPlateViz"].forEach((id) => ($(id).innerHTML = ""));
  ["laminate", "tube", "failure", "beam", "bolt", "clamp", "vibration"].forEach((m) => setStatus(m, "none", "waiting"));
}
function recalc() {
  if (!pyApi) return;
  const t0 = performance.now();
  const spec = layupSpec();
  const layMsgs = [];
  const finish = () => {
    $("layupMsgs").innerHTML = layMsgs.join("");
    $("solveTime").textContent = `solved in ${Math.round(performance.now() - t0)} ms`;
    renderLayupRead();
    renderSimple();
  };
  if (!spec) {
    layMsgs.push(errHTML("Enter at least one ply in the sequence."));
    $("stackViz").innerHTML = ""; $("layerTable").innerHTML = ""; renderMiniStack(null); $("layupSum").textContent = "";
    state.lam = state.bend = state.tor = null; state.layers = null; state.rows = [];
    waitAll("Waiting for a valid layup."); renderBeam(); finish(); return;
  }
  const lay = call("layers", { layup: spec });
  if (!lay.ok) {
    layMsgs.push(errHTML("Could not read the sequence: " + lay.error));
    state.lam = state.bend = state.tor = null;
    waitAll("Waiting for a valid layup."); renderBeam(); finish(); return;
  }
  layupWarnings(lay.result).forEach((w) => layMsgs.push(msgHTML("warn", w)));
  const lam = call("laminate", { layup: spec });
  state.lam = lam.ok ? lam.result : null;
  renderLayerTable(lay.result, state.lam);
  renderStack(lay.result, state.lam);
  renderMiniStack(lay.result);  // after the table: it reuses the table rows
  if (!lam.ok) {
    layMsgs.push(errHTML(lam.error));
    $("layupSum").textContent = "";
    state.bend = state.tor = null;
    waitAll("Waiting for a valid layup."); renderBeam(); finish(); return;
  }
  const L = lam.result, nPly = L.layers.filter((l) => !l.is_core).length;
  $("layupSum").textContent = `${nPly} layers · h ${fmt(L.h_total * 1000)} mm · ${fmt(L.areal_mass)} kg/m²`;
  renderLaminate(L, lam.log);
  renderTube(spec);
  renderFailure(spec);
  renderBolt(spec);
  renderClamp(spec);
  renderVibration(spec);
  renderHelper();
  renderBeam();
  if (state.matSel) renderMaterialInspector();
  finish();
}
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(recalc, 250); }

// ---------- navigation ----------
const MODULES = {
  simple: ["Quick check", "Load a part, apply a load case and see how far it deflects and whether it holds."],
  laminate: ["Laminate", "Thickness, mass and the A, B, D stiffness matrices of the layup, from classical laminate theory."],
  tube: ["Tube Stiffness", "Bending and torsion of a tube whose wall is the current layup."],
  failure: ["Failure Analysis", "Ply-by-ply safety factors of the layup under applied stress and moment resultants."],
  beam: ["Beam", "Deflection and strength of a beam made from the current tube."],
  clamp: ["Tube Clamp", "A tube gripped by two clamp halves screwed together: whether the wall survives the preload, and the force needed to slide the clamp along the tube."],
  bolt: ["Bolted Joint", "How much in-plane load a bolt or dowel through a drilled hole in the laminate can take: bearing, net-tension and shear-out."],
  vibration: ["Vibration", "Natural frequencies of the current tube as a beam (bending, torsion, axial) and of a flat, simply supported plate of the current layup."],
  materials: ["Materials", "Ply material properties available to the layup builder."],
  upcoming: ["Roadmap", "Features planned for later versions."],
  feedback: ["Feedback", "Report a wrong result, an error or a missing feature on GitHub, with a screenshot."],
};
const MODULE_KEY = "composites_calculator_module";
// the GitHub issue form, with the version and the current layup filled in (fields are matched by their id)
const ISSUES_URL = "https://github.com/AlexLyakishev/CompositesCalculator/issues";
let libVersion = null;
function setReportLink() {
  const spec = layupSpec();
  const setup = [`Page: ${location.href.split("#")[0]}`, `Library: v${libVersion || "?"}`, `Last module: ${MODULES[backTab] ? MODULES[backTab][0] : "?"}`,
    spec ? `Layup: ${spec.template}, ${spec.material}${Object.keys(spec.overrides).length ? " (with per-ply edits)" : ""}` : "Layup: none", `Browser: ${navigator.userAgent}`].join("\n");
  $("fbReport").href = `${ISSUES_URL}/new?template=bug_report.yml&setup=${encodeURIComponent(setup)}`;
}
let current = "laminate";
let fullTab = "laminate";  // the module Full mode returns to
let backTab = "laminate";  // the page open before Feedback
function showTab(name) {
  if (!MODULES[name] || (name !== "feedback" && (name === "simple") !== (uiMode === "simple"))) name = uiMode === "simple" ? "simple" : fullTab;
  if (name === "feedback" && current !== "feedback") backTab = current;  // where Back returns to, and what the report names
  current = name;
  $("fbBtn").setAttribute("aria-pressed", String(name === "feedback"));
  if (name !== "simple" && name !== "feedback") fullTab = name;
  document.querySelectorAll(".nav button[data-tab]").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false"));
  document.querySelectorAll(".module").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  document.querySelectorAll(".insp").forEach((p) => (p.hidden = p.dataset.mod !== name));
  // the toolbar names the module; its description is a tooltip and the browser tab title, so it is never cut off
  $("modTitle").textContent = MODULES[name][0];
  $("modTitle").title = MODULES[name][1];
  document.title = `${MODULES[name][0]} · Composites Calculator`;
  $("layupBar").hidden = name === "materials" || name === "upcoming" || name === "feedback" || name === "simple";  // these do not show the layup
  // the layup is the main input on Laminate; everywhere else it is context, shown as one read-only line
  $("layupBar").classList.toggle("compact", name !== "laminate");
  $("editLayup").hidden = name === "laminate";
  renderLayupRead();
  document.body.classList.toggle("no-inspector", name === "upcoming" || name === "feedback");
  if (name === "feedback") setReportLink();
  document.body.classList.remove("sb-open");
  $("workspace").scrollTop = 0;
  if (name !== "simple" && name !== "feedback") { try { localStorage.setItem(MODULE_KEY, name); } catch (e) { /* not remembered */ } }
}
document.querySelectorAll(".nav button[data-tab]").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
$("fbBtn").addEventListener("click", () => showTab(current === "feedback" ? backTab : "feedback"));
$("fbBack").addEventListener("click", () => showTab(backTab));

// interface mode: Simple (one part, one load case, a verdict) or Full (every module). A first visit opens in
// Simple; after that the page opens in the mode last used.
const UI_KEY = "composites_calculator_ui_mode";
let uiMode = "simple";
function setUiMode(m, tab) {
  uiMode = m === "full" ? "full" : "simple";
  try { localStorage.setItem(UI_KEY, uiMode); } catch (e) { /* this visit only */ }
  document.body.classList.toggle("simple", uiMode === "simple");
  document.querySelectorAll("#uiMode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ui === uiMode)));
  showTab(uiMode === "simple" ? "simple" : tab || fullTab);
}
document.querySelectorAll("#uiMode button").forEach((b) => b.addEventListener("click", () => setUiMode(b.dataset.ui)));
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-full]");
  if (f) setUiMode("full", f.dataset.full);
  if (e.target.closest("#sToFull")) { const tab = simpleToFull(); setUiMode("full", tab); recalc(); }
});

// sidebar: collapses to icons when asked or when the window is narrow; a drawer on small screens
const SIDEBAR_KEY = "composites_calculator_sidebar_collapsed";
const narrowScreen = window.matchMedia("(max-width: 1180px)");
function savedCollapse() { try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch (e) { return false; } }
function setCollapsed(on) {
  document.body.classList.toggle("sb-collapsed", on);
  $("sbToggle").setAttribute("aria-expanded", String(!on));
  $("sbToggle").title = on ? "Expand sidebar" : "Collapse sidebar";
}
setCollapsed(narrowScreen.matches || savedCollapse());
narrowScreen.addEventListener("change", () => setCollapsed(narrowScreen.matches || savedCollapse()));
$("sbToggle").addEventListener("click", () => {
  const on = !document.body.classList.contains("sb-collapsed");
  setCollapsed(on);
  if (!narrowScreen.matches) { try { localStorage.setItem(SIDEBAR_KEY, on ? "1" : "0"); } catch (e) { /* preference lasts for this visit only */ } }
});
$("menuBtn").addEventListener("click", () => document.body.classList.toggle("sb-open"));
$("backdrop").addEventListener("click", () => document.body.classList.remove("sb-open"));

// results inspector: can be hidden for a moment to give the workspace the full width, but every visit starts with it
// shown: the results are the reason the app exists, so a hidden panel is never remembered
function setInspector(hidden) {
  document.body.classList.toggle("ip-collapsed", hidden);
  $("ipToggle").setAttribute("aria-expanded", String(!hidden));
  $("ipToggle").title = hidden ? "Show results panel" : "Hide results panel";
}
setInspector(false);
try { localStorage.removeItem("composites_calculator_inspector_hidden"); } catch (e) { /* nothing stored */ }
$("ipToggle").addEventListener("click", () => setInspector(!document.body.classList.contains("ip-collapsed")));

// theme: light (default), dark, or following the system
const THEME_KEY = "composites_calculator_theme";
$("themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* this visit only */ }
});

// ---------- inputs ----------
document.querySelectorAll(".live").forEach((el) => el.addEventListener("input", schedule));
// Enter commits a parameter immediately instead of waiting for the debounce
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input.live, #seq")) { e.preventDefault(); clearTimeout(timer); if (e.target.id === "seq") normaliseSeq(); recalc(); }
});
$("preset").addEventListener("change", (e) => applyPreset(e.target.value));
// any manual change to the layup or the tube geometry means the inputs are no longer the preset
["layupBar", "plyEditor", "tubeGeom"].forEach((id) => {
  $(id).addEventListener("input", (e) => { if (e.target.id !== "linkMirror" && e.target.id !== "preset") clearPreset(); });
  $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.dataset.goto) clearPreset(); });
});
$("seq").addEventListener("input", () => { state.overrides = {}; state.selRow = null; schedule(); });
$("seq").addEventListener("change", () => { normaliseSeq(); schedule(); });
$("baseMat").addEventListener("change", schedule);
document.querySelectorAll("[data-tok]").forEach((b) => b.addEventListener("click", () => insertToken(b.dataset.tok)));
$("seqBack").addEventListener("click", () => { $("seq").value = tokens().slice(0, -1).join("/"); state.overrides = {}; state.selRow = null; recalc(); });
document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode); state.overrides = {}; state.selRow = null; recalc(); }));
$("resetEdits").addEventListener("click", () => { state.overrides = {}; recalc(); });
document.querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => editSequence(SEQ_OPS[b.dataset.op])));

// ply table: select rows, edit cells, keyboard shortcuts
$("layerTable").addEventListener("change", (e) => {
  const tr = e.target.closest("tr[data-row]"), f = e.target.dataset.f;
  if (tr && f) applyRowEdit(+tr.dataset.row, f, e.target.value);
});
$("layerTable").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-row]");
  if (tr && +tr.dataset.row !== state.selRow) selectRow(+tr.dataset.row);
});
$("layerTable").addEventListener("focusin", (e) => {
  const tr = e.target.closest("tr[data-row]");
  if (tr && +tr.dataset.row !== state.selRow) selectRow(+tr.dataset.row);
});
document.addEventListener("keydown", (e) => {
  if (current !== "laminate" || state.selRow === null) return;
  const inField = e.target.matches("input, select, textarea");
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); editSequence(SEQ_OPS[e.key === "ArrowUp" ? "up" : "down"]); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && !inField) { e.preventDefault(); editSequence(SEQ_OPS.dup); return; }
  if (inField) return;
  if (e.key === "Delete") { e.preventDefault(); editSequence(SEQ_OPS.del); }
  if (e.key === "ArrowUp" && state.selRow > 0) { e.preventDefault(); selectRow(state.selRow - 1); }
  if (e.key === "ArrowDown" && state.selRow < state.rows.length - 1) { e.preventDefault(); selectRow(state.selRow + 1); }
  if (e.key === "Escape") selectRow(null);
});
// drawings: hover read-outs and click to select
document.addEventListener("mousemove", (e) => {
  const h = e.target.closest && e.target.closest("[data-hover]");
  if (h) hoverTip(h.dataset.hover, e);
  else if (e.target.closest && e.target.closest("#stackViz, #failPlot")) hoverTip(null);
});
$("stackViz").addEventListener("mouseleave", () => hoverTip(null));
$("failPlot").addEventListener("mouseleave", () => hoverTip(null));
$("stackViz").addEventListener("click", (e) => { const g = e.target.closest("[data-row]"); if (g && +g.dataset.row >= 0) selectRow(+g.dataset.row); });
// failure: a ply picked in the table or the plot is marked in both
function selectFailLayer(n) {
  state.failSel = state.failSel === n ? null : n;
  document.querySelectorAll("#failTable tbody tr").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.layer === state.failSel));
  renderFailPlot();
}
$("failDetail").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-layer]"); if (tr) selectFailLayer(+tr.dataset.layer); });
$("failPlot").addEventListener("click", (e) => { const r = e.target.closest("[data-layer]"); if (r) selectFailLayer(+r.dataset.layer); });

document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => {
  $("pts").value = examplePoints(b.dataset.ex); if (b.dataset.ex === "naca") $("surface").value = "outer"; recalc();
}));
$("ptsUploadBtn").addEventListener("click", () => $("ptsFile").click());
$("ptsFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) { $("pts").value = await f.text(); recalc(); } e.target.value = ""; });
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) showTab(go.dataset.goto);
});
document.querySelectorAll(".hlive").forEach((el) => el.addEventListener("input", renderHelper));
document.querySelectorAll(".tlive").forEach((el) => el.addEventListener("input", renderTorqueHelper));
$("cTqApply").addEventListener("click", () => { if (state.clampTorqueF) { $("cF").value = trim6(state.clampTorqueF); recalc(); } });
$("cCopy").addEventListener("click", () => {
  const sec = sectionSpec(), msg = $("cCopyMsg");
  const preset = PRESETS.find((x) => x.id === $("preset").value);
  msg.hidden = false;
  if (preset && preset.clamp) {
    $("cShape").value = "rect"; $("cW").value = trim6(preset.clamp.width * 1000); $("cH").value = trim6(preset.clamp.height * 1000); $("cR").value = trim6(preset.clamp.radius * 1000);
    msg.textContent = "Took the preset tube, gripped on its wide faces. Swap width and height to grip the narrow faces.";
  } else if (sec.type === "circ" && !sec.error) { $("cShape").value = "round"; $("cD").value = trim6(sec.d_in * 1000); msg.textContent = "Took the round tube from Tube Stiffness."; }
  else if (sec.type === "rect" && !sec.error) {
    $("cShape").value = "rect"; $("cW").value = trim6(sec.width * 1000); $("cH").value = trim6(sec.height * 1000); $("cR").value = 0;
    msg.textContent = "Took the rectangular tube from Tube Stiffness, gripped on its width faces, with sharp inside corners. Enter the real corner radius if it has one.";
  } else { msg.textContent = "An arbitrary section from points cannot be used here; enter the size of the round or rectangular tube instead."; return; }
  recalc();
});
$("hApply").addEventListener("click", () => {
  if (!state.helper) return;
  ["N1", "N2", "N6"].forEach((id, i) => ($(id).value = trim6(state.helper.N[i])));
  ["M1", "M2", "M6"].forEach((id, i) => ($(id).value = trim6(state.helper.M[i])));
  recalc();
});

setMode("so");
renderHelper();
renderTorqueHelper();
try { fullTab = MODULES[localStorage.getItem(MODULE_KEY)] ? localStorage.getItem(MODULE_KEY) : "laminate"; } catch (e) { /* default module */ }
try { setUiMode(localStorage.getItem(UI_KEY) || "simple"); } catch (e) { setUiMode("simple"); }
boot();
