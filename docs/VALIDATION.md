# Upstream compatibility validation

Validation last ran on 2026-08-21 with Tree-sitter CLI 0.25.10. Every file was parsed with the generated `gcode` parser; a success means the syntax tree contained no `ERROR` or missing nodes. The run is reproducible with:

```sh
npm run validate:corpora
```

which shallow-fetches each pinned revision into `build/corpora/` and re-runs the sweep.

| Upstream corpus | Pinned revision | Files | Result |
| --- | --- | ---: | ---: |
| `Klipper3d/klipper`, top-level `config/*.cfg` | `58bd67db3ce1be1951c3e4a6d1156a79903d4edc` | 228 | 228 / 228 |
| `Duet3D/RRF-machine-config-files`, recursive `*.g` | `bef2faf7dc7dc66444d608027130ce79f39ec09c` | 570 | 570 / 570 |
| `LinuxCNC/linuxcnc`, recursive `nc_files/**/*.ngc` | `7a29eb2b930825c75cfd4d7698b37b9ea94a564c` | 247 | 247 / 247 |
| `MarlinFirmware/Marlin`, `buildroot/test-gcode/M808-loops.gcode` | `0ebac470a47d9e278096c955f36087b613001a65` | 1 | 1 / 1 |

Because the grammar is tolerant, a no-`ERROR` sweep alone cannot distinguish a correct parse from a tolerated mis-parse, so the sweep also asserts structure: every LinuxCNC file containing numeric O-words (`o100 if …`) must produce `o_statement` nodes — 33 / 33 do.

Marlin's `syntax_test_G-code.gcode` was also checked. It intentionally contains the invalid line `N234 G1 X-5 Y+2 *64 error`; the parser reports that deliberately invalid suffix and no earlier error.

The repository-owned gates (`npm test`) add:

- nine syntax-tree corpus tests covering RRF, Klipper/Jinja, Marlin/RepRap, LinuxCNC, compact/checksummed lines, display glyphs, and Jinja comments;
- six complete example fixtures, including `examples/rrf.g`, which is based on the reported `measure_idle_window.g` failure case;
- compilation of every Tree-sitter query file in `queries/`, plus a drift check that the four Zed language-mode copies match them byte for byte;
- a regeneration step that keeps the committed `src/` parser in sync with `grammar.js`.

These are syntax-coverage tests, not firmware command validation. A tolerant editor grammar should retain structure for vendor commands it has never seen; the target firmware remains responsible for deciding whether a command and its operands are semantically valid.
