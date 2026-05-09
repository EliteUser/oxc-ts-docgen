import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { DocSchema } from "../../src/index";

import { DependencyGraph } from "../../src/graph/dependency-graph";
import {
  collectDocSchemaDependencyRecords,
  collectDocSchemaFileDependencies,
  collectResolvedDocSchemaDependencyRecords,
} from "../../src/graph/dependency-records";
import { generateDocs, resolveConfig } from "../../src/index";
import { generateDocsWithResolver } from "../../src/public/api";
import { TypeResolver } from "../../src/resolver/resolver";

const normalize = (path: string): string => {
  return path.replace(/\\/g, "/");
};

describe("DependencyGraph", () => {
  it("normalizes paths and collects transitive dependents", () => {
    const graph = new DependencyGraph();

    graph.addDependency("src\\tokens.ts", "src/button.ts:ButtonProps");
    graph.addDependency("src/button.ts:ButtonProps", "src/main.tsx");

    expect(graph.getDependents("src/tokens.ts")).toEqual(new Set(["src/button.ts:ButtonProps"]));
    expect(graph.collectAffected(["src\\tokens.ts"])).toEqual([
      "src/tokens.ts",
      "src/button.ts:ButtonProps",
      "src/main.tsx",
    ]);
  });

  it("clears stale dependent edges", () => {
    const graph = new DependencyGraph();

    graph.addDependency("src/tokens.ts", "src/button.ts:ButtonProps");
    graph.clearDependent("src\\button.ts:ButtonProps");

    expect(graph.getDependents("src/tokens.ts")).toEqual(new Set());
    expect(graph.isTrackedSource("src/tokens.ts")).toBe(false);
  });

  it("keeps Vite consumer compatibility aliases", () => {
    const graph = new DependencyGraph();

    graph.addConsumerDependency("src/button.ts", "src/main.tsx");
    expect(graph.getConsumers("src\\button.ts")).toEqual(new Set(["src/main.tsx"]));

    graph.clearConsumer("src\\main.tsx");
    expect(graph.getConsumers("src/button.ts")).toEqual(new Set());
  });
});

describe("collectDocSchemaFileDependencies", () => {
  it("collects primary, related, property, and reference target files", () => {
    const schema: DocSchema = {
      version: 1,
      entries: [
        {
          name: "ButtonProps",
          kind: "interface",
          description: "",
          tags: {},
          typeParameters: [],
          source: { filePath: "src/button.ts", line: 1, column: 0 },
          heritage: [
            {
              name: "ExternalProps",
              reason: "externalReference",
              source: { filePath: "src/button.ts", line: 1, column: 38 },
              target: { name: "ExternalProps", filePath: "node_modules/external/index.d.ts" },
            },
          ],
          properties: [
            {
              name: "token",
              type: {
                kind: "reference",
                name: "TokenName",
                target: { name: "TokenName", filePath: "src/tokens.ts" },
              },
              optional: true,
              readonly: false,
              description: "",
              tags: {},
              defaultValue: undefined,
              source: { filePath: "src/base.ts", line: 2, column: 2 },
            },
          ],
          type: {
            kind: "object",
            properties: [],
          },
        },
      ],
      related: [
        {
          name: "TokenName",
          kind: "typeAlias",
          description: "",
          tags: {},
          typeParameters: [],
          source: { filePath: "src/tokens.ts", line: 1, column: 0 },
          properties: [],
          type: {
            kind: "union",
            members: [
              { kind: "literal", value: "'primary'" },
              { kind: "literal", value: "'secondary'" },
            ],
          },
        },
      ],
    };

    expect(collectDocSchemaFileDependencies(schema, "src/consumer.ts")).toEqual(
      new Set([
        "src/consumer.ts",
        "src/button.ts",
        "node_modules/external/index.d.ts",
        "src/base.ts",
        "src/tokens.ts",
      ]),
    );
    expect(collectDocSchemaDependencyRecords(schema, "src/consumer.ts")).toEqual([
      { kind: "schemaOwner", filePath: "src/consumer.ts" },
      { kind: "entrySource", filePath: "src/button.ts", entryName: "ButtonProps" },
      {
        kind: "heritageReference",
        filePath: "node_modules/external/index.d.ts",
        entryName: "ButtonProps",
        referencedName: "ExternalProps",
        targetName: "ExternalProps",
        heritageReason: "externalReference",
      },
      {
        kind: "propertySource",
        filePath: "src/base.ts",
        entryName: "ButtonProps",
        propertyName: "token",
      },
      {
        kind: "referenceTarget",
        filePath: "src/tokens.ts",
        entryName: "ButtonProps",
        propertyName: "token",
        referencedName: "TokenName",
        targetName: "TokenName",
      },
      { kind: "relatedEntrySource", filePath: "src/tokens.ts", entryName: "TokenName" },
    ]);
  });

  it("collects resolver trace records from core for barrel references", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-dep-records-barrel-"));
    const tokenFile = resolve(root, "tokens.ts");
    const barrelFile = resolve(root, "index.ts");
    const buttonFile = resolve(root, "button.ts");
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

    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const parsed = resolver.parseFileCached(buttonFile);
    const schema = generateDocsWithResolver({
      filePath: buttonFile,
      typeName: "ButtonProps",
      config,
      resolver,
    });

    if (!parsed) {
      throw new Error("Expected parsed button source");
    }

    const records = collectResolvedDocSchemaDependencyRecords({
      schema,
      ownerFile: buttonFile,
      parsed,
      resolver,
      config,
    });

    expect(records).toContainEqual({
      kind: "resolverTrace",
      filePath: normalize(barrelFile),
      entryName: "ButtonProps",
      referencedName: "TokenName",
      targetName: "TokenName",
    });
    expect(records).toContainEqual({
      kind: "resolverTrace",
      filePath: normalize(tokenFile),
      entryName: "ButtonProps",
      referencedName: "TokenName",
      targetName: "TokenName",
    });
  });

  it("explains semantic fallback property source dependencies", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-dep-records-semantic-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const nativeFile = resolve(srcDir, "native.ts");
    const helperFile = resolve(srcDir, "helper.ts");
    const linkFile = resolve(srcDir, "link.ts");

    writeFileSync(
      nativeFile,
      ["export interface AnchorProps {", "  /** Link target URL. */", "  href?: string", "}"].join(
        "\n",
      ),
    );
    writeFileSync(
      helperFile,
      [
        "import type { AnchorProps } from './native'",
        "export type NativeProps<T extends 'a'> = T extends 'a' ? AnchorProps : {}",
      ].join("\n"),
    );
    writeFileSync(
      linkFile,
      [
        "import type { NativeProps } from './helper'",
        "export type LinkProps = { label: string } & NativeProps<'a'>",
      ].join("\n"),
    );

    const schema = generateDocs({ filePath: linkFile, typeName: "LinkProps" });
    const records = collectDocSchemaDependencyRecords(schema, linkFile);

    expect(records).toContainEqual({
      kind: "entrySource",
      filePath: normalize(linkFile),
      entryName: "LinkProps",
    });
    expect(records).toContainEqual({
      kind: "propertySource",
      filePath: normalize(nativeFile),
      entryName: "LinkProps",
      propertyName: "href",
    });
  });
});
