import { readFileSync, statSync } from "node:fs";
import type { ParsedSource } from "./parser";
import { parseSource, findTypeDeclaration } from "./parser";
import type { DocgenConfig } from "./config";
import { ModuleResolver } from "./module-resolver";
import type { TSInterfaceDeclaration, TSTypeAliasDeclaration, TSEnumDeclaration } from "oxc-parser";

export interface ResolvedType {
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration;
  parsed: ParsedSource;
  filePath: string;
  statementStart: number;
  sourceFiles: string[];
}

interface CacheEntry {
  parsed: ParsedSource;
  mtime: number;
}

export class TypeResolver {
  private fileCache = new Map<string, CacheEntry>();
  private resolvingStack = new Set<string>();
  private moduleResolver: ModuleResolver;
  readonly config: DocgenConfig;

  constructor(config: DocgenConfig) {
    this.config = config;
    this.moduleResolver = new ModuleResolver(config);
  }

  private cacheKey(filePath: string): string {
    return filePath.split("\\").join("/");
  }

  resolveType(
    typeName: string,
    fromFile: string,
    fromParsed: ParsedSource,
  ): ResolvedType | undefined {
    const stackKey = `${this.cacheKey(fromFile)}:${typeName}`;
    if (this.resolvingStack.has(stackKey)) return undefined;
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
      if (!importInfo) return undefined;

      const originalName = importInfo.importedName ?? typeName;
      return this.resolveImportedType(importInfo.source, originalName, fromFile);
    } finally {
      this.resolvingStack.delete(stackKey);
    }
  }

  resolveImportedType(
    specifier: string,
    importedName: string,
    fromFile: string,
  ): ResolvedType | undefined {
    const resolvedPath = this.resolveImportPath(specifier, fromFile);
    if (!resolvedPath) return undefined;
    if (this.isExternalFile(resolvedPath) && this.config.externalTypes !== "resolve") {
      return undefined;
    }

    const targetParsed = this.parseFileCached(resolvedPath);
    if (!targetParsed) return undefined;

    const found = findTypeDeclaration(targetParsed, importedName);
    if (found) {
      return {
        decl: found.decl,
        parsed: targetParsed,
        filePath: resolvedPath,
        statementStart: found.statementStart,
        sourceFiles: [resolvedPath],
      };
    }

    const resolved = this.resolveExportedType(
      importedName,
      resolvedPath,
      targetParsed,
      new Set([`${this.cacheKey(resolvedPath)}:${importedName}`]),
    );
    return resolved
      ? { ...resolved, sourceFiles: [resolvedPath, ...resolved.sourceFiles] }
      : undefined;
  }

  parseFileCached(filePath: string): ParsedSource | undefined {
    const key = this.cacheKey(filePath);
    try {
      const stats = statSync(filePath);
      const mtime = stats.mtimeMs;
      const cached = this.fileCache.get(key);

      if (cached && cached.mtime === mtime) {
        return cached.parsed;
      }

      const source = readFileSync(filePath, "utf-8");
      const parsed = parseSource(source, filePath);
      this.fileCache.set(key, { parsed, mtime });
      return parsed;
    } catch {
      return undefined;
    }
  }

  isCircular(typeName: string, filePath: string): boolean {
    return this.resolvingStack.has(`${this.cacheKey(filePath)}:${typeName}`);
  }

  clearCache(): void {
    this.fileCache.clear();
    this.moduleResolver.clearCache();
  }

  invalidateFile(filePath: string): void {
    this.fileCache.delete(this.cacheKey(filePath));
    this.moduleResolver.clearCache();
  }

  resolveImportPath(specifier: string, fromFile: string): string | undefined {
    return this.moduleResolver.resolveImport(specifier, fromFile);
  }

  private isExternalFile(filePath: string): boolean {
    return this.cacheKey(filePath).includes("/node_modules/");
  }

  private findImportForName(
    parsed: ParsedSource,
    name: string,
  ): { source: string; importedName: string | undefined } | undefined {
    return parsed.index.importsByLocalName.get(name);
  }

  private resolveExportedType(
    exportName: string,
    fromFile: string,
    fromParsed: ParsedSource,
    visited: Set<string>,
  ): ResolvedType | undefined {
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
      const resolved = this.resolveExportFromSource(
        reExport.source,
        reExport.importedName,
        fromFile,
        visited,
      );
      if (resolved) return resolved;
    }

    for (const source of fromParsed.index.exportAllSources) {
      const resolved = this.resolveExportFromSource(source, exportName, fromFile, visited);
      if (resolved) return resolved;
    }

    return undefined;
  }

  private resolveExportFromSource(
    source: string,
    exportName: string,
    fromFile: string,
    visited: Set<string>,
  ): ResolvedType | undefined {
    const resolvedPath = this.resolveImportPath(source, fromFile);
    if (!resolvedPath) return undefined;
    if (this.isExternalFile(resolvedPath) && this.config.externalTypes !== "resolve") {
      return undefined;
    }

    const key = `${this.cacheKey(resolvedPath)}:${exportName}`;
    if (visited.has(key)) return undefined;
    visited.add(key);

    const parsed = this.parseFileCached(resolvedPath);
    if (!parsed) return undefined;

    const found = findTypeDeclaration(parsed, exportName);
    if (found) {
      return {
        decl: found.decl,
        parsed,
        filePath: resolvedPath,
        statementStart: found.statementStart,
        sourceFiles: [resolvedPath],
      };
    }

    const resolved = this.resolveExportedType(exportName, resolvedPath, parsed, visited);
    return resolved
      ? { ...resolved, sourceFiles: [resolvedPath, ...resolved.sourceFiles] }
      : undefined;
  }
}
