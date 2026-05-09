import type { DocSchemaDependencyRecord } from "../graph/dependency-record-types";
import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "../resolver/module-resolver";
import type { ParsedSource } from "../resolver/parser";
import type { ResolutionResult } from "../resolver/resolution-controller";
import type { TypeResolver } from "../resolver/resolver";
import type { DocEntry, DocSchema } from "../schema/doc-schema";
import type { ProjectTypeIndexEntry } from "./project-type-index";

import { buildDocSchema } from "../schema/schema-build";

export type ProjectSchemaCacheEntry = {
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
  diagnostics: ResolverDiagnostic[];
};

export type ProjectSchemaCacheBuildResult = {
  /**
   * Registry/cache key that was requested.
   */
  key: string;
  /**
   * Current cache entry after the build or cache hit.
   */
  cacheEntry: ProjectSchemaCacheEntry;
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
  diagnostics: ResolverDiagnostic[];
  /**
   * Parsed source used for dependency analysis when a build occurred.
   */
  parsed: ParsedSource | undefined;
  /**
   * Whether this result came from rebuilding rather than an existing cache hit.
   */
  rebuilt: boolean;
};

export type ProjectSchemaCacheOptions = {
  /**
   * Resolved docgen configuration used for schema generation.
   */
  config: DocgenConfig;
  /**
   * Resolver whose parse cache and semantic service should be reused.
   */
  resolver: TypeResolver;
};

/**
 * Adapter-neutral cache for docgen schema entries.
 *
 * Bundler adapters own consumers and module invalidation, while this cache owns schema entry state,
 * resolver reuse, and lazy/eager schema construction.
 */
export class ProjectSchemaCache {
  private readonly config: DocgenConfig;
  private readonly resolver: TypeResolver;
  private readonly entries = new Map<string, ProjectSchemaCacheEntry>();

  constructor(options: ProjectSchemaCacheOptions) {
    const { config, resolver } = options;

    this.config = config;
    this.resolver = resolver;
  }

  get size(): number {
    return this.entries.size;
  }

  getBuiltEntryCount(): number {
    let count = 0;

    for (const entry of this.entries.values()) {
      if (entry.entry) {
        count++;
      }
    }

    return count;
  }

  getDiagnostics(): ResolverDiagnostic[] {
    const diagnostics: ResolverDiagnostic[] = [];
    const seen = new Set<string>();

    for (const entry of this.entries.values()) {
      for (const diagnostic of entry.diagnostics) {
        const key = JSON.stringify(diagnostic);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  }

  register(entry: ProjectTypeIndexEntry): ProjectSchemaCacheBuildResult | undefined {
    this.entries.set(entry.key, {
      key: entry.key,
      entry: undefined,
      schema: undefined,
      resolution: undefined,
      dependencyRecords: [],
      diagnostics: [],
      filePath: entry.filePath,
      typeName: entry.typeName,
    });

    if (entry.startup) {
      return this.rebuildEntry(entry.key);
    }

    return undefined;
  }

  registerAll(entries: ProjectTypeIndexEntry[]): ProjectSchemaCacheBuildResult[] {
    const results: ProjectSchemaCacheBuildResult[] = [];

    for (const entry of entries) {
      const result = this.register(entry);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): ProjectSchemaCacheEntry | undefined {
    return this.entries.get(key);
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  ensureEntry(key: string): ProjectSchemaCacheBuildResult | undefined {
    const cached = this.entries.get(key);
    if (!cached) {
      return undefined;
    }

    if (cached.entry) {
      return {
        key,
        cacheEntry: cached,
        entry: cached.entry,
        schema: cached.schema,
        resolution: cached.resolution,
        dependencyRecords: cached.dependencyRecords,
        diagnostics: cached.diagnostics,
        parsed: undefined,
        rebuilt: false,
      };
    }

    return this.rebuildEntry(key);
  }

  ensureSchema(key: string): ProjectSchemaCacheBuildResult | undefined {
    const cached = this.entries.get(key);
    if (!cached) {
      return undefined;
    }

    if (cached.schema) {
      return {
        key,
        cacheEntry: cached,
        entry: cached.entry,
        schema: cached.schema,
        resolution: cached.resolution,
        dependencyRecords: cached.dependencyRecords,
        diagnostics: cached.diagnostics,
        parsed: undefined,
        rebuilt: false,
      };
    }

    return this.rebuildEntry(key);
  }

  rebuildEntry(key: string): ProjectSchemaCacheBuildResult | undefined {
    const cached = this.entries.get(key);
    if (!cached) {
      return undefined;
    }

    const parsed = this.resolver.parseFileCached(cached.filePath);
    if (!parsed) {
      const next: ProjectSchemaCacheEntry = {
        ...cached,
        entry: undefined,
        schema: undefined,
        resolution: undefined,
        dependencyRecords: [],
        diagnostics: this.resolver.getDiagnostics(),
      };

      this.entries.set(key, next);

      return {
        key,
        cacheEntry: next,
        entry: undefined,
        schema: undefined,
        resolution: undefined,
        dependencyRecords: [],
        diagnostics: next.diagnostics,
        parsed: undefined,
        rebuilt: true,
      };
    }

    const generation = buildDocSchema({
      parsed,
      typeName: cached.typeName,
      filePath: cached.filePath,
      config: this.config,
      resolver: this.resolver,
    });
    const { schema } = generation;
    const entry = schema.entries[0];
    const next: ProjectSchemaCacheEntry = {
      ...cached,
      entry,
      schema: entry ? schema : undefined,
      resolution: generation.resolution,
      dependencyRecords: generation.dependencyRecords,
      diagnostics: generation.diagnostics,
    };

    this.entries.set(key, next);

    return {
      key,
      cacheEntry: next,
      entry,
      schema: next.schema,
      resolution: next.resolution,
      dependencyRecords: next.dependencyRecords,
      diagnostics: next.diagnostics,
      parsed,
      rebuilt: true,
    };
  }

  clear(): void {
    this.entries.clear();
  }
}
