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
    files: (dir) => walk(join(dir, "nc_files"), (name) => name.endsWith(".ngc")),
    assertNumericOWords: true,
  },
  {
    name: "marlin",
    url: "https://github.com/MarlinFirmware/Marlin",
    rev: "0ebac470a47d9e278096c955f36087b613001a65",
    sparse: ["buildroot/test-gcode"],
    files: (dir) => [join(dir, "buildroot", "test-gcode", "M808-loops.gcode")],
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
  console.log(
    `${corpus.name}: ${files.length - failures.length} / ${files.length} parse clean`,
  );
  for (const line of failures) {
    console.log(`  FAIL ${line}`);
    failed = true;
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
