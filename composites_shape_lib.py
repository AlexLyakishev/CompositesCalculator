"""
composites_shape_lib: composite beams of any slender 3D shape (tube, arm, spar, wing), from a triangle mesh of
the outer surface. Sits between the closed-form tube sections of composites_calculator_lib and a full shell FE model.

Workflow:
    1. mesh_load_stl() (or mesh_example()) reads the outer surface as triangles.
    2. The layup is laid inward from that surface (or outward, surface="inner"); layer 1 is the surface ply and
       the laminate 1 direction (0 deg plies) runs along the span axis.
    3. shape_analyse() cuts the mesh into sections across the span, gets each section's stiffness from the layup
       (the same offset-polygon method as generate_EIeq_arbitrary_tube()), and solves a 3D beam finite-element
       model with those properties under the given supports and loads.
    4. At every section, the beam strains are turned back into ply stresses round the wall and checked with the
       maximum stress, Tsai-Wu and Hashin criteria, giving the lowest safety factor R everywhere on the surface.

Model (state these limits with the results):
    - Euler-Bernoulli bending (no shear deformation) about a straight reference axis; the axial-bending coupling
      of sections whose centroid wanders off that axis (tapered or curved shapes) is kept in full.
    - Thin-walled single-cell torsion (Bredt) about each section's shear centre (that of a uniform-wall cell). The
      ply check includes the shear flow from transverse shear force as well as from torsion.
    - Each section is cut square to the span axis. Strongly curved shapes (bends) are outside this model.
    - The layup is the same everywhere. Internal webs, ribs and spars are not modelled.
"""
import math
import struct

import numpy as np

import composites_calculator_lib as cc

__version__ = cc.__version__  # one version for the whole project

AXES = {"x": 0, "y": 1, "z": 2}


# ---------------------------------------------------------------- mesh input
def mesh_load_stl(path_or_bytes, scale=1.0):
    """
    Reads an ASCII or binary STL file.
    :param path_or_bytes: file path, or the file's bytes
    :param scale: factor from the file's units to metres (0.001 for a file in millimetres)
    :return: vertices (n, 3) [m] and faces (m, 3) vertex indices, with coincident vertices merged
    """
    data = path_or_bytes
    if isinstance(data, str):
        with open(data, "rb") as f:
            data = f.read()
    data = bytes(data)
    tri = None
    if len(data) >= 84:
        n = struct.unpack("<I", data[80:84])[0]
        if 84 + 50 * n == len(data):
            rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                                count=n, offset=84)
            tri = rec["v"].astype(float)
    if tri is None:
        text = data.decode("latin-1")
        if "vertex" not in text:
            raise ValueError("Not an STL file: no binary triangle records and no ASCII 'vertex' lines")
        v = [list(map(float, line.split()[1:4])) for line in text.splitlines() if line.strip().startswith("vertex")]
        tri = np.array(v, dtype=float).reshape(-1, 3, 3)
    if len(tri) == 0:
        raise ValueError("The STL file has no triangles")
    return mesh_weld(tri.reshape(-1, 3) * scale, np.arange(3 * len(tri)).reshape(-1, 3))


def mesh_weld(vertices, faces):
    """Merges vertices closer than a millionth of the model size, and drops triangles that collapse."""
    vertices = np.asarray(vertices, dtype=float)
    size = float(np.max(np.ptp(vertices, axis=0))) or 1.0
    key = np.round((vertices - vertices.min(axis=0)) / (size * 1e-6)).astype(np.int64)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    faces = inverse.reshape(-1)[np.asarray(faces)]
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
    return vertices[first], faces


def mesh_example(kind):
    """
    Example outer-surface meshes [m], open at both ends, span along x:
        "tube"  tapered round tube, 600 mm long, outer diameter 40 mm at the root to 25 mm at the tip
        "wing"  NACA 0012 wing, 800 mm span, chord 200 mm at the root to 120 mm at the tip, sharp trailing edge
        "arm"   rectangular arm 30 x 20 mm with 4 mm corner radii, 350 mm long
    """
    ns, nc = 41, 72
    s = np.linspace(0.0, 1.0, ns)
    if kind == "tube":
        L = 0.6
        th = np.linspace(0, 2 * np.pi, nc, endpoint=False)
        rings = [np.column_stack([np.full(nc, L * u), (0.02 - 0.0075 * u) * np.cos(th), (0.02 - 0.0075 * u) * np.sin(th)])
                 for u in s]
    elif kind == "wing":
        L = 0.8
        n = nc // 2
        xc = (1 - np.cos(np.linspace(0, np.pi, n + 1))) / 2  # chordwise, clustered at both edges
        yt = 0.6 * (0.2969 * np.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
        yt[-1] = 0.0  # sharp trailing edge
        top = np.column_stack([xc[::-1], yt[::-1]])[:-1]  # trailing edge to leading edge on top
        bot = np.column_stack([xc, -yt])[:-1]            # leading edge to trailing edge underneath
        prof = np.vstack([top, bot])                     # counter-clockwise seen from +x... checked by the slicer
        rings = []
        for u in s:
            c = 0.2 - 0.08 * u
            # chord along -y from the leading edge at y = 0.25 c, so the reference axis is at the quarter chord
            rings.append(np.column_stack([np.full(len(prof), L * u), (0.25 - prof[:, 0]) * c, prof[:, 1] * c]))
    elif kind == "arm":
        L = 0.35
        w, h, r = 0.030, 0.020, 0.004
        a, b = w / 2 - r, h / 2 - r
        pts = []
        for cx, cy, a0 in ((a, b, 0), (-a, b, 90), (-a, -b, 180), (a, -b, 270)):
            for t in np.radians(np.linspace(a0, a0 + 90, 7)):
                pts.append((cx + r * np.cos(t), cy + r * np.sin(t)))
        prof = np.array(pts)
        rings = [np.column_stack([np.full(len(prof), L * u), prof[:, 0], prof[:, 1]]) for u in s]
    else:
        raise ValueError("Unknown example: " + repr(kind))
    m = len(rings[0])
    V = np.vstack(rings)
    F = []
    for i in range(ns - 1):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            F += [(a, b, b + m), (a, b + m, a + m)]
    return mesh_weld(V, np.array(F))


# ---------------------------------------------------------------- slicing
def _frame(axis):
    """Unit vectors (span, y, z) of the beam frame for span axis "x", "y" or "z"; right-handed."""
    i = AXES[axis]
    e = np.eye(3)
    return e[i], e[(i + 1) % 3], e[(i + 2) % 3]


def mesh_slice(vertices, faces, axis, s):
    """
    Cuts the mesh with the plane (span coordinate) = s.
    :return: list of closed loops, each an (n, 2) array of section coordinates (y, z) [m]
    """
    ax = AXES[axis]
    d = vertices[:, ax] - s
    tiny = 1e-12 * (np.ptp(vertices[:, ax]) or 1.0)
    d = np.where(np.abs(d) < tiny, tiny, d)  # a vertex on the plane counts as just above it
    sd = d[faces] > 0
    cut = faces[(sd.any(axis=1)) & (~sd.all(axis=1))]
    if len(cut) == 0:
        return []
    # each cut triangle crosses exactly two of its edges; the crossing points are keyed by their (sorted) edge
    seg = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        va, vb = cut[:, a], cut[:, b]
        crosses = (d[va] > 0) != (d[vb] > 0)
        seg.append(np.where(crosses[:, None], np.sort(np.column_stack([va, vb]), axis=1), -1))
    seg = np.stack(seg, axis=1)  # (m, 3 edges, 2)
    ends = [row[row[:, 0] >= 0] for row in seg]

    nbr = {}
    for e in ends:
        if len(e) != 2:
            continue
        k0, k1 = tuple(e[0]), tuple(e[1])
        nbr.setdefault(k0, []).append(k1)
        nbr.setdefault(k1, []).append(k0)

    def point(key):
        va, vb = key
        t = d[va] / (d[va] - d[vb])
        p = vertices[va] + t * (vertices[vb] - vertices[va])
        return p[(ax + 1) % 3], p[(ax + 2) % 3]

    loops, seen = [], set()
    for start in nbr:
        if start in seen:
            continue
        # walk from an open end if this chain has one (an open surface), otherwise from anywhere
        chain, prev, cur = [], None, start
        while True:
            seen.add(cur)
            chain.append(cur)
            nxt = [k for k in nbr[cur] if k != prev and k not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
        if len(chain) >= 3:
            loops.append(np.array([point(k) for k in chain]))
    return loops


def _clean_loop(loop, size):
    """Removes repeated points and makes the loop counter-clockwise."""
    keep = np.hypot(*(np.roll(loop, -1, axis=0) - loop).T) > 1e-9 * size
    loop = loop[keep]
    x, y = loop[:, 0], loop[:, 1]
    if np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) < 0:
        loop = loop[::-1]
    return loop


# ---------------------------------------------------------------- section properties
def section_properties(py_, pz_, lu, surface="outer", n_points=64):
    """
    Stiffness and mass of a tube section whose outline (y, z) [m] is one surface of the wall, with layer 1 on that
    surface. Same method as generate_EIeq_arbitrary_tube(), but about the coordinate origin (the beam reference
    axis) rather than the centroid, so that sections along the beam share one axis.
    :return: dict with
        "D": 3x3 axial-bending stiffness about the origin, [[EA, -ESy, -ESz], [-ESy, EIyy, EIyz], [-ESz, EIyz, EIzz]]
             for the generalised strains [u', v'', w''] (axial strain = u' - y v'' - z w'') [N, N m, N m^2]
        "EA", "EI_y", "EI_z", "EI_yz": centroidal values; EI_y = int E y^2 (bending in the y direction, v)
        "centroid": stiffness-weighted (y, z) [m]
        "GJ": thin-walled torsional stiffness [N m^2], "A_m": area inside the wall midline [m^2], "S": its length [m]
        "mass": mass per length [kg/m], "mass_centroid": (y, z) [m]
        "shear_centre": (y, z) [m]; "mid_points", "mid_normals": n_points points evenly round the wall midline and
        their outward normals; "q_Vy", "q_Vz": shear flow there per newton of shear force through the shear centre
        [N/m per N], from section_shear_flow()
    """
    px, py = np.asarray(py_, float), np.asarray(pz_, float)
    h = lu["Thickness (m)"].sum()
    half_h = h / 2
    cache = {}

    def moments(dd):
        dd = round(float(dd), 15)
        if dd not in cache:
            ox, oy = cc._section_checked_offset(px, py, dd, surface, h)
            cache[dd] = np.zeros(6) if len(ox) == 0 else cc._section_polygon_moments(ox, oy)
        return cache[dd]

    tot, mass = np.zeros(6), np.zeros(3)
    for _, row in lu.iterrows():
        d_hi, d_lo = row["TopHeight"] + half_h, row["BottomHeight"] + half_h
        if surface == "outer":
            d_hi, d_lo = d_hi - h, d_lo - h
        m = moments(d_hi) - moments(d_lo)
        mass += row["Material"].rho * m[:3]
        if row["Material"].name == "Core":
            continue
        tot += row["Q matrix off"][0, 0] * 1e9 * m
    EA, ESy, ESz, EIyy, EIzz, EIyz = tot
    yc, zc = ESy / EA, ESz / EA

    mx, my = cc._section_checked_offset(px, py, half_h if surface == "inner" else -half_h, surface, h)
    if len(mx) == 0:
        raise ValueError("the section is solid (the hollow closes up), so thin-walled torsion does not apply")
    A_m = cc._section_polygon_moments(mx, my)[0]
    S = float(np.sum(np.hypot(np.roll(mx, -1) - mx, np.roll(my, -1) - my)))
    A_mat = sum(r["Q matrix off"] * r["Thickness (m)"] for _, r in lu.iterrows()) * 1e9
    alpha66 = np.linalg.inv(A_mat)[2, 2]

    mid, nrm = _resample(np.column_stack([mx, my]), n_points)
    shear = section_shear_flow(mid)

    return {
        "D": np.array([[EA, -ESy, -ESz], [-ESy, EIyy, EIyz], [-ESz, EIyz, EIzz]]),
        "EA": EA, "EI_y": EIyy - EA * yc ** 2, "EI_z": EIzz - EA * zc ** 2, "EI_yz": EIyz - EA * yc * zc,
        "centroid": (yc, zc), "GJ": 4 * A_m ** 2 / (alpha66 * S), "A_m": A_m, "S": S,
        "mass": mass[0], "mass_centroid": (mass[1] / mass[0], mass[2] / mass[0]) if mass[0] > 0 else (yc, zc),
        "mid_points": mid, "mid_normals": nrm, "q_Vy": shear["q_Vy"], "q_Vz": shear["q_Vz"],
        "shear_centre": shear["shear_centre"],
    }


def section_shear_flow(mid):
    """
    Shear flow round a thin-walled single-cell section from transverse shear force, and its shear centre. The wall
    is the closed counter-clockwise midline polygon mid (n, 2) [m] with the same laminate all the way round.

    Beam theory gives the rate of change of axial wall force along the span, dN_xx/dx = E_t (a - y b - z c), and
    wall equilibrium dN_xx/dx + dq/ds = 0 gives the open-section flow q_o(s) = -int_0^s dN_xx/dx ds from a cut at
    the first point. a, b, c follow from the shear force (Vy, Vz) = int q (dy, dz) and no change of axial force
    (int dN_xx/dx ds = 0). The wall stiffness E_t is the same everywhere, so it cancels. The closed cell adds a
    constant flow q0, set so the wall does not twist (int q ds = 0 for a uniform wall). The torque that flow
    carries about the origin puts the shear force on its line of action, the shear centre:
        y_sc = (torque of the flow for Vz = 1),   z_sc = -(torque of the flow for Vy = 1)
    Shear flow q is positive along the midline in the counter-clockwise direction (seen looking along +x, the
    span), the direction torsion about +x drives it.
    :return: dict with "q_Vy", "q_Vz": flow [N/m per N] at each point, for a shear force through the shear
             centre; "shear_centre": (y_sc, z_sc) [m]
    """
    n = len(mid)
    p0, p1 = mid, np.roll(mid, -1, axis=0)
    d = p1 - p0                      # segment j runs from point j to point j+1
    ln = np.hypot(d[:, 0], d[:, 1])
    pm = (p0 + p1) / 2
    # dN/dx on each segment, per unit (a, b, c), times its length; q at point k = -(sum over segments before k)
    g = ln[:, None] * np.column_stack([np.ones(n), -pm[:, 0], -pm[:, 1]])
    q_pts = -np.vstack([np.zeros(3), np.cumsum(g, axis=0)[:-1]])  # (n, 3): q_o at each point per (a, b, c)
    q_seg = q_pts - g / 2  # mean flow over each segment (dN/dx taken at the segment middle)
    rows = np.vstack([q_seg.T @ d[:, 0], q_seg.T @ d[:, 1], g.sum(axis=0)])  # Vy, Vz, change of axial force

    arm = pm[:, 0] * d[:, 1] - pm[:, 1] * d[:, 0]  # moment arm x length of each segment, about the origin
    out = {}
    for key, rhs in (("q_Vy", [1.0, 0.0, 0.0]), ("q_Vz", [0.0, 1.0, 0.0])):
        abc = np.linalg.solve(rows, rhs)
        qs, qp = q_seg @ abc, q_pts @ abc
        q0 = -np.sum(qs * ln) / np.sum(ln)  # no twist
        out[key] = qp + q0
        out[key + "_torque"] = float(np.sum((qs + q0) * arm))
    out["shear_centre"] = (out["q_Vz_torque"], -out["q_Vy_torque"])
    return out


# ---------------------------------------------------------------- ply checks
class _PlyCheck:
    """
    Lowest safety factor round a section wall, vectorised over points. The wall at each point carries the axial
    force N1 and moment M1 that give it the beam's axial strain at mid-wall and its strain gradient through the
    thickness, plus the torsion shear flow N6; all other resultants are zero (as Tube Stiffness does).
    """
    CRIT = ["max", "max", "max", "max", "max", "quad", "hashin", "hashin", "hashin", "hashin"]
    MODE = ["FT", "FC", "MT", "MC", "S", None, "FT", "FC", "MT", "MC"]

    def __init__(self, lu):
        A, B, D = cc.calculate_A_B_D_matrix(lu)
        self.a = np.linalg.inv(np.block([[A * 1e9, B], [B, D]]))
        self.surf = []  # (layer, location, 3x3 map from (N1, N6, M1) to on-axis stress [MPa], material)
        for _, r in lu.iterrows():
            if r["Material_name"] == "Core":
                continue
            th = math.radians(r["Orientation (deg)"])
            c, s = math.cos(th), math.sin(th)
            T = np.array([[c * c, s * s, c * s], [s * s, c * c, -c * s], [-2 * c * s, 2 * c * s, c * c - s * s]])
            for loc, z in (("Top", r["TopHeight"]), ("Bottom", r["BottomHeight"])):
                strain = np.hstack([np.eye(3), z * np.eye(3)]) @ self.a[:, [0, 2, 3]]  # off-axis strain per load
                self.surf.append((int(r["Layer #"]), loc, r["Q matrix"] @ T @ strain * 1e3, r["Material"]))

    def loads(self, eps1, kap1, N6):
        """N1, M1 for a target mid-wall axial strain and curvature with shear flow N6 (arrays)."""
        a = self.a
        M = np.array([[a[0, 0], a[0, 3]], [a[3, 0], a[3, 3]]])
        rhs = np.vstack([eps1 - a[0, 2] * N6, kap1 - a[3, 2] * N6])
        N1, M1 = np.linalg.solve(M, rhs)
        return N1, M1

    @staticmethod
    def _criteria(m, s1, s2, s6):
        """Safety factors [n_modes, n_points]; inf where a mode is not loaded."""
        inf = np.inf
        with np.errstate(divide="ignore", invalid="ignore"):
            a6 = np.abs(s6)
            R = [np.where(s1 > 0, m.Xt / s1, inf), np.where(s1 < 0, m.Xc / -s1, inf),
                 np.where(s2 > 0, m.Yt / s2, inf), np.where(s2 < 0, m.Yc / -s2, inf),
                 np.where(a6 > 0, m.Sc / a6, inf)]
            Fxx, Fx = 1 / (m.Xt * m.Xc), 1 / m.Xt - 1 / m.Xc
            Fyy, Fy = 1 / (m.Yt * m.Yc), 1 / m.Yt - 1 / m.Yc
            Fxy = -0.5 * math.sqrt(Fxx * Fyy)
            qa = Fxx * s1 * s1 + 2 * Fxy * s1 * s2 + Fyy * s2 * s2 + s6 * s6 / m.Sc ** 2
            qb = Fx * s1 + Fy * s2
            R.append(np.where(qa > 0, (-qb + np.sqrt(qb * qb + 4 * qa)) / (2 * qa), np.where(qb > 0, 1 / qb, inf)))
            R.append(np.where(s1 > 0, m.Sc * m.Xt / np.sqrt(s1 ** 2 * m.Sc ** 2 + m.Xt ** 2 * s6 ** 2), inf))
            R.append(np.where(s1 < 0, m.Xc / -s1, inf))
            R.append(np.where(s2 > 0, m.Sc * m.Yt / np.sqrt(s6 ** 2 * m.Yt ** 2 + m.Sc ** 2 * s2 ** 2), inf))
            S, Y = m.Sc, m.Yc
            mc = (np.sqrt(64 * S ** 2 * Y ** 2 * s6 ** 2 + 8 * s2 ** 2 * S ** 2 * Y ** 2 + s2 ** 2 * Y ** 4
                          + 16 * s2 ** 2 * S ** 4) + 4 * s2 * S ** 2 - s2 * Y ** 2) / (2 * Y * (4 * s6 ** 2 + s2 ** 2))
            R.append(np.where(s2 < 0, mc, inf))
        R = np.array(R)
        return np.where(np.isfinite(R) & (R > 0), R, inf)

    def check(self, N1, N6, M1):
        """Lowest R at each point, and the details (criterion, mode, layer, location) of the lowest overall."""
        loads = np.vstack([N1, N6, M1])
        best = np.full(loads.shape[1], np.inf)
        worst = None
        for layer, loc, G, mat in self.surf:
            st = G @ loads
            big = np.max(np.abs(st), axis=0, keepdims=True)
            st = np.where(np.abs(st) < 1e-9 * big, 0.0, st)  # round-off, as calculate_safety_factors()
            R = self._criteria(mat, *st)
            k = np.argmin(R, axis=0)
            r = R[k, np.arange(R.shape[1])]
            best = np.minimum(best, r)
            i = int(np.argmin(r))
            if np.isfinite(r[i]) and (worst is None or r[i] < worst["R"]):
                worst = {"R": float(r[i]), "point": i, "criterion": self.CRIT[k[i]], "mode": self.MODE[k[i]],
                         "layer": layer, "location": loc, "stress_MPa": st[:, i].tolist()}
        return best, worst


# ---------------------------------------------------------------- beam finite elements
def _hermite(xi, L):
    """Hermite shape functions and their second x-derivatives for (w1, w1', w2, w2')."""
    N = np.array([1 - 3 * xi ** 2 + 2 * xi ** 3, L * (xi - 2 * xi ** 2 + xi ** 3), 3 * xi ** 2 - 2 * xi ** 3,
                  L * (-xi ** 2 + xi ** 3)])
    B = np.array([(-6 + 12 * xi) / L ** 2, (-4 + 6 * xi) / L, (6 - 12 * xi) / L ** 2, (-2 + 6 * xi) / L])
    return N, B


# node DOFs: 0 u (axial), 1 v (y), 2 w (z), 3 phi (twist about the axis), 4 v', 5 w'
_U, _V, _W, _PHI, _VP, _WP = range(6)


def _elem_dofs(e):
    n0, n1 = 6 * e, 6 * (e + 1)
    return {"u": [n0 + _U, n1 + _U], "v": [n0 + _V, n0 + _VP, n1 + _V, n1 + _VP],
            "w": [n0 + _W, n0 + _WP, n1 + _W, n1 + _WP], "phi": [n0 + _PHI, n1 + _PHI]}


def _point_load(f, fel, sections, x_nodes, s, F, y, z, Mx=0.0):
    """
    Adds a force F = (Fx, Fy, Fz) [N] acting at section point (y, z) at span position s, plus a torque Mx, to the
    load vector f as consistent nodal loads, and to the element's own load vector fel[e] (u, v, w, phi order).
    v, w and the twist phi are those of the shear centre (y_sc, z_sc), so a section point moves by
    (u - y v' - z w', v - (z - z_sc) phi, w + (y - y_sc) phi).
    """
    e = int(np.clip(np.searchsorted(x_nodes, s) - 1, 0, len(x_nodes) - 2))
    L = x_nodes[e + 1] - x_nodes[e]
    xi = float(np.clip((s - x_nodes[e]) / L, 0, 1))
    Nh, _ = _hermite(xi, L)
    dNh = np.array([(-6 * xi + 6 * xi ** 2) / L, 1 - 4 * xi + 3 * xi ** 2, (6 * xi - 6 * xi ** 2) / L, -2 * xi + 3 * xi ** 2])
    Nl = np.array([1 - xi, xi])
    ysc, zsc = sections[e]["shear_centre"]
    Fx, Fy, Fz = F
    vals = np.concatenate([Nl * Fx, Nh * Fy - dNh * y * Fx, Nh * Fz - dNh * z * Fx,
                           Nl * (Mx - (z - zsc) * Fy + (y - ysc) * Fz)])
    d = _elem_dofs(e)
    f[d["u"] + d["v"] + d["w"] + d["phi"]] += vals
    fel[e] += vals


def beam_solve(x_nodes, sections, supports, point_loads=(), line_loads=(), gravity=None):
    """
    3D Euler-Bernoulli beam with per-element section stiffness (from section_properties()) about a straight axis.
    Bending and axial strain use the reference axis (y = z = 0) with the full coupled stiffness D; the transverse
    displacements v, w and the twist phi are those of each element's shear centre, so a load twists the beam by its
    torque about the shear centre and bending carries no twist.
    :param x_nodes: node positions along the span [m]; element e runs from node e to e+1 and uses sections[e]
    :param supports: list of (s [m], kind): "fixed" (all six DOFs), "pinned" (u, v, w and twist; slopes free)
                     or "roller" (v, w only). Each goes to the nearest node.
    :param point_loads: list of dicts {"s", "F": (Fx, Fy, Fz), "y", "z", "Mx"} in the beam frame [m, N, N m]
    :param line_loads: list of dicts {"s0", "s1", "q": (qx, qy, qz) [N/m], "y", "z"}
    :param gravity: (gx, gy, gz) [m/s^2] in the beam frame, or None; acts at each section's mass centroid
    :return: dict with "u" (n, 6) nodal displacements (shear-centre v, w and twist), per-element generalised
             strains "e" (u', v'', w'' at the element middle), twist rate "phi_p", and internal forces at the element
             middle "internal" (n_el, 4): N, Vy, Vz [N] and torque about the shear centre T [N m], each the force of
             the part further along the span on the part before it (N tension positive)
    """
    n = len(x_nodes)
    nd = 6 * n
    ne = len(sections)
    K = np.zeros((nd, nd))
    f = np.zeros(nd)
    fel = np.zeros((ne, 12))
    kel = []
    gp, gw = np.polynomial.legendre.leggauss(3)
    gp, gw = (gp + 1) / 2, gw / 2
    for e, sec in enumerate(sections):
        L = x_nodes[e + 1] - x_nodes[e]
        d = _elem_dofs(e)
        ke = np.zeros((12, 12))
        for xi, w in zip(gp, gw):
            _, Bh = _hermite(xi, L)
            Bm = np.zeros((3, 10))
            Bm[0, 0:2] = [-1 / L, 1 / L]
            Bm[1, 2:6] = Bh
            Bm[2, 6:10] = Bh
            ke[:10, :10] += w * L * Bm.T @ sec["D"] @ Bm
        ke[10:, 10:] = sec["GJ"] / L * np.array([[1, -1], [-1, 1]])
        idx = d["u"] + d["v"] + d["w"] + d["phi"]
        K[np.ix_(idx, idx)] += ke
        kel.append((idx, ke))

    # distributed loads by integration over each element
    for e, sec in enumerate(sections):
        L = x_nodes[e + 1] - x_nodes[e]
        loads = [ll for ll in line_loads if ll["s1"] > x_nodes[e] and ll["s0"] < x_nodes[e + 1]]
        if gravity is not None:
            mg = sec["mass"] * np.asarray(gravity, float)
            loads = loads + [{"s0": -np.inf, "s1": np.inf, "q": mg, "y": sec["mass_centroid"][0],
                              "z": sec["mass_centroid"][1]}]
        for ll in loads:
            for xi in np.linspace(0.05, 0.95, 10):
                s = x_nodes[e] + xi * L
                if ll["s0"] <= s <= ll["s1"]:
                    _point_load(f, fel, sections, x_nodes, s, np.asarray(ll["q"], float) * 0.1 * L, ll["y"], ll["z"])

    for pl in point_loads:
        _point_load(f, fel, sections, x_nodes, pl["s"], pl["F"], pl.get("y", 0.0), pl.get("z", 0.0), pl.get("Mx", 0.0))

    fixed = set()
    for s, kind in supports:
        i = int(np.argmin(np.abs(x_nodes - s)))
        dofs = {"fixed": range(6), "pinned": (_U, _V, _W, _PHI), "roller": (_V, _W)}[kind]
        fixed.update(6 * i + k for k in dofs)
    free = np.array(sorted(set(range(nd)) - fixed))
    Kff = K[np.ix_(free, free)]
    scale = np.sqrt(np.abs(np.diag(Kff)))
    Ks = Kff / np.outer(scale, scale)
    if np.linalg.cond(Ks) > 1e12:
        raise ValueError("The supports do not hold the beam: it can move or rotate freely. Add a fixed support, "
                         "or pinned supports at two places.")
    u = np.zeros(nd)
    u[free] = np.linalg.solve(Ks, f[free] / scale) / scale
    reactions = K @ u - f

    e_mid, phi_p, internal = [], [], []
    for e, (idx, ke) in enumerate(kel):
        L = x_nodes[e + 1] - x_nodes[e]
        d = _elem_dofs(e)
        _, Bh = _hermite(0.5, L)
        e_mid.append([(u[d["u"][1]] - u[d["u"][0]]) / L, Bh @ u[d["v"]], Bh @ u[d["w"]]])
        phi_p.append((u[d["phi"][1]] - u[d["phi"][0]]) / L)
        # forces the rest of the beam puts on the element at its two ends; the internal force at the middle is the
        # mean of the far-end force and minus the near-end force (exact for loads at the nodes)
        g = ke @ u[idx] - fel[e]
        internal.append([(g[1] - g[0]) / 2, (g[4] - g[2]) / 2, (g[8] - g[6]) / 2, (g[11] - g[10]) / 2])
    return {"u": u.reshape(n, 6), "e": np.array(e_mid), "phi_p": np.array(phi_p), "internal": np.array(internal),
            "reactions": reactions.reshape(n, 6), "f": f.reshape(n, 6)}


def _resample(loop, n):
    """n points evenly spaced round a closed loop, with outward normals (loop counter-clockwise)."""
    seg = np.roll(loop, -1, axis=0) - loop
    ln = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(ln)])
    t = np.linspace(0, cum[-1], n, endpoint=False)
    k = np.clip(np.searchsorted(cum, t, side="right") - 1, 0, len(loop) - 1)
    frac = (t - cum[k]) / ln[k]
    p = loop[k] + frac[:, None] * seg[k]
    tang = seg[k] / ln[k][:, None]
    return p, np.column_stack([tang[:, 1], -tang[:, 0]])


# ---------------------------------------------------------------- whole analysis
def shape_analyse(vertices, faces, lu, axis="x", n_elements=40, surface="outer", supports=(("start", "fixed"),),
                  point_loads=(), line_loads=(), gravity=None, n_points=64, verbose=True):
    """
    Beam analysis of a composite shell of any slender shape, from a mesh of one of its surfaces.
    Positions, loads and gravity are in model coordinates [m, N, N/m, m/s^2]; supports and line-load ranges are
    given as positions along the span axis [m], or "start" / "end".
    :param vertices, faces: mesh of the surface, e.g. from mesh_load_stl() [m]
    :param lu: layup dataframe, output of layup_create(); layer 1 lies on the meshed surface, 0 deg along the span
    :param axis: span axis, "x", "y" or "z"
    :param n_elements: number of beam elements (sections cut at their middles)
    :param surface: "outer" (layup built inward from the mesh) or "inner" (built outward)
    :param point_loads: list of {"at": (x, y, z), "F": (Fx, Fy, Fz), "M_axis": torque about the span axis}
    :param line_loads: list of {"s0", "s1", "through": (x, y, z), "q": (qx, qy, qz) [N/m]}: a load spread along the
                       span between s0 and s1 on the line parallel to the span axis through the given point
    :param gravity: gravity vector in model coordinates [m/s^2] (e.g. (0, 0, -9.81)), or None
    :return: dict of results; see the keys at the end of this function
    """
    vertices = np.asarray(vertices, float)
    faces = np.asarray(faces)
    ax = AXES[axis]
    ea, ey, ez = _frame(axis)
    to_beam = np.array([ea, ey, ez])  # rows: model vector -> (span, y, z) components
    lo, hi = float(vertices[:, ax].min()), float(vertices[:, ax].max())
    size = float(np.max(np.ptp(vertices, axis=0)))
    x_nodes = np.linspace(lo, hi, n_elements + 1)
    x_mid = (x_nodes[:-1] + x_nodes[1:]) / 2

    lu = lu.copy()
    cc.calculate_A_B_D_matrix(lu)
    h = float(lu["Thickness (m)"].sum())

    def pos(s):
        return lo if s == "start" else hi if s == "end" else float(s)

    sections, outlines = [], []
    for e, s in enumerate(x_mid):
        loops = [_clean_loop(l, size) for l in mesh_slice(vertices, faces, axis, s)]
        loops = [l for l in loops if len(l) >= 3]
        if not loops:
            raise ValueError("No section found at %s = %.4g m: is the mesh one closed surface round the span?" % (axis, s))
        areas = [abs(cc._section_polygon_moments(l[:, 0], l[:, 1])[0]) for l in loops]
        loop = loops[int(np.argmax(areas))]  # the outermost loop (a solid mesh also has the inner wall)
        try:
            sec = section_properties(loop[:, 0], loop[:, 1], lu, surface, n_points)
        except ValueError as err:
            raise ValueError("Section at %s = %.4g m: %s" % (axis, s, err))
        sections.append(sec)
        outlines.append(loop)

    # loads into the beam frame
    pls = []
    for pl in point_loads:
        p = to_beam @ np.asarray(pl["at"], float)
        pls.append({"s": p[0], "F": to_beam @ np.asarray(pl["F"], float), "y": p[1], "z": p[2],
                    "Mx": float(pl.get("M_axis", 0.0))})
    lls = []
    for ll in line_loads:
        p = to_beam @ np.asarray(ll.get("through", (0, 0, 0)), float)
        lls.append({"s0": pos(ll.get("s0", "start")), "s1": pos(ll.get("s1", "end")),
                    "q": to_beam @ np.asarray(ll["q"], float), "y": p[1], "z": p[2]})
    g = None if gravity is None else to_beam @ np.asarray(gravity, float)
    sup = [(pos(s), kind) for s, kind in supports]
    if not sup:
        raise ValueError("Add at least one support")

    sol = beam_solve(x_nodes, sections, sup, pls, lls, g)

    # ply check round every section, at points evenly spaced round the wall midline
    checker = _PlyCheck(lu)
    sign = 1 if surface == "outer" else -1  # laminate z points toward layer 1, on the meshed surface
    R_pts, worst, pts_out = [], None, []
    for e, sec in enumerate(sections):
        mid, nrm = sec["mid_points"], sec["mid_normals"]
        up, vpp, wpp = sol["e"][e]
        eps1 = up - mid[:, 0] * vpp - mid[:, 1] * wpp
        kap1 = -sign * (nrm[:, 0] * vpp + nrm[:, 1] * wpp)
        _, Vy, Vz, T = sol["internal"][e]
        # shear flow: shear force through the shear centre, plus torsion about it (Bredt). Taken as N6 with the
        # same sign as Tube Stiffness (positive counter-clockwise looking along +x)
        q_shear = Vy * sec["q_Vy"] + Vz * sec["q_Vz"]
        q_tors = T / (2 * sec["A_m"])
        N6 = q_shear + q_tors
        N1, M1 = checker.loads(eps1, kap1, N6)
        R, w = checker.check(N1, N6, M1)
        R_pts.append(R)
        surf = mid + sign * (h / 2) * nrm
        pts_out.append(surf)
        if w and (worst is None or w["R"] < worst["R"]):
            k = w["point"]
            model = ea * x_mid[e] + ey * surf[k, 0] + ez * surf[k, 1]
            worst = dict(w, element=e, s=float(x_mid[e]), at=model.tolist(), N1=float(N1[k]), M1=float(M1[k]),
                         N6=float(N6[k]), N6_shear=float(q_shear[k]), N6_torsion=float(q_tors))
    R_pts = np.array(R_pts)

    # safety factor at each mesh vertex: the nearest check point of the nearest section
    elem = np.clip(np.searchsorted(x_nodes, vertices[:, ax]) - 1, 0, n_elements - 1)
    yz = vertices[:, [(ax + 1) % 3, (ax + 2) % 3]]
    R_vert = np.full(len(vertices), np.inf)
    for e in range(n_elements):
        m = elem == e
        if m.any():
            dd = ((yz[m, None, :] - pts_out[e][None, :, :]) ** 2).sum(axis=2)
            R_vert[m] = R_pts[e][np.argmin(dd, axis=1)]

    # nodal displacements of the reference axis, from the shear centre's and the twist (shear centre at a node:
    # the mean of the elements either side)
    u = sol["u"].copy()
    sc = np.array([sec["shear_centre"] for sec in sections])
    sc_node = np.vstack([sc[:1], (sc[:-1] + sc[1:]) / 2, sc[-1:]])
    u[:, _V] += sc_node[:, 1] * u[:, _PHI]
    u[:, _W] -= sc_node[:, 0] * u[:, _PHI]
    disp = u[:, [_U, _V, _W]] @ to_beam  # back to model coordinates
    dmag = np.linalg.norm(disp, axis=1)
    i_max = int(np.argmax(dmag))
    mass = float(sum(sec["mass"] * (x_nodes[e + 1] - x_nodes[e]) for e, sec in enumerate(sections)))
    reac = sol["reactions"]
    support_nodes = sorted({int(np.argmin(np.abs(x_nodes - s))) for s, _ in sup})

    res = {
        "axis": axis, "x_nodes": x_nodes, "x_mid": x_mid, "h": h, "mass": mass,
        "disp": disp, "twist_deg": np.degrees(u[:, _PHI]),
        "max_disp": float(dmag[i_max]), "max_disp_at": float(x_nodes[i_max]),
        "max_twist_deg": float(np.max(np.abs(np.degrees(u[:, _PHI])))),
        "sections": [{k: sec[k] for k in ("EA", "EI_y", "EI_z", "EI_yz", "GJ", "mass", "centroid", "A_m", "S",
                                          "shear_centre")} for sec in sections],
        "shear_centre_model": [(ea * xm + ey * c[0] + ez * c[1]).tolist() for xm, c in zip(x_mid, sc)],
        "outlines": outlines,
        "forces": [{"N": float(it[0]), "V_y": float(it[1]), "V_z": float(it[2]), "T": float(it[3]),
                    "M_y": float(sec["D"][1] @ ee), "M_z": float(sec["D"][2] @ ee)}
                   for sec, ee, it in zip(sections, sol["e"], sol["internal"])],
        "R_points": R_pts, "R_min_section": R_pts.min(axis=1), "R_vertex": R_vert, "worst": worst,
        # reaction torque about the span (reference) axis: about the shear centre, plus the reaction force's moment
        "reactions": [{"s": float(x_nodes[i]), "F": (reac[i, :3] @ to_beam).tolist(),
                       "M_axis": float(reac[i, 3] + sc_node[i, 0] * reac[i, 2] - sc_node[i, 1] * reac[i, 1])}
                      for i in support_nodes],
    }
    if verbose:
        print("Shape beam: %d elements along %s, %.4g m long, wall %.4g mm, mass %.4g kg"
              % (n_elements, axis, hi - lo, h * 1000, mass))
        print("Largest deflection %.4g mm at %s = %.4g m, largest twist %.4g deg"
              % (res["max_disp"] * 1000, axis, res["max_disp_at"], res["max_twist_deg"]))
        if worst:
            print("Lowest safety factor R = %.4g (%s %s), layer %d %s, at %s = %.4g m"
                  % (worst["R"], worst["criterion"], worst["mode"] or "", worst["layer"], worst["location"].lower(),
                     axis, worst["s"]))
        else:
            print("No ply is loaded")
    return res
