import type { TSInterfaceDeclaration, TSTypeAliasDeclaration, TSEnumDeclaration } from "oxc-parser";

import { readFileSync, statSync } from "node:fs";

import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "./module-resolver";
import type { ParsedSource } from "./parser";

import {
  getSemanticProjectSelection,
  TypeScriptSemanticService,
} from "../semantic/semantic-service";
import { ModuleResolver } from "./module-resolver";
import { parseSource, findTypeDeclaration } from "./parser";
export type ResolvedType = {
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration;
  parsed: ParsedSource;
  filePath: string;
  statementStart: number;
  sourceFiles: string[];
};
export type ResolveImportedTypeResult = {
  resolved: ResolvedType | undefined;
  sourceFiles: string[];
};
type CacheEntry = {
  parsed: ParsedSource;
  mtime: number;
};
export type ResolveTypeOptions = {
  typeName: string;
  fromFile: string;
  fromParsed: ParsedSource;
};
type ResolveTypeInternalOptions = ResolveTypeOptions & {
  /**
   * Whether package declarations may be resolved as references without expansion.
   */
  allowExternal: boolean;
};
export type ResolveImportedTypeOptions = {
  specifier: string;
  importedName: string;
  fromFile: string;
};
type ResolveImportedTypeInternalOptions = ResolveImportedTypeOptions & {
  /**
   * Whether package declarations may be resolved as references without expansion.
   */
  allowExternal: boolean;
};
type ResolveExportedTypeOptions = {
  exportName: string;
  fromFile: string;
  fromParsed: ParsedSource;
  visited: Set<string>;
  allowExternal: boolean;
  sourceFiles?: Set<string>;
};
type ResolveExportFromSourceOptions = {
  source: string;
  exportName: string;
  fromFile: string;
  visited: Set<string>;
  allowExternal: boolean;
  sourceFiles?: Set<string>;
};
export type UpdateSemanticFileOptions = {
  resolver: TypeResolver;
  filePath: string;
  source: string;
};
export class TypeResolver {
  private fileCache = new Map<string, CacheEntry>();
  private resolvingStack = new Set<string>();
  private semanticServices = new Map<string, TypeScriptSemanticService>();
  private sourceDiagnosticKeys = new Set<string>();
  private sourceDiagnostics: ResolverDiagnostic[] = [];
  private moduleResolver: ModuleResolver;
  readonly config: DocgenConfig;
  constructor(config: DocgenConfig) {
    this.config = config;
    this.moduleResolver = new ModuleResolver(config);
  }
  private cacheKey(filePath: string): string {
    return filePath.split("\\").join("/");
  }
  resolveType(options: ResolveTypeOptions): ResolvedType | undefined {
    return this.resolveTypeInternal({
      ...options,
      allowExternal: this.config.externalTypes === "resolve",
    });
  }
  resolveTypeReference(options: ResolveTypeOptions): ResolvedType | undefined {
    return this.resolveTypeInternal({ ...options, allowExternal: true });
  }
  private resolveTypeInternal(options: ResolveTypeInternalOptions): ResolvedType | undefined {
    const { typeName, fromFile, fromParsed } = options;
    const stackKey = `${this.cacheKey(fromFile)}:${typeName}`;
    if (this.resolvingStack.has(stackKey)) {
      return undefined;
    }
    this.resolvingStack.add(stackKey);
    try {
      const localDecl = findTypeDeclaration(fromParsed, typeName);
      if (localDecl) {
        return {
          decl: localDecl.decl,
          parsed: fromParsed,
          filePath: fromFile,
          statementStart: localDecl.statementStart,
          sourceFiles: [fromFile],
        };
      }
      const importInfo = this.findImportForName(fromParsed, typeName);
      if (!importInfo) {
        return undefined;
      }
      const originalName = importInfo.importedName ?? typeName;
      return this.resolveImportedTypeInternal({
        specifier: importInfo.source,
        importedName: originalName,
        fromFile,
        allowExternal: options.allowExternal,
      });
    } finally {
      this.resolvingStack.delete(stackKey);
    }
  }
  resolveImportedType(options: ResolveImportedTypeOptions): ResolvedType | undefined {
    return this.resolveImportedTypeInternal({
      ...options,
      allowExternal: this.config.externalTypes === "resolve",
    });
  }
  resolveImportedTypeReference(options: ResolveImportedTypeOptions): ResolvedType | undefined {
    return this.resolveImportedTypeInternal({ ...options, allowExternal: true });
  }
  resolveImportedTypeDependencies(options: ResolveImportedTypeOptions): string[] {
    return this.resolveImportedTypeWithDependencies({
      ...options,
      allowExternal: this.config.externalTypes === "resolve",
    }).sourceFiles;
  }
  private resolveImportedTypeInternal(
    options: ResolveImportedTypeInternalOptions,
  ): ResolvedType | undefined {
    return this.resolveImportedTypeWithDependencies(options).resolved;
  }
  private resolveImportedTypeWithDependencies(
    options: ResolveImportedTypeInternalOptions,
  ): ResolveImportedTypeResult {
    const { specifier, importedName, fromFile } = options;
    const resolvedPath = this.resolveImportPath(specifier, fromFile);
    if (!resolvedPath) {
      return { resolved: undefined, sourceFiles: [] };
    }
    if (this.isExternalFile(resolvedPath) && !options.allowExternal) {
      return { resolved: undefined, sourceFiles: [] };
    }
    const sourceFiles = new Set([resolvedPath]);
    const targetParsed = this.parseFileCached(resolvedPath);
    if (!targetParsed) {
      return { resolved: undefined, sourceFiles: [...sourceFiles] };
    }
    const found = findTypeDeclaration(targetParsed, importedName);
    if (found?.exported) {
      const resolved = {
        decl: found.decl,
        parsed: targetParsed,
        filePath: resolvedPath,
        statementStart: found.statementStart,
        sourceFiles: [resolvedPath],
      };
      return { resolved, sourceFiles: resolved.sourceFiles };
    }
    const resolved = this.resolveExportedType({
      exportName: importedName,
      fromFile: resolvedPath,
      fromParsed: targetParsed,
      visited: new Set([`${this.cacheKey(resolvedPath)}:${importedName}`]),
      allowExternal: options.allowExternal,
      sourceFiles,
    });
    if (!resolved) {
      return { resolved: undefined, sourceFiles: [...sourceFiles] };
    }

    const resolvedWithImport = {
      ...resolved,
      sourceFiles: [resolvedPath, ...resolved.sourceFiles],
    };
    return { resolved: resolvedWithImport, sourceFiles: resolvedWithImport.sourceFiles };
  }
  parseFileCached(filePath: string): ParsedSource | undefined {
    const key = this.cacheKey(filePath);
    this.clearSourceDiagnostics(filePath);

    let mtime: number;
    try {
      const stats = statSync(filePath);
      mtime = stats.mtimeMs;
    } catch (error) {
      this.addSourceDiagnostic({
        code: isMissingFileError(error) ? "source-file-missing" : "source-read-failed",
        message: `Could not read source file "${key}".`,
        filePath: key,
        cause: errorMessage(error),
      });
      return undefined;
    }

    const cached = this.fileCache.get(key);
    if (cached && cached.mtime === mtime) {
      return cached.parsed;
    }

    let source: string;
    try {
      source = readFileSync(filePath, "utf-8");
    } catch (error) {
      this.addSourceDiagnostic({
        code: "source-read-failed",
        message: `Could not read source file "${key}".`,
        filePath: key,
        cause: errorMessage(error),
      });
      return undefined;
    }

    try {
      const parsed = parseSource(source, filePath);
      this.fileCache.set(key, { parsed, mtime });
      return parsed;
    } catch (error) {
      this.addSourceDiagnostic({
        code: "source-parse-failed",
        message: `Could not parse source file "${key}".`,
        filePath: key,
        cause: errorMessage(error),
      });
      return undefined;
    }
  }
  isCircular(typeName: string, filePath: string): boolean {
    return this.resolvingStack.has(`${this.cacheKey(filePath)}:${typeName}`);
  }
  clearCache(): void {
    this.fileCache.clear();
    this.moduleResolver.clearCache();
    this.moduleResolver.clearDiagnostics();
    this.sourceDiagnosticKeys.clear();
    this.sourceDiagnostics = [];
  }
  getDiagnostics(): ResolverDiagnostic[] {
    return [
      ...this.moduleResolver.getDiagnostics(),
      ...this.sourceDiagnostics,
      ...[...this.semanticServices.values()].flatMap((service) => service.getDiagnostics()),
    ];
  }
  invalidateFile(filePath: string): void {
    this.fileCache.delete(this.cacheKey(filePath));
    this.moduleResolver.clearDiagnosticsForImporter(filePath);
    this.moduleResolver.clearCache();
    for (const service of this.semanticServices.values()) {
      service.invalidateFile(filePath);
    }
  }
  resolveImportPath(specifier: string, fromFile: string): string | undefined {
    return this.moduleResolver.resolveImport(specifier, fromFile);
  }
  dispose(): void {
    for (const service of this.semanticServices.values()) {
      service.dispose();
    }
    this.semanticServices.clear();
  }

  private addSourceDiagnostic(diagnostic: ResolverDiagnostic): void {
    const key = sourceDiagnosticKey(diagnostic);
    if (this.sourceDiagnosticKeys.has(key)) {
      return;
    }

    this.sourceDiagnosticKeys.add(key);
    this.sourceDiagnostics.push(diagnostic);
  }

  private clearSourceDiagnostics(filePath: string): void {
    const normalized = this.cacheKey(filePath);
    this.sourceDiagnostics = this.sourceDiagnostics.filter((diagnostic) => {
      if (diagnostic.filePath !== normalized) {
        return true;
      }

      this.sourceDiagnosticKeys.delete(sourceDiagnosticKey(diagnostic));
      return false;
    });
  }

  getSemanticService(filePath?: string): TypeScriptSemanticService {
    const selection = getSemanticProjectSelection({
      config: this.config,
      filePath,
    });
    const existing = this.semanticServices.get(selection.key);
    if (existing) {
      if (filePath) {
        existing.ensureFile(filePath);
      }
      return existing;
    }
    const service = new TypeScriptSemanticService({
      config: this.config,
      rootFiles: filePath ? [filePath] : [],
      currentDirectory: selection.currentDirectory,
    });
    this.semanticServices.set(selection.key, service);
    return service;
  }
  updateSemanticFile(filePath: string, source: string): void {
    this.getSemanticService(filePath).updateFile(filePath, source);
  }
  private isExternalFile(filePath: string): boolean {
    return this.cacheKey(filePath).includes("/node_modules/");
  }
  private findImportForName(
    parsed: ParsedSource,
    name: string,
  ):
    | {
        source: string;
        importedName: string | undefined;
      }
    | undefined {
    return parsed.index.importsByLocalName.get(name);
  }
  private resolveExportedType(options: ResolveExportedTypeOptions): ResolvedType | undefined {
    const { exportName, fromFile, fromParsed, visited } = options;
    if (exportName === "default" && fromParsed.index.defaultExportName) {
      const defaultDecl = findTypeDeclaration(fromParsed, fromParsed.index.defaultExportName);
      if (defaultDecl) {
        return {
          decl: defaultDecl.decl,
          parsed: fromParsed,
          filePath: fromFile,
          statementStart: defaultDecl.statementStart,
          sourceFiles: [fromFile],
        };
      }
    }
    const localName = fromParsed.index.localExportsByName.get(exportName);
    if (localName) {
      const local = findTypeDeclaration(fromParsed, localName);
      if (local) {
        return {
          decl: local.decl,
          parsed: fromParsed,
          filePath: fromFile,
          statementStart: local.statementStart,
          sourceFiles: [fromFile],
        };
      }
    }
    const explicit = fromParsed.index.reExportsByName.get(exportName) ?? [];
    for (const reExport of explicit) {
      const resolved = this.resolveExportFromSource({
        source: reExport.source,
        exportName: reExport.importedName,
        fromFile,
        visited,
        allowExternal: options.allowExternal,
        sourceFiles: options.sourceFiles,
      });
      if (resolved) {
        return resolved;
      }
    }
    for (const source of fromParsed.index.exportAllSources) {
      const resolved = this.resolveExportFromSource({
        source,
        exportName,
        fromFile,
        visited,
        allowExternal: options.allowExternal,
        sourceFiles: options.sourceFiles,
      });
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }
  private resolveExportFromSource(
    options: ResolveExportFromSourceOptions,
  ): ResolvedType | undefined {
    const { source, exportName, fromFile, visited } = options;
    const resolvedPath = this.resolveImportPath(source, fromFile);
    if (!resolvedPath) {
      return undefined;
    }
    if (this.isExternalFile(resolvedPath) && !options.allowExternal) {
      return undefined;
    }
    const key = `${this.cacheKey(resolvedPath)}:${exportName}`;
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);
    options.sourceFiles?.add(resolvedPath);
    const parsed = this.parseFileCached(resolvedPath);
    if (!parsed) {
      return undefined;
    }
    const found = findTypeDeclaration(parsed, exportName);
    if (found?.exported) {
      return {
        decl: found.decl,
        parsed,
        filePath: resolvedPath,
        statementStart: found.statementStart,
        sourceFiles: [resolvedPath],
      };
    }
    const resolved = this.resolveExportedType({
      exportName,
      fromFile: resolvedPath,
      fromParsed: parsed,
      visited,
      allowExternal: options.allowExternal,
      sourceFiles: options.sourceFiles,
    });
    return resolved
      ? { ...resolved, sourceFiles: [resolvedPath, ...resolved.sourceFiles] }
      : undefined;
  }
}

const sourceDiagnosticKey = (diagnostic: ResolverDiagnostic): string => {
  return [
    diagnostic.code,
    diagnostic.filePath,
    diagnostic.specifier,
    diagnostic.importer,
    diagnostic.message,
  ].join("\0");
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isMissingFileError = (error: unknown): boolean => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT";
};

export const getSemanticService = (
  resolver: TypeResolver,
  filePath?: string,
): TypeScriptSemanticService => {
  return resolver.getSemanticService(filePath);
};
export const updateSemanticFile = (options: UpdateSemanticFileOptions): void => {
  const { resolver, filePath, source } = options;
  resolver.updateSemanticFile(filePath, source);
};
