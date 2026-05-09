import type { NapiResolveOptions } from "oxc-resolver";

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ResolverFactory } from "oxc-resolver";

import type { DocgenConfig } from "../public/config";
const TS_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts"];
const RESOLVE_EXTENSIONS = [...TS_EXTENSIONS, ".js", ".jsx", ".mjs", ".cjs"];
export type ResolverDiagnosticCode =
  | "tsconfig-not-found"
  | "tsconfig-invalid"
  | "tsconfig-unsupported"
  | "resolver-setup-failed"
  | "module-resolution-failed"
  | "source-file-missing"
  | "source-read-failed"
  | "source-parse-failed"
  | "static-extraction-incomplete";
export type ResolverDiagnostic = {
  code: ResolverDiagnosticCode;
  message: string;
  filePath?: string;
  specifier?: string;
  importer?: string;
  cause?: string;
};
export class ModuleResolver {
  private readonly resolver: ResolverFactory;
  private readonly resolutionCache = new Map<string, string | undefined>();
  private readonly explicitTsconfig: string | undefined;
  private readonly validatedTsconfigs = new Set<string>();
  private readonly diagnostics = new Map<string, ResolverDiagnostic>();
  constructor(config: DocgenConfig) {
    this.explicitTsconfig = config.tsconfig ? normalizePath(resolve(config.tsconfig)) : undefined;
    if (this.explicitTsconfig) this.validateTsconfigFile(this.explicitTsconfig);
    this.resolver = this.createResolver(config);
  }
  resolveImport(specifier: string, fromFile: string): string | undefined {
    const key = resolutionCacheKey(specifier, fromFile);
    if (this.resolutionCache.has(key)) {
      return this.resolutionCache.get(key);
    }
    const resolved = this.resolveImportUncached(specifier, fromFile);
    this.resolutionCache.set(key, resolved);
    return resolved;
  }
  clearCache(): void {
    this.resolver.clearCache();
    this.resolutionCache.clear();
  }
  clearDiagnostics(): void {
    this.diagnostics.clear();
  }
  clearDiagnosticsForImporter(filePath: string): void {
    const importer = normalizePath(filePath);
    for (const [key, diagnostic] of this.diagnostics) {
      if (diagnostic.importer === importer) {
        this.diagnostics.delete(key);
      }
    }
  }
  getDiagnostics(): ResolverDiagnostic[] {
    return [...this.diagnostics.values()];
  }
  private resolveImportUncached(specifier: string, fromFile: string): string | undefined {
    if (!this.explicitTsconfig) this.validateNearestTsconfig(fromFile);
    let resolutionError: unknown;
    try {
      const result = this.resolver.resolveFileSync(fromFile, specifier);
      if (result.path) {
        this.clearModuleResolutionDiagnostic(specifier, fromFile);
        return normalizePath(result.path);
      }
    } catch (error) {
      resolutionError = error;
      // Keep old relative/absolute behavior as the compatibility fallback.
    }
    const legacyResolved = resolveImportPathLegacy(specifier, fromFile);
    if (legacyResolved) {
      this.clearModuleResolutionDiagnostic(specifier, fromFile);
      return legacyResolved;
    }
    this.addDiagnostic({
      code: "module-resolution-failed",
      message: `Could not resolve "${specifier}" from "${normalizePath(fromFile)}".`,
      specifier,
      importer: normalizePath(fromFile),
      cause: resolutionError ? errorMessage(resolutionError) : undefined,
    });
    return undefined;
  }
  private createResolver(config: DocgenConfig): ResolverFactory {
    try {
      return new ResolverFactory(createResolverOptions(config));
    } catch (error) {
      this.addDiagnostic({
        code: "resolver-setup-failed",
        message: "Could not initialize the TypeScript module resolver.",
        cause: errorMessage(error),
      });
      return new ResolverFactory(createResolverOptions(config, false));
    }
  }
  private validateNearestTsconfig(fromFile: string): void {
    const tsconfig = findNearestTsconfig(dirname(fromFile));
    if (tsconfig) this.validateTsconfigFile(tsconfig);
  }
  private validateTsconfigFile(filePath: string): void {
    const normalized = normalizePath(resolve(filePath));
    if (this.validatedTsconfigs.has(normalized)) {
      return;
    }
    this.validatedTsconfigs.add(normalized);
    if (!existsSync(normalized)) {
      this.addDiagnostic({
        code: "tsconfig-not-found",
        filePath: normalized,
        message: `Configured tsconfig file does not exist: ${normalized}.`,
      });
      return;
    }
    try {
      if (!statSync(normalized).isFile()) {
        this.addDiagnostic({
          code: "tsconfig-not-found",
          filePath: normalized,
          message: `Configured tsconfig path is not a file: ${normalized}.`,
        });
        return;
      }
    } catch (error) {
      this.addDiagnostic({
        code: "tsconfig-not-found",
        filePath: normalized,
        message: `Could not read configured tsconfig file: ${normalized}.`,
        cause: errorMessage(error),
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(readFileSync(normalized, "utf-8")));
    } catch (error) {
      this.addDiagnostic({
        code: "tsconfig-invalid",
        filePath: normalized,
        message: `Invalid tsconfig JSON in ${normalized}.`,
        cause: errorMessage(error),
      });
      return;
    }
    const unsupported = validateTsconfigShape(parsed);
    if (unsupported) {
      this.addDiagnostic({
        code: "tsconfig-unsupported",
        filePath: normalized,
        message: `Unsupported tsconfig shape in ${normalized}: ${unsupported}.`,
      });
    }
  }
  private addDiagnostic(diagnostic: ResolverDiagnostic): void {
    this.diagnostics.set(diagnosticKey(diagnostic), diagnostic);
  }
  private clearModuleResolutionDiagnostic(specifier: string, fromFile: string): void {
    this.diagnostics.delete(moduleResolutionDiagnosticKey(specifier, fromFile));
  }
}
export const formatResolverDiagnostic = (diagnostic: ResolverDiagnostic): string => {
  const fileLabel = diagnostic.code.startsWith("tsconfig") ? "tsconfig" : "file";
  const details = [
    `[${diagnostic.code}] ${diagnostic.message}`,
    diagnostic.filePath ? `${fileLabel}: ${diagnostic.filePath}` : undefined,
    diagnostic.specifier ? `specifier: ${diagnostic.specifier}` : undefined,
    diagnostic.importer ? `importer: ${diagnostic.importer}` : undefined,
    diagnostic.cause ? `cause: ${diagnostic.cause}` : undefined,
  ].filter(Boolean);
  return details.join(" ");
};
const createResolverOptions = (config: DocgenConfig, useTsconfig = true): NapiResolveOptions => {
  const options: NapiResolveOptions = {
    conditionNames: ["node", "import"],
    extensions: RESOLVE_EXTENSIONS,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    },
    mainFiles: ["index"],
  };
  if (useTsconfig) {
    options.tsconfig =
      config.tsconfig !== undefined
        ? { configFile: resolve(config.tsconfig), references: "auto" }
        : "auto";
  }
  return options;
};
const normalizePath = (filePath: string): string => {
  return filePath.split("\\").join("/");
};
const diagnosticKey = (diagnostic: ResolverDiagnostic): string => {
  if (
    diagnostic.code === "module-resolution-failed" &&
    diagnostic.specifier &&
    diagnostic.importer
  ) {
    return moduleResolutionDiagnosticKey(diagnostic.specifier, diagnostic.importer);
  }
  return [
    diagnostic.code,
    diagnostic.filePath,
    diagnostic.specifier,
    diagnostic.importer,
    diagnostic.message,
  ].join("\0");
};
const moduleResolutionDiagnosticKey = (specifier: string, fromFile: string): string => {
  return ["module-resolution-failed", normalizePath(fromFile), specifier].join("\0");
};
const resolutionCacheKey = (specifier: string, fromFile: string): string => {
  return `${normalizePath(fromFile)}\0${specifier}`;
};
const resolveImportPathLegacy = (specifier: string, fromFile: string): string | undefined => {
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
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalizePath(candidate);
    }
  }
  const indexCandidates = TS_EXTENSIONS.map((ext) => join(base, `index${ext}`));
  for (const candidate of indexCandidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalizePath(candidate);
    }
  }
  return undefined;
};
const findNearestTsconfig = (startDir: string): string | undefined => {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "tsconfig.json");
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};
const validateTsconfigShape = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return "root must be a JSON object";
  }
  const compilerOptions = value.compilerOptions;
  if (compilerOptions !== undefined && !isRecord(compilerOptions)) {
    return "compilerOptions must be an object";
  }
  if (!isRecord(compilerOptions)) {
    return undefined;
  }
  if (compilerOptions.baseUrl !== undefined && typeof compilerOptions.baseUrl !== "string") {
    return "compilerOptions.baseUrl must be a string";
  }
  const paths = compilerOptions.paths;
  if (paths === undefined) {
    return undefined;
  }
  if (!isRecord(paths)) {
    return "compilerOptions.paths must be an object";
  }
  for (const [alias, targets] of Object.entries(paths)) {
    if (typeof targets === "string") {
      continue;
    }
    if (Array.isArray(targets) && targets.every((target) => typeof target === "string")) {
      continue;
    }
    return `compilerOptions.paths["${alias}"] must be a string or string array`;
  }
  return undefined;
};
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
const stripJsonCommentsAndTrailingCommas = (source: string): string => {
  return stripTrailingCommas(stripJsonComments(source));
};
const stripJsonComments = (source: string): string => {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    result += char;
  }
  return result;
};
const stripTrailingCommas = (source: string): string => {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === ",") {
      let lookahead = i + 1;
      while (/\s/.test(source[lookahead] ?? "")) lookahead++;
      if (source[lookahead] === "}" || source[lookahead] === "]") {
        continue;
      }
    }
    result += char;
  }
  return result;
};
const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
