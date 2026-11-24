"""Checks composites_shape_lib against the closed-form results of composites_calculator_lib. Run: py test_composites_shape_lib.py"""
import contextlib, io, os, tempfile
import numpy as np
import composites_calculator_lib as cc
import composites_shape_lib as cs

with contextlib.redirect_stdout(io.StringIO()):
    MATS = cc.materials_load()
MAT = MATS["Graphite_Epoxy_T300_N5208"]


def quiet(f, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return f(*a, **k)


def cylinder(R, L, nc=180, ns=21):
    th = np.linspace(0, 2 * np.pi, nc, endpoint=False)
    V = np.vstack([np.column_stack([np.full(nc, x), R * np.cos(th), R * np.sin(th)]) for x in np.linspace(0, L, ns)])
    F = []
    for i in range(ns - 1):
        for j in range(nc):
            a, b = i * nc + j, i * nc + (j + 1) % nc
            F += [(a, b, b + nc), (a, b + nc, a + nc)]
    return V, np.array(F)


def close(a, b, tol, what):
    err = abs(a - b) / abs(b)
    print(f"{'ok ' if err < tol else 'BAD'} {what}: {a:.6g} vs {b:.6g} ({err * 100:.3f} %)")
    assert err < tol, what


lu = cc.layup_create("0/45/-45/90/s", MAT)
quiet(cc.calculate_A_B_D_matrix, lu)
h = lu["Thickness (m)"].sum()
R, L = 0.02, 0.5
V, F = cylinder(R, L)

# 1. section stiffness equals the existing arbitrary-section function on the same polygon
loop = cs._clean_loop(cs.mesh_slice(V, F, "x", 0.25)[0], 1.0)
csv = os.path.join(tempfile.mkdtemp(), "sec.csv")
np.savetxt(csv, loop, delimiter=",", header="x2,x3", comments="")
ref = quiet(cc.generate_EIeq_arbitrary_tube, csv, lu, "outer")
sec = cs.section_properties(loop[:, 0], loop[:, 1], lu, "outer")
close(sec["EI_y"], ref["EI_3"], 1e-9, "EI_y vs generate_EIeq_arbitrary_tube")
close(sec["EA"], ref["EA"], 1e-9, "EA vs generate_EIeq_arbitrary_tube")
tor = quiet(cc.generate_torsion_arbitrary_tube, csv, lu, 1.0, 0.0, "outer")
close(sec["GJ"], tor["GJ_eq"], 1e-9, "GJ vs generate_torsion_arbitrary_tube")
A, B, D = quiet(cc.calculate_A_B_D_matrix, lu)
Dx = quiet(cc.generate_Dx_eq_circ_tube, A, D, 2 * (R - h), lu)
close(sec["EI_y"], Dx, 2e-3, "EI_y vs circular tube formula (180-sided polygon)")

# 2. cantilever, tip load: P L^3 / 3 EI; torque: T L / GJ
P, T = 50.0, 20.0
r = quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "fixed")],
          point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P), "M_axis": T}])
close(-r["disp"][-1, 2], P * L ** 3 / (3 * sec["EI_z"]), 1e-6, "cantilever tip deflection")
close(r["twist_deg"][-1], np.degrees(T * L / sec["GJ"]), 1e-6, "cantilever tip twist")
close(r["reactions"][0]["F"][2], P, 1e-6, "support reaction")

# 3. simply supported, uniform load: 5 q L^4 / 384 EI at mid-span
q = 200.0
r = quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "pinned"), ("end", "roller")],
          line_loads=[{"s0": "start", "s1": "end", "q": (0, 0, -q)}])
close(-r["disp"][10, 2], 5 * q * L ** 4 / (384 * sec["EI_z"]), 1e-4, "simply supported mid-span deflection")

# 4. ply check against calculate_safety_factors at the most loaded point of the cantilever root
r = quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "fixed")],
          point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P), "M_axis": T}])
w = r["worst"]
sf = quiet(cc.calculate_safety_factors, lu, np.array([w["N1"], 0, w["N6"]]), np.array([w["M1"], 0, 0]))
cols = [c for c in sf.columns if c not in ("Layer #", "T/B")]
close(w["R"], float(sf[cols].min().min()), 1e-6, "lowest R vs calculate_safety_factors")
# and the root bending stress matches M c / I for the 0 deg ply, outer fibre
print("worst:", w["criterion"], w["mode"], "layer", w["layer"], w["location"], "at", np.round(w["at"], 4))

# 5. offset load makes torque: a vertical load 30 mm to the side twists the tube by P*0.03*L/GJ
r = quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "fixed")],
          point_loads=[{"at": (L, 0.03, 0), "F": (0, 0, -P)}])
close(r["twist_deg"][-1], np.degrees(-P * 0.03 * L / sec["GJ"]), 1e-6, "twist from offset load")

# 6. gravity: cantilever under own weight, w L^4 / 8 EI
r = quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "fixed")], gravity=(0, 0, -9.81))
close(-r["disp"][-1, 2], sec["mass"] * 9.81 * L ** 4 / (8 * sec["EI_z"]), 1e-4, "self-weight tip deflection")
close(r["mass"], sec["mass"] * L, 1e-9, "mass")

# 7. the slicer and STL reader: write a binary STL of the example wing and read it back
Vw, Fw = cs.mesh_example("wing")
path = os.path.join(tempfile.mkdtemp(), "wing.stl")
tri = (Vw[Fw] * 1000).astype("<f4")
with open(path, "wb") as f:
    f.write(b"\0" * 80 + np.uint32(len(tri)).tobytes())
    rec = np.zeros(len(tri), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    rec["v"] = tri
    f.write(rec.tobytes())
V2, F2 = cs.mesh_load_stl(path, 0.001)
assert len(F2) == len(Fw), (len(F2), len(Fw))
for kind in ("tube", "wing", "arm"):
    Vk, Fk = cs.mesh_example(kind)
    r = quiet(cs.shape_analyse, Vk, Fk, lu, "x", 30, "outer", [("start", "fixed")],
              point_loads=[{"at": (Vk[:, 0].max(), 0, 0), "F": (0, 0, -20)}], gravity=(0, 0, -9.81))
    print(f"ok  example {kind}: mass {r['mass'] * 1000:.1f} g, tip {r['max_disp'] * 1000:.2f} mm, "
          f"twist {r['max_twist_deg']:.3f} deg, R {r['worst']['R']:.2f}")

# 8. shear flow and shear centre
def prism(profile, L, ns=21):
    m = len(profile)
    V = np.vstack([np.column_stack([np.full(m, x), profile]) for x in np.linspace(0, L, ns)])
    F = []
    for i in range(ns - 1):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            F += [(a, b, b + m), (a, b + m, a + m)]
    return V, np.array(F)


th = np.linspace(0, 2 * np.pi, 400, endpoint=False)
circ = np.column_stack([R * np.cos(th) + 0.01, R * np.sin(th) - 0.005])
sf_c = cs.section_shear_flow(circ)
close(sf_c["shear_centre"][0], 0.01, 1e-9, "circle shear centre y (off-origin circle)")
close(sf_c["shear_centre"][1], -0.005, 1e-9, "circle shear centre z")
close(np.abs(sf_c["q_Vz"]).max(), 1 / (np.pi * R), 1e-3, "circle peak shear flow V / (pi R)")

# D section (semicircle radius r and a flat web on y = 0): by hand, with I = r^3 (pi/2 + 2/3) and S = r (pi + 2),
# q0 = -(4 r^3 / 3) / (I S) and y_sc = r^2 (2 r^2 / I + pi q0) = 0.5297 r from the web
r = 0.03
t = np.linspace(-np.pi / 2, np.pi / 2, 401)
Dsec = np.vstack([np.column_stack([r * np.cos(t), r * np.sin(t)]), np.column_stack([np.zeros(199), np.linspace(r, -r, 201)[1:-1]])])
I = r ** 3 * (np.pi / 2 + 2 / 3)
q0 = -(4 * r ** 3 / 3) / (I * r * (np.pi + 2))
y_sc = r ** 2 * (2 * r ** 2 / I + np.pi * q0)
sf_d = cs.section_shear_flow(Dsec)
close(sf_d["shear_centre"][0], y_sc, 2e-3, "D-section shear centre vs hand calculation")
assert abs(sf_d["shear_centre"][1]) < 1e-9 * r

# beam: a D-section cantilever loaded through its shear centre does not twist; loaded on the web it twists by
# P * y_sc * L / GJ. (The mesh is the outer surface; the shear centre is that of the wall midline.)
VD, FD = prism(Dsec, L)
r0 = quiet(cs.shape_analyse, VD, FD, lu, "x", 20, "outer", [("start", "fixed")],
           point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P)}])
sec_d = r0["sections"][-1]
ysc_mid = sec_d["shear_centre"][0]
r1 = quiet(cs.shape_analyse, VD, FD, lu, "x", 20, "outer", [("start", "fixed")],
           point_loads=[{"at": (L, ysc_mid, 0), "F": (0, 0, -P)}])
assert abs(r1["twist_deg"][-1]) < 1e-9, r1["twist_deg"][-1]
print("ok  load through the shear centre: no twist")
close(r0["twist_deg"][-1], np.degrees(P * ysc_mid * L / sec_d["GJ"]), 1e-6, "twist of load on the web")
close(r0["forces"][5]["V_z"], -P, 1e-9, "internal shear force")
close(r0["forces"][5]["T"], P * ysc_mid, 1e-9, "internal torque about the shear centre")
assert abs(r0["reactions"][0]["M_axis"]) < 1e-9, r0["reactions"][0]["M_axis"]
print("ok  reaction torque about the span axis is zero for a load on that axis")

# ply check: a stubby round cantilever where shear matters. At the side of the tube (neutral axis) the wall carries
# only the shear flow V / (pi R_mid)
Lc = 0.05
Vc, Fc = cylinder(R, Lc)
rc = quiet(cs.shape_analyse, Vc, Fc, lu, "x", 10, "outer", [("start", "fixed")],
           point_loads=[{"at": (Lc, 0, 0), "F": (0, 0, -P)}])
assert rc["worst"] is not None
sec0 = quiet(cs.section_properties, loop[:, 0], loop[:, 1], lu, "outer", 64)
k_side = int(np.argmin(np.abs(sec0["mid_points"][:, 1]) + (sec0["mid_points"][:, 0] < 0)))
close(abs(sec0["q_Vz"][k_side]), 1 / (np.pi * (R - h / 2)), 2e-3, "shear flow at the neutral axis, per newton")

print("all checks passed")
