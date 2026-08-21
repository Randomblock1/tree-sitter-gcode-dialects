// Reproduces the upstream-compatibility run documented in docs/VALIDATION.md:
// shallow-fetches each pinned corpus into build/corpora/ and checks that every
// file parses without ERROR or missing nodes. LinuxCNC files with numeric
// O-words must additionally produce o_statement nodes — a no-ERROR sweep alone
// cannot distinguish a correct parse from a tolerated mis-parse.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { root } from "./paths.mjs";

const require = createRequire(import.meta.url);
const binary = join(
  dirname(require.resolve("tree-sitter-cli/package.json")),
  process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter",
);

const corpora = [
  {
    name: "klipper",
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
    url: "https://github.com/Duet3D/RRF-machine-config-files",
    rev: "bef2faf7dc7dc66444d608027130ce79f39ec09c",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  {
    name: "linuxcnc",
    url: "https://github.com/LinuxCNC/linuxcnc",
    rev: "7a29eb2b930825c75cfd4d7698b37b9ea94a564c",
    sparse: ["nc_files"],
    files: (dir) =>
      walk(join(dir, "nc_files"), (name) => name.endsWith(".ngc")),
    assertNumericOWords: true,
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
    url: "https://github.com/ErwinRieger/ddprint-test-gcode",
    rev: "9178069d985798aaacc2f27827c9e33968464296",
    sparse: ["test_files"],
    files: (dir) =>
      walk(join(dir, "test_files"), (name) => name.endsWith(".gcode")),
  },
  // Modern PrusaSlicer output: thumbnails, M486 object markers, M862.x (MIT).
  {
    name: "gcode-preview",
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
    url: "https://github.com/MillenniumMachines/MillenniumOS",
    rev: "de639ec84d4556815ebc1820a6ce57c297aabfec",
    sparse: ["macro", "sys"],
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  // Independent second sample of idiomatic modern RRF meta G-code (GPL-3.0).
  {
    name: "next-rrf",
    url: "https://github.com/benagricola/NeXT",
    rev: "7b8fd4d80784476dc698d641aee702dc1d936c89",
    sparse: ["macros"],
    files: (dir) => walk(dir, (name) => name.endsWith(".g")),
  },
  // Breadth of Klipper config surface: hardware sections, include chains,
  // user templates (GPL-3.0).
  {
    name: "klippain",
    url: "https://github.com/Frix-x/klippain",
    rev: "ac565f2f85dff846a584be600b593b76c8afe52b",
    sparse: ["config", "macros", "user_templates"],
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // Jinja statements broken across lines at a keyword boundary
    // ("x if cond\n else y", "{% for p in params\n ... %}") — a line-oriented
    // grammar cannot continue there without merging real statement lines.
    knownFailures: [
      "macros/base/pause_resume.cfg",
      "macros/helpers/prime_line.cfg",
      "macros/base/probing/overrides/dockable_probe_overrides.cfg",
    ],
  },
  // The densest Jinja macro code in the Klipper ecosystem (GPL-3.0).
  {
    name: "klipper-macros",
    url: "https://github.com/jschuh/klipper-macros",
    rev: "ebae0a3b6ec4bf7096e7b068967b283992078f5f",
    sparse: null,
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
    // Same line-broken-Jinja class as klippain: conditionals wrapped before
    // "if"/"else", "{% endif\n %}", subscripts split at "[", plus prose with
    // unbalanced parentheses inside multiline descriptions.
    knownFailures: [
      "bed_mesh_fast.cfg",
      "bed_surface.cfg",
      "draw.cfg",
      "filament.cfg",
      "globals.cfg",
      "heaters.cfg",
      "kinematics.cfg",
      "layers.cfg",
      "pause_resume_cancel.cfg",
      "start_end.cfg",
      "velocity.cfg",
      "optional/lcd_menus.cfg",
    ],
  },
  // The most-forked Klipper macro set; its idioms recur in thousands of
  // downstream configs (GPL-3.0).
  {
    name: "kamp",
    url: "https://github.com/kyleisah/Klipper-Adaptive-Meshing-Purging",
    rev: "b0dad8ec9ee31cb644b94e39d4b8a8fb9d6c9ba0",
    sparse: ["Configuration"],
    files: (dir) => walk(dir, (name) => name.endsWith(".cfg")),
  },
  // LinuxCNC named-O-word subroutines: labeled blocks, #<local>/#<_global>
  // parameters, active comments with quoted strings (GPL-2.0).
  {
    name: "nativecam",
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
    url: "https://github.com/RomanBoreyko/r_cod2",
    rev: "d19e92b76c1a30ed95be8c990687f1f0b657be4e",
    sparse: ["cnc"],
    files: (dir) => walk(join(dir, "cnc"), (name) => name.endsWith(".nc")),
  },
  // Purpose-built Siemens SINUMERIK edge cases: address=expression forms,
  // extended addresses, GOTOB/GOTOF, CASE..OF, IC() increments (MIT).
  {
    name: "sinumerik-cead",
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

  if (corpus.assertNumericOWords) {
    let checked = 0;
    let missing = 0;
    for (const file of files) {
      if (!/^\s*[oO]\d/m.test(readFileSync(file, "utf8"))) {
        continue;
      }
      checked += 1;
      const result = spawnSync(binary, ["parse", file], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
      });
      if (!result.stdout.includes("o_statement")) {
        console.log(`  NO o_statement: ${file}`);
        missing += 1;
        failed = true;
      }
    }
    console.log(
      `${corpus.name}: ${checked - missing} / ${checked} numeric O-word files produce o_statement nodes`,
    );
  }
}

process.exit(failed ? 1 : 0);
