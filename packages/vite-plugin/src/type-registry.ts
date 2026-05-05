import { readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { DocEntry, DocSchema, DocgenConfig, ParsedSource } from "@oxc-ts-docgen/docgen";
import {
  TypeResolver,
  attachRelatedToSchema,
  buildDocEntry,
  collectReferencedTypeNames,
  findAllTypeDeclarations,
  findTypeDeclaration,
} from "@oxc-ts-docgen/docgen";

function norm(p: string): string {
  return p.split("\\").join("/");
}

function typeKey(filePath: string, typeName: string): string {
  return `${norm(filePath)}:${typeName}`;
}

interface RegistryEntry {
  entry: DocEntry;
  schema: DocSchema | undefined;
  filePath: string;
  typeName: string;
  typeDeps: Set<string>;
}

/**
 * Vite-only: pre-built index of project types for fast `getDocs<T>()` transforms,
 * incremental rebuilds, and HMR. Standalone `generateDocs` / CLI do not use this.
 */
export class TypeRegistry {
  private entries = new Map<string, RegistryEntry>();
  private fileToKeys = new Map<string, Set<string>>();
  private reverseDeps = new Map<string, Set<string>>();

  private consumerToTypes = new Map<string, Set<string>>();
  private typeToConsumers = new Map<string, Set<string>>();
  private consumerToFiles = new Map<string, Set<string>>();
  private fileToConsumers = new Map<string, Set<string>>();

  private resolver: TypeResolver;
  private readonly config: DocgenConfig;
  private _initialized = false;

  constructor(config: DocgenConfig) {
    this.config = config;
    this.resolver = new TypeResolver(config);
  }

  getConfig(): DocgenConfig {
    return this.config;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  getResolver(): TypeResolver {
    return this.resolver;
  }

  initialize(rootDir: string): void {
    this.reset();
    const files = scanFiles(rootDir, this.config);
    for (const file of files) {
      this.processFile(file);
    }
    this._initialized = true;
  }

  rebuild(rootDir: string): string[] {
    const consumers = this.getConsumerModules();
    this.initialize(rootDir);
    return consumers;
  }

  getConsumerModules(): string[] {
    return [...new Set([...this.consumerToTypes.keys(), ...this.consumerToFiles.keys()])];
  }

  processFile(filePath: string): void {
    const nPath = norm(filePath);

    const oldKeys = this.fileToKeys.get(nPath);
    if (oldKeys) {
      for (const k of oldKeys) this.removeEntry(k);
    }

    const parsed = this.resolver.parseFileCached(filePath);
    if (!parsed) return;

    const typeNames = findAllTypeDeclarations(parsed);
    const keys = new Set<string>();
    this.fileToKeys.set(nPath, keys);

    for (const name of typeNames) {
      const k = typeKey(filePath, name);
      keys.add(k);

      const entry = buildDocEntry(parsed, name, filePath, this.config, this.resolver);
      if (!entry) continue;

      const deps = this.collectTypeDeps(entry, parsed, name, filePath);
      this.entries.set(k, { entry, schema: undefined, filePath, typeName: name, typeDeps: deps });

      for (const dep of deps) {
        let set = this.reverseDeps.get(dep);
        if (!set) {
          set = new Set();
          this.reverseDeps.set(dep, set);
        }
        set.add(k);
      }
    }
  }

  invalidateFile(filePath: string): string[] {
    const nPath = norm(filePath);
    this.resolver.invalidateFile(filePath);

    const previousKeys = new Set(this.fileToKeys.get(nPath) ?? []);
    const affected = new Set(this.collectAffectedKeys(previousKeys));
    this.processFile(filePath);
    const rebuiltKeys = this.fileToKeys.get(nPath) ?? new Set();
    for (const key of this.collectAffectedKeys(rebuiltKeys)) {
      affected.add(key);
    }

    for (const key of affected) {
      if (rebuiltKeys.has(key)) continue;
      this.rebuildEntry(key);
    }

    const consumers = new Set<string>();
    const directFileConsumers = this.fileToConsumers.get(nPath);
    if (directFileConsumers) {
      for (const c of directFileConsumers) consumers.add(c);
    }
    for (const k of affected) {
      const set = this.typeToConsumers.get(k);
      if (set) for (const c of set) consumers.add(c);
    }
    return [...consumers];
  }

  getEntry(typeName: string, sourceFile?: string): DocEntry | undefined {
    if (sourceFile) {
      const k = typeKey(sourceFile, typeName);
      const cached = this.entries.get(k);
      if (cached) return cached.entry;

      this.processFile(sourceFile);
      return this.entries.get(k)?.entry;
    }

    for (const [k, re] of this.entries) {
      if (k.endsWith(`:${typeName}`)) return re.entry;
    }
    return undefined;
  }

  getSchema(typeName: string, sourceFile: string): DocSchema | undefined {
    const k = typeKey(sourceFile, typeName);
    let cached = this.entries.get(k);
    if (!cached) {
      this.processFile(sourceFile);
      cached = this.entries.get(k);
    }
    if (!cached) return undefined;
    if (cached.schema) return cached.schema;

    cached.schema = attachRelatedToSchema(
      { version: 1, entries: [cached.entry] },
      cached.filePath,
      this.resolver,
      this.config,
    );
    return cached.schema;
  }

  registerConsumer(consumerModule: string, typeName: string, sourceFile: string): void {
    const c = norm(consumerModule);
    const k = typeKey(sourceFile, typeName);

    let types = this.consumerToTypes.get(c);
    if (!types) {
      types = new Set();
      this.consumerToTypes.set(c, types);
    }
    types.add(k);

    let consumers = this.typeToConsumers.get(k);
    if (!consumers) {
      consumers = new Set();
      this.typeToConsumers.set(k, consumers);
    }
    consumers.add(c);
  }

  registerFileDependency(consumerModule: string, sourceFile: string): void {
    const c = norm(consumerModule);
    const source = norm(sourceFile);

    let files = this.consumerToFiles.get(c);
    if (!files) {
      files = new Set();
      this.consumerToFiles.set(c, files);
    }
    files.add(source);

    let consumers = this.fileToConsumers.get(source);
    if (!consumers) {
      consumers = new Set();
      this.fileToConsumers.set(source, consumers);
    }
    consumers.add(c);
  }

  clearConsumer(consumerModule: string): void {
    const c = norm(consumerModule);
    const types = this.consumerToTypes.get(c);

    if (types) {
      for (const k of types) {
        const consumers = this.typeToConsumers.get(k);
        if (consumers) {
          consumers.delete(c);
          if (consumers.size === 0) this.typeToConsumers.delete(k);
        }
      }
      this.consumerToTypes.delete(c);
    }

    const files = this.consumerToFiles.get(c);
    if (!files) return;
    for (const source of files) {
      const consumers = this.fileToConsumers.get(source);
      if (consumers) {
        consumers.delete(c);
        if (consumers.size === 0) this.fileToConsumers.delete(source);
      }
    }
    this.consumerToFiles.delete(c);
  }

  private collectAffectedKeys(keys: Iterable<string>): string[] {
    const affected = new Set<string>();
    const queue = [...keys];

    for (let index = 0; index < queue.length; index++) {
      const cur = queue[index];
      if (affected.has(cur)) continue;
      affected.add(cur);

      const dependents = this.reverseDeps.get(cur);
      if (!dependents) continue;
      for (const dep of dependents) {
        if (!affected.has(dep)) queue.push(dep);
      }
    }

    return [...affected];
  }

  private removeEntry(k: string): void {
    const re = this.entries.get(k);
    if (!re) return;

    for (const dep of re.typeDeps) {
      const set = this.reverseDeps.get(dep);
      if (set) {
        set.delete(k);
        if (set.size === 0) this.reverseDeps.delete(dep);
      }
    }
    this.entries.delete(k);
  }

  private rebuildEntry(k: string): void {
    const old = this.entries.get(k);
    if (!old) return;

    const parsed = this.resolver.parseFileCached(old.filePath);
    if (!parsed) return;

    const entry = buildDocEntry(parsed, old.typeName, old.filePath, this.config, this.resolver);
    if (!entry) return;

    for (const dep of old.typeDeps) {
      const set = this.reverseDeps.get(dep);
      if (set) set.delete(k);
    }

    const deps = this.collectTypeDeps(entry, parsed, old.typeName, old.filePath);
    for (const dep of deps) {
      let set = this.reverseDeps.get(dep);
      if (!set) {
        set = new Set();
        this.reverseDeps.set(dep, set);
      }
      set.add(k);
    }

    this.entries.set(k, {
      entry,
      schema: undefined,
      filePath: old.filePath,
      typeName: old.typeName,
      typeDeps: deps,
    });
  }

  private collectTypeDeps(
    entry: DocEntry,
    parsed: ParsedSource,
    typeName: string,
    filePath: string,
  ): Set<string> {
    const deps = new Set<string>();
    const currentKey = typeKey(filePath, typeName);
    for (const name of collectReferencedTypeNames(entry)) {
      this.addResolvedTypeDep(deps, name, filePath, parsed, currentKey);
    }

    const found = findTypeDeclaration(parsed, typeName);
    if (!found) return deps;

    if (found.decl.type === "TSInterfaceDeclaration" && found.decl.extends) {
      for (const parent of found.decl.extends) {
        const expr = parent.expression as { type: string; name?: string };
        if (expr.type !== "Identifier" || !expr.name) continue;
        this.addResolvedTypeDep(deps, expr.name, filePath, parsed, currentKey);
      }
    }

    return deps;
  }

  private addResolvedTypeDep(
    deps: Set<string>,
    typeName: string,
    filePath: string,
    parsed: ParsedSource,
    currentKey: string,
  ): void {
    if (this.config.ignoreTypes.includes(typeName)) return;
    const resolved = this.resolver.resolveType(typeName, filePath, parsed);
    if (!resolved) return;

    const depKey = typeKey(resolved.filePath, resolved.decl.id.name);
    if (depKey !== currentKey) deps.add(depKey);
  }

  private reset(): void {
    this.entries.clear();
    this.fileToKeys.clear();
    this.reverseDeps.clear();
    this.consumerToTypes.clear();
    this.typeToConsumers.clear();
    this.consumerToFiles.clear();
    this.fileToConsumers.clear();
    this.resolver = new TypeResolver(this.config);
    this._initialized = false;
  }
}

function scanFiles(rootDir: string, config: DocgenConfig): string[] {
  const results: string[] = [];

  try {
    const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const ext = extname(entry.name);
      if (ext !== ".ts" && ext !== ".tsx") continue;

      const parentDir =
        (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
        (entry as unknown as { path: string }).path;
      const fullPath = join(parentDir, entry.name);
      const rel = norm(relative(rootDir, fullPath));

      if (rel.includes("node_modules/")) continue;
      if (rel.startsWith("node_modules/")) continue;
      if (rel.endsWith(".d.ts")) continue;

      if (config.include.length > 0 && !config.include.some((pat) => matchesGlob(rel, pat)))
        continue;
      if (config.exclude.some((pat) => matchesGlob(rel, pat))) continue;

      results.push(fullPath);
    }
  } catch {
    // rootDir doesn't exist
  }

  return results;
}

function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(norm(pattern)).test(path);
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) return cached;

  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];

    if (char === "*") {
      if (next === "*") {
        const after = pattern[i + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i++;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  source += "$";

  const regex = new RegExp(source);
  globCache.set(pattern, regex);
  return regex;
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}
