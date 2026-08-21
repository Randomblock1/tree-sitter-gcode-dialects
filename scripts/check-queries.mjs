import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { examplesDir, queriesDir } from "./paths.mjs";
import { runTreeSitter } from "./tree-sitter-cli.mjs";

// `tree-sitter query` validates query compilation against the grammar; the
// fixture only gives it something to run over.
const fixture = join(examplesDir, "klipper.cfg");

export function checkQueries() {
  const queries = readdirSync(queriesDir).filter((name) =>
    name.endsWith(".scm"),
  );

  for (const query of queries) {
    runTreeSitter(["query", join(queriesDir, query), fixture, "--quiet"], {
      stdio: "pipe",
    });
  }

  console.log(`Validated ${queries.length} query files.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkQueries();
}
