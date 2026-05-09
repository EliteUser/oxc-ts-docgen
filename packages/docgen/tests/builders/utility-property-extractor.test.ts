import type { TSType } from "oxc-parser";

import { describe, expect, it } from "vitest";

import { createStaticExtractionState } from "../../src/builders/property-extraction-diagnostics";
import { extractPropertiesFromType } from "../../src/builders/property-extractor";
import { extractPropertiesFromUtilityType } from "../../src/builders/utility-property-extractor";
import { resolveConfig } from "../../src/public/config";
import { findTypeDeclaration, parseSource } from "../../src/resolver/parser";
import { TypeResolver } from "../../src/resolver/resolver";

const utilityReference = (source: string, typeName: string) => {
  const parsed = parseSource(source, "utility-extractor.ts");
  const found = findTypeDeclaration(parsed, typeName);
  if (!found || found.decl.type !== "TSTypeAliasDeclaration") {
    throw new Error(`Missing type alias ${typeName}`);
  }
  const tsType = found.decl.typeAnnotation;
  if (tsType.type !== "TSTypeReference") {
    throw new Error(`Expected ${typeName} to be a utility type reference`);
  }

  return { parsed, tsType };
};

const utilityArgs = (tsType: TSType): TSType[] => {
  if (tsType.type !== "TSTypeReference") {
    return [];
  }

  return tsType.typeArguments?.params ?? [];
};

describe("utility property extractor", () => {
  it("extracts supported object utility properties through a recursive callback", () => {
    const { parsed, tsType } = utilityReference(
      [
        "interface BaseProps {",
        "  label: string",
        "  disabled?: boolean",
        "}",
        "type ButtonProps = Pick<BaseProps, 'label'>",
      ].join("\n"),
      "ButtonProps",
    );
    const config = resolveConfig({ analysis: "static" });
    const resolver = new TypeResolver(config);

    const properties = extractPropertiesFromUtilityType({
      name: "Pick",
      args: utilityArgs(tsType),
      sourceType: tsType,
      parsed,
      filePath: parsed.fileName,
      config,
      resolver,
      depth: 0,
      extractProperties: extractPropertiesFromType,
    });

    expect(properties?.map((property) => property.name)).toEqual(["label"]);
  });

  it("records diagnostics for unsupported utility extraction in static mode", () => {
    const { parsed, tsType } = utilityReference(
      [
        "declare function createButtonProps(): { label: string }",
        "type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
      "ButtonProps",
    );
    const config = resolveConfig({ analysis: "static" });
    const resolver = new TypeResolver(config);
    const state = createStaticExtractionState();

    const properties = extractPropertiesFromUtilityType({
      name: "ReturnType",
      args: utilityArgs(tsType),
      sourceType: tsType,
      parsed,
      filePath: parsed.fileName,
      config,
      resolver,
      depth: 0,
      state,
      extractProperties: extractPropertiesFromType,
    });

    expect(properties?.map((property) => property.name)).toEqual(["__unresolved"]);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        code: "static-extraction-incomplete",
        filePath: "utility-extractor.ts",
      }),
    ]);
    expect(state.diagnostics[0].message).toContain("unsupported utility type");
  });
});
