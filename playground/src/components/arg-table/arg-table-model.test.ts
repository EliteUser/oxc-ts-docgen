import type { DocProperty } from "@synthfall/oxc-ts-docgen";

import { describe, expect, it } from "vitest";

import { toRows } from "./arg-table-model";

const makeProperty = (options: {
  /**
   * JSDoc tags attached to the property.
   */
  tags: DocProperty["tags"];
}): DocProperty => {
  return {
    name: "deprecatedProperty",
    type: { kind: "primitive", name: "string" },
    optional: true,
    readonly: false,
    description: "Deprecated property.",
    tags: options.tags,
    defaultValue: undefined,
    source: {
      filePath: "src/examples/flat-component.ts",
      line: 1,
      column: 1,
    },
  };
};

describe("arg table row model", () => {
  it("maps deprecated JSDoc tags to description tag blocks", () => {
    const [row] = toRows([
      makeProperty({
        tags: {
          deprecated: "Use another property.",
        },
      }),
    ]);

    expect(row.descriptionTags).toEqual([
      {
        label: "Deprecated",
        value: "Use another property.",
      },
    ]);
  });

  it("supports deprecated tags without messages", () => {
    const [row] = toRows([
      makeProperty({
        tags: {
          deprecated: true,
        },
      }),
    ]);

    expect(row.descriptionTags).toEqual([
      {
        label: "Deprecated",
        value: "",
      },
    ]);
  });
});
