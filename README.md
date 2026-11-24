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
- tube natural frequencies (bending, torsion, axial)
- natural frequencies of simply supported rectangular laminate plates

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
- `generate_natural_frequencies_tube()` computes bending (Euler-Bernoulli), torsion and axial natural frequencies of a tube from its stiffness and the ply densities, for clamped-free, pinned-pinned, clamped-clamped, free-free and clamped-pinned supports
- `generate_natural_frequencies_plate()` computes the lowest natural frequencies and (m, n) mode numbers of a rectangular laminate simply supported on all edges (Navier solution; exact for symmetric cross-ply, an upper estimate when D16/D26 or B are not zero)

## Example usage
See `CompositesCalculatorExample.py` for a complete example:
- load materials with `materials_load()`
- create a layup with `layup_create()`
- modify layers with `layup_material_change()`, `layup_thickness_change()`, and `layup_orientation_change()`
- compute stiffness with `calculate_A_B_D_matrix()`
- print the layup with `layup_print()`

## Web app
`index.html` runs the library in the browser through Pyodide; serve the folder over HTTP (for example `py -m http.server`) and open the page. The front end has no build step:
- `css/app.css`: design tokens (light and dark theme) and all styles
- `py/bridge.py`: the Python layer between the page and `composites_calculator_lib.py`
- `js/calc.js`: the few formulas that run in the page (beam cases, bolted-joint strength, load converter, screw preload)
- `js/components.js`: shared result, matrix, table, tab and tooltip components
- `js/layup.js`: layup definition, ply table and cross-section drawing
- `js/modules/*.js`: one file per module (laminate, tube, failure, beam, bolt, clamp, materials)
- `js/app.js`: start-up, navigation and recalculation

## Notes
- The library assumes ply data uses GPa for elastic moduli and MPa for strengths.
- For layup templates containing a core, use `zc<number>` tokens to add a core layer thickness in cm.
- `materials_database.csv` must contain the expected columns: `name, Ex, Ey, Es, vxy, Xt, Xc, Yt, Yc, Sc, h0, rho`.

> Do not edit `composites_calculator_lib.py` unless you know what you are doing.


## Shape Beam (beta)
`shape.html` analyses a slender composite shell of any shape (tapered tube, arm, spar, wing) from an STL of its outer surface. It sits between the closed-form tube sections above and a full shell finite-element model:
1. The mesh is cut into sections across the span axis, and the layup is laid inward from the surface (layer 1 on the surface, 0° along the span).
2. Each section's stiffness (EA, EI with coupling, GJ) and mass come from the layup, by the same offset-polygon method as `generate_EIeq_arbitrary_tube()`.
3. A 3D beam finite-element model with those sections is solved under the supports, point loads, line loads and self-weight, with torsion about each section's shear centre.
4. Ply stresses round every section (from bending, torsion and shear flow from shear force) are checked with the maximum stress, Tsai-Wu and Hashin criteria, and the lowest safety factor is shown on the surface.

The analysis lives in `composites_shape_lib.py` (usable from Python: `mesh_load_stl()`, `shape_analyse()`), the page glue in `py/shape_bridge.py` and `js/shape.js`. `tests/test_composites_shape_lib.py` checks it against the closed-form results of `composites_calculator_lib.py`.

Each section's shear centre and its shear flow per unit shear force come from thin-walled single-cell theory (`section_shear_flow()`): the beam twists about the shear centres, and the ply check adds the shear flow from shear force to the torsion shear flow.

Limits: Euler–Bernoulli beam on a straight axis, single cell with the same layup all round, no warping restraint at supports, no internal webs or ribs, no buckling or local load introduction. Use it for sizing.
