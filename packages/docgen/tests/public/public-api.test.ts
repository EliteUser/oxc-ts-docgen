import { describe, expect, it } from "vitest";

import * as docgen from "../../src/index";

describe("public API surface", () => {
  it("keeps everyday user APIs visible at the docgen root", () => {
    const userFacingKeys = [
      "DEFAULT_CONFIG",
      "DEFAULT_PRESETS",
      "DOM_IGNORE_TYPES",
      "REACT_IGNORE_TYPES",
      "TYPESCRIPT_IGNORE_TYPES",
      "generateDocs",
      "generateDocsFromSource",
      "generateDocsResultFromSource",
      "getDocs",
      "resolveConfig",
    ];

    for (const key of userFacingKeys) {
      expect(docgen).toHaveProperty(key);
    }

    expect("BUILTIN_PRESETS" in docgen).toBe(false);
    expect("TYPESCRIPT_PRESET" in docgen).toBe(false);
    expect("REACT_PRESET" in docgen).toBe(false);
    expect("DOM_PRESET" in docgen).toBe(false);
  });

  it("exports an intentional plugin-facing API list from the docgen root", () => {
    const adapterFacingKeys = ["DocgenProject"];

    for (const key of adapterFacingKeys) {
      expect(docgen).toHaveProperty(key);
    }
  });

  it("keeps the runtime export list explicit", () => {
    expect(Object.keys(docgen).sort()).toEqual([
      "DEFAULT_CONFIG",
      "DEFAULT_PRESETS",
      "DOM_IGNORE_TYPES",
      "DocgenProject",
      "REACT_IGNORE_TYPES",
      "TYPESCRIPT_IGNORE_TYPES",
      "generateDocs",
      "generateDocsFromSource",
      "generateDocsResultFromSource",
      "getDocs",
      "resolveConfig",
    ]);
  });
});
