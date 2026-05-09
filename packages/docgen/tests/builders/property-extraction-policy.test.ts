import { describe, expect, it } from "vitest";

import {
  isSemanticObjectBoundary,
  isObjectLikeUnionType,
  shouldExtractAliasProperties,
  shouldRequireAliasSemanticFallback,
} from "../../src/builders/property-extraction-policy";
import { buildDocType } from "../../src/builders/type-builder";
import { resolveConfig } from "../../src/public/config";
import { findTypeDeclaration, parseSource } from "../../src/resolver/parser";

const typeAliasAnnotation = (source: string, typeName: string) => {
  const parsed = parseSource(source, "property-policy.ts");
  const found = findTypeDeclaration(parsed, typeName);
  if (!found || found.decl.type !== "TSTypeAliasDeclaration") {
    throw new Error(`Missing type alias ${typeName}`);
  }

  return { parsed, type: found.decl.typeAnnotation };
};

const shouldFallbackForAlias = (source: string, typeName: string): boolean => {
  const { parsed, type } = typeAliasAnnotation(source, typeName);
  const config = resolveConfig();
  const docType = buildDocType({
    tsType: type,
    parsed,
    filePath: parsed.fileName,
    config,
  });

  return shouldRequireAliasSemanticFallback({
    tsType: type,
    docType,
    config,
  });
};

describe("property extraction policy", () => {
  it("keeps unsupported utility aliases on the semantic fallback path in hybrid mode", () => {
    const { parsed, type } = typeAliasAnnotation(
      [
        "declare function createButtonProps(): { label: string }",
        "type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
      "ButtonProps",
    );
    const config = resolveConfig();
    const docType = buildDocType({
      tsType: type,
      parsed,
      filePath: parsed.fileName,
      config,
    });

    expect(shouldExtractAliasProperties(type, config)).toBe(false);
    expect(
      shouldRequireAliasSemanticFallback({
        tsType: type,
        docType,
        config,
      }),
    ).toBe(true);
  });

  it("keeps static mode utility extraction explicit", () => {
    const { type } = typeAliasAnnotation(
      [
        "declare function createButtonProps(): { label: string }",
        "type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
      "ButtonProps",
    );

    expect(shouldExtractAliasProperties(type, resolveConfig({ analysis: "static" }))).toBe(true);
  });

  it("classifies semantic object boundaries separately from plain object literals", () => {
    const conditional = typeAliasAnnotation(
      "type ButtonProps<T> = T extends string ? { label: string } : {}",
      "ButtonProps",
    ).type;
    const objectLiteral = typeAliasAnnotation(
      "type ButtonProps = { label: string }",
      "ButtonProps",
    ).type;

    expect(isSemanticObjectBoundary(conditional)).toBe(true);
    expect(isSemanticObjectBoundary(objectLiteral)).toBe(false);
  });

  it("keeps primitive unions on the static path", () => {
    const { type } = typeAliasAnnotation("type Size = 's' | 'm'", "Size");

    expect(isObjectLikeUnionType(type)).toBe(false);
    expect(shouldFallbackForAlias("type Size = 's' | 'm'", "Size")).toBe(false);
  });

  it("marks object-like union aliases as semantic fallback candidates", () => {
    const source = [
      "type SingleProps = { value?: string | null }",
      "type MultipleProps = { value?: string[] }",
      "type BranchUnionProps = SingleProps | MultipleProps",
    ].join("\n");
    const { type } = typeAliasAnnotation(source, "BranchUnionProps");

    expect(isObjectLikeUnionType(type)).toBe(true);
    expect(shouldFallbackForAlias(source, "BranchUnionProps")).toBe(true);
  });

  it("keeps parenthesized object-like union aliases on the fallback path", () => {
    const source = [
      "type SingleProps = { value?: string | null }",
      "type MultipleProps = { value?: string[] }",
      "type BranchUnionProps = (SingleProps | MultipleProps)",
    ].join("\n");
    const { type } = typeAliasAnnotation(source, "BranchUnionProps");

    expect(isObjectLikeUnionType(type)).toBe(true);
    expect(shouldFallbackForAlias(source, "BranchUnionProps")).toBe(true);
  });
});
