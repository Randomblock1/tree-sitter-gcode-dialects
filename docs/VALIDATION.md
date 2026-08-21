# Upstream compatibility validation

Validation last ran on 2026-08-21 with Tree-sitter CLI 0.25.10. Every file was parsed with the generated `gcode` parser; a success means the syntax tree contained no `ERROR` or missing nodes. The run is reproducible with:

```sh
npm run validate:corpora
```

which shallow-fetches each pinned revision into `build/corpora/` and re-runs the sweep. Corpora are parsed in CI only, never vendored; licenses are noted in [validate-corpora.mjs](../scripts/validate-corpora.mjs) next to each pin. See [REFERENCES.md](REFERENCES.md) for the language references each dialect is validated against.

| Dialect | Upstream corpus | Pinned revision | Result |
| --- | --- | --- | ---: |
| Klipper | `Klipper3d/klipper` `config/*.cfg` | `58bd67db` | 228 / 228 |
| Klipper | `Frix-x/klippain` configs + macros | `ac565f2f` | 370 / 373 |
| Klipper | `jschuh/klipper-macros` | `ebae0a3b` | 7 / 19 |
| Klipper | `kyleisah/Klipper-Adaptive-Meshing-Purging` | `b0dad8ec` | 5 / 5 |
| RRF | `Duet3D/RRF-machine-config-files` `**/*.g` | `bef2faf7` | 570 / 570 |
| RRF | `MillenniumMachines/MillenniumOS` macros | `de639ec8` | 103 / 103 |
| RRF | `benagricola/NeXT` macros | `7b8fd4d8` | 38 / 38 |
| Printer | `MarlinFirmware/Marlin` `M808-loops.gcode` | `0ebac470` | 1 / 1 |
| Printer | `ErwinRieger/ddprint-test-gcode` (Simplify3D/Cura + stress files) | `9178069d` | 60 / 60 |
| Printer | `xyz-tools/gcode-preview` (PrusaSlicer 2.7/2.9 output) | `0fed7ed3` | 7 / 7 |
| CNC | `LinuxCNC/linuxcnc` `nc_files/**/*.ngc` | `7a29eb2b` | 247 / 247 |
| CNC | `FernV/NativeCAM` `lib/**/*.ngc` (named O-words) | `2ba64e65` | 85 / 86 |
| CNC | `RomanBoreyko/r_cod2` `cnc/**/*.nc` (Fanuc shop output) | `d19e92b7` | 312 / 312 |
| Siemens | `CEAD-group/nc-gcode-interpreter` `examples/**/*.mpf` | `892e32a6` | 31 / 32 |
| Siemens | `josip-mrdeza/PyroNc` `MPF.DIR_*/**.MPF` | `1a89fa2b` | 90 / 90 |

**Total: 2,376 / 2,393 files parse without a single ERROR node (99.3%).**

The 17 known failures are pinned by path in the validation script and re-checked on every run — a known failure that starts passing fails the run until it is removed from the list. They fall into three classes:

1. **Line-broken Jinja** (15 files, klippain + jschuh/klipper-macros): statements wrapped at a keyword boundary (`x if cond` newline `else y`, `{% endfor` newline `%}`, a subscript split at `[`). A line-oriented grammar cannot continue there without merging genuinely separate statement lines in every other dialect.
2. **Preprocessor templates** (1 file): NativeCAM's `optimize.ngc` contains `o11 if [cur dir EQ 1]` — a substitution placeholder, not valid RS274.
3. **Siemens empty argument slots in expression context** (1 file): `FELD1[10,3]=SET(0,,,9,…)`. The same form as a standalone cycle call (`MCALL CYCLE81(5,,3,-15,0)`) parses fine.

Because the grammar is tolerant, a no-`ERROR` sweep alone cannot distinguish a correct parse from a tolerated mis-parse, so the sweep also asserts structure: every LinuxCNC file containing numeric O-words (`o100 if …`) must produce `o_statement` nodes — 33 / 33 do.

Marlin's `syntax_test_G-code.gcode` was also checked. It intentionally contains the invalid line `N234 G1 X-5 Y+2 *64 error`; the parser reports that deliberately invalid suffix and no earlier error.

The repository-owned gates (`npm test`) add:

- ten syntax-tree corpus tests covering RRF, Klipper/Jinja, Marlin/RepRap, LinuxCNC, Siemens address assignments, compact/checksummed lines, display glyphs, and Jinja comments;
- six complete example fixtures, including `examples/rrf.g`, which is based on the reported `measure_idle_window.g` failure case;
- compilation of every Tree-sitter query file in `queries/`;
- a regeneration step that keeps the committed `src/` parser in sync with `grammar.js`.

`npm run fuzz` adds three more layers: seeded generative fuzzing (valid-by-construction programs across all dialects must parse with zero ERROR nodes), mutation fuzzing (corrupted fixtures must never crash or hang the parser), and `tree-sitter fuzz` incremental-reparse consistency.

These are syntax-coverage tests, not firmware command validation. A tolerant editor grammar should retain structure for vendor commands it has never seen; the target firmware remains responsible for deciding whether a command and its operands are semantically valid.
