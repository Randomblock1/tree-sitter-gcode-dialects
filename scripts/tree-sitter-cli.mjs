import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { root } from "./paths.mjs";

const require = createRequire(import.meta.url);
const packageDirectory = dirname(
  require.resolve("tree-sitter-cli/package.json"),
);
const binaryName =
  process.platform === "win32" ? "tree-sitter.exe" : "tree-sitter";
const binary = join(packageDirectory, binaryName);

export function runTreeSitter(args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: root,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CACHE_HOME: join(root, "build", "cache"),
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(
      `tree-sitter ${args.join(" ")} exited with ${result.status ?? `signal ${result.signal}`}${detail}`,
    );
  }
}

export { binary as treeSitterBinary, root };
