import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import type { NapiResolveOptions } from "oxc-resolver";
import type { DocgenConfig } from "./config";

const TS_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts"];
const RESOLVE_EXTENSIONS = [...TS_EXTENSIONS, ".js", ".jsx", ".mjs", ".cjs"];

export class ModuleResolver {
  private readonly resolver: ResolverFactory;
  private readonly resolutionCache = new Map<string, string | undefined>();

  constructor(config: DocgenConfig) {
    this.resolver = new ResolverFactory(createResolverOptions(config));
  }

  resolveImport(specifier: string, fromFile: string): string | undefined {
    const key = resolutionCacheKey(specifier, fromFile);
    if (this.resolutionCache.has(key)) return this.resolutionCache.get(key);

    const resolved = this.resolveImportUncached(specifier, fromFile);
    this.resolutionCache.set(key, resolved);
    return resolved;
  }

  clearCache(): void {
    this.resolver.clearCache();
    this.resolutionCache.clear();
  }

  private resolveImportUncached(specifier: string, fromFile: string): string | undefined {
    try {
      const result = this.resolver.resolveFileSync(fromFile, specifier);
      if (result.path) return normalizePath(result.path);
    } catch {
      // Keep old relative/absolute behavior as the compatibility fallback.
    }

    return resolveImportPathLegacy(specifier, fromFile);
  }
}

function createResolverOptions(config: DocgenConfig): NapiResolveOptions {
  return {
    conditionNames: ["node", "import"],
    extensions: RESOLVE_EXTENSIONS,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    },
    mainFiles: ["index"],
    tsconfig: config.tsconfig
      ? { configFile: resolve(config.tsconfig), references: "auto" }
      : "auto",
  };
}

function normalizePath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function resolutionCacheKey(specifier: string, fromFile: string): string {
  return `${normalizePath(fromFile)}\0${specifier}`;
}

function resolveImportPathLegacy(specifier: string, fromFile: string): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !isAbsolute(specifier)) {
    return undefined;
  }

  const dir = dirname(fromFile);
  const base = isAbsolute(specifier) ? specifier : resolve(dir, specifier);

  if (existsSync(base) && statSync(base).isFile()) {
    return normalizePath(base);
  }

  for (const ext of TS_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return normalizePath(candidate);
  }

  const indexCandidates = TS_EXTENSIONS.map((ext) => join(base, `index${ext}`));
  for (const candidate of indexCandidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return normalizePath(candidate);
  }

  return undefined;
}
