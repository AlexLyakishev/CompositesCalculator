"use strict";
// Materials module: the ply material database (CSV) plus custom materials kept in this browser.

state.matSel = null;
const MAT_COLS = [
  ["name", "Material", "s"], ["custom", "Origin", "s"],
  ["Ex", "E<sub>x</sub>", "n", "GPa"], ["Ey", "E<sub>y</sub>", "n", "GPa"], ["Es", "E<sub>s</sub>", "n", "GPa"], ["vxy", "ν<sub>xy</sub>", "n", ""],
  ["Xt", "X<sub>t</sub>", "n", "MPa"], ["Xc", "X<sub>c</sub>", "n", "MPa"], ["Yt", "Y<sub>t</sub>", "n", "MPa"], ["Yc", "Y<sub>c</sub>", "n", "MPa"], ["Sc", "S<sub>c</sub>", "n", "MPa"],
  ["h0", "h<sub>0</sub>", "n", "mm"], ["rho", "ρ", "n", "kg/m³"], ["source", "Source", "s"],
];
function renderMaterials() {
  const q = ($("matSearch").value || "").trim().toLowerCase();
  const list = state.materials.filter((m) => !q || m.name.toLowerCase().includes(q) || String(m.source).toLowerCase().includes(q));
  if (state.matSel && !matByName(state.matSel)) state.matSel = null;
  const val = (m, k) => (k === "h0" ? m.h0 * 1000 : m[k]);
  $("matTable").innerHTML =
    '<thead><tr class="grp"><th colspan="2"></th><th colspan="4">Elastic (GPa)</th><th colspan="5">Strength (MPa)</th><th colspan="2">Ply</th><th></th></tr><tr>' +
    MAT_COLS.map(([k, t, s, u]) => `<th${s === "n" ? ' class="n"' : ""} data-sort="${s}" title="${u ? "in " + u : ""}">${t}${k === "h0" ? " (mm)" : k === "rho" ? " (kg/m³)" : ""}</th>`).join("") + "</tr></thead><tbody>" +
    list.map((m) => `<tr class="click${m.name === state.matSel ? " sel" : ""}" data-mat="${esc(m.name)}">` + MAT_COLS.map(([k, , s]) => {
      if (k === "name") return `<td>${esc(m.name)}</td>`;
      if (k === "custom") return `<td data-v="${m.custom ? 1 : 0}">${m.custom ? chip("info", "Custom") : '<span class="src">Database</span>'}</td>`;
      if (k === "source") return `<td class="src">${esc(m.source)}</td>`;
      return `<td class="n" data-v="${val(m, k)}">${fmt(val(m, k))}</td>`;
    }).join("") + "</tr>").join("") + "</tbody>";
  resort("matTable");
  $("matCount").textContent = `${list.length} of ${state.materials.length} materials`;
  renderMaterialInspector();
}
function renderMaterialInspector() {
  const m = state.matSel ? matByName(state.matSel) : null;
  $("matDel").disabled = !(m && m.custom);
  $("matDup").disabled = !m;
  if (!m) { $("iMat").innerHTML = emptyHTML("Select a material in the table to see its full property set."); return; }
  const inUse = state.layers && state.layers.some((l) => l.material === m.name);
  $("iMat").innerHTML =
    isec("Identification", secondary([
      { name: "Name", value: esc(m.name), text: true },
      { name: "Origin", value: m.custom ? chip("info", "Custom, this browser") : "Database CSV", text: true },
      { name: "Source", value: esc(m.source), text: true },
      { name: "In current layup", value: inUse ? chip("good", "yes") : "no", text: true },
    ])) +
    isec("Physical", secondary([
      { name: "Ply thickness", sym: "h<sub>0</sub>", value: fmt(m.h0 * 1000), unit: "mm" },
      { name: "Density", sym: "ρ", value: fmt(m.rho), unit: "kg/m³" },
      { name: "Areal mass per ply", value: fmt(m.h0 * m.rho * 1000, 4), unit: "g/m²" },
    ])) +
    isec("Elastic, fibre axes", secondary([
      { name: "Longitudinal modulus", sym: "E<sub>x</sub>", value: fmt(m.Ex), unit: "GPa" },
      { name: "Transverse modulus", sym: "E<sub>y</sub>", value: fmt(m.Ey), unit: "GPa" },
      { name: "In-plane shear modulus", sym: "E<sub>s</sub>", value: fmt(m.Es), unit: "GPa" },
      { name: "Major Poisson's ratio", sym: "ν<sub>xy</sub>", value: fmt(m.vxy) },
    ]), "Properties of a single ply in its own fibre axes, x along the fibres. Laminate-level properties are calculated in the Laminate module.") +
    isec("Strength", secondary([
      { name: "Longitudinal tension", sym: "X<sub>t</sub>", value: fmt(m.Xt), unit: "MPa" },
      { name: "Longitudinal compression", sym: "X<sub>c</sub>", value: fmt(m.Xc), unit: "MPa" },
      { name: "Transverse tension", sym: "Y<sub>t</sub>", value: fmt(m.Yt), unit: "MPa" },
      { name: "Transverse compression", sym: "Y<sub>c</sub>", value: fmt(m.Yc), unit: "MPa" },
      { name: "In-plane shear", sym: "S<sub>c</sub>", value: fmt(m.Sc), unit: "MPa" },
    ])) +
    `<div class="isec"><button class="btn sm" type="button" id="matUse">Use for all plies</button> <span class="hint">sets the layup material</span></div>`;
}
function openMatForm(from) {
  $("matFormPanel").hidden = false;
  $("matForm").reset();
  $("matFormMsg").textContent = "";
  if (from) {
    $("m_name").value = from.name + " (copy)"; $("m_source").value = from.source || "";
    $("m_h0").value = trim6(from.h0 * 1000); $("m_rho").value = from.rho;
    for (const k of ["Ex", "Ey", "Es", "vxy", "Xt", "Xc", "Yt", "Yc", "Sc"]) $("m_" + k).value = from[k];
  }
  $("matFormPanel").scrollIntoView({ block: "nearest" });
  $("m_name").focus();
}
(function wireMaterials() {
  $("matSearch").addEventListener("input", renderMaterials);
  $("matTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-mat]");
    if (!tr) return;
    state.matSel = tr.dataset.mat;
    $("matTable").querySelectorAll("tbody tr").forEach((r) => r.classList.toggle("sel", r === tr));
    renderMaterialInspector();
  });
  $("matNew").addEventListener("click", () => openMatForm(null));
  $("matDup").addEventListener("click", () => { const m = matByName(state.matSel); if (m) openMatForm(m); });
  $("matDel").addEventListener("click", () => {
    const m = matByName(state.matSel);
    if (!m || !m.custom || !confirm(`Remove the custom material “${m.name}” from this browser?`)) return;
    state.matSel = null;
    refreshMaterials(loadCustom().filter((x) => x.name !== m.name));
  });
  $("matCancel").addEventListener("click", () => { $("matFormPanel").hidden = true; });
  $("iMat").addEventListener("click", (e) => {
    if (e.target.id !== "matUse" || !state.matSel) return;
    $("baseMat").value = state.matSel; clearPreset(); recalc(); showTab("laminate");
  });
  $("matForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!pyApi) return;
    const name = $("m_name").value.trim(), msg = $("matFormMsg");
    if (!name || name.toLowerCase() === "core" || matByName(name)) { msg.textContent = name ? "That name is already in use." : "Enter a name."; return; }
    const m = { name, source: $("m_source").value.trim() || "Custom", h0: numVal("m_h0") / 1000, rho: numVal("m_rho") };
    for (const k of ["Ex", "Ey", "Es", "vxy", "Xt", "Xc", "Yt", "Yc", "Sc"]) m[k] = numVal("m_" + k);
    if (Object.values(m).some((v) => typeof v === "number" && !Number.isFinite(v))) { msg.textContent = "Fill in every property."; return; }
    state.matSel = name;
    refreshMaterials([...loadCustom(), m]);
    e.target.reset();
    msg.textContent = `Added “${name}”. Select it in the layup material or the ply table.`;
  });
})();
