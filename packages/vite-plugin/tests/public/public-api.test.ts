import { describe, expect, it } from "vitest";

import * as vitePlugin from "../../src/index";

describe("vite plugin public API surface", () => {
  it("exports only the user-facing plugin entrypoint", () => {
    expect(Object.keys(vitePlugin).sort()).toEqual(["docgenPlugin"]);
    expect("DependencyGraph" in vitePlugin).toBe(false);
    expect("TypeRegistry" in vitePlugin).toBe(false);
    expect("transformGetDocs" in vitePlugin).toBe(false);
  });
});
