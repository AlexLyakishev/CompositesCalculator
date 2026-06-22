# CompositesCalculator
CompositesCalculator is a lightweight Python library for composite laminate design and structural stiffness estimation.

The library combines:
- classical laminate theory for stacking sequence, ply orientation, and lamina stiffness calculations
- beam theory for applied bending stiffness of common structural shapes like rectangular and circular tubes

## Features
- material database import from `materials_database.csv`
- layup creation from simple string templates (`45/0/0/0/45/t`, `0/+45/-45/t`, etc.)
- symmetric and total layup expansion
- per-layer material, thickness, and orientation updates
- computation of S and Q stiffness matrices for each ply
- calculation of laminate A, B, and D matrices
- generation of equivalent anisotropic stiffness tensor `C`
- approximate `E*I` or `D_x` values for rectangular and circular tubes

## Installation
No installation is required beyond Python and the dependencies used in the example.

Required Python packages:
- `pandas`
- `numpy`
- `tabulate`

## Quick start
1. Place `composites_calculator_lib.py`, `materials_database.csv`, and `CompositesCalculatorExample.py` in the same directory.
2. Run `CompositesCalculatorExample.py`.

## How it works
### Classical laminate theory
The library builds laminate properties using classical laminate theory:
- each ply material is defined by longitudinal, transverse, and shear moduli plus Poisson ratio
- per-ply stiffness matrices are computed in the lamina coordinate system
- off-axis transformation yields the stiffness contribution of each ply
- laminate `A`, `B`, and `D` matrices are assembled from the layer contributions

### Beam theory for applied calculations
For simple structural estimates, the library uses beam-based approximations:
- `generate_EIeq_rect_tube()` computes an equivalent bending stiffness for a rectangular tube cross-section
- `generate_Dx_eq_circ_tube()` computes an equivalent bending stiffness for a circular tube cross-section

## Example usage
See `CompositesCalculatorExample.py` for a complete example:
- load materials with `materials_load()`
- create a layup with `layup_create()`
- modify layers with `layup_material_change()`, `layup_thickness_change()`, and `layup_orientation_change()`
- compute stiffness with `calculate_A_B_D_matrix()`
- print the layup with `layup_print()`

## Notes
- The library assumes ply data uses GPa for elastic moduli and MPa for strengths.
- For layup templates containing a core, use `zc<number>` tokens to add a core layer thickness in cm.
- `materials_database.csv` must contain the expected columns: `name, Ex, Ey, Es, vxy, Xt, Xc, Yt, Yc, Sc, h0, rho`.

> Do not edit `composites_calculator_lib.py` unless you know what you are doing.

