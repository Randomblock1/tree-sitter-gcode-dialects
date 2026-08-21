# Dialect language references

The authoritative sources each dialect's grammar decisions are checked against. All URLs were verified reachable on 2026-08-21. Where documentation and implementation disagree, the implementation wins — the "ground truth" entries name the parser source files that settle disputes.

## Marlin / RepRap printer G-code

- [Marlin G-code index](https://marlinfw.org/meta/gcode/) — 252 per-command pages with usage, parameter tables, and version notes. Best source for Marlin-only codes (M808, M810–M819, M486, M862.x). The site rejects non-browser user agents; the markdown source lives in `MarlinFirmware/MarlinDocumentation`.
- [RepRap wiki G-code](https://reprap.org/wiki/G-code) — the only cross-firmware reference, with a support matrix per command. Uniquely documents *line* syntax: fields, case sensitivity, quoted strings, expressions, checksums, comments.
- [Prusa-specific G-codes](https://help.prusa3d.com/article/prusa-specific-g-codes_112173) — vendor extensions common in real slicer output: `M862.1–.6`, `M73` variants, MMU `T?`/`Tx`/`Tc`, letterless commands.
- Ground truth: `Marlin/src/gcode/parser.cpp` (word splitting, `string_arg`, MMU T-forms) and `queue.cpp` (checksum, line numbers).

## RepRapFirmware (Duet)

- [GCode meta commands](https://docs.duet3d.com/User_manual/Reference/Gcode_meta_commands) — the meta-language spec: the twelve keywords, indentation blocks, types, literals, the full operator table with precedences, and ~35 built-in functions.
- [GCode dictionary](https://docs.duet3d.com/User_manual/Reference/Gcodes) — 279 G/M/T codes; the parameter-letter authority for the non-meta half.
- [Object model documentation](https://github.com/Duet3D/RepRapFirmware/wiki/Object-Model-Documentation) — 611 dotted paths across 23 roots; the pool of valid `move.axes[…]`-style expressions.
- Ground truth: `src/GCodes/GCodeBuffer/StringParser.cpp` (standalone) and `src/DuetAPI/Commands/Code/Parser.cs` (SBC). Notable findings: `skip` is a real keyword absent from the docs; the docs' `pass` does not exist; no whitespace is required after a keyword (`if{…}` is valid); there is no line continuation; `{pi,}` is a one-element array while `{pi}` is a scalar.

## Klipper

- [Config reference](https://www.klipper3d.org/Config_Reference.html) — every section and option, including `[include]` globs and `[gcode_macro]`.
- [Command templates](https://www.klipper3d.org/Command_Templates.html) — `gcode:` blocks, `params`/`rawparams`/`printer`, `action_*` callables.
- [G-Codes](https://www.klipper3d.org/G-Codes.html) — the extended-command catalog and `NAME=VALUE` parameter form.
- [Jinja2 template designer](https://jinja.palletsprojects.com/en/stable/templates/) — with one critical caveat: Klipper constructs its Jinja environment with *single-brace* expression delimiters, so `{ x }` is an expression and `{{ x }}` is a syntax error.
- Ground truth: `klippy/configfile.py` (multiline values, `#` cut at any column, the `#*#` autosave tail), `klippy/gcode.py` (two disjoint parsers chosen by `is_traditional_gcode()`; extended commands go through `shlex`), `klippy/extras/gcode_macro.py`.

## CNC — RS274/NGC, LinuxCNC, Fanuc, Haas

- [LinuxCNC G-code overview](https://linuxcnc.org/docs/stable/html/gcode/overview.html) — the densest lexical spec: line format, parameters, operator precedence, functions, active comments, polar `@`/`^`, `%` markers.
- [LinuxCNC O codes](https://linuxcnc.org/docs/stable/html/gcode/o-code.html) — numbered and `<named>` O-words, all flow-control forms, plus a Fanuc-style (`M98`/`M99`) section.
- [NIST RS274NGC v3 (NISTIR 6556)](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir6556.pdf) — the normative document; Appendix E gives formal production rules directly usable for grammar work.
- Key tolerance requirement from real Fanuc/Haas output: everything may be glued with no whitespace (`N10IF[#7NE#0]GOTO10`, `#33=[[#128AND32]/32]`), decimal points are optional and may trail (`Z150.`), and word values may be bare parameters (`T#33`).

## Siemens SINUMERIK (840D)

- [Fundamentals programming manual (12/2018, V4.91)](https://cache.industry.siemens.com/dl/files/241/109763241/att_971137/v1/840Dsl_fundamentals_progr_man_1218_en-US.pdf) — block structure, comments, block skip, addresses; §17.3.1 is the authoritative table of which letters accept a numeric extension (`X1=`, `S1=`, `M1=`).
- [Job planning programming manual (05/2017, V4.8)](https://cache.industry.siemens.com/dl/files/381/109748381/att_923040/v1/840Dsl_828D_job_planning_progr_man_0517_en-US.pdf) — indirect programming (`AX[…]=`), `GOTOB`/`GOTOF`/`GOTOC`, jump-label rules, flexible NC programming (`DEF`, R parameters, `IF/ELSE/ENDIF`, `CASE`), string ops and `<<`.
- Note: only the `cache.industry.siemens.com` host serves these PDFs to non-browser clients; `support.industry.siemens.com` returns 403. There is no official HTML documentation.
- Secondary: [Nuaduwodan/lance SinumerikNC.g4](https://github.com/Nuaduwodan/lance/blob/86e2212df0b5ee115070e268ec54ad077f65a9c0/antlr4-grammar/SinumerikNC.g4) — the most complete public formalization (1,811-line ANTLR4 grammar, case-insensitive). Known wrong on trailing-decimal literals (`X260.`) and extended addresses; no license, read-only.
- Scope note: this grammar targets the G-code-compatible subset plus common line-level Siemens constructs (address assignments, R parameters, GOTO/labels, cycle calls). Synchronized actions (`WHENEVER … DO …`), `SETINT`, and ISO-dialect mode (`G290/G291`) are explicitly out of scope; frame concatenation with `:` may produce ERROR nodes.
