import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DocgenProject, resolveConfig } from "../../src/index";
import { ProjectSchemaCache } from "../../src/project/project-schema-cache";
import { ProjectTypeIndex } from "../../src/project/project-type-index";
import { TypeResolver } from "../../src/resolver/resolver";

describe("ProjectSchemaCache", () => {
  it("builds schemas lazily without Vite registry hooks", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-schema-cache-lazy-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "export type TokenName = 'primary' | 'secondary'",
        "export interface ButtonProps {",
        "  token: TokenName",
        "}",
      ].join("\n"),
    );

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "cache",
      buildMode: "indexOnly",
    });
    const cache = new ProjectSchemaCache({ config, resolver });
    const entries = index.initialize(root);

    expect(cache.registerAll(entries)).toEqual([]);
    expect(cache.getBuiltEntryCount()).toBe(0);

    const key = index.getTypeKey({ filePath: typesFile, typeName: "ButtonProps" });
    const firstResult = cache.ensureSchema(key);

    expect(firstResult?.schema?.entries[0].name).toBe("ButtonProps");
    expect(firstResult?.schema?.related?.map((entry) => entry.name)).toEqual(["TokenName"]);
    expect(firstResult?.resolution?.fallbackReason).toBe("staticResolved");
    expect(firstResult?.dependencyRecords.map((record) => record.kind)).toEqual(
      expect.arrayContaining(["schemaOwner", "entrySource", "relatedEntrySource"]),
    );
    expect(firstResult?.rebuilt).toBe(true);
    expect(cache.getBuiltEntryCount()).toBe(1);

    const secondResult = cache.ensureSchema(key);

    expect(secondResult?.schema).toBe(firstResult?.schema);
    expect(secondResult?.dependencyRecords).toBe(firstResult?.dependencyRecords);
    expect(secondResult?.rebuilt).toBe(false);
  });

  it("eagerly builds startup entries from project index policy", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-schema-cache-eager-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "export type TokenName = 'primary' | 'secondary'",
        "export interface PublicProps { token: TokenName }",
        "interface InternalProps { value: string }",
      ].join("\n"),
    );

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "cache",
      buildMode: "eagerPublic",
    });
    const cache = new ProjectSchemaCache({ config, resolver });
    const buildResults = cache.registerAll(index.initialize(root));

    expect(buildResults.map((result) => result.entry?.name)).toEqual(["TokenName", "PublicProps"]);
    expect(buildResults[1]?.schema?.related?.map((entry) => entry.name)).toEqual(["TokenName"]);
    expect(cache.getBuiltEntryCount()).toBe(2);

    const internalKey = index.getTypeKey({ filePath: typesFile, typeName: "InternalProps" });

    expect(cache.ensureEntry(internalKey)?.entry?.name).toBe("InternalProps");
    expect(cache.getBuiltEntryCount()).toBe(3);
  });

  it("rebuilds cached schemas with the shared resolver after invalidation", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-schema-cache-rebuild-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "cache",
      buildMode: "indexOnly",
    });
    const cache = new ProjectSchemaCache({ config, resolver });

    cache.registerAll(index.initialize(root));

    const key = index.getTypeKey({ filePath: typesFile, typeName: "ButtonProps" });
    expect(cache.ensureSchema(key)?.schema?.entries[0].properties.map((prop) => prop.name)).toEqual(
      ["label"],
    );

    writeFileSync(typesFile, "export interface ButtonProps { label: string; disabled: boolean }\n");
    resolver.invalidateFile(typesFile);

    expect(cache.rebuildEntry(key)?.schema?.entries[0].properties.map((prop) => prop.name)).toEqual(
      ["label", "disabled"],
    );
  });

  it("clears stale schema state when a cached source can no longer be parsed", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-schema-cache-missing-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "cache",
      buildMode: "indexOnly",
    });
    const cache = new ProjectSchemaCache({ config, resolver });

    cache.registerAll(index.initialize(root));

    const key = index.getTypeKey({ filePath: typesFile, typeName: "ButtonProps" });
    expect(cache.ensureSchema(key)?.schema?.entries[0].name).toBe("ButtonProps");

    unlinkSync(typesFile);
    resolver.invalidateFile(typesFile);

    const result = cache.rebuildEntry(key);

    expect(result?.rebuilt).toBe(true);
    expect(result?.schema).toBeUndefined();
    expect(cache.get(key)?.schema).toBeUndefined();
  });

  it("clears stale facade cache entries when a processed file changes type names", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-stale-cache-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(typesFile, "export interface OldProps { label: string }\n");

    const config = resolveConfig();
    const project = new DocgenProject({
      config,
      configHash: "cache",
      buildMode: "indexOnly",
    });

    project.initialize(root);

    const oldKey = project.getTypeKey({ filePath: typesFile, typeName: "OldProps" });
    expect(project.ensureSchema(oldKey)?.schema?.entries[0].name).toBe("OldProps");

    writeFileSync(typesFile, "export interface NewProps { label: string }\n");
    project.invalidateFile(typesFile);
    project.processFile(typesFile);

    const newKey = project.getTypeKey({ filePath: typesFile, typeName: "NewProps" });

    expect(project.hasCacheEntry(oldKey)).toBe(false);
    expect(project.ensureSchema(oldKey)).toBeUndefined();
    expect(project.ensureSchema(newKey)?.schema?.entries[0].name).toBe("NewProps");
  });
});
