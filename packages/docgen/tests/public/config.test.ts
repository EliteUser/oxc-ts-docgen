import { describe, expect, it } from "vitest";

import { resolveConfig } from "../../src/public/config";

describe("resolveConfig", () => {
  it("rejects invalid option values consistently", () => {
    expect(() => resolveConfig({ maxDepth: -1 })).toThrow('Invalid docgen config maxDepth "-1"');
    expect(() => resolveConfig({ externalTypes: "expand" as unknown as "reference" })).toThrow(
      'Invalid docgen config externalTypes "expand"',
    );
    expect(() => resolveConfig({ include: ["src/**/*.ts", 1] as unknown as string[] })).toThrow(
      "Invalid docgen config include. Expected an array of strings.",
    );
    expect(() => resolveConfig({ skipPropsWithoutDoc: "yes" as unknown as boolean })).toThrow(
      "Invalid docgen config skipPropsWithoutDoc. Expected a boolean.",
    );
    expect(() => resolveConfig({ tags: { default: "text" } as never })).toThrow(
      "Invalid docgen config tags.default. Expected a function.",
    );
  });

  it("keeps valid option normalization intact", () => {
    const config = resolveConfig({
      maxDepth: 5,
      externalTypes: "resolve",
      include: ["src/**/*.ts"],
      skipPropsWithName: ["internal"],
      tags: {
        default: (value) => value.trim(),
      },
    });

    expect(config.maxDepth).toBe(5);
    expect(config.externalTypes).toBe("resolve");
    expect(config.include).toEqual(["src/**/*.ts"]);
    expect(config.skipPropsWithName).toEqual(["internal"]);
    expect(config.tags.default(" value ")).toBe("value");
  });
});
