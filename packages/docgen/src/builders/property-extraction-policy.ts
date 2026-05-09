import type { TSType } from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { DocType } from "../schema/doc-schema";

import { resolveTypeName } from "./type-builder";

export const MAX_EXTENDS_DEPTH = 10;

export const SUPPORTED_OBJECT_UTILITY_TYPES = new Set([
  "Pick",
  "Omit",
  "Partial",
  "Required",
  "Readonly",
  "Record",
  "NonNullable",
]);

export const KNOWN_UTILITY_TYPES = new Set([
  ...SUPPORTED_OBJECT_UTILITY_TYPES,
  "Exclude",
  "Extract",
  "ReturnType",
  "Parameters",
  "InstanceType",
  "ConstructorParameters",
  "ThisParameterType",
  "OmitThisParameter",
  "ThisType",
  "Awaited",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
  "NoInfer",
]);

export type ShouldRequireAliasSemanticFallbackOptions = {
  /**
   * Alias type annotation being evaluated for semantic fallback.
   */
  tsType: TSType;
  /**
   * Static doc type produced for the alias annotation.
   */
  docType: DocType;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
};

export const shouldExtractAliasProperties = (tsType: TSType, config: DocgenConfig): boolean => {
  if (
    tsType.type === "TSTypeLiteral" ||
    tsType.type === "TSIntersectionType" ||
    tsType.type === "TSMappedType"
  ) {
    return true;
  }

  if (tsType.type === "TSTypeReference") {
    const name = resolveTypeName(tsType.typeName);
    return !(config.analysis !== "static" && isUnsupportedKnownUtilityType(name));
  }

  if (config.analysis !== "static" && isObjectLikeUnionType(tsType)) {
    return true;
  }

  if (tsType.type === "TSParenthesizedType") {
    return shouldExtractAliasProperties(tsType.typeAnnotation, config);
  }

  return false;
};

export const shouldRequireAliasSemanticFallback = (
  options: ShouldRequireAliasSemanticFallbackOptions,
): boolean => {
  const { tsType, docType, config } = options;
  if (config.analysis === "static") {
    return false;
  }

  if (tsType.type === "TSParenthesizedType") {
    return shouldRequireAliasSemanticFallback({
      tsType: tsType.typeAnnotation,
      docType,
      config,
    });
  }

  if (tsType.type !== "TSTypeReference") {
    return isObjectLikeUnionType(tsType);
  }

  const name = resolveTypeName(tsType.typeName);
  return (
    docType.kind === "reference" && docType.name === name && isUnsupportedKnownUtilityType(name)
  );
};

export const isKnownUtilityType = (name: string): boolean => {
  return KNOWN_UTILITY_TYPES.has(name);
};

export const isUnsupportedKnownUtilityType = (name: string): boolean => {
  return KNOWN_UTILITY_TYPES.has(name) && !SUPPORTED_OBJECT_UTILITY_TYPES.has(name);
};

export const isSemanticObjectBoundary = (tsType: TSType): boolean => {
  if (
    tsType.type === "TSConditionalType" ||
    tsType.type === "TSMappedType" ||
    tsType.type === "TSIndexedAccessType" ||
    tsType.type === "TSImportType"
  ) {
    return true;
  }

  return tsType.type === "TSTypeOperator" && tsType.operator === "keyof";
};

export const isObjectLikeUnionType = (tsType: TSType): boolean => {
  if (tsType.type === "TSParenthesizedType") {
    return isObjectLikeUnionType(tsType.typeAnnotation);
  }

  if (tsType.type !== "TSUnionType") {
    return false;
  }

  return tsType.types.every(isPotentialObjectLikeUnionMember);
};

const isPotentialObjectLikeUnionMember = (tsType: TSType): boolean => {
  if (tsType.type === "TSParenthesizedType") {
    return isPotentialObjectLikeUnionMember(tsType.typeAnnotation);
  }

  if (
    tsType.type === "TSTypeLiteral" ||
    tsType.type === "TSIntersectionType" ||
    tsType.type === "TSMappedType" ||
    tsType.type === "TSConditionalType" ||
    tsType.type === "TSIndexedAccessType" ||
    tsType.type === "TSImportType"
  ) {
    return true;
  }

  return tsType.type === "TSTypeReference";
};
