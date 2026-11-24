# Changelog

All notable changes to the Python libraries and the web calculator. One version number covers the whole project.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [Semantic Versioning](https://semver.org/)
(PATCH = bug fix, MINOR = new feature, MAJOR = a change that breaks existing scripts).

Add every change under **Unreleased** as you make it. On release, rename that heading to the new version and date.

## [Unreleased]

### Added
- `__version__` in both libraries; CHANGELOG, CONTRIBUTING, pytest test suite and GitHub Actions CI.

### Changed
- The web pages always revalidate the Python and CSV files with the server, so a new release never runs stale code.

## [1.3.0] - 2026-11-23

### Added
- Web calculator (`index.html`): the library running in the browser through Pyodide.
- Simple mode (quick check) and the Vibration tab.
- Shape Beam page (`shape.html`, beta) and `composites_shape_lib`: composite beams of any slender 3D shape from an STL.
- Feedback tab and issue form for reporting problems.
- Favicon; readability improvements to the web pages.

## [1.2.0] - 2026-11-09

### Added
- Arbitrary cross-section stiffness and torsion of tubes.
- Version string inside the library.

## Earlier

### Added
- FE materials example; real-world materials in the database (new database format).

### Fixed
- Cored materials in `composites_calculator_lib`.

[Unreleased]: https://github.com/AlexLyakishev/CompositesCalculator/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/AlexLyakishev/CompositesCalculator/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/AlexLyakishev/CompositesCalculator/releases/tag/v1.2.0
