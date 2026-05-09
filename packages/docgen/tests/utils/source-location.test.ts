import { describe, expect, it } from "vitest";

import { parseSource } from "../../src/resolver/parser";
import { offsetToLocation } from "../../src/utils/source-location";

describe("source location", () => {
  it("converts offsets to one-based line and zero-based column locations", () => {
    const source = ["interface ButtonProps {", "  label: string", "}"].join("\n");
    const parsed = parseSource(source, "button.ts");
    const offset = source.indexOf("label");

    expect(offsetToLocation({ parsed, offset, filePath: "button.ts" })).toEqual({
      filePath: "button.ts",
      line: 2,
      column: 2,
    });
  });
});
