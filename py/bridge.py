import contextlib, io, json, math
import numpy as np
import pandas as pd
import composites_calculator_lib as cc

_DB = {}
_CUSTOM = {}
_FIELDS = ["Ex", "Ey", "Es", "vxy", "Xt", "Xc", "Yt", "Yc", "Sc"]


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    if isinstance(o, (bool, np.bool_)):
        return bool(o)
    if isinstance(o, (float, np.floating)):
        o = float(o)
        return o if math.isfinite(o) else None
    if isinstance(o, np.integer):
        return int(o)
    return o


def _mat(name):
    if name in _CUSTOM:
        return _CUSTOM[name]
    if name in _DB:
        return _DB[name]
    raise ValueError("Unknown material: " + str(name))


def _mat_dict(m, custom):
    d = {f: getattr(m, f) for f in _FIELDS}
    d.update(name=m.name, h0=m.h0, rho=m.rho, source=m.source, custom=custom)
    return d


def _materials(p):
    if p.get("csv") is not None:
        with open("/tmp/materials_database.csv", "w", newline="") as f:
            f.write(p["csv"])
        _DB.clear()
        _DB.update(cc.materials_load("/tmp/materials_database.csv"))
    _CUSTOM.clear()
    for c in p.get("custom", []):
        if c["name"] in _DB:
            continue
        _CUSTOM[c["name"]] = cc.Material(
            c["name"], [float(c["Ex"]), float(c["Ey"]), float(c["Es"]), float(c["vxy"])],
            [float(c[k]) for k in ("Xt", "Xc", "Yt", "Yc", "Sc")], float(c["h0"]), float(c["rho"]), str(c.get("source") or "Custom"))
    return {"version": cc.version, "update_date": cc.update_date,
            "materials": [_mat_dict(m, False) for m in _DB.values()] + [_mat_dict(m, True) for m in _CUSTOM.values()]}


def _build(spec):
    lu = cc.layup_create(spec["template"], _mat(spec["material"]))
    for k, ov in spec.get("overrides", {}).items():
        n = int(k)
        if ov.get("material"):
            cc.layup_material_change(lu, n, _mat(ov["material"]))
        if ov.get("thickness") is not None:
            cc.layup_thickness_change(lu, n, float(ov["thickness"]))
        if ov.get("orientation") is not None:
            cc.layup_orientation_change(lu, n, float(ov["orientation"]))
    return lu


def _woven_groups(template):
    """
    Which layers came from the same woven (+-) entry, following layup_create()'s expansion.
    Returns one (group id, role) per layer: role 0 for the sub-layers at theta, 1 for those at theta - 90,
    and (None, None) for a layer that is not woven.
    """
    tokens = template.split("/")
    kind = tokens.pop() if tokens[-1] in ("s", "t", "so") else "s"
    out, g = [], 0
    for t in tokens:
        if t.strip().lower().startswith("+-"):
            g += 1
            out.extend([(g, 0), (g, 1), (g, 0), (g, 1)])
        else:
            out.append((None, None))
    mirror = [(None if i is None else -i, role) for i, role in out[::-1]]
    if kind == "so":
        out = out + mirror[1:]
    elif kind == "s":
        out = out + mirror
    return out


def _layers(p):
    """Layer list only (no stiffness), so the preview still works for layups the maths rejects."""
    lu = _build(p["layup"])
    woven = _woven_groups(p["layup"]["template"])
    return [{"num": None if r["Material_name"] == "Core" else int(r["Layer #"]),
             "is_core": r["Material_name"] == "Core", "material": r["Material_name"],
             "thickness": r["Thickness (m)"], "orientation": r["Orientation (deg)"],
             "woven": woven[i][0] if i < len(woven) else None,
             "role": woven[i][1] if i < len(woven) else None} for i, (_, r) in enumerate(lu.iterrows())]


def _laminate(p):
    lu = _build(p["layup"])
    h, h_total = cc.layup_calculate_heights(lu)
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    C = cc.generate_anisotropic_stiffness_tensor_C(A, B, D, lu)
    layers = []
    for _, r in lu.iterrows():
        core = r["Material_name"] == "Core"
        layers.append({"num": None if core else int(r["Layer #"]), "is_core": core, "material": r["Material_name"],
                       "thickness": r["Thickness (m)"], "orientation": r["Orientation (deg)"],
                       "z_top": r["TopHeight"], "z_bottom": r["BottomHeight"],
                       "S": r["S matrix"], "Q": r["Q matrix"], "S_off": r["S matrix off"], "Q_off": r["Q matrix off"]})
    areal = float(sum(r["Thickness (m)"] * r["Material"].rho for _, r in lu.iterrows()))
    scale = np.max(np.abs(A)) * 1e9 / h_total
    symmetric = bool(np.max(np.abs(B)) * 6 / h_total ** 2 < 1e-6 * scale)
    balanced = bool(max(abs(A[0, 2]), abs(A[1, 2])) < 1e-6 * np.max(np.abs(A)))
    return {"layers": layers, "h": h, "h_total": h_total, "areal_mass": areal, "A": A, "B": B, "D": D, "C": C,
            "symmetric": symmetric, "balanced": balanced}


def _section_csv(s):
    with open("/tmp/section.csv", "w", newline="") as f:
        f.write(s["csv"])
    return "/tmp/section.csv"


def _outline(p):
    """The surface given by the points and the other surface of the wall, d [m] away, for the section drawing."""
    s = p["section"]
    px, py = cc._section_read_csv(_section_csv(s), s["surface"])
    ox, oy = cc._section_offset(px, py, p["d"] if s["surface"] == "inner" else -p["d"], np.radians(3.0))
    return {"datum": np.column_stack([px, py]), "other": np.column_stack([ox, oy])}


def _bending(p):
    lu = _build(p["layup"])
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    s = p["section"]
    if s["type"] == "circ":
        return {"type": "circ", "Dx": cc.generate_Dx_eq_circ_tube(A, D, s["d_in"], lu)}
    if s["type"] == "rect":
        return {"type": "rect", "EI": cc.generate_EIeq_rect_tube(A, D, s["height"], s["width"], lu)}
    out = cc.generate_EIeq_arbitrary_tube(_section_csv(s), lu, s["surface"])
    out["type"] = "arb"
    return out


def _torsion(p):
    lu = _build(p["layup"])
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    s = p["section"]
    if s["type"] == "circ":
        out = cc.generate_torsion_circ_tube(A, s["d_in"], lu, p["torque"], p["axial"])
        wall_length = 2 * np.pi * (s["d_in"] / 2 + lu["Thickness (m)"].sum() / 2)
    else:
        out = cc.generate_torsion_arbitrary_tube(_section_csv(s), lu, p["torque"], p["axial"], s["surface"])
        wall_length = out["perimeter"]
    # the tube wall is a laminate carrying the axial load per unit length of wall and the shear flow
    out["wall_N"] = [p["axial"] / wall_length, 0.0, out["shear_flow"]]
    out["lowest"] = _lowest(p["layup"], out["wall_N"], [0.0, 0.0, 0.0])
    return out


def _safety(spec, N, M):
    lu = _build(spec)
    sf = cc.calculate_safety_factors(lu, np.array(N, dtype=float), np.array(M, dtype=float))
    groups = {"max": ["Max_FT", "Max_FC", "Max_MT", "Max_MC", "Max_S"], "quad": ["Quad"],
              "hashin": ["Hash_FT", "Hash_FC", "Hash_MT", "Hash_MC"]}
    cols = sum(groups.values(), [])
    sfr = sf.copy()
    sfr[cols] = sfr[cols].map(lambda x: cc.round_sig(x, 6))
    summary = {}
    for key, gcols in groups.items():
        if sfr[gcols].isna().all().all():
            summary[key] = None
            continue
        mode = sfr[gcols].min().idxmin()
        idx = sfr[mode].idxmin()
        summary[key] = {"R": sfr[gcols].min().min(), "mode": mode, "row": int(idx),
                        "layer": int(sfr.at[idx, "Layer #"]), "location": sfr.at[idx, "T/B"]}
    rows = [{"layer": int(r["Layer #"]), "loc": r["T/B"], **{c: r[c] for c in cols}} for _, r in sfr.iterrows()]
    return {"cols": cols, "rows": rows, "summary": summary}


def _failure(p):
    return _safety(p["layup"], p["N"], p["M"])


def _lowest(spec, N, M):
    """Lowest safety factor over the three criteria, with where it occurs. None if no ply is loaded."""
    best = None
    for key, s in _safety(spec, N, M)["summary"].items():
        if s and (best is None or s["R"] < best["R"]):
            best = dict(s, criterion=key)
    return best


def _wall_bending(p):
    """
    Lowest safety factor of a tube wall in beam bending. The wall is loaded with the N1 and M1 that give it the
    beam's axial strain at mid-wall and the beam's curvature through its thickness (all other resultants zero),
    and is checked on the tension and compression sides.
    """
    lu = _build(p["layup"])
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    abd = np.linalg.inv(np.block([[A * 10 ** 9, B], [B, D]]))
    N1, M1 = np.linalg.solve(np.array([[abd[0, 0], abd[0, 3]], [abd[3, 0], abd[3, 3]]]),
                             np.array([p["strain"], p["curvature"]], dtype=float))
    best = None
    for side, sign in (("tension", 1.0), ("compression", -1.0)):
        low = _lowest(p["layup"], [sign * N1, 0.0, 0.0], [sign * M1, 0.0, 0.0])
        if low and (best is None or low["R"] < best["R"]):
            best = dict(low, side=side)
    return {"lowest": best, "N1": N1, "M1": M1}


def _load_axes_N(phi, kind, sign):
    """Unit stress resultant [N1, N2, N6] for a load in axes turned phi [rad] from the laminate 1 direction:
    uniaxial ("n") along the load, or in-plane shear ("s") in the load axes."""
    c, s = math.cos(phi), math.sin(phi)
    v = [c * c, s * s, s * c] if kind == "n" else [-2 * s * c, 2 * s * c, c * c - s * s]
    return [sign * x for x in v]


def _matrix_discounted(spec):
    """The layup with the matrix-dominated stiffnesses (Ey, Es) of every ply cut to 1 %: the laminate after matrix
    cracking, with the fibres carrying the load (ply-discount estimate of the last-ply, fibre failure)."""
    lu = _build(spec)
    for i, r in lu.iterrows():
        if r["Material_name"] == "Core":
            continue
        m = r["Material"]
        lu.at[i, "Material"] = cc.Material(m.name, [m.Ex, m.Ey * 0.01, m.Es * 0.01, m.vxy],
                                           [m.Xt, m.Xc, m.Yt, m.Yc, m.Sc], m.h0, m.rho, m.source)
    return lu


def _bolt(p):
    """
    Laminate strengths [Pa] in the axes of a bolt load at p["angle"] [deg] from the 1 direction: tension and compression
    along the load and in-plane shear. Each is the higher of first-ply failure (lowest R of the three criteria) and
    fibre failure after matrix cracking, since a notched laminate keeps carrying load after its matrix cracks.
    The bolt-hole formulas themselves run in the page.
    """
    spec = p["layup"]
    lu = _build(spec)
    plies = lu[lu["Material_name"] != "Core"]
    t = float(plies["Thickness (m)"].sum())
    lu_d = _matrix_discounted(spec)
    a_intact = np.linalg.inv(cc.calculate_A_B_D_matrix(lu)[0])
    a_cracked = np.linalg.inv(cc.calculate_A_B_D_matrix(lu_d)[0])
    phi = math.radians(p["angle"])

    def strength(kind, sign):
        N = _load_axes_N(phi, kind, sign)
        by_crit = _safety(spec, N, [0.0, 0.0, 0.0])["summary"]
        low = None
        for key, s in by_crit.items():
            if s and (low is None or s["R"] < low["R"]):
                low = dict(s, criterion=key)
        fpf = low["R"] if low else None
        fib, fib_at = None, None
        # the fibre path counts only where fibres actually carry this load: after matrix cracking the laminate must
        # keep at least 10 % of its stiffness in this direction (not so for a UD ply loaded across its fibres)
        Nv = np.array(N)
        if Nv @ a_intact @ Nv >= 0.1 * (Nv @ a_cracked @ Nv):
            sf = cc.calculate_safety_factors(lu_d, Nv, np.zeros(3))
            fib = sf[["Max_FT", "Max_FC"]].min().min()
            if pd.isna(fib):
                fib = None
            else:
                fib = float(fib)
                mode = sf[["Max_FT", "Max_FC"]].min().idxmin()
                idx = sf[mode].idxmin()
                fib_at = {"mode": mode, "layer": int(sf.at[idx, "Layer #"]), "location": sf.at[idx, "T/B"]}
        R = max(x for x in (fpf, fib, 0.0) if x is not None)
        return {"stress": R / t, "fpf": None if fpf is None else fpf / t, "fibre": None if fib is None else fib / t,
                "basis": "fibre" if fib is not None and (fpf is None or fib > fpf) else "fpf", "first": low,
                "fibre_at": fib_at,
                "criteria": {k: None if s is None else dict(s, stress=s["R"] / t) for k, s in by_crit.items()}}

    shear = min((strength("s", 1.0), strength("s", -1.0)), key=lambda x: x["stress"])
    return {"t": t, "has_core": bool(len(plies) < len(lu)),
            "tension": strength("n", 1.0), "compression": strength("n", -1.0), "shear": shear}


_CRIT_MODES = {"max": ["FT", "FC", "MT", "MC", "S"], "hashin": ["FT", "FC", "MT", "MC"]}


def _hoop_checker(lu):
    """
    A fast first-ply failure check of the wall under a hoop force N2 [N/m] and hoop moment M2 [N] (laminate 2
    direction = around the tube). Same maths as calculate_safety_factors(), without its printing, so it can run at
    every point of the ring. Returns a function giving the lowest R and where and how the wall fails.
    """
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    abd_inv = np.linalg.inv(np.block([[A * 1e9, B], [B, D]]))
    plies = [r for _, r in lu.iterrows() if r["Material_name"] != "Core"]

    def check(N2, M2):
        ek = abd_inv @ np.array([0.0, N2, 0.0, 0.0, M2, 0.0])
        best = None
        for r in plies:
            for loc, z in (("Outer", r["TopHeight"]), ("Inner", r["BottomHeight"])):
                stress = r["Q matrix"] @ cc._strain_off_to_on(r["Orientation (deg)"], ek[:3] + z * ek[3:])
                stress[np.abs(stress) < 1e-9 * max(np.max(np.abs(stress)), 1e-300)] = 0.0
                m = r["Material"]
                found = [("max", mode, R) for mode, R in zip(_CRIT_MODES["max"], cc._maximum_stress_criterion(m, stress))]
                found.append(("quad", None, cc._tsai_wu_quadratic_criterion(m, stress)))
                found += [("hashin", mode, R) for mode, R in zip(_CRIT_MODES["hashin"], cc._hashin_failure_criteria(m, stress))]
                for crit, mode, R in found:
                    if R is not None and math.isfinite(R) and R > 0 and (best is None or R < best["R"]):
                        best = {"R": float(R), "criterion": crit, "mode": mode, "layer": int(r["Layer #"]), "location": loc}
        return best
    return check


def _ring_frame(pts, loads, EA, EI):
    """
    Quarter of the tube cross-section as a 2D frame of straight beam elements, from the top centre (x = 0) round to
    the side-wall centre (y = 0), with symmetry conditions at both ends. loads: nodal force (fx, fy) per metre of tube.
    Returns, for each element end, the hoop force N2 [N/m, tension +] and the hoop moment M2 [N] in the laminate
    sign convention (+M2 stretches the outer surface, layer 1), the node index, and the closing of the tube [m]
    between the top and bottom centres.
    """
    n = len(pts)
    K, f, elems = np.zeros((3 * n, 3 * n)), np.zeros(3 * n), []
    for i in range(n - 1):
        dx, dy = pts[i + 1] - pts[i]
        L = math.hypot(dx, dy)
        c, s = dx / L, dy / L
        k = np.zeros((6, 6))
        k[np.ix_([0, 3], [0, 3])] = EA / L * np.array([[1, -1], [-1, 1]])
        k[np.ix_([1, 2, 4, 5], [1, 2, 4, 5])] = EI / L ** 3 * np.array(
            [[12, 6 * L, -12, 6 * L], [6 * L, 4 * L * L, -6 * L, 2 * L * L],
             [-12, -6 * L, 12, -6 * L], [6 * L, 2 * L * L, -6 * L, 4 * L * L]])
        Rm = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
        T = np.block([[Rm, np.zeros((3, 3))], [np.zeros((3, 3)), Rm]])
        dof = np.r_[3 * i:3 * i + 6]
        K[np.ix_(dof, dof)] += T.T @ k @ T
        elems.append((i, dof, k @ T))
    f[0::3], f[1::3] = loads[:, 0], loads[:, 1]
    fixed = [0, 2, 3 * (n - 1) + 1, 3 * (n - 1) + 2]
    free = np.setdiff1d(np.arange(3 * n), fixed)
    u = np.zeros(3 * n)
    u[free] = np.linalg.solve(K[np.ix_(free, free)], f[free])
    out = []
    for i, dof, kT in elems:
        fl = kT @ u[dof]
        # local y points out of the tube along this path, so sagging beam moment stretches the inner surface
        out += [(-fl[0], fl[2], i), (fl[3], -fl[5], i + 1)]
    return out, -2 * u[1]


def _clamp(p):
    """
    Two identical clamp halves (U for a rectangular tube, C for a round one) screwed together around the tube with a
    total preload F [N] over a contact length L [m]. Checks the tube wall (first-ply failure from ring bending, and
    wall buckling) or, with a plug, the wall and plug in crushing; gives the force needed to slide the clamp.
    """
    lu = _build(p["layup"])
    plies = lu[lu["Material_name"] != "Core"]
    t = float(lu["Thickness (m)"].sum())
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    EA, EI = A[1, 1] * 1e9, D[1, 1]                      # hoop direction, per metre of tube
    F, L, mu, contact = p["preload"], p["length"], p["friction"], p["contact"]
    q = F / L                                             # clamp line load on each face [N/m]
    out = {"t": t, "has_core": bool(len(plies) < len(lu)), "q": q}

    if p["shape"] == "round":
        Rm = p["d_in"] / 2 + t / 2                        # mid-wall radius
        R_out = Rm + t / 2
        th = np.linspace(0.0, math.pi / 2, 31)            # from the top centre
        pts = np.column_stack([Rm * np.sin(th), Rm * np.cos(th)])
        loads = np.zeros_like(pts)
        if contact == "even":
            # a closely fitting C pressed down: contact pressure ~ cos(angle from the top), radial and inward
            w = np.cos(th) * Rm * (th[1] - th[0])
            w[[0, -1]] *= 0.5
            loads = -np.column_stack([np.sin(th), np.cos(th)]) * w[:, None]
            loads *= 0.5 / -loads[:, 1].sum()
            normal = 8 / math.pi                          # total normal force on the tube / F, both halves
            cases = [("even pressure round the clamp", loads)]
        else:
            loads[0, 1] = -0.5                            # contact along one line, top and bottom
            normal = 2.0
            cases = [("a line at the crown", loads)]
        regions = lambda i: "crown, under the clamp" if i <= 10 else "side, between the clamps" if i >= 20 else "shoulder"
        flat_w = 2 * R_out
        out.update(R_out=R_out, torque_arm=R_out)
        # ring buckling under the clamp: hoop compression at the sides vs the ring buckling load 3 EI / R^2
        N_side, N_cr = q / 2, 3 * EI / Rm ** 2
        buckle_what = "ring buckling of the tube wall (3 EI / R², long-tube value, conservative for a short clamp)"
        inner_w = p["d_in"]
        peak = 4 / math.pi if contact == "even" else 1.0
    else:
        W, H = p["width"] + t, p["height"] + t           # mid-wall
        r = min(p["radius"] + t / 2, W / 2, H / 2)
        a, b = W / 2 - r, H / 2 - r
        nf, na = 16, 12
        pts = [(x, H / 2) for x in np.linspace(0, a, nf + 1)]
        pts += [(a + r * math.sin(x), b + r * math.cos(x)) for x in np.linspace(0, math.pi / 2, na + 1)[1:]]
        pts += [(W / 2, y) for y in np.linspace(b, 0, nf + 1)[1:]]
        pts = np.array(pts)
        loads = np.zeros_like(pts)
        if contact == "even":
            w = np.ones(nf + 1)
            w[[0, -1]] = 0.5
            loads[:nf + 1, 1] = -0.5 * w / w.sum()
            cases = [("even pressure on the face", loads)]
        else:
            # a rigid U on a face that is not perfectly flat touches first along the face centre (face bulged out)
            # or near the corners (face dished in); the worse of the two is used
            centre, corner = np.zeros_like(pts), np.zeros_like(pts)
            centre[0, 1] = -0.5
            corner[nf, 1] = -0.5
            cases = [("a line at the face centre", centre), ("lines near the corners", corner)]
        normal = 2.0
        regions = lambda i: "top face" if i < nf else "side wall" if i > nf + na else "corner"
        flat_w = max(W + t - 2 * (r + t / 2), 1e-9)
        out.update(torque_arm=None)
        # side wall as a pinned wide column over its straight height, each carrying q/2
        hs = H - 2 * r
        N_side = q / 2
        N_cr = math.pi ** 2 * EI / hs ** 2 if hs > 1e-6 else None
        buckle_what = "side wall buckling as a pinned wide column (π² EI / h², conservative)"
        inner_w = max(p["width"] - 2 * p["radius"], 1e-9)
        peak = 1.0

    modes = []
    check = _hoop_checker(lu)
    if not p["plug"]:
        best, frame, squash = None, None, 0.0
        for label, case_loads in cases:
            fr, sq = _ring_frame(pts, case_loads, EA, EI)
            for N2, M2, node in fr:
                res = check(N2 * q, M2 * q)
                if res and (best is None or res["R"] < best["R"]):
                    best = dict(res, region=regions(node), N2=N2 * q, M2=M2 * q, case=label)
                    frame, squash = fr, sq
        frame = frame or fr
        if best:
            modes.append({"key": "fpf", "name": "Wall first-ply failure", "R": best["R"], "ply": best})
        if N_cr:
            modes.append({"key": "buckle", "name": "Wall buckling", "R": N_cr / N_side, "what": buckle_what,
                          "N": N_side, "N_cr": N_cr})
        out["squash"] = squash * q
        out["M_max"] = max(abs(M) for _, M, _ in frame) * q
    else:
        # a plug fills the bore under the clamp: the wall cannot bend or buckle, it is squeezed between clamp and plug
        if contact == "even":
            p_wall = peak * F / (L * flat_w)
            p_plug = peak * F / (L * inner_w)
        else:
            # a line load, spread at 45 degrees through the wall: over about t at mid-wall, 2t on the plug
            p_wall, p_plug = q / t, q / (2 * t)
        yc = min(float(r["Material"].Yc) for _, r in plies.iterrows()) * 1e6
        modes.append({"key": "crush", "name": "Wall crushing through its thickness", "R": yc / p_wall,
                      "pressure": p_wall, "strength": yc})
        modes.append({"key": "plug", "name": "Plug crushing", "R": p["plug_strength"] / p_plug,
                      "pressure": p_plug, "strength": p["plug_strength"]})
        out["squash"] = None
    out["modes"] = modes
    out["normal"] = normal * F
    out["slide"] = mu * normal * F
    return out


def _vib_tube(p):
    """
    Natural frequencies of the current tube as a beam. Circular: one bending set (same about every axis), torsion
    and axial. Rectangular: bending about both axes and axial (EA = A11 * mid-wall perimeter, thin wall).
    Arbitrary: bending about both principal axes and axial. Torsion needs the polar mass inertia, so circular only.
    """
    lu = _build(p["layup"])
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    s, L, bc, n = p["section"], p["length"], p["boundary"], p["n_modes"]
    h = lu["Thickness (m)"].sum()
    out = {"bending": []}
    if s["type"] == "circ":
        EI = cc.generate_Dx_eq_circ_tube(A, D, s["d_in"], lu)
        GJ = cc.generate_torsion_circ_tube(A, s["d_in"], lu, 1.0)["GJ_eq"]
        r = cc.generate_natural_frequencies_tube(EI, lu, L, inner_diameter=s["d_in"], GJ=GJ, boundary=bc, n_modes=n)
        out["bending"].append({"label": "Bending", "EI": EI, "f": r["f_bending"]})
        out["outer_size"] = s["d_in"] + 2 * h
    elif s["type"] == "rect":
        S = 2 * (s["width"] + s["height"]) + 4 * h
        EI_w = cc.generate_EIeq_rect_tube(A, D, s["height"], s["width"], lu)
        EI_h = cc.generate_EIeq_rect_tube(A, D, s["width"], s["height"], lu)
        r = cc.generate_natural_frequencies_tube(EI_w, lu, L, perimeter=S, EA=A[0, 0] * 1e9 * S, boundary=bc, n_modes=n)
        r_h = cc.generate_natural_frequencies_tube(EI_h, lu, L, perimeter=S, boundary=bc, n_modes=n)
        out["bending"] += [{"label": "Bending about the width axis", "EI": EI_w, "f": r["f_bending"]},
                           {"label": "Bending about the height axis", "EI": EI_h, "f": r_h["f_bending"]}]
        out["outer_size"] = max(s["width"], s["height"]) + 2 * h
    else:
        sec = cc.generate_EIeq_arbitrary_tube(_section_csv(s), lu, s["surface"])
        S = cc.generate_torsion_arbitrary_tube(_section_csv(s), lu, 1.0, 0.0, s["surface"])["perimeter"]
        r = cc.generate_natural_frequencies_tube(sec, lu, L, perimeter=S, boundary=bc, n_modes=n)
        out["bending"] += [{"label": "Bending, stiffest axis (EI max)", "EI": sec["EI_max"], "f": r["f_bending"]},
                           {"label": "Bending, softest axis (EI min)", "EI": sec["EI_min"], "f": r["f_bending_min"]}]
        out["outer_size"] = S / np.pi
    out.update(torsion=r["f_torsion"], axial=r["f_axial"], beta_L=r["beta_L"], mass_per_length=r["mass_per_length"])
    return out


def _vib_plate(p):
    lu = _build(p["layup"])
    A, B, D = cc.calculate_A_B_D_matrix(lu)
    out = cc.generate_natural_frequencies_plate(D, lu, p["a"], p["b"], p["n_modes"], B)
    out["h"] = lu["Thickness (m)"].sum()
    return out


_API = {"materials": _materials, "layers": _layers, "outline": _outline, "laminate": _laminate, "bending": _bending,
        "torsion": _torsion, "failure": _failure, "wall_bending": _wall_bending, "bolt": _bolt, "clamp": _clamp,
        "vib_tube": _vib_tube, "vib_plate": _vib_plate}


def api(name, payload):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            out = _API[name](json.loads(payload))
        return json.dumps({"ok": True, "result": _clean(out), "log": buf.getvalue()})
    except Exception as e:
        msg = str(e) if isinstance(e, ValueError) else type(e).__name__ + ": " + str(e)
        return json.dumps({"ok": False, "error": msg, "log": buf.getvalue()})
