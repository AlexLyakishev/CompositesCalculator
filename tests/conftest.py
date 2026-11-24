"""Shared set-up for the tests: import the libraries from the repository root and load the materials database."""
import contextlib
import io
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import composites_calculator_lib as cc  # noqa: E402


def quiet(f, *a, **k):
    """Call a library function without its printed tables."""
    with contextlib.redirect_stdout(io.StringIO()):
        return f(*a, **k)


@pytest.fixture(scope="session")
def materials():
    return quiet(cc.materials_load, os.path.join(ROOT, "materials_database.csv"))


@pytest.fixture(scope="session")
def mat(materials):
    return materials["Graphite_Epoxy_T300_N5208"]


@pytest.fixture(scope="session")
def lu(mat):
    """Quasi-isotropic [0/45/-45/90]s layup with its ABD matrix calculated."""
    layup = cc.layup_create("0/45/-45/90/s", mat)
    quiet(cc.calculate_A_B_D_matrix, layup)
    return layup
