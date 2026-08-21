# tree-sitter-gcode-dialects

A tolerant Tree-sitter grammar for the G-code people edit on real printers and CNC machines: Marlin/RepRap-style firmware output, RepRapFirmware meta commands, Klipper configuration and macros, and RS274/NGC (LinuxCNC/Fanuc) programs. It is independently authored, not a fork of `ChocolateNao/tree-sitter-gcode`.

The parser deliberately accepts unknown extended commands and vendor arguments, and understands space-free compact lines (`N10G01X1.Y1.F100.` splits into its words). Firmware remains the authority on whether a particular command exists and whether its operands are valid; the grammar's job is to preserve useful syntax structure and highlighting without breaking the rest of a file.

This grammar backs [G-code Dialects](https://github.com/Randomblock1/zed-gcode-dialects), the Zed extension that layers four language modes (3D printer, RepRapFirmware, Klipper config, CNC) on this one parser.

## Dialect coverage

- **Marlin / RepRap / slicer output** — commands, checksummed `N`-lines, vendor arguments, comments, thumbnails and settings trailers
- **RepRapFirmware** — `var`, `global`, `set`, `if`/`elif`/`else`, `while`, `echo`, `abort`; `{...}` expressions in operands; object-model paths such as `move.axes[global.AXIS].machinePosition`; strings with `""` escapes, arrays with trailing commas, calls, and the full operator set
- **Klipper** — sections and options (including `[include]` globs), extended commands, macro parameters, Jinja statements/expressions/comments with whitespace control, multiline Python-literal variables, display glyph blocks
- **RS274/NGC / Fanuc** — parameters (`#1`, `#<named>`, `#[expr]` indirection), bracket expressions, O-code flow control with numeric and named labels, glued Fanuc forms (`IF[#7NE#0]GOTO10`, `WHILE[…]DO1`), `%` markers, active comments
- **Siemens SINUMERIK** — address assignments (`X1=50`, `S1=5000`, `R10=R11+2`), bare block numbers, `GOTOB`/`GOTOF` with labels, cycle calls; see the scope note in [docs/REFERENCES.md](docs/REFERENCES.md)

## Usage

```sh
npm install
npm run generate
npm test
```

`npm test` regenerates the parser (so `src/` cannot silently drift from `grammar.js`), runs the corpus tests, parses every file in `examples/` rejecting any `ERROR` or missing node, and compiles every query in `queries/`.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the pinned upstream compatibility run — 2,376 of 2,393 real-world files across 15 corpora (Klipper configs and macro packs, Duet RRF machine configs and meta-G-code operation systems, slicer output, LinuxCNC and Fanuc shop programs, Siemens MPF part programs) parse without recovery nodes; the 17 exceptions are pinned, classified known failures. Reproducible with:

```sh
npm run validate:corpora
```

[docs/REFERENCES.md](docs/REFERENCES.md) lists the authoritative language reference for each dialect, including the firmware parser sources that settle disputes where documentation is wrong.

`npm run fuzz` runs a seeded grammar-directed fuzzer: generated valid-by-construction programs for every dialect must parse without a single `ERROR`, corrupted fixtures must never crash or hang the parser, and `tree-sitter fuzz` checks incremental-reparse consistency over the corpus. Deterministic by default; pass `-- --seed N` to explore.

## Design

The grammar is the deep module: its syntax tree is the small interface tested by every dialect fixture. Dialect differences remain named nodes at that interface—RRF statements, Klipper sections/options and Jinja directives, LinuxCNC O-statements—while common commands, operands, comments, and expressions share one implementation. This keeps vendor additions local and avoids four parsers drifting apart.
