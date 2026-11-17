// Lets Node run the game's TypeScript modules directly: extensionless relative imports and
// the "@/" alias resolve to .ts files (Node strips the types itself).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(path.join(root, spec.slice(2))).href;
    if (spec.startsWith(".") || spec.startsWith("file:")) {
      const base = spec.startsWith("file:") ? fileURLToPath(spec) : path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec);
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
        const file = base + ext;
        if (ext === "" && !/\.[cm]?[jt]sx?$/.test(file)) continue;
        if (existsSync(file)) return next(pathToFileURL(file).href, context);
      }
    }
    return next(spec, context);
  },
});
