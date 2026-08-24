// Runs test/tolerance/cases.txt, which fixes both edges of the grammar's
// permissiveness. "reject" cases must produce an ERROR; "accept" and
// "tolerate" cases must not. Either may name required nodes after "->", or
// forbidden ones with a leading "!", so a case cannot pass by being swallowed
// into a comment or a bare argument.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./paths.mjs";
import { treeSitterBinary } from "./tree-sitter-cli.mjs";

const casesPath = join(root, "test", "tolerance", "cases.txt");
const scratch = join(root, "build", "tolerance");

function parseCases(source) {
  const cases = [];
  let current = null;
  for (const line of source.split("\n")) {
    // Everything after a header is body until the next header — a case may
    // itself begin with "#", so no line inside the case data is a comment.
    const header = line.match(
      /^--- (reject|accept|tolerate): (.*?)(?: -> ([\w!, ]+))?$/,
    );
    if (header) {
      const nodes = (header[3] ?? "")
        .split(",")
        .map((node) => node.trim())
        .filter(Boolean);
      current = {
        kind: header[1],
        name: header[2].trim(),
        requires: nodes.filter((node) => !node.startsWith("!")),
        forbids: nodes
          .filter((node) => node.startsWith("!"))
          .map((node) => node.slice(1)),
        lines: [],
      };
      cases.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return cases.map((entry) => ({
    ...entry,
    source: `${entry.lines.join("\n").trim()}\n`,
  }));
}

function indent(text) {
  return `${text
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")}\n`;
}

const cases = parseCases(readFileSync(casesPath, "utf8"));
mkdirSync(scratch, { recursive: true });

const failures = [];
for (const entry of cases) {
  const file = join(scratch, "case.gcode");
  writeFileSync(file, entry.source);
  const result = spawnSync(treeSitterBinary, ["parse", file], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: join(root, "build", "cache") },
  });
  const errored = result.status !== 0;
  const has = (node) => new RegExp(`\\(${node}[\\s)[]`).test(result.stdout);

  if (entry.kind === "reject") {
    if (!errored) {
      failures.push([entry, "parsed without an ERROR", result.stdout]);
    }
    continue;
  }
  if (errored) {
    failures.push([entry, "produced an ERROR", result.stdout]);
    continue;
  }
  const missing = entry.requires.filter((node) => !has(node));
  const present = entry.forbids.filter((node) => has(node));
  if (missing.length > 0 || present.length > 0) {
    const detail = [
      missing.length > 0 ? `without ${missing.join(", ")}` : "",
      present.length > 0 ? `with ${present.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    failures.push([entry, `parsed, but ${detail}`, result.stdout]);
  }
}

for (const [entry, reason, tree] of failures) {
  console.log(
    `FAIL ${entry.kind}: ${entry.name}\n  ${reason}:\n${indent(entry.source)}${indent(tree)}`,
  );
}

const count = (kind) => cases.filter((entry) => entry.kind === kind).length;
console.log(
  `Tolerance: ${cases.length - failures.length} / ${cases.length} cases ` +
    `(${count("reject")} rejected, ${count("accept")} accepted, ` +
    `${count("tolerate")} knowingly tolerated).`,
);
process.exit(failures.length > 0 ? 1 : 0);
