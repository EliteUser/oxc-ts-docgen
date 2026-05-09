import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { DocgenDebugRecord } from "../../src/index";

import { generateDocs, generateDocsFromSource } from "../../src/index";

describe("experimental debug records", () => {
  it("explains static resolution and schema dependency records without schema metadata", () => {
    const records: DocgenDebugRecord[] = [];
    const result = generateDocsFromSource({
      source: "interface ButtonProps { label: string }\n",
      typeName: "ButtonProps",
      fileName: "button.ts",
      config: { experimentalDebug: (record) => records.push(record) },
    });

    expect(records).toContainEqual({
      kind: "resolution",
      typeName: "ButtonProps",
      filePath: "button.ts",
      analysis: "hybrid",
      staticStatus: "resolved",
      usedSemanticFallback: false,
      entryKind: "interface",
    });
    expect(records).toContainEqual({
      kind: "schemaDependency",
      dependency: { kind: "schemaOwner", filePath: "button.ts" },
    });
    expect(result.entries[0].name).toBe("ButtonProps");
    expect(JSON.stringify(result)).not.toContain("schemaDependency");
  });

  it("explains resolved schema dependency records for barrel references", () => {
    const records: DocgenDebugRecord[] = [];
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-debug-resolved-deps-"));
    const tokenFile = join(root, "tokens.ts");
    const barrelFile = join(root, "index.ts");
    const buttonFile = join(root, "button.ts");
    mkdirSync(root, { recursive: true });
    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary'\n");
    writeFileSync(barrelFile, "export type { TokenName } from './tokens'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { TokenName } from './index'",
        "export interface ButtonProps { token?: TokenName }",
      ].join("\n"),
    );

    generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: { experimentalDebug: (record) => records.push(record) },
    });

    expect(records).toContainEqual({
      kind: "schemaDependency",
      dependency: {
        kind: "resolverTrace",
        filePath: barrelFile.replace(/\\/g, "/"),
        entryName: "ButtonProps",
        referencedName: "TokenName",
        targetName: "TokenName",
      },
    });
    expect(records).toContainEqual({
      kind: "schemaDependency",
      dependency: {
        kind: "resolverTrace",
        filePath: tokenFile.replace(/\\/g, "/"),
        entryName: "ButtonProps",
        referencedName: "TokenName",
        targetName: "TokenName",
      },
    });
  });

  it("explains semantic fallback replacement decisions", () => {
    const records: DocgenDebugRecord[] = [];
    const result = generateDocsFromSource({
      source: [
        "declare function createButtonProps(): {",
        "  label: string",
        "}",
        "type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
      typeName: "ButtonProps",
      fileName: "semantic.ts",
      config: { experimentalDebug: (record) => records.push(record) },
    });

    expect(records).toContainEqual({
      kind: "resolution",
      typeName: "ButtonProps",
      filePath: "semantic.ts",
      analysis: "hybrid",
      staticStatus: "semanticFallbackRequired",
      usedSemanticFallback: true,
      entryKind: "typeAlias",
    });
    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
    expect(JSON.stringify(result)).not.toContain("resolution");
  });

  it("explains filtered external properties", () => {
    const records: DocgenDebugRecord[] = [];
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-debug-filter-"));
    const baseFile = join(root, "base.ts");
    const buttonFile = join(root, "button.ts");
    mkdirSync(root, { recursive: true });

    writeFileSync(baseFile, "export interface BaseProps { base: string }\n");
    writeFileSync(
      buttonFile,
      [
        "import type { BaseProps } from './base'",
        "export interface ButtonProps extends BaseProps {",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config: {
        skipPropsFromExternalFiles: true,
        experimentalDebug: (record) => records.push(record),
      },
    });

    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
    expect(records).toContainEqual({
      kind: "propertyFiltered",
      reason: "skipPropsFromExternalFiles",
      propertyName: "base",
      ownerName: "ButtonProps",
      ownerKind: "interface",
      sourceFile: baseFile.replace(/\\/g, "/"),
      rootFile: buttonFile.replace(/\\/g, "/"),
      inherited: true,
      external: true,
    });
    expect(JSON.stringify(result)).not.toContain("propertyFiltered");
  });

  it("explains semantic external type filtering", () => {
    const records: DocgenDebugRecord[] = [];
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-debug-semantic-external-"));
    const packageRoot = join(root, "node_modules", "external-lib");
    const externalFile = join(packageRoot, "index.d.ts");
    const propsFile = join(root, "props.ts");

    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "external-lib", types: "index.d.ts" }),
    );
    writeFileSync(
      externalFile,
      [
        "export interface ExternalProps {",
        "  /** External label from a dependency. */",
        "  externalLabel: string",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      propsFile,
      [
        "import type { ExternalProps } from 'external-lib'",
        "type ExternalFor<T extends true> = T extends true ? ExternalProps : never",
        "export type ButtonProps = {",
        "  /** Local label. */",
        "  label: string",
        "} & ExternalFor<true>",
      ].join("\n"),
    );

    const result = generateDocs({
      filePath: propsFile,
      typeName: "ButtonProps",
      config: {
        experimentalDebug: (record) => records.push(record),
      },
    });

    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
    expect(records).toContainEqual({
      kind: "propertyFiltered",
      reason: "externalTypes",
      propertyName: "externalLabel",
      ownerName: "ButtonProps",
      ownerKind: "typeAlias",
      sourceFile: externalFile.replace(/\\/g, "/"),
      rootFile: propsFile.replace(/\\/g, "/"),
      inherited: false,
      external: true,
    });
    expect(JSON.stringify(result)).not.toContain("propertyFiltered");
  });
});
