# Shape Beam page: runs after py/bridge.py in the same namespace and adds its calls to _API.
# Lengths cross the bridge in model units (the STL's units, mm by default); everything inside is SI.
import composites_shape_lib as cs

_MESH = {}


def _shape_mesh(p):
    """Loads an example or the uploaded STL (written to /tmp/model.stl by the page)."""
    unit = float(p.get("unit", 0.001))  # metres per model unit
    if p["source"] == "example":
        V, F = cs.mesh_example(p["kind"])
    else:
        V, F = cs.mesh_load_stl("/tmp/model.stl", unit)
    _MESH.clear()
    _MESH.update(V=V, F=F, unit=unit)
    ext = np.ptp(V, axis=0)
    Vu = V / unit
    return {"vertices": np.round(Vu, 6).reshape(-1), "faces": F.reshape(-1), "n_faces": int(len(F)),
            "min": Vu.min(axis=0), "max": Vu.max(axis=0), "axis": "xyz"[int(np.argmax(ext))]}


def _shape_run(p):
    if not _MESH:
        raise ValueError("Load a model first")
    k = _MESH["unit"]
    lu = _build(p["layup"])
    lo = 0.0  # span positions are model coordinates along the span axis

    def span(v):  # model units -> metres
        return float(v) * k

    supports = [(span(s["s"]), s["kind"]) for s in p["supports"]]
    pls = [{"at": [float(c) * k for c in pl["at"]], "F": pl["F"], "M_axis": float(pl.get("M", 0.0))}
           for pl in p["point_loads"]]
    lls = [{"s0": span(ll["s0"]), "s1": span(ll["s1"]), "through": [float(c) * k for c in ll["through"]], "q": ll["q"]}
           for ll in p["line_loads"]]
    g = p.get("gravity")
    r = cs.shape_analyse(_MESH["V"], _MESH["F"], lu, p["axis"], int(p["n_elements"]), p["surface"], supports,
                         pls, lls, g, int(p.get("n_points", 64)))
    x = (r["x_nodes"] - lo) / k
    xm = (r["x_mid"] - lo) / k
    w = r["worst"]
    if w:
        w = dict(w, s=(w["s"] - lo) / k, at=[c / k for c in w["at"]])
    return {
        "x": x, "x_mid": xm, "h": r["h"], "mass": r["mass"],
        "disp": r["disp"] / k, "twist_deg": r["twist_deg"],
        "max_disp": r["max_disp"] / k, "max_disp_at": (r["max_disp_at"] - lo) / k, "max_twist_deg": r["max_twist_deg"],
        "sections": r["sections"], "forces": r["forces"], "R_min_section": r["R_min_section"],
        "R_vertex": r["R_vertex"], "worst": w,
        "reactions": [dict(rr, s=(rr["s"] - lo) / k) for rr in r["reactions"]],
        "shear_centre": [[c / k for c in pt] for pt in r["shear_centre_model"]],
    }


_API.update({"shape_mesh": _shape_mesh, "shape_run": _shape_run})
