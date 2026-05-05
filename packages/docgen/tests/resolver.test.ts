import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { generateDocs } from "../src/index";

const fixturesDir = resolve(__dirname, "fixtures", "cross-file");

describe("generateDocs (file-based with resolution)", () => {
  it("resolves ButtonProps from file with extends", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
    });

    expect(result.version).toBe(1);
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0];
    expect(entry.name).toBe("ButtonProps");
    expect(entry.kind).toBe("interface");
    expect(entry.description).toBe("Button component props.");

    const propNames = entry.properties.map((p) => p.name);
    expect(propNames).toContain("size");
    expect(propNames).toContain("variant");
    expect(propNames).toContain("disabled");
    expect(propNames).toContain("id");
    expect(propNames).toContain("className");
  });

  it("inherited props come before own props", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
    });

    const propNames = result.entries[0].properties.map((p) => p.name);
    const idIndex = propNames.indexOf("id");
    const sizeIndex = propNames.indexOf("size");
    expect(idIndex).toBeLessThan(sizeIndex);
  });

  it("inherited props have correct JSDoc from parent file", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
    });

    const id = result.entries[0].properties.find((p) => p.name === "id")!;
    expect(id.description).toBe("Unique identifier.");
    expect(id.optional).toBe(true);
  });

  it("resolves multi-level inheritance (IconButton -> Button -> Base)", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "icon-button.ts"),
      typeName: "IconButtonProps",
    });

    const propNames = result.entries[0].properties.map((p) => p.name);
    expect(propNames).toContain("icon");
    expect(propNames).toContain("iconOnly");
    expect(propNames).toContain("size");
    expect(propNames).toContain("variant");
    expect(propNames).toContain("id");
    expect(propNames).toContain("className");
  });

  it("respects ignoreTypes configuration", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
      config: {
        ignoreTypes: ["BaseProps"],
      },
    });

    const propNames = result.entries[0].properties.map((p) => p.name);
    expect(propNames).toContain("size");
    expect(propNames).not.toContain("id");
    expect(propNames).not.toContain("className");
  });

  it("type references from imports are preserved", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
    });

    const size = result.entries[0].properties.find((p) => p.name === "size")!;
    expect(size.type).toEqual({ kind: "reference", name: "ButtonSize" });
  });

  it("resolves imports through tsconfig baseUrl", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-baseurl-"));
    const sharedDir = resolve(root, "src", "shared");
    mkdirSync(sharedDir, { recursive: true });

    const baseFile = resolve(sharedDir, "base.ts");
    const buttonFile = resolve(root, "src", "button.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    );
    writeFileSync(baseFile, "export interface BaseProps { id?: string }\n");
    writeFileSync(
      buttonFile,
      [
        "import type { BaseProps } from 'src/shared/base'",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["id", "label"]);
  });

  it("resolves imports through tsconfig paths aliases", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-paths-"));
    const sharedDir = resolve(root, "src", "shared");
    mkdirSync(sharedDir, { recursive: true });

    const baseFile = resolve(sharedDir, "base.ts");
    const buttonFile = resolve(root, "src", "button.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@shared/*": ["src/shared/*"],
          },
        },
      }),
    );
    writeFileSync(baseFile, "export interface BaseProps { id?: string }\n");
    writeFileSync(
      buttonFile,
      [
        "import type { BaseProps } from '@shared/base'",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["id", "label"]);
  });

  it("resolves explicit type re-exports from barrel files", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "export interface BaseProps { id?: string }\n");
    writeFileSync(barrelFile, "export type { BaseProps } from './base'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { BaseProps } from './index'",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["id", "label"]);
  });

  it("resolves aliased and star type re-exports from barrel files", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-star-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const nestedFile = resolve(srcDir, "nested.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "export interface BaseProps { id?: string }\n");
    writeFileSync(nestedFile, "export type { BaseProps as PublicBaseProps } from './base'\n");
    writeFileSync(barrelFile, "export * from './nested'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { PublicBaseProps } from './index'",
        "export interface ButtonProps extends PublicBaseProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["id", "label"]);
  });

  it("preserves external imports as references by default", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-external-reference-"));
    const pkgDir = resolve(root, "node_modules", "external-lib");
    mkdirSync(pkgDir, { recursive: true });

    const buttonFile = resolve(root, "src", "button.ts");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(resolve(pkgDir, "package.json"), JSON.stringify({ types: "index.d.ts" }));
    writeFileSync(
      resolve(pkgDir, "index.d.ts"),
      "export interface ExternalProps { external: string }\n",
    );
    writeFileSync(
      buttonFile,
      [
        "import type { ExternalProps } from 'external-lib'",
        "export interface ButtonProps extends ExternalProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("ignores external expansion attempts when externalTypes is ignore", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-external-ignore-"));
    const pkgDir = resolve(root, "node_modules", "external-lib");
    mkdirSync(pkgDir, { recursive: true });

    const buttonFile = resolve(root, "src", "button.ts");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(resolve(pkgDir, "package.json"), JSON.stringify({ types: "index.d.ts" }));
    writeFileSync(
      resolve(pkgDir, "index.d.ts"),
      "export interface ExternalProps { external: string }\n",
    );
    writeFileSync(
      buttonFile,
      [
        "import type { ExternalProps } from 'external-lib'",
        "export interface ButtonProps extends ExternalProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: { externalTypes: "ignore" },
    });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("can resolve external imports when externalTypes is resolve", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-external-resolve-"));
    const pkgDir = resolve(root, "node_modules", "external-lib");
    mkdirSync(pkgDir, { recursive: true });

    const buttonFile = resolve(root, "src", "button.ts");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(resolve(pkgDir, "package.json"), JSON.stringify({ types: "index.d.ts" }));
    writeFileSync(
      resolve(pkgDir, "index.d.ts"),
      "export interface ExternalProps { external: string }\n",
    );
    writeFileSync(
      buttonFile,
      [
        "import type { ExternalProps } from 'external-lib'",
        "export interface ButtonProps extends ExternalProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: { externalTypes: "resolve" },
    });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["external", "label"]);
  });

  it("preserves external re-exports as references by default", () => {
    const buttonFile = writeExternalBarrelFixture("oxc-docgen-external-barrel-reference-");

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("ignores external re-export expansion attempts when externalTypes is ignore", () => {
    const buttonFile = writeExternalBarrelFixture("oxc-docgen-external-barrel-ignore-");

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: { externalTypes: "ignore" },
    });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("can resolve external re-exports when externalTypes is resolve", () => {
    const buttonFile = writeExternalBarrelFixture("oxc-docgen-external-barrel-resolve-");

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: { externalTypes: "resolve" },
    });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["external", "label"]);
  });
});

function writeExternalBarrelFixture(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  const pkgDir = resolve(root, "node_modules", "external-lib");
  const srcDir = resolve(root, "src");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });

  const barrelFile = resolve(srcDir, "external.ts");
  const buttonFile = resolve(srcDir, "button.ts");
  writeFileSync(resolve(pkgDir, "package.json"), JSON.stringify({ types: "index.d.ts" }));
  writeFileSync(
    resolve(pkgDir, "index.d.ts"),
    "export interface ExternalProps { external: string }\n",
  );
  writeFileSync(barrelFile, "export type { ExternalProps } from 'external-lib'\n");
  writeFileSync(
    buttonFile,
    [
      "import type { ExternalProps } from './external'",
      "export interface ButtonProps extends ExternalProps { label: string }",
    ].join("\n"),
  );

  return buttonFile;
}
