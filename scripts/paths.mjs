import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const queriesDir = join(root, "queries");
export const examplesDir = join(root, "examples");
