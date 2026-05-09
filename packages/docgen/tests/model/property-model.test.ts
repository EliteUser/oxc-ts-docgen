import { describe, expect, it } from "vitest";

import { emitDocProperty, normalizeDocProperty } from "../../src/model/property-model";

describe("property model", () => {
  it("normalizes provenance and dependencies without leaking internal fields", () => {
    const property = normalizeDocProperty({
      name: "label",
      type: { kind: "primitive", name: "string" },
      optional: false,
      readonly: false,
      description: "Visible label.",
      tags: {},
      defaultValue: undefined,
      source: { filePath: "src\\button.ts", line: 2, column: 2 },
      provenance: { kind: "semantic", filePath: "src\\button.ts" },
      dependencies: ["src/button.ts", "src\\theme.ts"],
    });

    expect(property.provenance).toEqual({ kind: "semantic", filePath: "src/button.ts" });
    expect(property.dependencies).toEqual(["src/button.ts", "src/theme.ts"]);
    expect(emitDocProperty(property)).toEqual({
      name: "label",
      type: { kind: "primitive", name: "string" },
      optional: false,
      readonly: false,
      description: "Visible label.",
      tags: {},
      defaultValue: undefined,
      source: { filePath: "src/button.ts", line: 2, column: 2 },
    });
  });
});
