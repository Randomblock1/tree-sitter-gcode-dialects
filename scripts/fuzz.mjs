// Grammar-directed fuzzer with two layers:
//
//   generative — builds valid-by-construction programs for every dialect from
//   a seeded PRNG; any ERROR/MISSING node is a bug in the grammar (or the
//   generator, which is itself a spec of what we claim to parse).
//
//   mutation — corrupts the example fixtures; the parser may produce ERROR
//   nodes (it is tolerant by design) but must never crash or hang.
//
// Deterministic by default (seed 1) so CI failures reproduce; pass --seed N
// to explore. Failing inputs are kept under build/fuzz/ for inspection.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { examplesDir, root } from "./paths.mjs";

const require = createRequire(import.meta.url);
const binary = join(
  dirname(require.resolve("tree-sitter-cli/package.json")),
  process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter",
);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(args[index + 1]);
};
const seed = flag("seed", 1);
const generatedFiles = flag("files", 200);
const mutationsPerFixture = flag("mutations", 40);

// mulberry32 — small, seedable, good enough for fuzzing.
function prng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = prng(seed);
const int = (n) => Math.floor(rng() * n);
const pick = (list) => list[int(list.length)];
const maybe = (p) => rng() < p;
const randomCase = (word) =>
  [...word]
    .map((c) => (maybe(0.5) ? c.toUpperCase() : c.toLowerCase()))
    .join("");

const number = () => {
  const body = pick([
    `${int(300)}`,
    `${int(300)}.${int(100)}`,
    `.${1 + int(99)}`,
    `${int(50)}.`,
  ]);
  return pick(["", "", "-", "+"]) + body;
};

const identifier = () =>
  pick(["speed", "temp", "idx", "count", "probe_result", "x_max", "layer"]);

const WORD_OPS = ["mod", "and", "or", "xor", "in", "is"];
const SYMBOL_OPS = [
  "+",
  "-",
  "*",
  "/",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "&&",
  "||",
];

// Expressions valid inside X[...], {...}, and RRF/Klipper contexts. Word
// operators get random case on purpose — the grammar must not care.
function expression(depth) {
  if (depth <= 0 || maybe(0.4)) {
    return pick([
      number,
      identifier,
      () => `#${1 + int(30)}`,
      () => `#<${identifier()}>`,
      () => pick(["true", "True", "FALSE", "null"]),
      () => `"${identifier()}"`,
    ])();
  }
  return pick([
    () => {
      const op = maybe(0.4)
        ? ` ${randomCase(pick(WORD_OPS))} `
        : ` ${pick(SYMBOL_OPS)} `;
      return `${expression(depth - 1)}${op}${expression(depth - 1)}`;
    },
    () => `[${expression(depth - 1)}]`,
    () =>
      `${pick(["sin", "cos", "atan", "abs", "sqrt"])}[${expression(depth - 1)}]`,
    () => `${pick(["!", "-"])}${expression(depth - 1)}`,
  ])();
}

const axisLetter = () => pick(["X", "Y", "Z", "A", "B", "C", "E", "x", "y"]);
const axisWord = () => `${axisLetter()}${number()}`;

const activeComment = () =>
  `(${pick(["MSG", "DEBUG", "PRINT", "LOG", "msg"])}, ${identifier()} = #${1 + int(20)})`;

function commandLine() {
  const command = pick([
    () => `G${int(100)}`,
    () => `M${int(600)}`,
    () => `T${int(4)}`,
    () => `G${int(100)}.${1 + int(9)}`,
  ])();
  const arg = pick([
    axisWord,
    () => `F${1 + int(6000)}`,
    () => `S${int(255)}`,
    () => `${pick(["P", "R", "Q", "I", "J", "K"])}${number()}`,
    () => `${pick(["X", "Y", "Z"])}[${expression(2)}]`,
    () => `${identifier().toUpperCase()}=${expression(1)}`,
    () => `${axisLetter()}${1 + int(3)}=${number()}`,
    () => `R${1 + int(40)}=${number()}`,
  ]);
  const parts = [command];
  for (let i = 1 + int(4); i > 0; i--) {
    parts.push(arg());
  }
  let line = parts.join(" ");
  if (maybe(0.15)) {
    line = `N${1 + int(9000)} ${line}`;
  }
  if (maybe(0.1)) {
    line += ` *${int(200)}`;
  }
  if (maybe(0.2)) {
    line += ` ; ${identifier()}`;
  }
  return line;
}

// Constructs added while validating the Siemens/Fanuc corpora.
function siemensLine() {
  return pick([
    () => `N${10 * (1 + int(50))}`,
    () => `R${1 + int(40)}=${expression(1)}`,
    () => `${axisLetter().toUpperCase()}${1 + int(3)}=${number()}`,
    () => `S1=${1 + int(9000)} M3`,
    () => `GOTO${pick(["F", "B"])} LAB${1 + int(9)}`,
    () => `LAB${1 + int(9)}:`,
    () =>
      `IF R${1 + int(20)}${pick(["==", ">", "<>"])}${int(9)} GOTOF END_${identifier().toUpperCase()}`,
    () => `MCALL CYCLE8${1 + int(3)}(${number()},${number()},${number()})`,
    () => `R${1 + int(40)}=$P_${identifier().toUpperCase()}`,
    () => `R${1 + int(40)}=$P_${identifier().toUpperCase()}[${int(4)}]`,
  ])();
}

function fanucLine() {
  return pick([
    () =>
      `IF[#${1 + int(30)}${pick(["EQ", "NE", "GT", "LT"])}#${1 + int(30)}]GOTO${1 + int(99)}`,
    () => `WHILE[#${1 + int(20)}LE${1 + int(9)}.]DO${1 + int(3)}`,
    () => `END${1 + int(3)}`,
    () =>
      `#${1 + int(30)}= ${number()} ${maybe(0.5) ? `(${identifier()})` : ""}`,
    () => `G${int(99)} ${axisWord()} (${identifier()} (${identifier()}))`,
    () => "* * * * * * * *",
    () => activeComment(),
  ])();
}

// Space-free compact output, the way slicers and post-processors write it.
const compactLine = () =>
  `N${1 + int(999)}G${pick(["0", "1", "90", "21"])}` +
  Array.from({ length: 1 + int(3) }, () => {
    const body = pick([`${int(200)}`, `${int(200)}.${int(9)}`, `${int(50)}.`]);
    return `${axisLetter().toUpperCase()}${body}`;
  }).join("") +
  (maybe(0.3) ? `F${1 + int(6000)}` : "");

function rrfBlock() {
  const cond = () =>
    `${identifier()} ${pick(["<", ">", "==", "!="])} ${number()}`;
  const model = () =>
    pick([
      `move.axes[${int(3)}].machinePosition`,
      `heat.heaters[${int(2)}].current`,
      `state.status`,
      `sensors.probes[0].value`,
    ]);
  const body = () =>
    pick([
      () => `  set var.${identifier()} = ${expression(1)}`,
      () => `  echo ${model()}`,
      () => `  G1 ${axisWord()} F${1 + int(3000)}`,
      () => `  M291 P"${identifier()}" S1`,
    ])();
  const lines = [`var ${identifier()} = ${expression(1)}`];
  if (maybe(0.3)) {
    lines.push(`var ${identifier()}s = {${number()}, ${number()},}`);
  }
  if (maybe(0.2)) {
    lines.push(`abort { "escaped ""${identifier()}"" quote" }`);
  }
  lines.push(pick([`if ${cond()}`, `while ${cond()}`]));
  for (let i = 1 + int(3); i > 0; i--) {
    lines.push(body());
  }
  if (maybe(0.5)) {
    lines.push("else");
    lines.push(body());
  }
  lines.push(`echo {${model()}}`);
  return lines;
}

function klipperBlock() {
  const lines = [
    pick([
      `[gcode_macro ${identifier().toUpperCase()}]`,
      `[stepper_${pick(["x", "y", "z"])}]`,
      `[include ${identifier()}/*.cfg]`,
    ]),
  ];
  for (let i = 1 + int(3); i > 0; i--) {
    lines.push(
      pick([
        () => `${identifier()}: ${number()}`,
        () => `${identifier()} = ${identifier()}`,
        () => `variable_${identifier()}: ${number()}`,
      ])(),
    );
  }
  if (maybe(0.6)) {
    lines.push("gcode:");
    lines.push(`  {% ${pick(["if", "elif"])} ${expressionJinja()} %}`);
    lines.push(`  G1 ${axisWord()}`);
    lines.push(`  {% set ${identifier()} = ${expressionJinja()} %}`);
    lines.push(`  M117 {${expressionJinja()}}`);
    lines.push("  {% endif %}");
  }
  if (maybe(0.2)) {
    lines.push(`{# ${identifier()} #}`);
  }
  return lines;
}

// Jinja expressions exclude bare #<...> parameter syntax.
function expressionJinja() {
  return pick([
    () => `printer.${identifier()}[${int(4)}]`,
    () => `params.${identifier().toUpperCase()}|default(${int(10)})|float`,
    () => `${identifier()} ${pick(["+", "-", "*", "<", "=="])} ${number()}`,
    number,
  ])();
}

function cncBlock() {
  const label = pick([`o${100 + int(900)}`, `o<${identifier()}>`]);
  const lines = [
    `${label} ${pick(["sub", "if", "while", "repeat"])} [${expression(2)}]`,
  ];
  for (let i = 1 + int(3); i > 0; i--) {
    lines.push(
      pick([
        () => `#${1 + int(30)} = ${expression(2)}`,
        () => `#<${identifier()}> = ${expression(1)}`,
        () => `#[#${1 + int(20)}] = ${expression(1)}`,
        () => `G1 X#[#${1 + int(20)}] Y[${expression(1)}]`,
        () => `G1 X[${expression(2)}] Y#${1 + int(20)}`,
        () => `(${identifier()} comment)`,
        () => `G${pick(["0", "1", "2", "3"])} ${axisWord()} ${axisWord()}`,
      ])(),
    );
  }
  lines.push(`${label} ${pick(["endsub", "endif", "endwhile", "endrepeat"])}`);
  return lines;
}

function generateFile() {
  const lines = [];
  if (maybe(0.1)) {
    lines.push("%");
  }
  for (let block = 2 + int(5); block > 0; block--) {
    const kind = pick([
      "command",
      "command",
      "compact",
      "rrf",
      "klipper",
      "cnc",
    ]);
    if (kind === "command") {
      for (let i = 1 + int(4); i > 0; i--) {
        lines.push(commandLine());
      }
    } else if (kind === "compact") {
      lines.push(compactLine());
    } else if (kind === "rrf") {
      lines.push(...rrfBlock());
    } else if (kind === "klipper") {
      lines.push(...klipperBlock());
    } else if (kind === "siemens") {
      for (let i = 1 + int(4); i > 0; i--) {
        lines.push(siemensLine());
      }
    } else if (kind === "fanuc") {
      for (let i = 1 + int(4); i > 0; i--) {
        lines.push(fanucLine());
      }
    } else {
      lines.push(...cncBlock());
    }
    if (maybe(0.4)) {
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

function mutate(source) {
  const bytes = [...source];
  for (let edits = 1 + int(8); edits > 0; edits--) {
    const at = int(bytes.length);
    switch (int(5)) {
      case 0:
        bytes.splice(at, 1 + int(20));
        break;
      case 1:
        bytes.splice(
          at,
          0,
          pick([
            '"',
            "'",
            "{",
            "}",
            "[",
            "]",
            "(",
            "%",
            "=",
            "#",
            "\n",
            "\0",
            "é",
          ]),
        );
        break;
      case 2:
        bytes.splice(at, 0, ...bytes.slice(at, at + 1 + int(30)));
        break;
      case 3:
        if (bytes[at]) bytes[at] = String.fromCharCode(33 + int(94));
        break;
      case 4:
        bytes.reverse();
        break;
    }
  }
  return bytes.join("");
}

function parseBatch(files, { allowErrors }) {
  const failures = [];
  for (let start = 0; start < files.length; start += 50) {
    const batch = files.slice(start, start + 50);
    const result = spawnSync(binary, ["parse", "--quiet", ...batch], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
    });
    if (result.signal) {
      failures.push(
        `parser crashed or hung (${result.signal}) in batch: ${batch[0]}…`,
      );
    } else if (result.status !== 0 && !allowErrors) {
      failures.push(
        ...result.stdout.split("\n").filter((line) => line.trim() !== ""),
      );
    }
  }
  return failures;
}

const fuzzDir = join(root, "build", "fuzz");
rmSync(fuzzDir, { recursive: true, force: true });
const genDir = join(fuzzDir, "generated");
const mutDir = join(fuzzDir, "mutated");
mkdirSync(genDir, { recursive: true });
mkdirSync(mutDir, { recursive: true });

console.log(`Fuzzing with seed ${seed}`);

const generated = [];
for (let i = 0; i < generatedFiles; i++) {
  const file = join(genDir, `gen-${String(i).padStart(4, "0")}.gcode`);
  writeFileSync(file, generateFile());
  generated.push(file);
}
const genFailures = parseBatch(generated, { allowErrors: false });
console.log(
  `generative: ${generated.length - genFailures.length} / ${generated.length} parse clean`,
);
for (const line of genFailures) {
  console.log(`  FAIL ${line}`);
}

const fixtures = readdirSync(examplesDir).map((name) =>
  join(examplesDir, name),
);
const mutated = [];
for (const fixture of fixtures) {
  const source = readFileSync(fixture, "utf8");
  for (let i = 0; i < mutationsPerFixture; i++) {
    const file = join(mutDir, `${i}-${fixture.split("/").pop()}`);
    writeFileSync(file, mutate(source));
    mutated.push(file);
  }
}
const mutFailures = parseBatch(mutated, { allowErrors: true });
console.log(
  `mutation: ${mutated.length} corrupted fixtures parsed, ${mutFailures.length} crashes/hangs`,
);
for (const line of mutFailures) {
  console.log(`  FAIL ${line}`);
}

// Keep only failing inputs around.
if (genFailures.length === 0) rmSync(genDir, { recursive: true, force: true });
if (mutFailures.length === 0) rmSync(mutDir, { recursive: true, force: true });

// tree-sitter's own fuzzer: random incremental edits over the corpus tests,
// checking re-parse consistency.
console.log("tree-sitter fuzz (incremental edit consistency)…");
try {
  execFileSync(binary, ["fuzz", "--iterations", "10"], {
    cwd: root,
    stdio: "pipe",
    timeout: 300000,
    env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
  });
  console.log("tree-sitter fuzz: ok");
} catch (error) {
  console.log(`tree-sitter fuzz: FAILED\n${error.stdout ?? error.message}`);
  process.exitCode = 1;
}

if (genFailures.length > 0 || mutFailures.length > 0) {
  process.exitCode = 1;
}
