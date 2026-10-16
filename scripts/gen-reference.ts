import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { USAGE } from "../src/cli/usage.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { renderCliReference, renderConfigReference } from "./reference.js";

const out = fileURLToPath(new URL("../docs/reference/", import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(`${out}config.md`, renderConfigReference(DEFAULT_CONFIG));
writeFileSync(`${out}cli.md`, renderCliReference(USAGE));
console.log("generated docs/reference/config.md and cli.md");
