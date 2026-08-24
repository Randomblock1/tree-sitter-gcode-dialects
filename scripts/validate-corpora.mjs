// Reproduces the upstream-compatibility run documented in docs/VALIDATION.md:
// shallow-fetches each pinned corpus into build/corpora/ and checks that every
// file parses without ERROR or missing nodes.
//
// A no-ERROR sweep alone cannot distinguish a correct parse from a tolerated
// mis-parse — the grammar has deliberate escape hatches (bare_argument, the
// comment fallbacks) that can swallow a whole construct without complaint.
// Every corpus therefore also carries `assert` rules: a file matching `when`
// must produce a `node`. That is what catches a construct silently degrading
// into a comment or a bare argument.
//
// `fallbackCeiling` is the second half of the same idea, from the other
// direction: the recorded number of bare_argument nodes the corpus produces.
// It only ever ratchets down. A grammar change that makes the parser fall back
// more often raises the count and fails the run, even when nothing ERRORs.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { root } from "./paths.mjs";

// The grammar's catch-all for an operand it does not recognise.
const FALLBACK = "bare_argument";

// Structural assertions look at the first 64 KB of each file. Whole-file
// parsing is unaffected; this only bounds the assertion window, because
// `tree-sitter query` formats its matches in time quadratic in the range and
// the printer corpora reach 8 MB. Slicer output repeats the same handful of
// constructs from its first screenful, so a prefix is representative. The
// trigger regexes read the same prefix, so a rule can never fire on evidence
// the query was not allowed to see.
const ASSERT_WINDOW = 64 * 1024;

const require = createRequire(import.meta.url);
const binary = join(
  dirname(require.resolve("tree-sitter-cli/package.json")),
  process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter",
);

const corpora = [
  {
    name: "klipper",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
    ],

    url: "https://github.com/Klipper3d/klipper",
    rev: "58bd67db3ce1be1951c3e4a6d1156a79903d4edc",
    sparse: ["config"],
    files: (dir) =>
      readdirSync(join(dir, "config"))
        .filter((name) => name.endsWith(".cfg"))
        .map((name) => join(dir, "config", name)),
  },
  {
    name: "duet-rrf",
    // Machine configuration bundles are mostly plain M-codes; the meta-language
    // assertions live on millenniumos and next-rrf, which are written in it.
    assert: [
      { node: "rrf_control", when: /^[ \t]*(?:if|while)[ \t{(]/m },
      { node: "rrf_output", when: /^[ \t]*echo[ \t{("]/m },
      { node: "rrf_else", when: /^[ \t]*else[ \t]*$/m },
    ],

    url: "https://github.com/Duet3D/RRF-machine-config-files",
    rev: "bef2faf7dc7dc66444d608027130ce79f39ec09c",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  {
    name: "linuxcnc",
    assert: [
      { node: "o_statement", when: /^[ \t]*[oO]\d/m },
      { node: "o_statement", when: /^[ \t]*[oO]</m },
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
      { node: "bracket_expression", when: /^[ \t]*#\d+[ \t]*=[ \t]*\[/m },
      { node: "parenthesized_comment", when: /^[ \t]*\(MSG,/m },
    ],
    url: "https://github.com/LinuxCNC/linuxcnc",
    rev: "7a29eb2b930825c75cfd4d7698b37b9ea94a564c",
    sparse: ["nc_files"],
    files: (dir) =>
      walk(join(dir, "nc_files"), (name) => name.endsWith(".ngc")),
  },
  {
    name: "marlin",
    url: "https://github.com/MarlinFirmware/Marlin",
    rev: "0ebac470a47d9e278096c955f36087b613001a65",
    sparse: ["buildroot/test-gcode"],
    files: (dir) => [join(dir, "buildroot", "test-gcode", "M808-loops.gcode")],
  },
  // Simplify3D/Cura output plus hand-written parser stress files (MIT).
  {
    name: "ddprint",
    assert: [
      { node: "g_code", when: /^[ \t]*G\d/m },
      { node: "m_code", when: /^[ \t]*M\d/m },
      { node: "axis_word", when: /^[ \t]*G[01][ \t]+X-?[\d.]/m },
    ],

    url: "https://github.com/ErwinRieger/ddprint-test-gcode",
    rev: "9178069d985798aaacc2f27827c9e33968464296",
    sparse: ["test_files"],
    files: (dir) =>
      walk(join(dir, "test_files"), (name) => name.endsWith(".gcode")),
  },
  // Modern PrusaSlicer output: thumbnails, M486 object markers, M862.x (MIT).
  {
    name: "gcode-preview",
    assert: [
      { node: "g_code", when: /^[ \t]*G\d/m },
      { node: "m_code", when: /^[ \t]*M\d/m },
      { node: "axis_word", when: /^[ \t]*G[01][ \t]+X-?[\d.]/m },
    ],

    url: "https://github.com/xyz-tools/gcode-preview",
    rev: "0fed7ed3cf08b9d70bfb95bb6d795f9e6c7ae8d6",
    sparse: ["demo/gcodes"],
    files: (dir) =>
      walk(join(dir, "demo", "gcodes"), (name) => name.endsWith(".gcode")),
  },
  // A CNC operations system written entirely in RRF meta G-code — the densest
  // public source of if/while/var/set/echo and object-model expressions
  // (GPL-3.0, parsed in CI only, never vendored).
  {
    name: "millenniumos",
    assert: [
      { node: "rrf_control", when: /^[ \t]*(?:if|while)[ \t{(]/m },
      { node: "rrf_declaration", when: /^[ \t]*(?:var|global)[ \t]/m },
      { node: "rrf_output", when: /^[ \t]*echo[ \t{("]/m },
      { node: "rrf_else", when: /^[ \t]*else[ \t]*$/m },
      {
        node: "brace_expression",
        when: /^[ \t]*(?:if|while|var|global|set|echo)\b.*\{/m,
      },
    ],

    url: "https://github.com/MillenniumMachines/MillenniumOS",
    rev: "de639ec84d4556815ebc1820a6ce57c297aabfec",
    sparse: ["macro", "sys"],
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  // Independent second sample of idiomatic modern RRF meta G-code (GPL-3.0).
  {
    name: "next-rrf",
    assert: [
      { node: "rrf_control", when: /^[ \t]*(?:if|while)[ \t{(]/m },
      { node: "rrf_declaration", when: /^[ \t]*(?:var|global)[ \t]/m },
      { node: "rrf_output", when: /^[ \t]*echo[ \t{("]/m },
      { node: "rrf_else", when: /^[ \t]*else[ \t]*$/m },
      {
        node: "brace_expression",
        when: /^[ \t]*(?:if|while|var|global|set|echo)\b.*\{/m,
      },
    ],

    url: "https://github.com/benagricola/NeXT",
    rev: "7b8fd4d80784476dc698d641aee702dc1d936c89",
    sparse: ["macros"],
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  // Breadth of Klipper config surface: hardware sections, include chains,
  // user templates (GPL-3.0).
  {
    name: "klippain",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
      { node: "jinja_directive", when: /\{%/ },
    ],

    url: "https://github.com/Frix-x/klippain",
    rev: "ac565f2f85dff846a584be600b593b76c8afe52b",
    sparse: ["config", "macros", "user_templates"],
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // Jinja statements broken across lines at a keyword boundary
    // ("x if cond\n else y", "{% for p in params\n ... %}") — a line-oriented
    // grammar cannot continue there without merging real statement lines.
    knownFailures: [
      "macros/base/probing/overrides/dockable_probe_overrides.cfg",
    ],
  },
  // The densest Jinja macro code in the Klipper ecosystem (GPL-3.0).
  {
    name: "klipper-macros",
    assert: [{ node: "jinja_directive", when: /\{%/ }],

    url: "https://github.com/jschuh/klipper-macros",
    rev: "ebae0a3b6ec4bf7096e7b068967b283992078f5f",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // Same line-broken-Jinja class as klippain: conditionals wrapped before
    // "if"/"else", "{% endif\n %}", subscripts split at "[", plus prose with
    // unbalanced parentheses inside multiline descriptions.
    knownFailures: [
      "bed_mesh_fast.cfg",
      // Wraps before "if" rather than before "else". A newline-tolerant "if"
      // would fix it, but it is indistinguishable from an RRF "if" statement
      // on the following line, and gluing those together is silent.
      "velocity.cfg",
      "bed_surface.cfg",
      "draw.cfg",
      "filament.cfg",
      "globals.cfg",
      "heaters.cfg",
      "kinematics.cfg",
      "layers.cfg",
      "pause_resume_cancel.cfg",
      "start_end.cfg",
      "optional/lcd_menus.cfg",
    ],
  },
  // The most-forked Klipper macro set; its idioms recur in thousands of
  // downstream configs (GPL-3.0).
  {
    name: "kamp",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
      { node: "jinja_directive", when: /\{%/ },
    ],

    url: "https://github.com/kyleisah/Klipper-Adaptive-Meshing-Purging",
    rev: "b0dad8ec9ee31cb644b94e39d4b8a8fb9d6c9ba0",
    sparse: ["Configuration"],
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
  },
  // LinuxCNC named-O-word subroutines: labeled blocks, #<local>/#<_global>
  // parameters, active comments with quoted strings (GPL-2.0).
  {
    name: "nativecam",
    assert: [
      { node: "o_statement", when: /^[ \t]*[oO]</m },
      // The regression guard for indirection: 942 lines of "#[#1] = 0" used to
      // lex as a comment, which no ERROR-only sweep could see.
      {
        node: "indirect_parameter_reference",
        when: /^[ \t]*#\[[ \t\[]*[#\d]/m,
      },
    ],
    url: "https://github.com/FernV/NativeCAM",
    rev: "2ba64e655385fbaf534c4edc479ca1ca3c4c0df6",
    sparse: ["lib"],
    files: (dir) => walk(join(dir, "lib"), (name) => name.endsWith(".ngc")),
    // "o11 if [cur dir EQ 1]" — a NativeCAM preprocessor template, not valid
    // RS274 (the substitution happens before LinuxCNC parses it).
    knownFailures: ["lib/mill/optimize.ngc"],
  },
  // Real shop-floor Fanuc-style output: % markers, WHILE[..]DOn, IF..GOTO,
  // T#33 parameter words, glued expressions. Paths contain spaces and
  // parentheses on purpose (MIT).
  {
    name: "fanuc-rcod2",
    assert: [
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
      { node: "percent_line", when: /^%[ \t]*$/m },
      {
        node: "bracket_expression",
        // Skip lines that are entirely a comment: posted output often carries
        // a commented-out sample of the macro it replaced.
        when: /^[ \t]*(?![;(])[^\r\n]*(?:IF|WHILE)[ \t]*\[/m,
      },
    ],
    url: "https://github.com/RomanBoreyko/r_cod2",
    rev: "d19e92b76c1a30ed95be8c990687f1f0b657be4e",
    sparse: ["cnc"],
    files: (dir) => walk(join(dir, "cnc"), (name) => name.endsWith(".nc")),
  },
  // Purpose-built Siemens SINUMERIK edge cases: address=expression forms,
  // extended addresses, GOTOB/GOTOF, CASE..OF, IC() increments (MIT).
  {
    name: "sinumerik-cead",
    assert: [
      // The indexed form ("X1=50", "R10=R11+2") is the one that needs its own
      // node. A bare "X=7 DIV 3" decomposes into a named_argument whose name
      // is the address — the same shape a Klipper "HEATER=extruder" takes,
      // and not worth a lexer fight to relabel.
      { node: "address_assignment", when: /^[ \t]*[A-Z]+\d+=[^=]/m },
      { node: "named_argument", when: /^[ \t]*[A-Z]=[^=]/m },
    ],
    url: "https://github.com/CEAD-group/nc-gcode-interpreter",
    rev: "892e32a697c5b80014c0826db759276546c9e689",
    sparse: ["examples"],
    files: (dir) =>
      walk(join(dir, "examples"), (name) => name.endsWith(".mpf")),
    // SET(0,,,9,…) — empty positional slots inside an expression-context call.
    knownFailures: ["examples/arrays.mpf"],
  },
  // A real control's MPF.DIR dump: ordinary Siemens mill/turn programs with
  // TRANS/ROT, CYCLEnn(...) calls, MCALL (Apache-2.0).
  {
    name: "sinumerik-pyronc",
    assert: [
      // The indexed form ("X1=50", "R10=R11+2") is the one that needs its own
      // node. A bare "X=7 DIV 3" decomposes into a named_argument whose name
      // is the address — the same shape a Klipper "HEATER=extruder" takes,
      // and not worth a lexer fight to relabel.
      { node: "address_assignment", when: /^[ \t]*[A-Z]+\d+=[^=]/m },
      { node: "named_argument", when: /^[ \t]*[A-Z]=[^=]/m },
    ],
    url: "https://github.com/josip-mrdeza/PyroNc",
    rev: "1a89fa2b0ccf9ca57e5bc7f1e7f422299d14dacc",
    sparse: [
      "Pyro.Nc/Resources/MPF.DIR_MILL",
      "Pyro.Nc/Resources/MPF.DIR_TURNING",
    ],
    files: (dir) =>
      walk(join(dir, "Pyro.Nc", "Resources"), (name) =>
        name.toUpperCase().endsWith(".MPF"),
      ),
  },

  // Klipper display glyph pixel-art blocks, which no other pinned corpus has
  // (Apache-2.0).
  {
    name: "voron-common",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
      { node: "jinja_directive", when: /\{%/ },
    ],
    url: "https://github.com/The-Conglomerate/Voron-Klipper-Common",
    rev: "0d0b50805a3c5e129b0ce8773e330a7d4b832c7c",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // A single-quoted value wrapping a double-quoted string wrapping a brace
    // expression.
    knownFailures: ["macros/timers.cfg"],
  },
  // A large personal Klipper config: recursive Jinja over the printer
  // namespace, namespace() accumulators, save_config autosave tails (GPL-3.0).
  {
    name: "zippy-klipper",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
      { node: "jinja_directive", when: /\{%/ },
    ],
    url: "https://github.com/rootiest/zippy-klipper_config",
    rev: "2475c1f01a8ec8c317586868c43cd7c30ee446ff",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // Three causes, all Jinja rather than G-code: statements broken across
    // lines at a keyword boundary (the klippain/jschuh class), the "is in" /
    // "is divisibleby" tests, and "{141.output}" where a member is taken from
    // a number. MOM600.cfg and print_variables.cfg additionally use adjacent
    // expressions as implicit concatenation, which Jinja itself rejects.
    knownFailures: [
      "timelapse.cfg",
      "dev/MOM600.cfg",
      "extras/bedfans.cfg",
      "extras/led.cfg",
      "macros/CHAMBER_TEMP.cfg",
      "probe/klicky-bed-mesh-calibrate.cfg",
      "probe/klicky-macros.cfg",
      "probe/klicky-screws-tilt-calculate.cfg",
      "probe/klicky-z-tilt-adjust.cfg",
      "dev/print/print_macros.cfg",
      "dev/print/print_variables.cfg",
    ],
  },
  // The legacy [menu ...] display-menu config format (GPL-3.0).
  {
    name: "zellneralex-klipper",
    assert: [
      { node: "klipper_section", when: /^\[[a-z_]/m },
      { node: "klipper_option", when: /^[a-z_][a-z0-9_]*:/m },
      { node: "jinja_directive", when: /\{%/ },
    ],
    url: "https://github.com/zellneralex/klipper_config",
    rev: "6233edc41542595379532bf2cb0b3a6b8701ac5a",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // What survives once "is not in" and wrapped conditionals parse:
    // subscripting a list literal ("{['G28','G28 Z'][menu.input|int]}") and a
    // Jinja test taking a bare argument ("is divisibleby 2").
    knownFailures: ["display_menu.cfg", "macro.cfg"],
  },
  // A real toolchanger machine carrying parallel RRF2 and RRF3 macro sets, so
  // both generations of the meta language appear side by side (CC-BY-4.0).
  {
    name: "jubilee",
    assert: [
      { node: "rrf_control", when: /^[ \t]*(?:if|while)[ \t{(]/m },
      { node: "rrf_declaration", when: /^[ \t]*(?:var|global)[ \t]/m },
      { node: "rrf_output", when: /^[ \t]*echo[ \t{("]/m },
      { node: "rrf_else", when: /^[ \t]*else[ \t]*$/m },
    ],
    url: "https://github.com/machineagency/jubilee",
    rev: "c877bd2e889560c83da2a68479641a4f7f0d9b83",
    sparse: ["software/duet_config_files"],
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  // Automated filament changer: while loops bounded by globals and array
  // indexing inside G-code parameter fields (GPL-3.0).
  {
    name: "boxturtle-rrf",
    assert: [
      { node: "rrf_control", when: /^[ \t]*(?:if|while)[ \t{(]/m },
      { node: "rrf_declaration", when: /^[ \t]*(?:var|global)[ \t]/m },
      { node: "rrf_output", when: /^[ \t]*echo[ \t{("]/m },
      { node: "rrf_else", when: /^[ \t]*else[ \t]*$/m },
    ],
    url: "https://github.com/jaysuk/BoxTurtle_RRF",
    rev: "e01024ad5eae5c61f6a336f3f53f9cfe84974858",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
    // Upstream bug, not a grammar gap: line 143 opens a string that is never
    // closed, and RepRapFirmware has no line continuation, so the macro is
    // broken on the machine too.
    knownFailures: ["sd/sys/AFC/tfree.g"],
  },
  // The largest LinuxCNC example set found: %-delimited programs with no
  // O-word wrapper, lowercase built-in calls inside expressions (MIT).
  {
    name: "flexgui",
    assert: [
      { node: "o_statement", when: /^[ \t]*[oO][<\d]/m },
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
    ],
    url: "https://github.com/jethornton/flexgui",
    rev: "ad266a5f90a88947ff7db81986340d46405fb698",
    sparse: ["examples", "probe"],
    files: (dir) =>
      walk(dir, (name) => name.endsWith(".ngc") || name.endsWith(".nc")),
  },
  // do/while loops and INI-key subscripts (#<_ini[AXIS_X]MIN_LIMIT>), neither
  // of which the other CNC corpora exercise (GPL-3.0).
  {
    name: "tool-length-probe",
    assert: [
      { node: "o_statement", when: /^[ \t]*[oO][<\d]/m },
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
    ],
    url: "https://github.com/TooTall18T/tool_length_probe",
    rev: "3372bf2a436bddd05163ab2c490426f65a35c3e2",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".ngc")),
  },
  // Lathe macros written in lowercase with words glued together ("g4p1"), and
  // semicolon comments as the dominant style (GPL-2.0).
  {
    name: "lathe-macros",
    assert: [
      { node: "o_statement", when: /^[ \t]*[oO][<\d]/m },
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
    ],
    url: "https://github.com/andypugh/LatheMacros",
    rev: "36e921b2b6401ff7ca4499ba35ed87b4db33836a",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".ngc")),
  },
  // 5-axis tool-centre-point codes (G68.2/G53.1/G43.5) and semicolon
  // end-of-block terminators from Mastercam and Fusion posts (MIT).
  {
    name: "tormach-za6",
    assert: [
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
      {
        node: "bracket_expression",
        // Skip lines that are entirely a comment: posted output often carries
        // a commented-out sample of the macro it replaced.
        when: /^[ \t]*(?![;(])[^\r\n]*(?:IF|WHILE)[ \t]*\[/m,
      },
    ],
    url: "https://github.com/caileans/TormachZA6CNC",
    rev: "a9824c915811c7053f8500f3bd542698615b8df2",
    sparse: ["Gcode"],
    files: (dir) => walk(dir, (name) => name.endsWith(".nc")),
  },
  // Renishaw probing macros: compound IF[[..] AND [..]] THEN conditionals and
  // high-numbered system parameters. No license file; fetched in CI only.
  {
    name: "renishaw-macros",
    assert: [
      { node: "parameter_assignment", when: /^[ \t]*#\d+[ \t]*=/m },
      {
        node: "bracket_expression",
        // Skip lines that are entirely a comment: posted output often carries
        // a commented-out sample of the macro it replaced.
        when: /^[ \t]*(?![;(])[^\r\n]*(?:IF|WHILE)[ \t]*\[/m,
      },
    ],
    url: "https://github.com/jpaullee/renishaw_macros",
    rev: "b3b992389c0c9e6f30efe1ec0e08b1c803e0e76f",
    sparse: ["09000"],
    files: (dir) => walk(dir, (name) => name.endsWith(".nc")),
    // Two causes. Twelve files write a parenthesised comment directly after a
    // bracketed function call ("#195= ABS[ #192 ] (T P ERR)"), which the
    // grammar reads as an argument list — it cannot tell that from the spaced
    // call form ("min (a, b)") that Klipper and RRF configs really use. The
    // rest use DPRNT with literal text between brackets ("DPRNT[----]",
    // "DPRNT[UNITS*#4006[20]]"), which is print formatting, not an expression.
    knownFailures: [
      "09000/O09730_RENISHAW_Storm.nc",
      "09000/O09731_RENISHAW_Storm.nc",
      "09000/O09811_RENISHAW_Storm.nc",
      "09000/O09812_RENISHAW_Storm.nc",
      "09000/O09814_RENISHAW_Storm.nc",
      "09000/O09815_RENISHAW_Storm.nc",
      "09000/O09816_RENISHAW_Storm.nc",
      "09000/O09819_RENISHAW_Storm.nc",
      "09000/O09821_RENISHAW_Storm.nc",
      "09000/O09822_RENISHAW_Storm.nc",
      "09000/O09823_RENISHAW_Storm.nc",
      "09000/O09834_RENISHAW_Storm.nc",
      "09000/O09985(_SINGLE_AXIS_MRZP_).nc",
      "09000/O09993(_A_AXIS_TILT_AND_C_AXIS_ROT_AXIS_MRZP_).nc",
      "09000/O09994(_B_AXIS_TILT_AND_C_AXIS_ROT_AXIS_MRZP_).nc",
    ],
  },
  // SINUMERIK turning and milling notes: frame construction with CTRANS/CROT
  // and indirect system variables ($P_UIFR[...]). No license file; fetched in
  // CI only.
  {
    name: "sinumerik-staniska",
    assert: [{ node: "address_assignment", when: /^[ \t]*[A-Z]+\d+=[^=]/m }],
    url: "https://github.com/staniska/notes",
    rev: "1a93f36413d97df2e644dc357f9f0993bdf9fea3",
    sparse: null,
    files: (dir) =>
      walk(
        dir,
        (name) =>
          name.toUpperCase().endsWith(".MPF") ||
          name.toUpperCase().endsWith(".SPF"),
      ),
    // Siemens IF takes an unbracketed condition ("IF R1>=R10-2*R16+..."), so
    // arithmetic appears where this line-oriented grammar sees plain words
    // rather than an expression. Out of scope alongside synchronised actions;
    // see the scope note in docs/REFERENCES.md.
    knownFailures: [
      "6/CHERN.MPF",
      "6/FINE_L.MPF",
      "6/FINE_R.MPF",
      "ELLIPSE/TURN_2.MPF",
    ],
  },
  // SINUMERIK 5-axis CAM postprocessor output published as research data
  // (CC-BY-4.0).
  {
    name: "sinumerik-fiveaxis",
    assert: [{ node: "address_assignment", when: /^[ \t]*[A-Z]+\d+=[^=]/m }],
    url: "https://github.com/ElMoe/Production-Data-Set-for-Five-Axis-CNC-Milling-with-Multiple-Changeovers",
    rev: "b800366089c196c22c6eb66c69a1e9cfa781a061",
    sparse: ["NC_code"],
    files: (dir) => walk(dir, (name) => name.toLowerCase().endsWith(".mpf")),
  },
  // Eight different slicers in one place (Cura, ideaMaker, Slic3r,
  // SuperSlicer, IceSL, Kiri:Moto, PrusaSlicer, KISSlicer) plus base64
  // thumbnail blocks and M486 object markers (GPL-3.0).
  {
    name: "slicer-diversity",
    assert: [
      { node: "g_code", when: /^[ \t]*G\d/m },
      { node: "m_code", when: /^[ \t]*M\d/m },
    ],
    url: "https://github.com/kageurufu/preprocess_cancellation",
    rev: "3b9cf647f9088d51d5ae637e3e61bb9f68e0c3d0",
    sparse: ["GCode"],
    files: (dir) => walk(dir, (name) => name.endsWith(".gcode")),
    // Not a grammar gap: this file has doubled carriage returns ("\\r\\r\\n"),
    // which is why upstream files it under unsupported/. Reporting it is the
    // correct behaviour.
    knownFailures: ["GCode/unsupported/icesl.gcode"],
  },
  // PrusaSlicer MMU2S output: bare letterless tool changes (Tx, Tc) in the
  // executed body and a quoted string command argument (GPL-3.0).
  {
    name: "prusa-mmu",
    assert: [
      { node: "g_code", when: /^[ \t]*G\d/m },
      { node: "m_code", when: /^[ \t]*M\d/m },
    ],
    url: "https://github.com/loidolt/outdoor-box-latch",
    rev: "075ed89d89068ccdc49e158270613ae283f3efc4",
    sparse: [
      "gcode/3_4inSpacer_0.3mm_PETG_MK3SMMU2S_2h32m.gcode",
      "gcode/4mmSpacer_0.3mm_PETG_MK3SMMU2S_1h14m.gcode",
    ],
    files: (dir) => walk(dir, (name) => name.endsWith(".gcode")),
  },
];

function walk(dir, matches) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe", timeout: 600000 });
}

function fetchCorpus({ name, url, rev, sparse }) {
  const dir = join(root, "build", "corpora", name);
  if (existsSync(join(dir, ".git"))) {
    return dir;
  }
  console.log(`Fetching ${url} @ ${rev.slice(0, 12)}…`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", url);
  if (sparse) {
    git(dir, "sparse-checkout", "set", "--no-cone", ...sparse);
  }
  git(dir, "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", rev);
  git(dir, "checkout", "-q", rev);
  return dir;
}

// Runs one query over the corpus and returns, per file, the set of node types
// it produced. `tree-sitter query` prints an unindented path line per file that
// matched at least once, followed by indented capture lines; a file with no
// matches is omitted entirely.
function capturesByFile(files, nodes) {
  const queryPath = join(root, "build", "cache", "assertions.scm");
  mkdirSync(dirname(queryPath), { recursive: true });
  writeFileSync(queryPath, nodes.map((n) => `(${n}) @${n}\n`).join(""));

  const captures = new Map();
  for (let start = 0; start < files.length; start += 50) {
    const result = spawnSync(
      binary,
      [
        "query",
        "--byte-range",
        `0:${ASSERT_WINDOW}`,
        queryPath,
        ...files.slice(start, start + 50),
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
      },
    );
    if (result.status !== 0) {
      throw new Error(`tree-sitter query failed:\n${result.stderr}`);
    }
    let current = null;
    for (const line of result.stdout.split("\n")) {
      if (line === "" || /^\s/.test(line)) {
        const capture = line.match(/capture: (?:\d+ - )?([A-Za-z_][\w]*)/);
        if (capture && current) {
          current.set(capture[1], (current.get(capture[1]) ?? 0) + 1);
        }
      } else {
        current = new Map();
        captures.set(line, current);
      }
    }
  }
  return captures;
}

function parseBatch(files) {
  const failures = [];
  for (let start = 0; start < files.length; start += 50) {
    const batch = files.slice(start, start + 50);
    const result = spawnSync(binary, ["parse", "--quiet", ...batch], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
    });
    if (result.status !== 0) {
      failures.push(
        ...result.stdout.split("\n").filter((line) => line.trim() !== ""),
      );
    }
  }
  return failures;
}

let failed = false;

for (const corpus of corpora) {
  const dir = fetchCorpus(corpus);
  const files = corpus.files(dir);
  const failures = parseBatch(files);
  const known = new Set(
    (corpus.knownFailures ?? []).map((path) => join(dir, path)),
  );
  const failedPaths = new Set(
    failures.map((line) => line.split("\t")[0].trimEnd()),
  );
  const unexpected = failures.filter(
    (line) => !known.has(line.split("\t")[0].trimEnd()),
  );
  console.log(
    `${corpus.name}: ${files.length - failedPaths.size} / ${files.length} parse clean` +
      (known.size > 0 ? ` (${known.size} known failures)` : ""),
  );
  for (const line of unexpected) {
    console.log(`  FAIL ${line}`);
    failed = true;
  }
  for (const path of known) {
    if (!failedPaths.has(path)) {
      console.log(
        `  FIXED (remove from knownFailures): ${path.slice(dir.length + 1)}`,
      );
      failed = true;
    }
  }

  // Files that already fail to parse cannot say anything about mis-parses.
  const parsed = files.filter(
    (file) => !failedPaths.has(file) && !known.has(file),
  );
  const nodes = [
    ...new Set([...(corpus.assert ?? []).map((rule) => rule.node), FALLBACK]),
  ];
  const captures = capturesByFile(parsed, nodes);

  const window = new Map(
    parsed.map((file) => [
      file,
      readFileSync(file).subarray(0, ASSERT_WINDOW).toString("utf8"),
    ]),
  );

  for (const rule of corpus.assert ?? []) {
    let checked = 0;
    let missing = 0;
    for (const file of parsed) {
      if (!rule.when.test(window.get(file))) {
        continue;
      }
      checked += 1;
      if (!captures.get(file)?.has(rule.node)) {
        console.log(
          `  NO ${rule.node}: ${file.slice(dir.length + 1)} (matched ${rule.when})`,
        );
        missing += 1;
        failed = true;
      }
    }
    console.log(
      `${corpus.name}: ${checked - missing} / ${checked} files matching ${rule.when} produce ${rule.node}`,
    );
  }

  let fallbacks = 0;
  for (const file of parsed) {
    fallbacks += captures.get(file)?.get(FALLBACK) ?? 0;
  }
  const ceiling = corpus.fallbackCeiling;
  console.log(
    `${corpus.name}: ${fallbacks} ${FALLBACK} nodes` +
      (ceiling === undefined
        ? " (no ceiling recorded)"
        : ` (ceiling ${ceiling})`),
  );
  if (ceiling !== undefined && fallbacks > ceiling) {
    console.log(
      `  FALLBACK CEILING EXCEEDED: ${fallbacks} > ${ceiling}. The parser is ` +
        "reaching for bare_argument more often than it used to — find the " +
        "construct it stopped recognising before raising this number.",
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
