import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkQueries } from "./check-queries.mjs";
import { examplesDir, root } from "./paths.mjs";
import { runTreeSitter } from "./tree-sitter-cli.mjs";

const fixturesOnly = process.argv.includes("--fixtures-only");
const fixtures = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(examplesDir, entry.name));

if (!fixturesOnly) {
  const parserPath = join(root, "src", "parser.c");
  const parserBefore = readFileSync(parserPath, "utf8");
  runTreeSitter(["generate"]);
  if (readFileSync(parserPath, "utf8") !== parserBefore) {
    console.warn(
      "Warning: src/ was out of date with grammar.js and has been " +
        "regenerated; commit the updated files.",
    );
  }

  runTreeSitter(["test"]);
}

runTreeSitter(["parse", ...fixtures, "--quiet"]);

if (!fixturesOnly) {
  checkQueries();
  execFileSync(
    process.execPath,
    [join(root, "scripts", "check-tolerance.mjs")],
    { stdio: "inherit" },
  );
}
