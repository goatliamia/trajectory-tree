import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { defineSettings } from "./settings.js";

export { apply, inject } from "./index.js";
export const name = "dsh-analysis-view";

function loadSchema() {
  const specifier = "@deepseek-ai/schemastery";
  try { return createRequire(import.meta.url)(specifier); }
  catch (error) {
    // A link: install resolves dependencies from its source directory. The
    // DSH CLI also carries this dependency for linked plugins without node_modules.
    if (error.code !== "MODULE_NOT_FOUND" || !isAbsolute(process.argv[1] ?? "")) throw error;
    return createRequire(process.argv[1])(specifier);
  }
}

export const Config = defineSettings(loadSchema());
