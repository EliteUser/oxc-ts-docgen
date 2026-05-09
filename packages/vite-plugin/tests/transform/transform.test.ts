import type { DocEntry, DocgenProjectBuildResult, DocSchema } from "@synthfall/oxc-ts-docgen";

import { resolveConfig } from "@synthfall/oxc-ts-docgen";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { TypeRegistry } from "../../src/registry/type-registry";
import { transformGetDocs } from "../../src/transform/transform";

const fixturesDir = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docgen",
  "tests",
  "fixtures",
  "cross-file",
);
const pluginFixturesDir = resolve(__dirname, "..", "fixtures");

type BuildResultFixtureOptions = {
  /**
   * Cache key to expose through the fake registry build result.
   */
  key: string;
  /**
   * Type name requested by the transform.
   */
  typeName: string;
  /**
   * Source file that owns the requested type.
   */
  sourceFile: string;
};

const createSemanticFallbackUnavailableResult = (
  options: BuildResultFixtureOptions,
): DocgenProjectBuildResult => {
  const { key, typeName, sourceFile } = options;
  const normalizedSourceFile = sourceFile.replace(/\\/g, "/");
  const source = {
    filePath: normalizedSourceFile,
    line: 1,
    column: 0,
  };
  const entry: DocEntry = {
    name: typeName,
    kind: "typeAlias",
    description: "",
    tags: {},
    typeParameters: [],
    properties: [],
    type: { kind: "object", properties: [] },
    source,
  };
  const schema: DocSchema = {
    version: 1,
    entries: [entry],
  };
  const resolution = {
    status: "semanticFallbackRequired",
    entry,
    usedSemanticFallback: false,
    fallbackReason: "semanticFallbackUnavailable",
    diagnostics: [],
  } satisfies DocgenProjectBuildResult["resolution"];

  return {
    key,
    cacheEntry: {
      key,
      filePath: normalizedSourceFile,
      typeName,
      entry,
      schema,
      resolution,
      dependencyRecords: [],
      diagnostics: [],
    },
    entry,
    schema,
    resolution,
    dependencyRecords: [],
    diagnostics: [],
    rebuilt: true,
  };
};

describe("transformGetDocs", () => {
  it("returns null when no getDocs call is present", () => {
    const code = `const x = 1;`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).toBeNull();
  });

  it("returns null when getDocs is not imported from docgen", () => {
    const code = `
      import { getDocs } from './my-lib'
      const docs = getDocs<MyType>()
    `;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).toBeNull();
  });

  it("transforms getDocs call with a local type", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonSize } from '${typesFile.replace(/\\/g, "/")}'

const docs = getDocs<ButtonSize>()
console.log(docs)
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("getDocs");
    expect(result!.deps.length).toBeGreaterThan(0);
  });

  it("transforms getDocs call and produces valid JSON", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const docs = getDocs<BaseProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");

    const jsonMatch = result!.code.match(/JSON\.parse\(("[^"]*(?:\\.[^"]*)*")\)/);
    expect(jsonMatch).not.toBeNull();

    const innerJson = JSON.parse(jsonMatch![1]);
    const parsed = typeof innerJson === "string" ? JSON.parse(innerJson) : innerJson;
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].name).toBe("BaseProps");
    expect(parsed.entries[0].properties.length).toBeGreaterThan(0);
  });

  it("transforms object getDocs options and produces valid JSON", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-object-options-"));
    const typesFile = resolve(root, "button.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const docs = getDocs({ path: './button', symbol: 'ButtonProps' })
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("getDocs");
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].name).toBe("ButtonProps");
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "label",
    ]);
  });

  it("does not compile imported generic getDocs targets that are not exported", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-private-generic-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(typesFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(consumerFile, "");

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { PrivateProps } from './types'

const docs = getDocs<PrivateProps>()
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: {
        registry,
        onUnresolved: (items) => messages.push(...items),
      },
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe(code);
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );
    expect(messages.join("\n")).toContain("target module does not export that type");
    expect(registry.invalidateFile(typesFile).map((file) => file.replace(/\\/g, "/"))).toContain(
      consumerFile.replace(/\\/g, "/"),
    );
  });

  it("tracks re-export traversal files for unresolved generic getDocs recovery", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-private-generic-barrel-"));
    const baseFile = resolve(root, "base.ts");
    const middleFile = resolve(root, "middle.ts");
    const barrelFile = resolve(root, "index.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(baseFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(middleFile, "export * from './base'\n");
    writeFileSync(barrelFile, "export * from './middle'\n");
    writeFileSync(consumerFile, "");

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { PrivateProps } from './index'

const docs = getDocs<PrivateProps>()
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: {
        registry,
        onUnresolved: (items) => messages.push(...items),
      },
    });

    expect(result).not.toBeNull();
    const deps = result!.deps.map((dep) => dep.replace(/\\/g, "/"));
    expect(deps).toEqual(
      expect.arrayContaining([
        barrelFile.replace(/\\/g, "/"),
        middleFile.replace(/\\/g, "/"),
        baseFile.replace(/\\/g, "/"),
      ]),
    );
    expect(messages.join("\n")).toContain("target module does not export that type");
    expect(registry.invalidateFile(baseFile).map((file) => file.replace(/\\/g, "/"))).toContain(
      consumerFile.replace(/\\/g, "/"),
    );
  });

  it("does not compile object getDocs targets that are not exported", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-private-object-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(typesFile, "interface PrivateProps { secret: string }\n");
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const docs = getDocs({ path: './types', symbol: 'PrivateProps' })
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe(code);
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );
    expect(messages.join("\n")).toContain("PrivateProps is not exported by the target module");
    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: {},
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/PrivateProps is not exported by the target module/);
  });

  it("does not return unchanged transforms for object targets with unresolved modules", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-missing-object-module-"));
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const docs = getDocs({ path: './missing', symbol: 'MissingProps' })
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toContain("could not resolve the target module");
  });

  it("surfaces unavailable semantic fallback for registry-backed object targets", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-semantic-unavailable-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.ts");
    const typeName = "BrokenProps";
    writeFileSync(typesFile, "export type BrokenProps = MissingUtility<{ label: string }>\n");
    writeFileSync(consumerFile, "");

    const buildResult = createSemanticFallbackUnavailableResult({
      key: `${typesFile.replace(/\\/g, "/")}:${typeName}`,
      typeName,
      sourceFile: typesFile,
    });
    const registry = {
      getDiagnostics: () => [],
      resolveImportedTypeSource: () => ({
        filePath: typesFile.replace(/\\/g, "/"),
        typeName,
        sourceFiles: [typesFile.replace(/\\/g, "/")],
      }),
      resolveImportPath: () => typesFile.replace(/\\/g, "/"),
      getSchemaBuildResult: () => buildResult,
      registerFileDependency: () => undefined,
      registerConsumer: () => undefined,
    } as unknown as TypeRegistry;
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const docs = getDocs({ path: './types', symbol: 'BrokenProps' })
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: {
        registry,
        onUnresolved: (items) => messages.push(...items),
      },
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe(code);
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );
    expect(messages.join("\n")).toContain("semantic fallback was unavailable");
    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: {},
        options: {
          registry,
          failOnUnresolved: true,
        },
      }),
    ).toThrow(/semantic fallback was unavailable/);
  });

  it("transforms static batch getDocs registries and preserves metadata", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-batch-options-"));
    const buttonFile = resolve(root, "button.ts");
    const linkFile = resolve(root, "link.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(linkFile, "export interface LinkProps { href: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const targets = [
  { id: 'button-props', typeName: 'ButtonProps', path: './button', symbol: 'ButtonProps' },
  { id: 'link-props', typeName: 'LinkProps', path: './link', symbol: 'LinkProps' },
] as const satisfies readonly Array<{
  id: string
  typeName: string
  path: string
  symbol: string
}>

const examples = getDocs(targets)
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("getDocs(targets)");
    const normalizedDeps = result!.deps.map((dep) => dep.replace(/\\/g, "/"));
    expect(normalizedDeps).toContain(buttonFile.replace(/\\/g, "/"));
    expect(normalizedDeps).toContain(linkFile.replace(/\\/g, "/"));

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("button-props");
    expect(parsed[0].typeName).toBe("ButtonProps");
    expect(parsed[0].path).toBeUndefined();
    expect(parsed[0].symbol).toBeUndefined();
    expect(parsed[0].docs.entries[0].name).toBe("ButtonProps");
    expect(parsed[1].docs.entries[0].name).toBe("LinkProps");
  });

  it("does not compile batch getDocs targets that are not exported", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-private-batch-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(
      typesFile,
      [
        "export interface PublicProps { label: string }",
        "interface PrivateProps { secret: string }",
      ].join("\n"),
    );
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const docs = getDocs([
  { id: 'public', path: './types', symbol: 'PublicProps' },
  { id: 'private', path: './types', symbol: 'PrivateProps' },
] as const)
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).not.toBeNull();
    expect(result!.code).toBe(code);
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );
    expect(messages.join("\n")).toContain("PrivateProps is not exported by the target module");
  });

  it("resolves object getDocs options through tsconfig path aliases and barrels", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-object-paths-"));
    const componentsDir = resolve(root, "src", "components");
    mkdirSync(componentsDir, { recursive: true });

    const buttonFile = resolve(componentsDir, "button.ts");
    const barrelFile = resolve(componentsDir, "index.ts");
    const consumerFile = resolve(root, "src", "main.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@components": ["src/components/index.ts"],
          },
        },
      }),
    );
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const schema = getDocs({ path: '@components', symbol: 'PublicButtonProps' })
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      buttonFile.replace(/\\/g, "/"),
    );

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].name).toBe("ButtonProps");
  });

  it("can transform batch getDocs calls into virtual schema module imports", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-batch-virtual-"));
    const buttonFile = resolve(root, "button.ts");
    const linkFile = resolve(root, "link.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(linkFile, "export interface LinkProps { href: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
"use client";
import { getDocs } from '@synthfall/oxc-ts-docgen'

const examples = getDocs([
  { id: 'button-props', path: './button', symbol: 'ButtonProps' },
  { id: 'link-props', path: './link', symbol: 'LinkProps' },
] as const)
`;
    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: {
        outputMode: "virtual",
        createVirtualModuleId: (request) => {
          return `virtual:test-docgen?type=${request.typeName}&index=${request.index}`;
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.virtualModules).toHaveLength(2);
    expect(result!.code).toContain('"use client";\nimport __oxcTsDocgenSchema0 from');
    expect(result!.code).toContain('{"id":"button-props","docs":__oxcTsDocgenSchema0}');
    expect(result!.code).toContain('{"id":"link-props","docs":__oxcTsDocgenSchema1}');
    expect(result!.code).not.toContain("JSON.parse(");
  });

  it("transforms mixed generic object and batch getDocs calls independently", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-mixed-options-"));
    const buttonFile = resolve(root, "button.ts");
    const linkFile = resolve(root, "link.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(linkFile, "export interface LinkProps { href: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './button'

const genericSchema = getDocs<ButtonProps>()
const objectSchema = getDocs({ path: './link', symbol: 'LinkProps' })
const examples = getDocs([{ id: 'button-props', path: './button', symbol: 'ButtonProps' }] as const)
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code.match(/JSON\.parse/g)).toHaveLength(3);
    expect(result!.code).not.toContain("getDocs<ButtonProps>");
    expect(result!.code).not.toContain("getDocs({ path");
    expect(result!.code).not.toContain("getDocs([{");
  });

  it("generates schema for the explicit getDocs type without component auto-detection", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-explicit-contract-"));
    const typesFile = resolve(root, "link.tsx");
    const consumerFile = resolve(root, "main.tsx");
    writeFileSync(
      typesFile,
      [
        "export interface LinkProps {",
        "  /** Link destination. */",
        "  href: string",
        "}",
        "",
        "export interface InternalComponentProps {",
        "  hidden: boolean",
        "}",
        "",
        "export function Link(_props: InternalComponentProps) {",
        "  return null",
        "}",
      ].join("\n"),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { LinkProps } from './link'

const docs = getDocs<LinkProps>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries.map((entry: { name: string }) => entry.name)).toEqual(["LinkProps"]);
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "href",
    ]);
  });

  it("can transform getDocs calls into virtual schema module imports", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
// leading comment
"use client";
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const docs = getDocs<BaseProps>()
`;
    const result = transformGetDocs({
      code,
      id: "/test.tsx",
      config: {},
      options: {
        outputMode: "virtual",
        createVirtualModuleId: (request) => {
          const { typeName, sourceFile } = request;

          return `virtual:test-docgen?type=${typeName}&source=${encodeURIComponent(sourceFile)}`;
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.virtualModules).toHaveLength(1);
    expect(result!.code).toContain(
      '// leading comment\n"use client";\nimport __oxcTsDocgenSchema0 from',
    );
    expect(result!.code).toContain("const docs = __oxcTsDocgenSchema0");
    expect(result!.code).not.toContain("JSON.parse(");
    expect(result!.code).not.toContain("getDocs<BaseProps>()");
  });

  it("compiles transitive related project types", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-related-"));
    const typesFile = resolve(root, "button.ts");
    const consumerFile = resolve(root, "main.tsx");
    writeFileSync(
      typesFile,
      [
        "export type TokenName = 'primary' | 'secondary'",
        "export type InternalProps = {",
        "  token: TokenName",
        "}",
        "export interface ButtonProps {",
        "  internalProps?: InternalProps",
        "}",
      ].join("\n"),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './button'

const docs = getDocs<ButtonProps>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.related.map((entry: { name: string }) => entry.name)).toEqual([
      "InternalProps",
      "TokenName",
    ]);
  });

  it("compiles playground-style hybrid docs with semantic props and related token types", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-release-surface-"));
    const typesFile = resolve(root, "release-surface.ts");
    const consumerFile = resolve(root, "main.tsx");
    writeFileSync(
      typesFile,
      [
        "export type ReactNode = string | number",
        "export type ComponentPropsWithoutRef<T extends 'button'> = { disabled?: boolean }",
        "export type TokenScale = 'space.100' | 'space.200'",
        "export interface DesignTokens {",
        "  /** Space token values. */",
        "  space: Record<TokenScale, string>",
        "}",
        "export enum ControlTone {",
        "  Neutral,",
        "  Accent = 4,",
        "  Computed = 1 + 2,",
        "}",
        "export type SaveHandler = (payload: { id: string }, ...changes: Array<{ path: TokenScale }>) => Promise<{ ok: boolean }>",
        "export interface BaseControlProps {",
        "  /** Rendered label. */",
        "  label: ReactNode",
        "}",
        "export type ReleaseSurfaceProps = BaseControlProps &",
        "  Omit<ComponentPropsWithoutRef<'button'>, keyof BaseControlProps> & {",
        "    /** Visual tone. */",
        "    tone?: ControlTone",
        "    /** Token scale. */",
        "    scale?: TokenScale",
        "    /** Design token dictionary. */",
        "    tokens?: DesignTokens",
        "    /** Callback-heavy API. */",
        "    onSave?: SaveHandler",
        "  }",
      ].join("\n"),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ReleaseSurfaceProps } from './release-surface'

const docs = getDocs<ReleaseSurfaceProps>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "label",
      "disabled",
      "tone",
      "scale",
      "tokens",
      "onSave",
    ]);
    expect(parsed.related.map((entry: { name: string }) => entry.name)).toEqual([
      "ControlTone",
      "DesignTokens",
      "SaveHandler",
      "TokenScale",
    ]);

    const label = parsed.entries[0].properties.find(
      (prop: { name: string }) => prop.name === "label",
    );
    expect(label.type).toEqual({ kind: "reference", name: "ReactNode" });

    const onSave = parsed.entries[0].properties.find(
      (prop: { name: string }) => prop.name === "onSave",
    );
    expect(onSave.type).toMatchObject({
      kind: "reference",
      name: "SaveHandler",
    });

    const onSaveEntry = parsed.related.find(
      (entry: { name: string }) => entry.name === "SaveHandler",
    );
    expect(onSaveEntry.type).toMatchObject({
      kind: "function",
      parameters: [
        {
          name: "payload",
          type: {
            kind: "object",
            properties: [{ name: "id", type: { kind: "primitive", name: "string" } }],
          },
        },
        {
          name: "changes",
          rest: true,
          type: {
            kind: "array",
            elementType: {
              kind: "object",
              properties: [{ name: "path" }],
            },
          },
        },
      ],
      returnType: {
        kind: "reference",
        name: "Promise",
        typeArguments: [
          {
            kind: "object",
            properties: [{ name: "ok", type: { kind: "primitive", name: "boolean" } }],
          },
        ],
      },
    });
  });

  it("compiles schemas with generic property substitutions", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-generics-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.tsx");
    writeFileSync(
      typesFile,
      ["export interface Box<T> {", "  value: T", "}", "export type StringBox = Box<string>"].join(
        "\n",
      ),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { StringBox } from './types'

const docs = getDocs<StringBox>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].properties[0].type).toEqual({
      kind: "primitive",
      name: "string",
    });
  });

  it("compiles getDocs for named aliases that wrap supported utility types", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-utility-alias-"));
    const baseFile = resolve(root, "base.ts");
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.tsx");
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
      typesFile,
      [
        "import type { BaseButtonProps } from './base'",
        "export type ButtonProps = Required<BaseButtonProps>",
      ].join("\n"),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './types'

const docs = getDocs<ButtonProps>()
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "label",
      "disabled",
    ]);
    expect(
      parsed.entries[0].properties.map((prop: { optional: boolean }) => prop.optional),
    ).toEqual([false, false]);
    expect(result!.deps.map((dep) => dep.replace(/\\/g, "/"))).toContain(
      typesFile.replace(/\\/g, "/"),
    );
  });

  it("compiles unsupported object-like aliases through semantic fallback", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-unsupported-alias-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.tsx");
    writeFileSync(
      typesFile,
      [
        "export declare function createButtonProps(): {",
        "  /** Visible label. */",
        "  label: string",
        "  /** Disabled state. */",
        "  disabled?: boolean",
        "}",
        "export type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './types'

const docs = getDocs<ButtonProps>()
`;
    const result = transformGetDocs({ code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();

    const jsonMatch = result!.code.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "label",
      "disabled",
    ]);
    expect(parsed.entries[0].properties.map((prop: { name: string }) => prop.name)).not.toContain(
      "__unresolved",
    );
  });

  it("records dependency on the source file", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const normalizedTypesFile = typesFile.replace(/\\/g, "/");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonSize } from '${normalizedTypesFile}'

const docs = getDocs<ButtonSize>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    const normalizedDeps = result!.deps.map((d) => d.replace(/\\/g, "/"));
    expect(normalizedDeps).toContain(normalizedTypesFile);
  });

  it("transforms aliased getDocs imports", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs as docs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const schema = docs<BaseProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("docs<BaseProps>()");
  });

  it("resolves aliased imported type names to their exported declaration", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps as Props } from '${typesFile.replace(/\\/g, "/")}'

const schema = getDocs<Props>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");

    const jsonMatch = result!.code.match(/JSON\.parse\(("[^"]*(?:\\.[^"]*)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].name).toBe("BaseProps");
  });

  it("does not transform getDocs from unrelated docgen-like packages", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from 'my-docgen-utils'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).toBeNull();
  });

  it("does not transform shadowed getDocs calls", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

function local() {
  const getDocs = <T>() => ({})
  return getDocs<BaseProps>()
}

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code.match(/JSON\.parse/g)).toHaveLength(1);
    expect(result!.code).toContain("return getDocs<BaseProps>()");
  });

  it("does not transform getDocs calls shadowed in nested scopes", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

{
  const getDocs = <T>() => ({})
  getDocs<BaseProps>()
}

const withParam = (getDocs: <T>() => unknown) => getDocs<BaseProps>()

class Example {
  render(getDocs: <T>() => unknown) {
    return getDocs<BaseProps>()
  }
}

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code.match(/JSON\.parse/g)).toHaveLength(1);
    expect(result!.code).toContain("getDocs<BaseProps>()");
    expect(result!.code).toContain("return getDocs<BaseProps>()");
  });

  it("resolves directory imports to index files", () => {
    const typesDir = resolve(pluginFixturesDir, "directory-types");
    const normalizedTypesDir = typesDir.replace(/\\/g, "/");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { DirectoryProps } from '${normalizedTypesDir}'

const schema = getDocs<DirectoryProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      `${normalizedTypesDir}/index.ts`,
    );
  });

  it("resolves getDocs type imports through tsconfig paths aliases", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-paths-"));
    const componentsDir = resolve(root, "src", "components");
    mkdirSync(componentsDir, { recursive: true });

    const buttonFile = resolve(componentsDir, "button.ts");
    const consumerFile = resolve(root, "src", "main.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@components/*": ["src/components/*"],
          },
        },
      }),
    );
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from '@components/button'

const schema = getDocs<ButtonProps>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      buttonFile.replace(/\\/g, "/"),
    );
  });

  it("resolves getDocs type imports through barrel re-exports", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const buttonFile = resolve(srcDir, "button.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const consumerFile = resolve(srcDir, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { PublicButtonProps } from './index'

const schema = getDocs<PublicButtonProps>()
`;
    const result = transformGetDocs({ code: code, id: consumerFile, config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      buttonFile.replace(/\\/g, "/"),
    );
  });

  it("preserves getDocs imports when some calls remain unresolved in dev transforms", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const known = getDocs<BaseProps>()
const missing = getDocs<MissingProps>()
`;
    const result = transformGetDocs({ code: code, id: "/test.ts", config: {} });
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).toContain("import { getDocs } from '@synthfall/oxc-ts-docgen'");
    expect(result!.code).toContain("getDocs<MissingProps>()");
  });

  it("throws in strict mode when getDocs calls cannot be resolved", () => {
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const missing = getDocs<MissingProps>()
`;
    expect(() =>
      transformGetDocs({
        code: code,
        id: "/test.ts",
        config: {},
        options: { failOnUnresolved: true },
      }),
    ).toThrow("could not compile all getDocs() calls");
  });

  it("throws in strict mode for non-plain getDocs type arguments", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-composite-"));
    const typesFile = resolve(root, "types.ts");
    const consumerFile = resolve(root, "main.ts");
    mkdirSync(root, { recursive: true });
    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const intersectionCode = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './types'

const schema = getDocs<ButtonProps & { extra: string }>()
`;

    expect(() =>
      transformGetDocs({
        code: intersectionCode,
        id: consumerFile,
        config: {},
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/plain named type reference.*Name the type first/s);

    const genericCode = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './types'

const schema = getDocs<Readonly<ButtonProps>>()
`;

    expect(() =>
      transformGetDocs({
        code: genericCode,
        id: consumerFile,
        config: {},
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/plain named type reference.*Name the type first/s);
  });

  it("reports suggested fixes for non-plain getDocs type arguments in dev diagnostics", () => {
    const messages: string[] = [];
    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const schema = getDocs<Readonly<ButtonProps>>()
`;

    const result = transformGetDocs({
      code,
      id: "/test.ts",
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toMatch(/plain named type reference.*Name the type first/s);
  });

  it("reports dynamic getDocs options as unresolved", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-dynamic-options-"));
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const path = getPath()
const schema = getDocs({ path, symbol: 'ButtonProps' })
`;

    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toContain("target object values must be static JSON primitives");
  });

  it("keeps getDocs option calls unresolved when extra arguments are present", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-extra-options-"));
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const schema = getDocs({ path: './button', symbol: 'ButtonProps' }, trackUsage())
`;

    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toContain("must pass exactly one static object or array argument");
  });

  it("does not resolve getDocs registries through shadowed local identifiers", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-shadowed-targets-"));
    const buttonFile = resolve(root, "button.ts");
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(consumerFile, "");
    const messages: string[] = [];

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const targets = [{ id: 'button-props', path: './button', symbol: 'ButtonProps' }] as const

function loadDocs() {
  const targets = getRuntimeTargets()
  return getDocs(targets)
}
`;

    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: {},
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toContain("must pass a static object or array argument");
  });

  it("throws in strict mode for dynamic getDocs options", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-strict-dynamic-options-"));
    const consumerFile = resolve(root, "main.ts");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'

const path = getPath()
const schema = getDocs({ path, symbol: 'ButtonProps' })
`;

    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: {},
        options: { failOnUnresolved: true },
      }),
    ).toThrow("could not compile all getDocs() calls");
  });

  it("includes missing explicit tsconfig diagnostics in strict unresolved errors", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-missing-tsconfig-"));
    const consumerFile = resolve(root, "src", "main.ts");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from '@shared/button'

const schema = getDocs<ButtonProps>()
`;

    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: { tsconfig: resolve(root, "missing.tsconfig.json") },
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/tsconfig-not-found.*missing\.tsconfig\.json/s);
  });

  it("includes invalid tsconfig diagnostics in strict unresolved errors", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-invalid-tsconfig-"));
    const consumerFile = resolve(root, "src", "main.ts");
    const tsconfigFile = resolve(root, "tsconfig.json");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(consumerFile, "");
    writeFileSync(tsconfigFile, "{ invalid json");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from '@shared/button'

const schema = getDocs<ButtonProps>()
`;

    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: { tsconfig: tsconfigFile },
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/tsconfig-invalid.*tsconfig\.json/s);
  });

  it("includes unsupported tsconfig shape diagnostics in strict unresolved errors", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-unsupported-tsconfig-"));
    const consumerFile = resolve(root, "src", "main.ts");
    const tsconfigFile = resolve(root, "tsconfig.json");
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(consumerFile, "");
    writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          baseUrl: 123,
        },
      }),
    );

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from '@shared/button'

const schema = getDocs<ButtonProps>()
`;

    expect(() =>
      transformGetDocs({
        code,
        id: consumerFile,
        config: { tsconfig: tsconfigFile },
        options: { failOnUnresolved: true },
      }),
    ).toThrow(/tsconfig-unsupported.*baseUrl must be a string/s);
  });

  it("reports dev unresolved diagnostics without transforming recoverable calls", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-dev-diagnostics-"));
    const consumerFile = resolve(root, "src", "main.ts");
    const messages: string[] = [];
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from '@shared/button'

const schema = getDocs<ButtonProps>()
`;

    const result = transformGetDocs({
      code,
      id: consumerFile,
      config: { tsconfig: resolve(root, "missing.tsconfig.json") },
      options: { onUnresolved: (items) => messages.push(...items) },
    });

    expect(result).toBeNull();
    expect(messages.join("\n")).toMatch(/tsconfig-not-found.*missing\.tsconfig\.json/s);
  });
});
