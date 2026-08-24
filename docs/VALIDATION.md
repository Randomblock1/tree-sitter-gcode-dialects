# Upstream compatibility validation

Validation last ran on 2026-08-21 with Tree-sitter CLI 0.25.10. Every file was parsed with the generated `gcode` parser; a success means the syntax tree contained no `ERROR` or missing nodes. The run is reproducible with:

```sh
npm run validate:corpora
```

which shallow-fetches each pinned revision into `build/corpora/` and re-runs the sweep. Corpora are parsed in CI only, never vendored; licenses are noted in [validate-corpora.mjs](../scripts/validate-corpora.mjs) next to each pin. See [REFERENCES.md](REFERENCES.md) for the language references each dialect is validated against.

| Dialect | Upstream corpus | Pinned revision | Result |
| --- | --- | --- | ---: |
| Klipper | `Klipper3d/klipper` `config/*.cfg` | `58bd67db` | 228 / 228 |
| Klipper | `Frix-x/klippain` configs + macros | `ac565f2f` | 372 / 373 |
| Klipper | `jschuh/klipper-macros` | `ebae0a3b` | 8 / 19 |
| Klipper | `kyleisah/Klipper-Adaptive-Meshing-Purging` | `b0dad8ec` | 5 / 5 |
| Klipper | `The-Conglomerate/Voron-Klipper-Common` (display glyphs) | `0d0b5080` | 29 / 30 |
| Klipper | `rootiest/zippy-klipper_config` | `2475c1f0` | 171 / 182 |
| Klipper | `zellneralex/klipper_config` (legacy `[menu]`) | `6233edc4` | 25 / 27 |
| RRF | `Duet3D/RRF-machine-config-files` `**/*.g` | `bef2faf7` | 570 / 570 |
| RRF | `MillenniumMachines/MillenniumOS` macros | `de639ec8` | 103 / 103 |
| RRF | `benagricola/NeXT` macros | `7b8fd4d8` | 38 / 38 |
| RRF | `machineagency/jubilee` (RRF2 + RRF3 toolchanger) | `c877bd2e` | 77 / 77 |
| RRF | `jaysuk/BoxTurtle_RRF` (filament changer) | `e01024ad` | 33 / 34 |
| Printer | `MarlinFirmware/Marlin` `M808-loops.gcode` | `0ebac470` | 1 / 1 |
| Printer | `ErwinRieger/ddprint-test-gcode` (Simplify3D/Cura + stress files) | `9178069d` | 60 / 60 |
| Printer | `xyz-tools/gcode-preview` (PrusaSlicer 2.7/2.9 output) | `0fed7ed3` | 7 / 7 |
| Printer | `kageurufu/preprocess_cancellation` (eight slicers, thumbnails, M486) | `3b9cf647` | 11 / 12 |
| Printer | `loidolt/outdoor-box-latch` (PrusaSlicer MMU2S) | `075ed89d` | 2 / 2 |
| CNC | `LinuxCNC/linuxcnc` `nc_files/**/*.ngc` | `7a29eb2b` | 247 / 247 |
| CNC | `FernV/NativeCAM` `lib/**/*.ngc` (named O-words) | `2ba64e65` | 85 / 86 |
| CNC | `jethornton/flexgui` `examples` + `probe` | `ad266a5f` | 388 / 388 |
| CNC | `TooTall18T/tool_length_probe` (do/while, INI subscripts) | `3372bf2a` | 6 / 6 |
| CNC | `andypugh/LatheMacros` (lowercase, glued words) | `36e921b2` | 8 / 8 |
| CNC | `RomanBoreyko/r_cod2` `cnc/**/*.nc` (Fanuc shop output) | `d19e92b7` | 312 / 312 |
| CNC | `caileans/TormachZA6CNC` (5-axis TCP, `;` block ends) | `a9824c91` | 16 / 16 |
| CNC | `jpaullee/renishaw_macros` (Fanuc macro-B probing) | `b3b99238` | 50 / 65 |
| Siemens | `CEAD-group/nc-gcode-interpreter` `examples/**/*.mpf` | `892e32a6` | 31 / 32 |
| Siemens | `josip-mrdeza/PyroNc` `MPF.DIR_*/**.MPF` | `1a89fa2b` | 90 / 90 |
| Siemens | `staniska/notes` (frames, system variables) | `1a93f364` | 15 / 19 |
| Siemens | `ElMoe/…Five-Axis-CNC-Milling…` (CAM output) | `b8003660` | 2 / 2 |

**Total: 2,989 of 3,039 files across 29 corpora parse without a single ERROR node (98.4%).**

## Why a clean sweep is not enough

A tolerant grammar cannot prove itself with a no-ERROR sweep: a grammar that accepted every byte would score 100%. Two mechanisms guard the other direction.

**Structural assertions.** Each corpus declares rules of the form *a file matching this pattern must produce this node*. They catch a construct silently degrading into a comment or a bare argument while the sweep still reports clean — which is exactly what had been happening: 942 lines of NativeCAM indirection (`#[#1] = 0`) were being lexed as comments, and every one of those files passed. The assertions now cover Klipper sections, options and Jinja directives; RRF `if`/`while`, `var`/`global`, `echo` and brace expressions; printer G- and M-codes and axis words; LinuxCNC numeric and named O-words, parameter assignments and active comments; Fanuc parameter assignments, `%` markers and bracketed conditions; Siemens address assignments; and the indirection form itself. They are evaluated over the first 64 KB of each file, because `tree-sitter query` formats matches in time quadratic in the range and the printer corpora reach 8 MB.

**A negative corpus.** [test/tolerance/cases.txt](../test/tolerance/cases.txt) fixes the boundary from both sides and runs as part of `npm test`: 20 inputs that must produce an ERROR, 41 that must parse cleanly (many naming node types they must produce, so a case cannot pass by being swallowed), and 8 recorded as knowingly tolerated — input a real control rejects that this grammar accepts anyway, because one grammar serves four dialects and the construct is legal or unavoidably ambiguous in another one. Listing those keeps the leniency reviewable rather than invisible.

The reject cases are drawn from the sources that define the errors: LinuxCNC's `interp_read.cc` and its own negative fixtures under `tests/interp/bad/`, RepRapFirmware's `ExpressionParser.cpp` and `StringParser.cpp`, and Klipper's Jinja environment. The accept cases come from the same sources and matter just as much: `G1 X` (Marlin reads it as zero), `N10.5` (LinuxCNC reads and discards fractional line numbers), `G1 X10 5` (a letterless number continues the previous word), and glued or lowercase words all look wrong but are legal.

## The 50 known failures

Every one is pinned by path in the validation script with its cause, and re-checked on each run — a known failure that starts passing fails the run until it is removed, so the list cannot rot into a stale exemption.

What a failure costs is not uniform, so it is worth measuring rather than counting. Tree-sitter recovers locally, and across these 50 files **378 of 39,229 lines sit inside an ERROR node (0.96%)**, a median of 2.1% per file — a few lines lose their highlighting and the rest of the file is unaffected. The exception is an error inside a `gcode:` block nested in a section, where recovery unwinds to the top and a single ERROR wraps the whole file. Four files used to fail that way, costing 928 lines between them for two missing constructs; none do now.

1. **Jinja wrapped before `if`** (klippain, jschuh, and parts of the newer Klipper corpora), or before a closing `%}`. Wrapping before `else` now parses, through the same newline-prefixed token that `\n and` and `\n or` use. `if` cannot have one: a newline followed by `if` is indistinguishable from an RRF `if` statement on the next line, and gluing those together produces no ERROR at all — just a conditional expression where a control block belonged. One silent mis-parse in the dialect people actually write costs more than one file's highlighting.
2. **Jinja forms not modelled**: the `is divisibleby N` test taking a bare argument, subscripting a list literal (`{['G28','G28 Z'][menu.input|int]}`), and taking a member from a number (`{141.output}`).
3. **A comment after a bracketed call** (12 Renishaw files): `#195= ABS[ #192 ] (T P ERR)` reads as an argument list. The grammar cannot distinguish it from the spaced call form (`min (a, b)`) that Klipper and RRF configs really use, so neither reading can be made unconditional.
4. **DPRNT literal text** (3 Renishaw files): `DPRNT[----]` and `DPRNT[UNITS*#4006[20]]` are print formatting between brackets, not expressions.
5. **Siemens unbracketed IF conditions** (4 files): `IF R1>=R10-2*R16+…` puts arithmetic where a line-oriented grammar sees plain words.
6. **Genuinely broken upstream files** (3), where reporting an error is the correct behaviour: `boxturtle-rrf/tfree.g` opens a string it never closes, and RRF has no line continuation; `zippy-klipper`'s `MOM600.cfg` and `print_variables.cfg` use adjacent expressions as implicit concatenation, which Jinja itself rejects; `slicer-diversity`'s `icesl.gcode` has doubled carriage returns, which is why upstream files it under `unsupported/`.
7. **Preprocessor and empty-slot cases** (2, unchanged): NativeCAM's `optimize.ngc` substitution template, and Siemens `FELD1[10,3]=SET(0,,,9,…)`.

## Repository-owned gates

`npm test` adds eleven syntax-tree corpus tests, six complete example fixtures, compilation of every query file, the tolerance cases above, and a regeneration step that keeps the committed `src/` parser in sync with `grammar.js`.

`npm run fuzz` adds three more layers: seeded generative fuzzing (valid-by-construction programs across all dialects must parse with zero ERROR nodes), mutation fuzzing (corrupted fixtures must never crash or hang the parser), and `tree-sitter fuzz` incremental-reparse consistency.

These are syntax-coverage tests, not firmware command validation. A tolerant editor grammar should retain structure for vendor commands it has never seen; the target firmware remains responsible for deciding whether a command and its operands are semantically valid.
