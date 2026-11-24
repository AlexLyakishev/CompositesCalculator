"""Basic checks of composites_calculator_lib and of the project version. Add a test here for every bug you fix."""
import os
import re

import numpy as np

import composites_calculator_lib as cc
import composites_shape_lib as cs
from conftest import ROOT, quiet


def test_version_is_semver_and_shared():
    assert re.fullmatch(r"\d+\.\d+\.\d+", cc.__version__), cc.__version__
    assert cs.__version__ == cc.__version__
    assert cc.version == cc.__version__


def test_version_is_in_changelog():
    with open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8") as f:
        text = f.read()
    assert f"## [{cc.__version__}]" in text, f"add a '## [{cc.__version__}]' section to CHANGELOG.md"


def test_materials_database_loads(materials):
    assert "Graphite_Epoxy_T300_N5208" in materials
    assert len(materials) > 1


def test_symmetric_layup_has_no_coupling(lu):
    A, B, D = quiet(cc.calculate_A_B_D_matrix, lu)
    A, B, D = np.asarray(A, float), np.asarray(B, float), np.asarray(D, float)
    assert np.allclose(A, A.T) and np.allclose(D, D.T)
    assert np.abs(B).max() <= 1e-9 * np.abs(A).max() * lu["Thickness (m)"].sum()


def test_quasi_isotropic_in_plane_stiffness(lu):
    # [0/45/-45/90]s: A11 = A22, A16 = A26 = 0, and A66 = (A11 - A12) / 2 (in-plane isotropy)
    A, B, D = quiet(cc.calculate_A_B_D_matrix, lu)
    A = np.asarray(A, float)
    assert np.isclose(A[0, 0], A[1, 1], rtol=1e-9)
    assert abs(A[0, 2]) < 1e-9 * A[0, 0] and abs(A[1, 2]) < 1e-9 * A[0, 0]
    assert np.isclose(A[2, 2], (A[0, 0] - A[0, 1]) / 2, rtol=1e-9)
