# Working on CompositesCalculator

The Python libraries and the web calculator are one product: the web pages load the same `.py` files into the
browser through Pyodide. So there is one repository, one version number and one changelog.

## Set up

```
py -m pip install -r requirements-dev.txt
py -m pytest            # run the tests
py -m ruff check .      # lint
py -m http.server 8765  # then open http://localhost:8765 for the web calculator
```

## Version numbers

`__version__` in `composites_calculator_lib.py` is the version of the whole project (`composites_shape_lib`
uses the same one, and the web pages show it in their footer). It follows `MAJOR.MINOR.PATCH`:

- **PATCH** (1.3.0 → 1.3.1): a bug fix, no new features.
- **MINOR** (1.3.1 → 1.4.0): a new feature, tab, material or function. Existing scripts still work.
- **MAJOR** (1.4.0 → 2.0.0): a change that breaks existing scripts, such as a renamed function or argument, or a
  changed return value or units.

## Making a change

1. Open an issue for it (or find the existing one), so every bug and idea is written down.
2. Make a branch from `main`: `git switch -c fix/clamp-units` or `feat/laminate-buckling`.
3. For a bug, first write a test in `tests/` that fails, then fix it. For a new calculation, add a test that checks
   it against a hand calculation or a published example, and name the source in the test.
4. Add a line to `CHANGELOG.md` under **Unreleased**.
5. Commit with a type prefix: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`.
6. Push and open a pull request; write `Fixes #12` in it to close the issue on merge. The Tests workflow must pass
   before merging. `main` is what GitHub Pages serves, so merging is releasing to the live site.

## Releasing a version

1. In `CHANGELOG.md`, rename **Unreleased** to `[1.4.0] - YYYY-MM-DD`, start a new empty **Unreleased**, and
   update the compare links at the bottom.
2. Set `__version__` and `update_date` in `composites_calculator_lib.py`.
3. Commit (`chore: release 1.4.0`), merge to `main`, then tag and push the tag:

   ```
   git tag -a v1.4.0 -m "v1.4.0"
   git push origin v1.4.0
   ```

4. On GitHub, create a Release from the tag and paste in that version's changelog section.

## Keeping track

- **Issues** for every bug and idea, with labels: `bug`, `feature`, `python-lib`, `web-ui`, `shape-solver`,
  `validation`.
- **Milestones** per planned version (`v1.4.0`): what must be done before that release.
- **Project board** (Backlog → Next → In progress → Done) for what is being worked on now.
