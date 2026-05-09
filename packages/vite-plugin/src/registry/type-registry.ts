import type {
  DocEntry,
  DocSchema,
  DocgenConfig,
  DocgenProjectBuildMode,
  DocgenProjectBuildResult,
  DocgenProjectDiagnostic,
} from "@synthfall/oxc-ts-docgen";

import { DocgenProject } from "@synthfall/oxc-ts-docgen";

import { ConsumerGraph } from "../graph/consumer-graph";
import { DependencyGraph } from "../graph/dependency-graph";
import { normalizePath } from "../utils/path-utils";
import { collectRegistryTypeDependencies } from "./registry-dependency-collector";
export type RegistryBuildMode = DocgenProjectBuildMode;
export type TypeRegistryOptions = {
  /**
   * Startup indexing and eager schema build policy.
   */
  buildMode?: RegistryBuildMode;
};
export type RegisterConsumerOptions = {
  /**
   * Consumer module file that contains a compile-time `getDocs()` call.
   */
  consumerModule: string;
  /**
   * Requested type name consumed by the module.
   */
  typeName: string;
  /**
   * Source file where the requested type is declared.
   */
  sourceFile: string;
};
type TypeRegistryTypeKeyOptions = {
  /**
   * Source file where the requested type is declared.
   */
  sourceFile: string;
  /**
   * Requested type name.
   */
  typeName: string;
};
type GetCachedEntryOptions = {
  /**
   * Registry/cache key to read or lazily build.
   */
  key: string;
  /**
   * Source file to process first when the key is not indexed yet.
   */
  sourceFile?: string;
};
/**
 * Vite-only: pre-built index of project types for fast `getDocs()` transforms, incremental
 * rebuilds, and HMR. Standalone `generateDocs` / CLI do not use this.
 */
export class TypeRegistry {
  private reverseDeps = new DependencyGraph();
  private fileDepToKeys = new DependencyGraph();
  private consumers = new ConsumerGraph();
  private project: DocgenProject;
  private readonly config: DocgenConfig;
  private readonly buildMode: RegistryBuildMode;
  private _initialized = false;
  constructor(config: DocgenConfig, options: TypeRegistryOptions = {}) {
    this.config = config;
    this.buildMode = options.buildMode ?? "eagerAll";
    this.project = this.createProject();
  }
  getConfig(): DocgenConfig {
    return this.config;
  }
  getConfigHash(): string {
    return this.project.getConfigHash();
  }
  get initialized(): boolean {
    return this._initialized;
  }
  getIndexedTypeCount(): number {
    return this.project.getIndexedTypeCount();
  }
  getBuiltEntryCount(): number {
    return this.project.getBuiltEntryCount();
  }
  getDiagnostics(): DocgenProjectDiagnostic[] {
    return this.project.getDiagnostics();
  }
  dispose(): void {
    this.project.dispose();
  }
  initialize(rootDir: string): void {
    this.reset();
    for (const result of this.project.initialize(rootDir)) {
      this.trackBuildResult(result);
    }
    this._initialized = true;
  }
  rebuild(rootDir: string): string[] {
    const consumers = this.getConsumerModules();
    this.initialize(rootDir);
    return consumers;
  }
  getConsumerModules(): string[] {
    return this.consumers.getConsumerModules();
  }
  processFile(filePath: string): void {
    const nPath = normalizePath(filePath);
    const previousKeys = new Set(this.project.getFileKeys(nPath) ?? []);
    for (const key of previousKeys) {
      this.removeEntry(key);
    }

    const result = this.project.processFile(nPath);
    for (const buildResult of result.buildResults) {
      this.trackBuildResult(buildResult);
    }
  }
  invalidateFile(filePath: string): string[] {
    const nPath = normalizePath(filePath);
    const previousKeys = new Set(this.project.getFileKeys(nPath) ?? []);
    this.project.invalidateFile(filePath);
    const affected = new Set(this.collectAffectedKeys(previousKeys));
    for (const key of this.collectFileDependentKeys(nPath)) {
      affected.add(key);
    }
    this.processFile(filePath);
    const rebuiltKeys = this.project.getFileKeys(nPath) ?? new Set();
    for (const key of this.collectAffectedKeys(rebuiltKeys)) {
      affected.add(key);
    }
    for (const key of affected) {
      if (rebuiltKeys.has(key)) {
        if (this.consumers.hasTypeConsumers(key)) {
          this.rebuildEntry(key);
        }
        continue;
      }
      this.rebuildEntry(key);
    }
    const consumers = new Set<string>();
    for (const c of this.consumers.getFileConsumers(nPath)) {
      consumers.add(c);
    }
    for (const k of affected) {
      for (const c of this.consumers.getTypeConsumers(k)) {
        consumers.add(c);
      }
    }
    return [...consumers];
  }
  getEntry(typeName: string, sourceFile?: string): DocEntry | undefined {
    if (sourceFile) {
      const k = this.typeKey({ sourceFile, typeName });
      return this.getCachedEntry({ key: k, sourceFile });
    }
    for (const k of this.project.keys()) {
      if (k.endsWith(`:${typeName}`)) {
        return this.getCachedEntry({ key: k });
      }
    }
    return undefined;
  }
  getSchema(typeName: string, sourceFile: string): DocSchema | undefined {
    return this.getSchemaBuildResult(typeName, sourceFile)?.schema;
  }
  getSchemaBuildResult(typeName: string, sourceFile: string): DocgenProjectBuildResult | undefined {
    const k = this.typeKey({ sourceFile, typeName });
    if (!this.project.hasCacheEntry(k)) {
      this.processFile(sourceFile);
    }
    const result = this.project.ensureSchema(k);
    this.trackBuildResult(result);
    return result;
  }
  resolveImportedTypeSource(
    options: Parameters<DocgenProject["resolveImportedTypeSource"]>[0],
  ): ReturnType<DocgenProject["resolveImportedTypeSource"]> {
    return this.project.resolveImportedTypeSource(options);
  }
  resolveImportedTypeDependencies(
    options: Parameters<DocgenProject["resolveImportedTypeDependencies"]>[0],
  ): ReturnType<DocgenProject["resolveImportedTypeDependencies"]> {
    return this.project.resolveImportedTypeDependencies(options);
  }
  resolveImportPath(
    options: Parameters<DocgenProject["resolveImportPath"]>[0],
  ): ReturnType<DocgenProject["resolveImportPath"]> {
    return this.project.resolveImportPath(options);
  }
  getSchemaFileDependencies(typeName: string, sourceFile: string): string[] {
    const k = this.typeKey({ sourceFile, typeName });
    const result = this.project.ensureSchema(k);
    this.trackBuildResult(result);
    if (!result) {
      return [];
    }

    const files = result.dependencyRecords.map((record) => normalizePath(record.filePath));
    files.push(normalizePath(sourceFile));
    return [...new Set(files)];
  }
  registerConsumer(options: RegisterConsumerOptions): void {
    const { consumerModule, typeName, sourceFile } = options;
    const k = this.typeKey({ sourceFile, typeName });
    this.consumers.registerTypeConsumer(consumerModule, k);
  }
  registerFileDependency(consumerModule: string, sourceFile: string): void {
    this.consumers.registerFileConsumer(consumerModule, sourceFile);
  }
  clearConsumer(consumerModule: string): void {
    this.consumers.clearConsumer(consumerModule);
  }
  private collectAffectedKeys(keys: Iterable<string>): string[] {
    const affected = new Set<string>();
    const queue = [...keys];
    for (let index = 0; index < queue.length; index++) {
      const cur = queue[index];
      if (affected.has(cur)) {
        continue;
      }
      affected.add(cur);
      const dependents = this.reverseDeps.getDependents(cur);
      for (const dep of dependents) {
        if (!affected.has(dep)) {
          queue.push(dep);
        }
      }
    }
    return [...affected];
  }
  private collectFileDependentKeys(filePath: string): string[] {
    return this.collectAffectedKeys(this.fileDepToKeys.getDependents(filePath));
  }
  private removeEntry(k: string): void {
    if (!this.project.hasCacheEntry(k)) {
      return;
    }
    this.reverseDeps.clearDependent(k);
    this.fileDepToKeys.clearDependent(k);
    this.project.deleteEntry(k);
  }
  private rebuildEntry(k: string): void {
    this.reverseDeps.clearDependent(k);
    this.fileDepToKeys.clearDependent(k);
    this.trackBuildResult(this.project.rebuildEntry(k));
  }
  private trackBuildResult(result: DocgenProjectBuildResult | undefined): void {
    if (!result || !result.rebuilt) {
      return;
    }

    this.reverseDeps.clearDependent(result.key);
    this.fileDepToKeys.clearDependent(result.key);

    if (!result.entry || !result.schema) {
      return;
    }

    const schemaDependencyRecords = result.dependencyRecords;
    const fileDeps = new Set(schemaDependencyRecords.map((record) => record.filePath));
    const deps = collectRegistryTypeDependencies({
      dependencyRecords: schemaDependencyRecords,
      createTypeKey: (filePath, typeName) => this.typeKey({ sourceFile: filePath, typeName }),
    });
    this.reverseDeps.addDependencies(result.key, deps);
    this.fileDepToKeys.addDependencies(result.key, fileDeps);
  }
  getSchemaCacheKey(typeName: string, sourceFile: string): string {
    return this.typeKey({ sourceFile, typeName });
  }
  private typeKey(options: TypeRegistryTypeKeyOptions): string {
    const { sourceFile, typeName } = options;
    return this.project.getTypeKey({ filePath: sourceFile, typeName });
  }
  private reset(): void {
    this.project.dispose();
    this.reverseDeps.clear();
    this.fileDepToKeys.clear();
    this.consumers.clear();
    this.project = this.createProject();
    this._initialized = false;
  }
  private createProject(): DocgenProject {
    return new DocgenProject({
      config: this.config,
      buildMode: this.buildMode,
    });
  }
  private getCachedEntry(options: GetCachedEntryOptions): DocEntry | undefined {
    const { key, sourceFile } = options;

    if (!this.project.hasCacheEntry(key) && sourceFile) {
      this.processFile(sourceFile);
    }

    const result = this.project.ensureEntry(key);
    this.trackBuildResult(result);

    return result?.entry;
  }
}
