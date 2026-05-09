import { describe, expect, it } from "vitest";

import { buildDocType, resolveTypeName } from "../../src/builders/type-builder";
import { resolveConfig } from "../../src/public/config";
import { findTypeDeclaration, parseSource } from "../../src/resolver/parser";

function typeAliasAnnotation(source: string, typeName: string) {
  const parsed = parseSource(source, "type-builder.ts");
  const found = findTypeDeclaration(parsed, typeName);
  if (!found || found.decl.type !== "TSTypeAliasDeclaration") {
    throw new Error(`Missing type alias ${typeName}`);
  }
  return { parsed, type: found.decl.typeAnnotation };
}

describe("type builder", () => {
  it("builds structured utility and function DocType output", () => {
    const { parsed, type } = typeAliasAnnotation(
      `
        type Handler = (value: 'a' | 'b') => NonNullable<string | null>
      `,
      "Handler",
    );

    expect(
      buildDocType({
        tsType: type,
        parsed,
        filePath: parsed.fileName,
        config: resolveConfig(),
      }),
    ).toEqual({
      kind: "function",
      parameters: [
        {
          name: "value",
          optional: false,
          rest: false,
          type: {
            kind: "union",
            members: [
              { kind: "literal", value: "'a'" },
              { kind: "literal", value: "'b'" },
            ],
          },
        },
      ],
      returnType: { kind: "primitive", name: "string" },
    });
  });

  it("recursively builds callback parameter DocType output", () => {
    const { parsed, type } = typeAliasAnnotation(
      `
        type Handler = (
          options: { label: string; nested?: { count: number } },
          tuple: [id: string, flags: boolean[]],
          next: (payload: { ok: true }) => Promise<{ done: boolean }>,
          ...items: Array<{ id: string }>
        ) => void
      `,
      "Handler",
    );

    const result = buildDocType({
      tsType: type,
      parsed,
      filePath: parsed.fileName,
      config: resolveConfig({ maxDepth: 6 }),
    });

    expect(result.kind).toBe("function");
    if (result.kind !== "function") return;
    expect(result.parameters.map((parameter) => parameter.name)).toEqual([
      "options",
      "tuple",
      "next",
      "items",
    ]);

    expect(result.parameters[0].type.kind).toBe("object");
    if (result.parameters[0].type.kind === "object") {
      expect(result.parameters[0].type.properties.map((property) => property.name)).toEqual([
        "label",
        "nested",
      ]);
      expect(result.parameters[0].type.properties[1].type.kind).toBe("object");
    }

    expect(result.parameters[1].type.kind).toBe("tuple");
    if (result.parameters[1].type.kind === "tuple") {
      expect(result.parameters[1].type.elements).toEqual([
        { kind: "primitive", name: "string" },
        { kind: "array", elementType: { kind: "primitive", name: "boolean" } },
      ]);
    }

    expect(result.parameters[2].type.kind).toBe("function");
    if (result.parameters[2].type.kind === "function") {
      expect(result.parameters[2].type.parameters[0].type.kind).toBe("object");
      expect(result.parameters[2].type.returnType).toEqual({
        kind: "reference",
        name: "Promise",
        typeArguments: [
          {
            kind: "object",
            properties: [
              {
                name: "done",
                type: { kind: "primitive", name: "boolean" },
                optional: false,
                readonly: false,
                description: "",
                tags: {},
                defaultValue: undefined,
                source: { filePath: "type-builder.ts", line: 5, column: 53 },
              },
            ],
          },
        ],
      });
    }

    expect(result.parameters[3].rest).toBe(true);
    expect(result.parameters[3].type.kind).toBe("array");
    if (result.parameters[3].type.kind === "array") {
      expect(result.parameters[3].type.elementType.kind).toBe("object");
    }
  });

  it("builds object types with source-aware properties", () => {
    const { parsed, type } = typeAliasAnnotation(
      `
        type Options = {
          /** Display label. */
          label?: string
          submit(value: number): boolean
        }
      `,
      "Options",
    );

    const result = buildDocType({
      tsType: type,
      parsed,
      filePath: parsed.fileName,
      config: resolveConfig(),
    });

    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    expect(result.properties.map((property) => property.name)).toEqual(["label", "submit"]);
    expect(result.properties[0].description).toBe("Display label.");
    expect(result.properties[0].source.filePath).toBe("type-builder.ts");
    expect(result.properties[1].type.kind).toBe("function");
  });

  it("builds type literal call and index signatures through the shared static property path", () => {
    const { parsed, type } = typeAliasAnnotation(
      `
        type CallableMap = {
          [key: string]: number
          (value: string): boolean
        }
      `,
      "CallableMap",
    );

    const result = buildDocType({
      tsType: type,
      parsed,
      filePath: parsed.fileName,
      config: resolveConfig(),
    });

    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    expect(result.properties.map((property) => property.name)).toEqual(["[key: string]", "__call"]);
    expect(result.properties[0].type).toEqual({ kind: "primitive", name: "number" });
    expect(result.properties[1].type).toEqual({
      kind: "function",
      parameters: [
        {
          name: "value",
          optional: false,
          rest: false,
          type: { kind: "primitive", name: "string" },
        },
      ],
      returnType: { kind: "primitive", name: "boolean" },
    });
  });

  it("resolves qualified type names", () => {
    expect(
      resolveTypeName({
        type: "TSQualifiedName",
        left: { type: "Identifier", name: "React" },
        right: { name: "ReactNode" },
      }),
    ).toBe("React.ReactNode");
  });
});
