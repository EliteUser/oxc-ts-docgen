import type { DocSchemaDependencyRecord } from "../graph/dependency-record-types";
import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "../resolver/module-resolver";
import type { ResolutionResult } from "../resolver/resolution-controller";
import type { DocEntry, DocSchema } from "../schema/doc-schema";
import type {
  ProjectSchemaCacheBuildResult,
  ProjectSchemaCacheEntry,
} from "./project-schema-cache";
import type { ProjectIndexBuildMode, ProjectTypeIndexEntry } from "./project-type-index";

import { createConfigHash } from "../public/config";
import { TypeResolver } from "../resolver/resolver";
import { normalizePath } from "../utils/path-utils";
import { ProjectSchemaCache } from "./project-schema-cache";
import { ProjectTypeIndex } from "./project-type-index";

export type DocgenProjectBuildMode = ProjectIndexBuildMode;

export type DocgenProjectDiagnostic = ResolverDiagnostic;

export type DocgenProjectDependencyRecord = DocSchemaDependencyRecord;

export type DocgenProjectIndexEntry = {
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

export type DocgenProjectCacheEntry = {
  /**
   * Registry/cache key for this schema entry.
   */
  key: string;
  /**
   * Source file that owns the cached type declaration.
   */
  filePath: string;
  /**
   * Cached type declaration name.
   */
  typeName: string;
  /**
   * Lazily or eagerly built primary doc entry.
   */
  entry: DocEntry | undefined;
  /**
   * Lazily or eagerly built full doc schema, including related entries.
   */
  schema: DocSchema | undefined;
  /**
   * Resolution outcome used to build the cached entry.
   */
  resolution: ResolutionResult | undefined;
  /**
   * Dependency records produced with the cached schema.
   */
  dependencyRecords: DocSchemaDependencyRecord[];
  /**
   * Diagnostics produced while building the cached schema.
   */
  diagnostics: DocgenProjectDiagnostic[];
};

export type DocgenProjectBuildResult = {
  /**
   * Registry/cache key that was requested.
   */
  key: string;
  /**
   * Current cache entry after the build or cache hit.
   */
  cacheEntry: DocgenProjectCacheEntry;
  /**
   * Built primary doc entry when resolution succeeds.
   */
  entry: DocEntry | undefined;
  /**
   * Built full doc schema when resolution succeeds.
   */
  schema: DocSchema | undefined;
  /**
   * Resolution outcome used to build the primary schema entry.
   */
  resolution: ResolutionResult | undefined;
  /**
   * Schema dependency records collected during the build.
   */
  dependencyRecords: DocSchemaDependencyRecord[];
  /**
   * Resolver and semantic setup diagnostics collected during the build.
   */
  diagnostics: DocgenProjectDiagnostic[];
  /**
   * Whether this result came from rebuilding rather than an existing cache hit.
   */
  rebuilt: boolean;
};

export type DocgenProjectOptions = {
  /**
   * Resolved docgen configuration used by all project services.
   */
  config: DocgenConfig;
  /**
   * Startup indexing and eager schema build policy.
   */
  buildMode?: DocgenProjectBuildMode;
  /**
   * Stable configuration hash included in type cache keys.
   */
  configHash?: string;
};

export type DocgenProjectProcessFileResult = {
  /**
   * Type keys previously indexed for the processed file.
   */
  previousKeys: Set<string>;
  /**
   * Current indexed declarations discovered in the processed file.
   */
  entries: DocgenProjectIndexEntry[];
  /**
   * Schema cache build results for newly indexed startup entries.
   */
  buildResults: DocgenProjectBuildResult[];
};

export type DocgenProjectTypeKeyOptions = {
  /**
   * Source file that owns the type declaration.
   */
  filePath: string;
  /**
   * Type declaration name.
   */
  typeName: string;
};

export type DocgenProjectSchemaOptions = {
  /**
   * Source file where the requested type is declared.
   */
  sourceFile: string;
  /**
   * Requested type name.
   */
  typeName: string;
};

export type DocgenProjectResolveImportedTypeOptions = {
  /**
   * Import specifier from the consuming module.
   */
  specifier: string;
  /**
   * Imported type name to resolve.
   */
  importedName: string;
  /**
   * File that owns the import declaration.
   */
  fromFile: string;
};

export type DocgenProjectResolvedImportedType = {
  /**
   * Source file where the imported type declaration was found.
   */
  filePath: string;
  /**
   * Resolved declaration name, after export aliasing.
   */
  typeName: string;
  /**
   * Files traversed while resolving the imported type.
   */
  sourceFiles: string[];
};

export type DocgenProjectResolveImportPathOptions = {
  /**
   * Import specifier from the consuming module.
   */
  specifier: string;
  /**
   * File that owns the import declaration.
   */
  fromFile: string;
};

/**
 * Adapter-facing project facade for indexing, schema caching, resolver reuse, diagnostics,
 * dependency records, and semantic service lifecycle.
 */
export class DocgenProject {
  private readonly config: DocgenConfig;
  private readonly buildMode: DocgenProjectBuildMode;
  private readonly configHash: string;
  private readonly resolver: TypeResolver;
  private readonly projectIndex: ProjectTypeIndex;
  private readonly schemaCache: ProjectSchemaCache;

  constructor(options: DocgenProjectOptions) {
    const { config, buildMode = "eagerAll", configHash = createConfigHash(config) } = options;

    this.config = config;
    this.buildMode = buildMode;
    this.configHash = configHash;
    this.resolver = new TypeResolver(config);
    this.projectIndex = this.createProjectIndex();
    this.schemaCache = this.createSchemaCache();
  }

  getConfig(): DocgenConfig {
    return this.config;
  }

  getConfigHash(): string {
    return this.configHash;
  }

  getIndexedTypeCount(): number {
    return this.projectIndex.size;
  }

  getBuiltEntryCount(): number {
    return this.schemaCache.getBuiltEntryCount();
  }

  getDiagnostics(): ResolverDiagnostic[] {
    const diagnostics: ResolverDiagnostic[] = [];
    const seen = new Set<string>();

    for (const diagnostic of [
      ...this.resolver.getDiagnostics(),
      ...this.schemaCache.getDiagnostics(),
    ]) {
      const key = JSON.stringify(diagnostic);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      diagnostics.push(diagnostic);
    }

    return diagnostics;
  }

  initialize(rootDir: string): DocgenProjectBuildResult[] {
    this.schemaCache.clear();
    const entries = this.projectIndex.initialize(rootDir);
    return this.registerIndexedEntries(entries);
  }

  processFile(filePath: string): DocgenProjectProcessFileResult {
    const result = this.projectIndex.processFile(normalizePath(filePath));
    for (const key of result.previousKeys) {
      this.schemaCache.delete(key);
    }

    return {
      ...result,
      buildResults: this.registerIndexedEntries(result.entries),
    };
  }

  invalidateFile(filePath: string): void {
    this.resolver.invalidateFile(filePath);
  }

  getFileKeys(filePath: string): Set<string> | undefined {
    return this.projectIndex.getFileKeys(filePath);
  }

  keys(): IterableIterator<string> {
    return this.projectIndex.keys();
  }

  getCacheEntry(key: string): DocgenProjectCacheEntry | undefined {
    return mapCacheEntry(this.schemaCache.get(key));
  }

  hasCacheEntry(key: string): boolean {
    return this.schemaCache.has(key);
  }

  deleteEntry(key: string): void {
    this.schemaCache.delete(key);
  }

  ensureEntry(key: string): DocgenProjectBuildResult | undefined {
    return mapBuildResult(this.schemaCache.ensureEntry(key));
  }

  ensureSchema(key: string): DocgenProjectBuildResult | undefined {
    return mapBuildResult(this.schemaCache.ensureSchema(key));
  }

  rebuildEntry(key: string): DocgenProjectBuildResult | undefined {
    return mapBuildResult(this.schemaCache.rebuildEntry(key));
  }

  getSchema(options: DocgenProjectSchemaOptions): DocSchema | undefined {
    const { sourceFile, typeName } = options;
    const key = this.getTypeKey({ filePath: sourceFile, typeName });
    if (!this.hasCacheEntry(key)) {
      this.processFile(sourceFile);
    }

    return this.ensureSchema(key)?.schema;
  }

  getTypeKey(options: DocgenProjectTypeKeyOptions): string {
    return this.projectIndex.getTypeKey(options);
  }

  resolveImportedTypeSource(
    options: DocgenProjectResolveImportedTypeOptions,
  ): DocgenProjectResolvedImportedType | undefined {
    const resolved = this.resolver.resolveImportedType(options);
    if (!resolved) {
      return undefined;
    }

    return {
      filePath: resolved.filePath,
      typeName: resolved.decl.id.name,
      sourceFiles: resolved.sourceFiles,
    };
  }

  resolveImportedTypeDependencies(options: DocgenProjectResolveImportedTypeOptions): string[] {
    return this.resolver.resolveImportedTypeDependencies(options);
  }

  resolveImportPath(options: DocgenProjectResolveImportPathOptions): string | undefined {
    return this.resolver.resolveImportPath(options.specifier, options.fromFile);
  }

  dispose(): void {
    this.resolver.dispose();
  }

  private createProjectIndex(): ProjectTypeIndex {
    return new ProjectTypeIndex({
      config: this.config,
      resolver: this.resolver,
      configHash: this.configHash,
      buildMode: this.buildMode,
    });
  }

  private createSchemaCache(): ProjectSchemaCache {
    return new ProjectSchemaCache({
      config: this.config,
      resolver: this.resolver,
    });
  }

  private registerIndexedEntries(entries: ProjectTypeIndexEntry[]): DocgenProjectBuildResult[] {
    return this.schemaCache.registerAll(entries).map(mapRequiredBuildResult);
  }
}

const mapCacheEntry = (
  entry: ProjectSchemaCacheEntry | undefined,
): DocgenProjectCacheEntry | undefined => {
  if (!entry) {
    return undefined;
  }

  return {
    key: entry.key,
    filePath: entry.filePath,
    typeName: entry.typeName,
    entry: entry.entry,
    schema: entry.schema,
    resolution: entry.resolution,
    dependencyRecords: entry.dependencyRecords,
    diagnostics: entry.diagnostics,
  };
};

const mapBuildResult = (
  result: ProjectSchemaCacheBuildResult | undefined,
): DocgenProjectBuildResult | undefined => {
  if (!result) {
    return undefined;
  }

  return mapRequiredBuildResult(result);
};

const mapRequiredBuildResult = (
  result: ProjectSchemaCacheBuildResult,
): DocgenProjectBuildResult => {
  const cacheEntry = mapCacheEntry(result.cacheEntry);
  if (!cacheEntry) {
    throw new Error("DocgenProject received a schema build result without a cache entry.");
  }

  return {
    key: result.key,
    cacheEntry,
    entry: result.entry,
    schema: result.schema,
    resolution: result.resolution,
    dependencyRecords: result.dependencyRecords,
    diagnostics: result.diagnostics,
    rebuilt: result.rebuilt,
  };
};
