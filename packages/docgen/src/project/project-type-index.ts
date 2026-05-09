import type { DocgenConfig } from "../public/config";
import type { ParsedSource } from "../resolver/parser";
import type { TypeResolver } from "../resolver/resolver";

import { findAllTypeDeclarations, findExportedTypeDeclarations } from "../resolver/parser";
import { scanProjectFiles } from "../resolver/project-file-scanner";
import { normalizePath } from "../utils/path-utils";

export type ProjectIndexBuildMode = "indexOnly" | "eagerPublic" | "eagerAll";

export type ProjectTypeIndexEntry = {
  /**
   * Registry/cache key for this indexed type declaration.
   */
  key: string;
  /**
   * Source file that owns the indexed declaration.
   */
  filePath: string;
  /**
   * Indexed type declaration name.
   */
  typeName: string;
  /**
   * Whether callers should eagerly build this declaration after indexing.
   */
  startup: boolean;
};

export type ProcessProjectFileResult = {
  /**
   * Type keys previously indexed for the processed file.
   */
  previousKeys: Set<string>;
  /**
   * Current indexed declarations discovered in the processed file.
   */
  entries: ProjectTypeIndexEntry[];
};

export type ProjectTypeIndexOptions = {
  /**
   * Resolved docgen configuration used for scanning and parsing policy.
   */
  config: DocgenConfig;
  /**
   * Resolver whose parse cache should back the project index.
   */
  resolver: TypeResolver;
  /**
   * Stable configuration hash included in type cache keys.
   */
  configHash: string;
  /**
   * Startup indexing and eager build policy.
   */
  buildMode?: ProjectIndexBuildMode;
};

export type ProjectTypeKeyOptions = {
  /**
   * Source file that owns the type declaration.
   */
  filePath: string;
  /**
   * Type declaration name.
   */
  typeName: string;
};

type CreateProjectTypeKeyOptions = ProjectTypeKeyOptions & {
  /**
   * Stable configuration hash included in type cache keys.
   */
  configHash: string;
};

const createProjectTypeKey = (options: CreateProjectTypeKeyOptions): string => {
  const { filePath, typeName, configHash } = options;
  return `${configHash}:${normalizePath(filePath)}:${typeName}`;
};

export class ProjectTypeIndex {
  private readonly config: DocgenConfig;
  private readonly resolver: TypeResolver;
  private readonly configHash: string;
  private readonly buildMode: ProjectIndexBuildMode;
  private readonly entriesByKey = new Map<string, ProjectTypeIndexEntry>();
  private readonly fileToKeys = new Map<string, Set<string>>();

  constructor(options: ProjectTypeIndexOptions) {
    const { config, resolver, configHash, buildMode = "eagerAll" } = options;

    this.config = config;
    this.resolver = resolver;
    this.configHash = configHash;
    this.buildMode = buildMode;
  }

  get size(): number {
    return this.entriesByKey.size;
  }

  initialize(rootDir: string): ProjectTypeIndexEntry[] {
    this.clear();

    const entries: ProjectTypeIndexEntry[] = [];
    for (const file of scanProjectFiles(rootDir, this.config)) {
      entries.push(...this.processFile(file).entries);
    }

    return entries;
  }

  processFile(filePath: string): ProcessProjectFileResult {
    const normalizedPath = normalizePath(filePath);
    const previousKeys = new Set(this.fileToKeys.get(normalizedPath) ?? []);

    for (const key of previousKeys) {
      this.entriesByKey.delete(key);
    }

    this.fileToKeys.delete(normalizedPath);

    const parsed = this.resolver.parseFileCached(filePath);
    if (!parsed) {
      return { previousKeys, entries: [] };
    }

    const typeNames = findAllTypeDeclarations(parsed);
    const startupTypeNames = this.getStartupTypeNames(typeNames, parsed);
    const keys = new Set<string>();
    const entries: ProjectTypeIndexEntry[] = [];

    this.fileToKeys.set(normalizedPath, keys);

    for (const typeName of typeNames) {
      const key = this.getTypeKey({ filePath, typeName });
      const entry: ProjectTypeIndexEntry = {
        key,
        filePath,
        typeName,
        startup: startupTypeNames.has(typeName),
      };

      keys.add(key);
      this.entriesByKey.set(key, entry);
      entries.push(entry);
    }

    return { previousKeys, entries };
  }

  get(key: string): ProjectTypeIndexEntry | undefined {
    return this.entriesByKey.get(key);
  }

  keys(): IterableIterator<string> {
    return this.entriesByKey.keys();
  }

  getFileKeys(filePath: string): Set<string> | undefined {
    const keys = this.fileToKeys.get(normalizePath(filePath));
    if (!keys) {
      return undefined;
    }

    return new Set(keys);
  }

  getTypeKey(options: ProjectTypeKeyOptions): string {
    const { filePath, typeName } = options;
    return createProjectTypeKey({ filePath, typeName, configHash: this.configHash });
  }

  clear(): void {
    this.entriesByKey.clear();
    this.fileToKeys.clear();
  }

  private getStartupTypeNames(typeNames: string[], parsed: ParsedSource): Set<string> {
    if (this.buildMode === "eagerAll") {
      return new Set(typeNames);
    }

    if (this.buildMode === "eagerPublic") {
      return new Set(findExportedTypeDeclarations(parsed));
    }

    return new Set();
  }
}
