import type * as TypeScript from "typescript";

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "../resolver/module-resolver";
const require = createRequire(import.meta.url);
let cachedTypeScript: typeof TypeScript | undefined;
export type SemanticServiceOptions = {
  config: DocgenConfig;
  rootFiles?: string[];
  currentDirectory?: string;
};
export type SemanticProjectSelection = {
  /**
   * Stable cache key for the effective TypeScript project.
   */
  key: string;
  /**
   * Directory used by the TypeScript language service host.
   */
  currentDirectory: string;
};
type GetSemanticProjectSelectionOptions = {
  /**
   * Effective docgen config carrying optional tsconfig override.
   */
  config: DocgenConfig;
  /**
   * Source file requesting semantic analysis.
   */
  filePath?: string;
};
type ScriptState = {
  version: number;
  snapshot: TypeScript.IScriptSnapshot | undefined;
};
export const getSemanticProjectSelection = (
  options: GetSemanticProjectSelectionOptions,
): SemanticProjectSelection => {
  const { config, filePath } = options;

  if (config.tsconfig) {
    const tsconfigFile = normalizePath(resolve(config.tsconfig));

    return {
      key: `tsconfig:${tsconfigFile}`,
      currentDirectory: dirname(tsconfigFile),
    };
  }

  if (filePath) {
    const fileDirectory = dirname(resolve(filePath));
    const tsconfigFile = findNearestTsconfig(fileDirectory);

    if (tsconfigFile) {
      return {
        key: `tsconfig:${tsconfigFile}`,
        currentDirectory: dirname(tsconfigFile),
      };
    }
  }

  return {
    key: "default",
    currentDirectory: process.cwd(),
  };
};
export class TypeScriptSemanticService {
  private readonly config: DocgenConfig;
  private readonly currentDirectory: string;
  private readonly rootFiles = new Set<string>();
  private readonly scripts = new Map<string, ScriptState>();
  private readonly ts: typeof TypeScript;
  private readonly compilerOptions: TypeScript.CompilerOptions;
  private readonly tsconfigFile: string | undefined;
  private readonly diagnostics: ResolverDiagnostic[];
  private languageService: TypeScript.LanguageService | undefined;
  private languageServiceCreateCount = 0;
  constructor(options: SemanticServiceOptions) {
    this.config = options.config;
    this.ts = loadTypeScript();
    this.currentDirectory = normalizePath(resolve(options.currentDirectory ?? process.cwd()));
    const project = readProjectConfig({
      ts: this.ts,
      config: this.config,
      currentDirectory: this.currentDirectory,
    });
    this.compilerOptions = project.options;
    this.tsconfigFile = project.tsconfigFile;
    this.diagnostics = project.diagnostics;
    for (const filePath of project.fileNames) this.rootFiles.add(normalizePath(filePath));
    for (const filePath of options.rootFiles ?? []) this.ensureFile(filePath);
  }
  ensureFile(filePath: string): void {
    const normalized = normalizePath(resolve(filePath));
    this.rootFiles.add(normalized);
    if (!this.scripts.has(normalized)) {
      this.scripts.set(normalized, { version: 0, snapshot: readSnapshot(normalized) });
    }
  }
  updateFile(filePath: string, source: string): void {
    const normalized = normalizePath(resolve(filePath));
    this.rootFiles.add(normalized);
    const previous = this.scripts.get(normalized);
    this.scripts.set(normalized, {
      version: (previous?.version ?? 0) + 1,
      snapshot: this.ts.ScriptSnapshot.fromString(source),
    });
  }
  invalidateFile(filePath: string): void {
    const normalized = normalizePath(resolve(filePath));
    const previous = this.scripts.get(normalized);
    this.scripts.set(normalized, {
      version: (previous?.version ?? 0) + 1,
      snapshot: readSnapshot(normalized),
    });
  }
  getProgram(): TypeScript.Program | undefined {
    return this.getLanguageService().getProgram();
  }
  getTypeChecker(): TypeScript.TypeChecker | undefined {
    return this.getProgram()?.getTypeChecker();
  }
  getVersion(filePath: string): number | undefined {
    return this.scripts.get(normalizePath(resolve(filePath)))?.version;
  }
  getLanguageServiceCreateCount(): number {
    return this.languageServiceCreateCount;
  }
  getTsconfigFile(): string | undefined {
    return this.tsconfigFile;
  }
  getTypeScript(): typeof TypeScript {
    return this.ts;
  }
  getDiagnostics(): ResolverDiagnostic[] {
    return [...this.diagnostics];
  }
  dispose(): void {
    this.languageService?.dispose();
    this.languageService = undefined;
  }
  private getLanguageService(): TypeScript.LanguageService {
    if (this.languageService) {
      return this.languageService;
    }
    const host: TypeScript.LanguageServiceHost = {
      getCompilationSettings: () => this.compilerOptions,
      getCurrentDirectory: () => this.currentDirectory,
      getDefaultLibFileName: (options) => this.ts.getDefaultLibFilePath(options),
      getScriptFileNames: () => [...this.rootFiles],
      getScriptSnapshot: (fileName) => this.getScriptSnapshot(fileName),
      getScriptVersion: (fileName) => String(this.getScriptVersion(fileName)),
      readDirectory: this.ts.sys.readDirectory,
      readFile: this.ts.sys.readFile,
      fileExists: this.ts.sys.fileExists,
      directoryExists: this.ts.sys.directoryExists,
      getDirectories: this.ts.sys.getDirectories,
    };
    this.languageService = this.ts.createLanguageService(
      host,
      this.ts.createDocumentRegistry(false, this.currentDirectory),
    );
    this.languageServiceCreateCount++;
    return this.languageService;
  }
  private getScriptSnapshot(fileName: string): TypeScript.IScriptSnapshot | undefined {
    const normalized = normalizePath(resolve(fileName));
    const existing = this.scripts.get(normalized);
    if (existing) {
      return existing.snapshot;
    }
    const snapshot = readSnapshot(normalized);
    if (snapshot) this.scripts.set(normalized, { version: 0, snapshot });
    return snapshot;
  }
  private getScriptVersion(fileName: string): number {
    const normalized = normalizePath(resolve(fileName));
    const existing = this.scripts.get(normalized);
    if (existing) {
      return existing.version;
    }
    const snapshot = readSnapshot(normalized);
    if (!snapshot) {
      return 0;
    }
    this.scripts.set(normalized, { version: 0, snapshot });
    return 0;
  }
}
type ProjectConfig = {
  options: TypeScript.CompilerOptions;
  fileNames: string[];
  tsconfigFile: string | undefined;
  diagnostics: ResolverDiagnostic[];
};
type ReadProjectConfigOptions = {
  /**
   * TypeScript namespace used to parse config files.
   */
  ts: typeof TypeScript;
  /**
   * Effective docgen config carrying optional tsconfig override.
   */
  config: DocgenConfig;
  /**
   * Current working directory used for tsconfig discovery.
   */
  currentDirectory: string;
};
const readProjectConfig = (options: ReadProjectConfigOptions): ProjectConfig => {
  const { ts, config, currentDirectory } = options;
  const tsconfigFile = config.tsconfig
    ? normalizePath(resolve(config.tsconfig))
    : findNearestTsconfig(currentDirectory);
  if (!tsconfigFile) {
    return {
      options: defaultCompilerOptions(ts),
      fileNames: [],
      tsconfigFile: undefined,
      diagnostics: [],
    };
  }
  const read = ts.readConfigFile(tsconfigFile, ts.sys.readFile);
  if (read.error) {
    return {
      options: defaultCompilerOptions(ts),
      fileNames: [],
      tsconfigFile,
      diagnostics: [
        {
          code: "tsconfig-invalid",
          filePath: tsconfigFile,
          message: `TypeScript semantic service could not read tsconfig file: ${tsconfigFile}.`,
          cause: formatTsDiagnostic({ ts, diagnostic: read.error }),
        },
      ],
    };
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(tsconfigFile),
    defaultCompilerOptions(ts),
    tsconfigFile,
  );
  return {
    options: parsed.options,
    fileNames: parsed.fileNames.map(normalizePath),
    tsconfigFile,
    diagnostics: parsed.errors.map((diagnostic) => ({
      code: "tsconfig-invalid",
      filePath: tsconfigFile,
      message: `TypeScript semantic service found an invalid tsconfig setting in ${tsconfigFile}.`,
      cause: formatTsDiagnostic({ ts, diagnostic }),
    })),
  };
};
const defaultCompilerOptions = (ts: typeof TypeScript): TypeScript.CompilerOptions => {
  return {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    allowJs: false,
  };
};
const findNearestTsconfig = (startDir: string): string | undefined => {
  let current = normalizePath(resolve(startDir));
  while (true) {
    const candidate = normalizePath(resolve(current, "tsconfig.json"));
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = normalizePath(dirname(current));
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};
const readSnapshot = (filePath: string): TypeScript.IScriptSnapshot | undefined => {
  try {
    return loadTypeScript().ScriptSnapshot.fromString(readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
};
const loadTypeScript = (): typeof TypeScript => {
  cachedTypeScript ??= require("typescript") as typeof TypeScript;
  return cachedTypeScript;
};
type FormatTsDiagnosticOptions = {
  /**
   * TypeScript namespace used to flatten diagnostic messages.
   */
  ts: typeof TypeScript;
  /**
   * TypeScript diagnostic to format.
   */
  diagnostic: TypeScript.Diagnostic;
};
const formatTsDiagnostic = (options: FormatTsDiagnosticOptions): string => {
  const { ts, diagnostic } = options;
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
};
const normalizePath = (filePath: string): string => {
  return filePath.split("\\").join("/");
};
