"use strict";
// Laminate module: thickness, mass and the A, B, D stiffness matrices from classical laminate theory.

const MATRIX_INFO = {
  A: "Extensional stiffness. Links in-plane forces per unit width N to mid-plane strains: N = A·ε. Non-zero A16 or A26 means pulling the laminate also shears it (unbalanced layup).",
  B: "Coupling stiffness. Links in-plane forces to curvature, and moments to strain: N = A·ε + B·κ, M = B·ε + D·κ. Zero for a symmetric layup; otherwise pulling the laminate also bends or twists it.",
  D: "Bending stiffness. Links moments per unit width M to curvatures: M = D·κ. It depends strongly on how far each ply is from the mid-plane. Non-zero D16 or D26 means bending also twists the laminate.",
  C: "A, B and D divided by the thickness so that every term is in GPa, like a material modulus: A* = A/h, B* = 6B/h², D* = 12D/h³, arranged as [A* B*; B* D*]. A* is the laminate's effective in-plane stiffness and D* its effective bending stiffness; they are equal for a homogeneous plate, so the difference shows the effect of stacking order. C still links strains and curvatures to N and M: it is not a 3D solid stiffness tensor, so give FE shell elements A, B and D instead.",
};

function renderLaminate(r, log) {
  copyStore = [];
  const nPly = r.layers.filter((l) => !l.is_core).length, nCore = r.layers.length - nPly;
  const mats = [...new Set(r.layers.filter((l) => !l.is_core).map((l) => l.material))];
  // for a layup, symmetry and balance are the verdict: they say which couplings the laminate has
  const ok = r.symmetric && r.balanced;
  const couplings = [r.symmetric ? "" : "B ≠ 0: in-plane loads also bend or twist the laminate", r.balanced ? "" : "A₁₆, A₂₆ ≠ 0: tension–shear coupling"].filter(Boolean);
  $("iLam").innerHTML =
    verdict({ tone: ok ? "good" : "warn", word: `${r.symmetric ? "Symmetric" : "Unsymmetric"} · ${r.balanced ? "balanced" : "unbalanced"}`,
      text: ok ? "No extension–bending or tension–shear coupling" : couplings.join("<br>") }) +
    isec("", primary([
      { name: "Laminate thickness", sym: "h", value: fmt(r.h * 1000), unit: "mm", note: nCore ? "plies only" : "" },
      nCore ? { name: "Total thickness", sym: "h<sub>total</sub>", value: fmt(r.h_total * 1000), unit: "mm", note: "including core" } : null,
      { name: "Areal mass", value: fmt(r.areal_mass), unit: "kg/m²" },
    ])) +
    isec("Layup", secondary([
      { name: "Layers", value: String(nPly) + (nCore ? ` + ${nCore} core` : ""), text: true },
      { name: "Materials", value: mats.map(esc).join("<br>"), text: true },
    ])) +
    isec("Stiffness matrices",
      matrixBlock("A", "GPa·m (10⁹ N/m)", r.A, MATRIX_INFO.A) +
      // a symmetric layup has no B: a 3 × 3 grid of zeros says nothing a single line does not
      (r.symmetric ? `<div class="mxb"><div class="mxh"><b>B</b>${tipHTML(MATRIX_INFO.B)}<span class="u">= 0, symmetric layup</span></div></div>` : matrixBlock("B", "N", r.B, MATRIX_INFO.B)) +
      matrixBlock("D", "N·m", r.D, MATRIX_INFO.D));

  const plies = r.layers.filter((l) => !l.is_core).map((l) =>
    `<div class="h3" style="margin:14px 0 6px">Layer ${l.num} · ${angleText(l.orientation)} · ${esc(l.material)}</div><div class="mxgrid">` +
    [["Q on-axis", "GPa", l.Q], ["Q off-axis", "GPa", l.Q_off], ["S on-axis", "1/GPa", l.S], ["S off-axis", "1/GPa", l.S_off]]
      .map(([t, u, M]) => matrixBlock(t, u, M)).join("") + "</div>").join("");
  $("lamDetail").innerHTML = tabsHTML("lam", [
    { id: "c", title: "Normalised stiffness C", html: matrixBlock("C", "GPa · [A* B*; B* D*]", r.C, MATRIX_INFO.C, 3) },
    { id: "ply", title: `Ply matrices (${nPly})`, html: plies.replace('style="margin:14px 0 6px"', 'style="margin:0 0 6px"') },
    assumeTab("lam", "", log),
  ]);
  setStatus("laminate", ok ? "good" : "warn", ok ? "Symmetric, balanced" : "Check: " + (r.symmetric ? "unbalanced" : "unsymmetric"));
}
