import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { generateDocs, resolveConfig } from "../../src/index";
import { TypeResolver } from "../../src/resolver/resolver";

const fixturesDir = resolve(__dirname, "..", "fixtures", "cross-file");
const representativeFixturesDir = resolve(__dirname, "..", "fixtures", "representative");

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
    expect(result.entries[0].heritage).toEqual([
      {
        name: "BaseProps",
        reason: "ignored",
        source: {
          filePath: resolve(fixturesDir, "button.ts").replace(/\\/g, "/"),
          line: 7,
          column: 37,
        },
        target: {
          name: "BaseProps",
          filePath: resolve(fixturesDir, "types.ts").replace(/\\/g, "/"),
        },
      },
    ]);
  });

  it("type references from imports are preserved", () => {
    const result = generateDocs({
      filePath: resolve(fixturesDir, "button.ts"),
      typeName: "ButtonProps",
    });

    const size = result.entries[0].properties.find((p) => p.name === "size")!;
    expect(size.type).toEqual({
      kind: "reference",
      name: "ButtonSize",
      target: {
        name: "ButtonSize",
        filePath: resolve(fixturesDir, "types.ts").replace(/\\/g, "/"),
      },
    });
  });

  it("clears module resolution diagnostics after importer recovery", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-module-diagnostics-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const publicFile = resolve(srcDir, "public.ts");
    writeFileSync(publicFile, "import type { BaseProps } from './base'\n");

    const resolver = new TypeResolver(resolveConfig());
    const missing = resolver.resolveImportPath("./base", publicFile);

    expect(missing).toBeUndefined();
    expect(resolver.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "module-resolution-failed",
        importer: publicFile.replace(/\\/g, "/"),
        specifier: "./base",
      }),
    ]);

    writeFileSync(baseFile, "export interface BaseProps { id: string }\n");
    resolver.invalidateFile(publicFile);

    const recovered = resolver.resolveImportPath("./base", publicFile);
    const remainingResolutionDiagnostics = resolver
      .getDiagnostics()
      .filter((diagnostic) => diagnostic.code === "module-resolution-failed");

    expect(recovered).toBe(baseFile.replace(/\\/g, "/"));
    expect(remainingResolutionDiagnostics).toEqual([]);
  });

  it("resolves related entries from inherited property source files", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-related-source-context-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const tokenFile = resolve(srcDir, "tokens.ts");
    const baseFile = resolve(srcDir, "base.ts");
    const publicFile = resolve(srcDir, "public.ts");
    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary'\n");
    writeFileSync(
      baseFile,
      [
        "import type { TokenName } from './tokens'",
        "export interface BaseProps {",
        "  /** Token selected by inherited props. */",
        "  token?: TokenName",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { BaseProps } from './base'",
        "export interface PublicProps extends BaseProps {",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: publicFile, typeName: "PublicProps" });
    const token = result.entries[0].properties.find((property) => property.name === "token");

    expect(token?.type).toMatchObject({
      kind: "reference",
      name: "TokenName",
      target: {
        name: "TokenName",
        filePath: tokenFile.replace(/\\/g, "/"),
      },
    });
    expect(result.related?.map((entry) => entry.name)).toEqual(["TokenName"]);
  });

  it("covers representative component props through barrels, aliases, callbacks, enums, tokens, and related links", () => {
    const result = generateDocs({
      filePath: resolve(representativeFixturesDir, "component.ts"),
      typeName: "LinkProps",
    });

    const entry = result.entries[0];
    expect(entry.name).toBe("LinkProps");
    expect(entry.properties.map((property) => property.name)).toEqual([
      "href",
      "target",
      "rel",
      "tone",
      "token",
      "tokens",
      "onSave",
    ]);

    const relatedNames = new Set(result.related?.map((related) => related.name));
    expect(relatedNames).toEqual(
      new Set(["ControlTone", "DesignTokens", "SaveHandler", "TokenScale"]),
    );

    const tone = entry.properties.find((property) => property.name === "tone");
    expect(tone?.type).toMatchObject({
      kind: "reference",
      name: "ControlTone",
      target: {
        name: "ControlTone",
        filePath: resolve(representativeFixturesDir, "controls.ts").replace(/\\/g, "/"),
      },
    });

    const token = entry.properties.find((property) => property.name === "token");
    expect(token?.type).toMatchObject({
      kind: "reference",
      name: "PublicTokenScale",
      target: {
        name: "TokenScale",
        filePath: resolve(representativeFixturesDir, "tokens.ts").replace(/\\/g, "/"),
      },
    });

    const enumEntry = result.related?.find((related) => related.name === "ControlTone");
    expect(enumEntry?.properties.map((property) => [property.name, property.type])).toEqual([
      ["Neutral", { kind: "literal", value: "0" }],
      ["Accent", { kind: "literal", value: "4" }],
      ["Danger", { kind: "literal", value: "'danger'" }],
      ["Computed", { kind: "literal", value: "3" }],
    ]);

    const callbackEntry = result.related?.find((related) => related.name === "SaveHandler");
    expect(callbackEntry?.type.kind).toBe("function");
    if (callbackEntry?.type.kind === "function") {
      expect(callbackEntry.type.parameters.map((parameter) => parameter.name)).toEqual([
        "event",
        "changes",
      ]);
      expect(callbackEntry.type.parameters[0].type.kind).toBe("object");
      expect(callbackEntry.type.parameters[1].rest).toBe(true);
      expect(callbackEntry.type.parameters[1].type.kind).toBe("array");
    }
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

  it("accepts POSIX-style and Windows-style file paths on Windows", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-path-formats-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");

    const posixPath = buttonFile.replace(/\\/g, "/");
    expect(generateDocs({ filePath: posixPath, typeName: "ButtonProps" }).entries[0].name).toBe(
      "ButtonProps",
    );

    if (process.platform === "win32") {
      const windowsPath = posixPath.replace(/\//g, "\\");
      expect(generateDocs({ filePath: windowsPath, typeName: "ButtonProps" }).entries[0].name).toBe(
        "ButtonProps",
      );
    }
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

  it("resolves default type imports from default-exported declarations", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-default-import-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "export default interface BaseProps { id?: string }\n");
    writeFileSync(
      buttonFile,
      [
        "import type BaseProps from './base'",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["id", "label"]);
  });

  it("resolves aliased default type re-exports from barrel files", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-default-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "export default interface BaseProps { id?: string }\n");
    writeFileSync(barrelFile, "export { default as PublicBaseProps } from './base'\n");
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

  it("resolves default imports from default re-exported named types", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-named-default-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "export interface BaseProps { id?: string }\n");
    writeFileSync(barrelFile, "export { BaseProps as default } from './base'\n");
    writeFileSync(
      buttonFile,
      [
        "import type BaseProps from './index'",
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

  it("does not expose private declarations through star re-exports", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-private-star-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(barrelFile, "export * from './base'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { PrivateProps } from './index'",
        "export interface ButtonProps extends PrivateProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("does not resolve explicit re-exports of private declarations", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-private-explicit-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(barrelFile, "export type { PrivateProps } from './base'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { PrivateProps } from './index'",
        "export interface ButtonProps extends PrivateProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
  });

  it("keeps same-named related declarations from different files", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-related-same-name-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const firstFile = resolve(srcDir, "first.ts");
    const secondFile = resolve(srcDir, "second.ts");
    const buttonFile = resolve(srcDir, "button.ts");

    writeFileSync(firstFile, "export interface Options { first: string }\n");
    writeFileSync(secondFile, "export interface Options { second: number }\n");
    writeFileSync(
      buttonFile,
      [
        "import type { Options as FirstOptions } from './first'",
        "import type { Options as SecondOptions } from './second'",
        "export interface ButtonProps {",
        "  first: FirstOptions",
        "  second: SecondOptions",
        "}",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(
      result.related?.map((entry) => [entry.name, entry.source.filePath.replace(/\\/g, "/")]),
    ).toEqual([
      ["Options", firstFile.replace(/\\/g, "/")],
      ["Options", secondFile.replace(/\\/g, "/")],
    ]);
    expect(result.entries[0].properties.map((prop) => prop.type)).toEqual([
      {
        kind: "reference",
        name: "FirstOptions",
        target: { name: "Options", filePath: firstFile.replace(/\\/g, "/") },
      },
      {
        kind: "reference",
        name: "SecondOptions",
        target: { name: "Options", filePath: secondFile.replace(/\\/g, "/") },
      },
    ]);
  });

  it("does not resolve imported declarations that are not exported by the target module", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-private-import-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(baseFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(
      buttonFile,
      [
        "import type { PrivateProps } from './base'",
        "export interface ButtonProps extends PrivateProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
  });

  it("resolves local export lists without exposing private declarations", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-local-export-list-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(
      baseFile,
      [
        "interface BaseProps { id?: string }",
        "interface PrivateProps { secret: string }",
        "export { BaseProps }",
      ].join("\n"),
    );
    writeFileSync(
      buttonFile,
      [
        "import type { BaseProps, PrivateProps } from './base'",
        "export interface ButtonProps extends BaseProps, PrivateProps { label: string }",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });
    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["id", "label"]);
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
    expect(result.entries[0].heritage).toEqual([
      {
        name: "ExternalProps",
        reason: "externalReference",
        source: {
          filePath: buttonFile.replace(/\\/g, "/"),
          line: 2,
          column: 37,
        },
        target: {
          name: "ExternalProps",
          filePath: resolve(pkgDir, "index.d.ts").replace(/\\/g, "/"),
        },
      },
    ]);
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
    expect(result.entries[0].heritage?.[0]).toMatchObject({
      name: "ExternalProps",
      reason: "ignored",
      target: {
        name: "ExternalProps",
        filePath: resolve(pkgDir, "index.d.ts").replace(/\\/g, "/"),
      },
    });
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
    expect(result.entries[0].heritage).toBeUndefined();
  });

  it("preserves unresolved heritage references instead of treating them as successful empties", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-unresolved-heritage-"));
    const buttonFile = resolve(root, "button.ts");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      buttonFile,
      "export interface ButtonProps extends MissingProps { label: string }\n",
    );

    const result = generateDocs({ filePath: buttonFile, typeName: "ButtonProps" });

    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
    expect(result.entries[0].heritage).toEqual([
      {
        name: "MissingProps",
        reason: "unresolved",
        source: {
          filePath: buttonFile.replace(/\\/g, "/"),
          line: 1,
          column: 37,
        },
      },
    ]);
  });

  it("preserves ignored qualified heritage references", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-qualified-heritage-"));
    const linkFile = resolve(root, "link.tsx");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      linkFile,
      [
        "export interface LinkProps extends React.HTMLAttributes<HTMLAnchorElement> {",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const result = generateDocs({ filePath: linkFile, typeName: "LinkProps" });

    expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
    expect(result.entries[0].heritage).toEqual([
      {
        name: "React.HTMLAttributes",
        reason: "ignored",
        source: {
          filePath: linkFile.replace(/\\/g, "/"),
          line: 1,
          column: 35,
        },
      },
    ]);
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

  it("resolves cross-file named aliases that wrap supported utility types", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-utility-alias-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const baseFile = resolve(srcDir, "base.ts");
    const buttonFile = resolve(srcDir, "button.ts");
    writeFileSync(
      baseFile,
      [
        "export interface BaseButtonProps {",
        "  /** Visible label. */",
        "  label?: string",
        "  /** Disabled state. */",
        "  disabled?: boolean",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      buttonFile,
      [
        "import type { BaseButtonProps } from './base'",
        "export type ButtonProps = Required<BaseButtonProps>",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
    });

    expect(result.entries[0].properties.map((property) => property.name)).toEqual([
      "label",
      "disabled",
    ]);
    expect(result.entries[0].properties.map((property) => property.optional)).toEqual([
      false,
      false,
    ]);
    expect(result.entries[0].properties[0].source.filePath).toBe(baseFile.replace(/\\/g, "/"));
  });

  it("resolves object-like union aliases with cross-file object members", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-barrel-union-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const sharedFile = resolve(srcDir, "shared.ts");
    const componentFile = resolve(srcDir, "component.ts");
    writeFileSync(
      sharedFile,
      [
        "import type { CSSProperties } from 'react'",
        "export type DOMProps = {",
        "  /** HTML style attribute. */",
        "  style?: CSSProperties",
        "  /** HTML class attribute. */",
        "  className?: string",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      componentFile,
      [
        "import type { PropsWithChildren } from 'react'",
        "import type { DOMProps } from './shared'",
        "type DisplayVariant = 'primary' | 'secondary'",
        "type BaseUnionProps = DOMProps & PropsWithChildren & {",
        "  /** Display variant. */",
        "  variant?: DisplayVariant",
        "}",
        "type SingleValueProps = BaseUnionProps & {",
        "  /**",
        "   * Single-value mode.",
        "   *",
        "   * @default false",
        "   */",
        "  multiple?: false",
        "  /** Controlled value. */",
        "  value?: string | null",
        "  /** Initial value. */",
        "  defaultValue?: string",
        "  /** Change handler. */",
        "  onChange?: (value: string | null) => void",
        "}",
        "type MultipleValueProps = BaseUnionProps & {",
        "  multiple: true",
        "  value?: string[]",
        "  defaultValue?: string[]",
        "  onChange?: (value: string[]) => void",
        "}",
        "export type UnionComponentProps = SingleValueProps | MultipleValueProps",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: componentFile,
      typeName: "UnionComponentProps",
    });

    const entry = result.entries[0];
    const propertyNames = entry.properties.map((property) => property.name);
    expect(new Set(propertyNames)).toEqual(
      new Set(["className", "style", "variant", "multiple", "value", "defaultValue", "onChange"]),
    );
    expect(propertyNames).not.toContain("children");
    expect(propertyNames).not.toContain("__unresolved");
    expect(entry.type.kind).toBe("union");
    expect(entry.properties.find((property) => property.name === "multiple")?.defaultValue).toBe(
      "false",
    );
    expect(entry.source.filePath.replace(/\\/g, "/")).toBe(componentFile.replace(/\\/g, "/"));
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
