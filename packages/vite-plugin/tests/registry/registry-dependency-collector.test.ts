import { describe, expect, it } from "vitest";

import { collectRegistryDependencyRecords } from "../../src/registry/registry-dependency-collector";

const createTypeKey = (filePath: string, typeName: string): string => {
  return `${filePath}:${typeName}`;
};

describe("collectRegistryDependencyRecords", () => {
  it("maps core type dependency records into registry type keys", () => {
    const records = collectRegistryDependencyRecords({
      dependencyRecords: [
        {
          kind: "referenceTarget",
          filePath: "src/tokens.ts",
          entryName: "ButtonProps",
          referencedName: "TokenName",
          targetName: "TokenName",
        },
        {
          kind: "staticReference",
          filePath: "src/base.ts",
          entryName: "ButtonProps",
          referencedName: "BaseProps",
          targetName: "BaseProps",
        },
        {
          kind: "heritageReference",
          filePath: "src/external.ts",
          entryName: "ButtonProps",
          referencedName: "ExternalProps",
          targetName: "ExternalProps",
          heritageReason: "externalReference",
        },
        {
          kind: "resolverTrace",
          filePath: "src/index.ts",
          entryName: "ButtonProps",
          referencedName: "TokenName",
          targetName: "TokenName",
        },
      ],
      createTypeKey,
    });

    expect(records).toEqual([
      {
        kind: "referenceTarget",
        typeName: "TokenName",
        typeKey: "src/tokens.ts:TokenName",
      },
      {
        kind: "staticReference",
        typeName: "BaseProps",
        typeKey: "src/base.ts:BaseProps",
      },
      {
        kind: "heritageReference",
        typeName: "ExternalProps",
        typeKey: "src/external.ts:ExternalProps",
      },
    ]);
  });

  it("deduplicates repeated core type dependencies", () => {
    const records = collectRegistryDependencyRecords({
      dependencyRecords: [
        {
          kind: "referenceTarget",
          filePath: "src/tokens.ts",
          referencedName: "TokenName",
          targetName: "TokenName",
        },
        {
          kind: "referenceTarget",
          filePath: "src/tokens.ts",
          referencedName: "TokenName",
          targetName: "TokenName",
        },
      ],
      createTypeKey,
    });

    expect(records).toHaveLength(1);
  });
});
