import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(__dirname, "..", "..", "..", "..");
const docgenSrcDir = resolve(rootDir, "packages", "docgen", "src");
const vitePluginSrcDir = resolve(rootDir, "packages", "vite-plugin", "src");
const docgenPackageJson = resolve(rootDir, "packages", "docgen", "package.json");
const vitestConfig = resolve(rootDir, "vitest.config.ts");

describe("architecture contracts", () => {
  it("keeps TypeScript checker APIs behind semantic modules", () => {
    const offenders = sourceFiles([docgenSrcDir, vitePluginSrcDir]).filter((filePath) => {
      const source = readFileSync(filePath, "utf-8");
      return importsModule(source, "typescript") || source.includes('require("typescript")');
    });

    expect(toRepoPaths(offenders)).toEqual([
      "packages/docgen/src/semantic/semantic-doc-type-builder.ts",
      "packages/docgen/src/semantic/semantic-jsdoc.ts",
      "packages/docgen/src/semantic/semantic-property-builder.ts",
      "packages/docgen/src/semantic/semantic-property-resolver.ts",
      "packages/docgen/src/semantic/semantic-service.ts",
      "packages/docgen/src/semantic/semantic-source.ts",
      "packages/docgen/src/semantic/semantic-type-annotation.ts",
    ]);
  });

  it("keeps Vite APIs out of core docgen", () => {
    const offenders = sourceFiles([docgenSrcDir]).filter((filePath) => {
      const source = readFileSync(filePath, "utf-8");
      return importsModule(source, "vite");
    });

    expect(toRepoPaths(offenders)).toEqual([]);
  });

  it("keeps the Vite transform syntax-only", () => {
    const source = readFileSync(resolve(vitePluginSrcDir, "transform", "transform.ts"), "utf-8");

    expect(source).toContain("oxc-parser");
    expect(importsModule(source, "typescript")).toBe(false);
    expect(source).not.toContain("TypeScriptSemanticService");
    expect(source).not.toContain("SemanticPropertyResolver");
  });

  it("keeps public package roots limited to documented exports", () => {
    const docgenRoot = readFileSync(resolve(docgenSrcDir, "index.ts"), "utf-8");
    const viteRoot = readFileSync(resolve(vitePluginSrcDir, "index.ts"), "utf-8");

    expect(docgenRoot).not.toContain("./internal");
    expect(docgenRoot).toContain("Plugin-facing API for official bundler adapters.");
    expect(docgenRoot).toContain("DocgenProject");
    expect(docgenRoot).not.toContain("TypeResolver");
    expect(docgenRoot).not.toContain("DependencyGraph");
    expect(docgenRoot).not.toContain("ProjectSchemaCache");
    expect(docgenRoot).not.toContain("ProjectTypeIndex");
    expect(viteRoot).not.toContain("@synthfall/oxc-ts-docgen/internal");
    expect(viteRoot).not.toContain("TypeRegistry");
  });

  it("does not import the removed docgen internal package subpath", () => {
    const sourceOffenders = sourceFiles([docgenSrcDir, vitePluginSrcDir])
      .filter((filePath) =>
        readFileSync(filePath, "utf-8").includes("@synthfall/oxc-ts-docgen/internal"),
      )
      .map((filePath) => relative(rootDir, filePath).replace(/\\/g, "/"));
    const configOffenders = [vitestConfig]
      .filter((filePath) =>
        readFileSync(filePath, "utf-8").includes("@synthfall/oxc-ts-docgen/internal"),
      )
      .map((filePath) => relative(rootDir, filePath).replace(/\\/g, "/"));
    const offenders = [...sourceOffenders, ...configOffenders].sort();

    expect(offenders).toEqual([]);
  });

  it("does not publish removed docgen package subpaths", () => {
    const packageJsonSource = readFileSync(docgenPackageJson, "utf-8");

    expect(packageJsonSource).not.toContain('"./internal"');
    expect(packageJsonSource).not.toContain('"./format"');
    expect(packageJsonSource).not.toContain('"browser"');
  });
});

function sourceFiles(dirs: string[]): string[] {
  return dirs.flatMap((dir) => walkFiles(dir)).sort();
}

function walkFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = resolve(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      result.push(...walkFiles(filePath));
    } else if (filePath.endsWith(".ts")) {
      result.push(filePath);
    }
  }
  return result;
}

function importsModule(source: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']${escaped}["']`,
  ).test(source);
}

function toRepoPaths(filePaths: string[]): string[] {
  return filePaths.map((filePath) => relative(rootDir, filePath).replace(/\\/g, "/")).sort();
}
