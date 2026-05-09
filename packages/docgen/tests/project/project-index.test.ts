import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ProjectTypeIndexEntry } from "../../src/project/project-type-index";

import { resolveConfig } from "../../src/index";
import { ProjectTypeIndex } from "../../src/project/project-type-index";
import { scanProjectFiles } from "../../src/resolver/project-file-scanner";
import { TypeResolver } from "../../src/resolver/resolver";

const normalize = (path: string): string => {
  return path.replace(/\\/g, "/");
};

describe("ProjectTypeIndex", () => {
  it("scans project files and creates stable declaration keys", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-index-"));
    const srcDir = join(root, "src");
    const testDir = join(root, "tests");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const buttonFile = join(srcDir, "button.ts");
    const linkFile = join(srcDir, "link.tsx");
    const excludedFile = join(testDir, "fixture.ts");

    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(linkFile, "export type LinkProps = { href: string }\n");
    writeFileSync(excludedFile, "export interface FixtureProps { value: string }\n");

    const config = resolveConfig({ include: ["src/**/*.ts", "src/**/*.tsx"] });
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "stable",
      buildMode: "indexOnly",
    });

    const entries = index.initialize(root);

    expect(index.size).toBe(2);
    expect(entries.map((entry) => entry.typeName).sort()).toEqual(["ButtonProps", "LinkProps"]);
    expect(index.getTypeKey({ filePath: buttonFile, typeName: "ButtonProps" })).toBe(
      `stable:${normalize(buttonFile)}:ButtonProps`,
    );
    expect(index.getFileKeys(buttonFile)).toEqual(
      new Set([`stable:${normalize(buttonFile)}:ButtonProps`]),
    );
  });

  it("prunes excluded directories during project scans", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-index-prune-"));
    const srcDir = join(root, "src");
    const distDir = join(root, "dist");
    const nestedDistDir = join(srcDir, "generated");
    const nodeModulesDir = join(root, "node_modules", "pkg");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    mkdirSync(nestedDistDir, { recursive: true });
    mkdirSync(nodeModulesDir, { recursive: true });

    const includedFile = join(srcDir, "button.ts");
    writeFileSync(includedFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(join(distDir, "generated.ts"), "export interface DistProps { label: string }\n");
    writeFileSync(
      join(nestedDistDir, "ignored.ts"),
      "export interface GeneratedProps { label: string }\n",
    );
    writeFileSync(
      join(nodeModulesDir, "ignored.ts"),
      "export interface PackageProps { label: string }\n",
    );

    const config = resolveConfig({
      exclude: ["dist/**", "src/generated/**", "**/node_modules/**"],
    });

    expect(scanProjectFiles(root, config).map(normalize)).toEqual([normalize(includedFile)]);
  });

  it("marks startup entries according to build mode", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-index-startup-"));
    const typesFile = join(root, "types.ts");
    writeFileSync(
      typesFile,
      [
        "export interface PublicProps { label: string }",
        "interface InternalProps { value: string }",
      ].join("\n"),
    );

    const config = resolveConfig();
    const publicResolver = new TypeResolver(config);
    const publicIndex = new ProjectTypeIndex({
      config,
      resolver: publicResolver,
      configHash: "public",
      buildMode: "eagerPublic",
    });
    const allResolver = new TypeResolver(config);
    const allIndex = new ProjectTypeIndex({
      config,
      resolver: allResolver,
      configHash: "all",
      buildMode: "eagerAll",
    });

    expect(startupNames(publicIndex.initialize(root))).toEqual(["PublicProps"]);
    expect(startupNames(allIndex.initialize(root))).toEqual(["InternalProps", "PublicProps"]);
  });

  it("returns stale and current keys when a file is reprocessed", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-index-reprocess-"));
    const typesFile = join(root, "types.ts");
    writeFileSync(typesFile, "export interface OldProps { label: string }\n");

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "changed",
      buildMode: "indexOnly",
    });

    index.initialize(root);
    writeFileSync(typesFile, "export interface NewProps { label: string }\n");
    resolver.invalidateFile(typesFile);

    const result = index.processFile(typesFile);

    expect(result.previousKeys).toEqual(new Set([`changed:${normalize(typesFile)}:OldProps`]));
    expect(result.entries.map((entry) => entry.key)).toEqual([
      `changed:${normalize(typesFile)}:NewProps`,
    ]);
    expect(index.getFileKeys(typesFile)).toEqual(
      new Set([`changed:${normalize(typesFile)}:NewProps`]),
    );
  });

  it("surfaces source parse diagnostics and clears them after recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-project-index-parse-diagnostic-"));
    const typesFile = join(root, "types.ts");
    writeFileSync(typesFile, "export interface BrokenProps { label: string\n");

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const index = new ProjectTypeIndex({
      config,
      resolver,
      configHash: "parse",
      buildMode: "indexOnly",
    });

    const broken = index.initialize(root);

    expect(broken).toEqual([]);
    expect(resolver.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "source-parse-failed",
        filePath: normalize(typesFile),
      }),
    ]);

    writeFileSync(typesFile, "export interface RecoveredProps { label: string }\n");
    resolver.invalidateFile(typesFile);
    const recovered = index.processFile(typesFile);

    expect(recovered.entries.map((entry) => entry.typeName)).toEqual(["RecoveredProps"]);
    expect(
      resolver.getDiagnostics().some((diagnostic) => diagnostic.code === "source-parse-failed"),
    ).toBe(false);
  });
});

const startupNames = (entries: ProjectTypeIndexEntry[]): string[] => {
  return entries
    .filter((entry) => entry.startup)
    .map((entry) => entry.typeName)
    .sort();
};
