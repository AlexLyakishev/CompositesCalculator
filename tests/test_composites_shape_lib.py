"""Checks composites_shape_lib against the closed-form results of composites_calculator_lib. Run: py -m pytest"""
import numpy as np
import pytest

import composites_calculator_lib as cc
import composites_shape_lib as cs
from conftest import quiet

R, L = 0.02, 0.5  # tube radius and length [m]
P, T = 50.0, 20.0  # tip load [N] and torque [Nm]


def cylinder(R, L, nc=180, ns=21):
    th = np.linspace(0, 2 * np.pi, nc, endpoint=False)
    V = np.vstack([np.column_stack([np.full(nc, x), R * np.cos(th), R * np.sin(th)]) for x in np.linspace(0, L, ns)])
    F = []
    for i in range(ns - 1):
        for j in range(nc):
            a, b = i * nc + j, i * nc + (j + 1) % nc
            F += [(a, b, b + nc), (a, b + nc, a + nc)]
    return V, np.array(F)


def prism(profile, L, ns=21):
    m = len(profile)
    V = np.vstack([np.column_stack([np.full(m, x), profile]) for x in np.linspace(0, L, ns)])
    F = []
    for i in range(ns - 1):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            F += [(a, b, b + m), (a, b + m, a + m)]
    return V, np.array(F)


def close(a, b, tol, what):
    err = abs(a - b) / abs(b)
    assert err < tol, f"{what}: {a:.6g} vs {b:.6g} ({err * 100:.3f} %)"


def cantilever(V, F, lu, **loads):
    return quiet(cs.shape_analyse, V, F, lu, "x", 20, "outer", [("start", "fixed")], **loads)


@pytest.fixture(scope="module")
def tube():
    return cylinder(R, L)


@pytest.fixture(scope="module")
def loop(tube):
    V, F = tube
    return cs._clean_loop(cs.mesh_slice(V, F, "x", 0.25)[0], 1.0)


@pytest.fixture(scope="module")
def sec(loop, lu):
    return cs.section_properties(loop[:, 0], loop[:, 1], lu, "outer")


@pytest.fixture(scope="module")
def h(lu):
    return lu["Thickness (m)"].sum()


# 1. section stiffness equals the existing arbitrary-section functions on the same polygon
def test_section_stiffness_matches_arbitrary_tube(loop, sec, lu, h, tmp_path):
    csv = tmp_path / "sec.csv"
    np.savetxt(csv, loop, delimiter=",", header="x2,x3", comments="")
    ref = quiet(cc.generate_EIeq_arbitrary_tube, str(csv), lu, "outer")
    close(sec["EI_y"], ref["EI_3"], 1e-9, "EI_y vs generate_EIeq_arbitrary_tube")
    close(sec["EA"], ref["EA"], 1e-9, "EA vs generate_EIeq_arbitrary_tube")
    tor = quiet(cc.generate_torsion_arbitrary_tube, str(csv), lu, 1.0, 0.0, "outer")
    close(sec["GJ"], tor["GJ_eq"], 1e-9, "GJ vs generate_torsion_arbitrary_tube")
    A, B, D = quiet(cc.calculate_A_B_D_matrix, lu)
    Dx = quiet(cc.generate_Dx_eq_circ_tube, A, D, 2 * (R - h), lu)
    close(sec["EI_y"], Dx, 2e-3, "EI_y vs circular tube formula (180-sided polygon)")


# 2. cantilever, tip load: P L^3 / 3 EI; torque: T L / GJ
def test_cantilever_tip_load_and_torque(tube, sec, lu):
    r = cantilever(*tube, lu, point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P), "M_axis": T}])
    close(-r["disp"][-1, 2], P * L ** 3 / (3 * sec["EI_z"]), 1e-6, "cantilever tip deflection")
    close(r["twist_deg"][-1], np.degrees(T * L / sec["GJ"]), 1e-6, "cantilever tip twist")
    close(r["reactions"][0]["F"][2], P, 1e-6, "support reaction")


# 3. simply supported, uniform load: 5 q L^4 / 384 EI at mid-span
def test_simply_supported_uniform_load(tube, sec, lu):
    q = 200.0
    r = quiet(cs.shape_analyse, *tube, lu, "x", 20, "outer", [("start", "pinned"), ("end", "roller")],
              line_loads=[{"s0": "start", "s1": "end", "q": (0, 0, -q)}])
    close(-r["disp"][10, 2], 5 * q * L ** 4 / (384 * sec["EI_z"]), 1e-4, "simply supported mid-span deflection")


# 4. ply check against calculate_safety_factors at the most loaded point of the cantilever root
def test_ply_check_matches_safety_factors(tube, lu):
    r = cantilever(*tube, lu, point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P), "M_axis": T}])
    w = r["worst"]
    sf = quiet(cc.calculate_safety_factors, lu, np.array([w["N1"], 0, w["N6"]]), np.array([w["M1"], 0, 0]))
    cols = [c for c in sf.columns if c not in ("Layer #", "T/B")]
    close(w["R"], float(sf[cols].min().min()), 1e-6, "lowest R vs calculate_safety_factors")


# 5. offset load makes torque: a vertical load 30 mm to the side twists the tube by P*0.03*L/GJ
def test_offset_load_twists(tube, sec, lu):
    r = cantilever(*tube, lu, point_loads=[{"at": (L, 0.03, 0), "F": (0, 0, -P)}])
    close(r["twist_deg"][-1], np.degrees(-P * 0.03 * L / sec["GJ"]), 1e-6, "twist from offset load")


# 6. gravity: cantilever under own weight, w L^4 / 8 EI
def test_self_weight(tube, sec, lu):
    r = cantilever(*tube, lu, gravity=(0, 0, -9.81))
    close(-r["disp"][-1, 2], sec["mass"] * 9.81 * L ** 4 / (8 * sec["EI_z"]), 1e-4, "self-weight tip deflection")
    close(r["mass"], sec["mass"] * L, 1e-9, "mass")


# 7. the STL reader: write a binary STL of the example wing and read it back
def test_stl_round_trip(tmp_path):
    Vw, Fw = cs.mesh_example("wing")
    path = tmp_path / "wing.stl"
    tri = (Vw[Fw] * 1000).astype("<f4")
    with open(path, "wb") as f:
        f.write(b"\0" * 80 + np.uint32(len(tri)).tobytes())
        rec = np.zeros(len(tri), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
        rec["v"] = tri
        f.write(rec.tobytes())
    V2, F2 = cs.mesh_load_stl(str(path), 0.001)
    assert len(F2) == len(Fw)


@pytest.mark.parametrize("kind", ["tube", "wing", "arm"])
def test_example_shapes_solve(kind, lu):
    Vk, Fk = cs.mesh_example(kind)
    r = quiet(cs.shape_analyse, Vk, Fk, lu, "x", 30, "outer", [("start", "fixed")],
              point_loads=[{"at": (Vk[:, 0].max(), 0, 0), "F": (0, 0, -20)}], gravity=(0, 0, -9.81))
    assert r["mass"] > 0 and r["max_disp"] > 0 and r["worst"]["R"] > 0


# 8. shear flow and shear centre
def test_circle_shear_flow():
    th = np.linspace(0, 2 * np.pi, 400, endpoint=False)
    circ = np.column_stack([R * np.cos(th) + 0.01, R * np.sin(th) - 0.005])
    sf_c = cs.section_shear_flow(circ)
    close(sf_c["shear_centre"][0], 0.01, 1e-9, "circle shear centre y (off-origin circle)")
    close(sf_c["shear_centre"][1], -0.005, 1e-9, "circle shear centre z")
    close(np.abs(sf_c["q_Vz"]).max(), 1 / (np.pi * R), 1e-3, "circle peak shear flow V / (pi R)")


@pytest.fixture(scope="module")
def d_section():
    """Semicircle radius r with a flat web on y = 0."""
    r = 0.03
    t = np.linspace(-np.pi / 2, np.pi / 2, 401)
    return r, np.vstack([np.column_stack([r * np.cos(t), r * np.sin(t)]),
                         np.column_stack([np.zeros(199), np.linspace(r, -r, 201)[1:-1]])])


def test_d_section_shear_centre(d_section):
    # by hand, with I = r^3 (pi/2 + 2/3) and S = r (pi + 2): q0 = -(4 r^3 / 3) / (I S), y_sc = r^2 (2 r^2 / I + pi q0)
    r, Dsec = d_section
    I = r ** 3 * (np.pi / 2 + 2 / 3)
    q0 = -(4 * r ** 3 / 3) / (I * r * (np.pi + 2))
    y_sc = r ** 2 * (2 * r ** 2 / I + np.pi * q0)
    sf_d = cs.section_shear_flow(Dsec)
    close(sf_d["shear_centre"][0], y_sc, 2e-3, "D-section shear centre vs hand calculation")
    assert abs(sf_d["shear_centre"][1]) < 1e-9 * r


def test_d_section_beam_twist(d_section, lu):
    # loaded through its shear centre a D-section cantilever does not twist; loaded on the web it twists by
    # P * y_sc * L / GJ. (The mesh is the outer surface; the shear centre is that of the wall midline.)
    VD, FD = prism(d_section[1], L)
    r0 = cantilever(VD, FD, lu, point_loads=[{"at": (L, 0, 0), "F": (0, 0, -P)}])
    sec_d = r0["sections"][-1]
    ysc_mid = sec_d["shear_centre"][0]
    r1 = cantilever(VD, FD, lu, point_loads=[{"at": (L, ysc_mid, 0), "F": (0, 0, -P)}])
    assert abs(r1["twist_deg"][-1]) < 1e-9, "load through the shear centre must not twist"
    close(r0["twist_deg"][-1], np.degrees(P * ysc_mid * L / sec_d["GJ"]), 1e-6, "twist of load on the web")
    close(r0["forces"][5]["V_z"], -P, 1e-9, "internal shear force")
    close(r0["forces"][5]["T"], P * ysc_mid, 1e-9, "internal torque about the shear centre")
    assert abs(r0["reactions"][0]["M_axis"]) < 1e-9, "reaction torque about the span axis must be zero"


def test_shear_flow_at_neutral_axis(loop, lu, h):
    # a stubby round cantilever where shear matters: at the side of the tube (neutral axis) the wall carries only
    # the shear flow V / (pi R_mid)
    Lc = 0.05
    rc = quiet(cs.shape_analyse, *cylinder(R, Lc), lu, "x", 10, "outer", [("start", "fixed")],
               point_loads=[{"at": (Lc, 0, 0), "F": (0, 0, -P)}])
    assert rc["worst"] is not None
    sec0 = quiet(cs.section_properties, loop[:, 0], loop[:, 1], lu, "outer", 64)
    k_side = int(np.argmin(np.abs(sec0["mid_points"][:, 1]) + (sec0["mid_points"][:, 0] < 0)))
    close(abs(sec0["q_Vz"][k_side]), 1 / (np.pi * (R - h / 2)), 2e-3, "shear flow at the neutral axis, per newton")
