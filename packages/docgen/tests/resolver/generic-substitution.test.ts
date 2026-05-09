import { describe, expect, it } from "vitest";

import type { DocProperty, DocType } from "../../src/index";

import {
  applyTypeSubstitutionsToProperties,
  substituteDocType,
} from "../../src/resolver/generic-substitution";

describe("generic substitution", () => {
  it("substitutes nested DocType references inside object properties", () => {
    const properties: DocProperty[] = [
      {
        name: "value",
        type: {
          kind: "object",
          properties: [
            {
              name: "items",
              type: {
                kind: "array",
                elementType: {
                  kind: "reference",
                  name: "T",
                },
              },
              optional: false,
              readonly: false,
              description: "",
              tags: {},
              defaultValue: undefined,
              source: { filePath: "src/generic.ts", line: 1, column: 0 },
            },
          ],
        },
        optional: false,
        readonly: false,
        description: "",
        tags: {},
        defaultValue: undefined,
        source: { filePath: "src/generic.ts", line: 1, column: 0 },
      },
    ];

    const substituted = applyTypeSubstitutionsToProperties({
      properties,
      substitutions: new Map<string, DocType>([["T", { kind: "primitive", name: "string" }]]),
    });

    const originalType = properties[0].type;
    if (originalType.kind !== "object") {
      throw new Error("Expected original property type to be an object");
    }

    expect(substituted[0].type).toEqual({
      kind: "object",
      properties: [
        {
          ...originalType.properties[0],
          type: {
            kind: "array",
            elementType: { kind: "primitive", name: "string" },
          },
        },
      ],
    });
  });

  it("does not recurse forever through cyclic substitutions", () => {
    const substitutions = new Map<string, DocType>([
      ["T", { kind: "reference", name: "U" }],
      ["U", { kind: "reference", name: "T" }],
    ]);

    expect(substituteDocType({ type: { kind: "reference", name: "T" }, substitutions })).toEqual({
      kind: "reference",
      name: "T",
    });
  });
});
