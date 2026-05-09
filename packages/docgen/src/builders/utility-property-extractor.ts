import type { TSLiteral, TSType } from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { GenericDocPolicy } from "../resolver/generic-doc-policy";
import type { ParsedSource } from "../resolver/parser";
import type { TypeResolver } from "../resolver/resolver";
import type { DocProperty } from "../schema/doc-schema";
import type { StaticExtractionState } from "./property-extraction-diagnostics";

import { offsetToLocation } from "../utils/source-location";
import { getLiteralLike } from "./oxc-ast-compat";
import { recordBoundedExtractionDiagnostic } from "./property-extraction-diagnostics";
import { isUnsupportedKnownUtilityType, MAX_EXTENDS_DEPTH } from "./property-extraction-policy";
import { hasUnresolvedExtraction } from "./property-extraction-result";
import { buildStaticProperty, buildUnresolvedExtractionProperty } from "./static-property-builder";
import { buildDocType, resolveTypeName } from "./type-builder";

export type RecursivePropertyExtractorOptions = {
  /**
   * Type node to extract object-like properties from.
   */
  tsType: TSType;
  /**
   * Parsed source containing the type node.
   */
  parsed: ParsedSource;
  /**
   * Source file containing the type node.
   */
  filePath: string;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Resolver used for referenced object-like declarations.
   */
  resolver?: TypeResolver;
  /**
   * Current recursive extraction depth.
   */
  depth?: number;
  /**
   * Mutable static extraction state for fallback and diagnostics.
   */
  state?: StaticExtractionState;
  /**
   * Generic substitutions available in the current extraction context.
   */
  genericPolicy?: GenericDocPolicy;
};

export type RecursivePropertyExtractor = (
  options: RecursivePropertyExtractorOptions,
) => DocProperty[];

export type ExtractPropertiesFromUtilityTypeOptions = {
  /**
   * Utility type name.
   */
  name: string;
  /**
   * Utility type arguments.
   */
  args: TSType[];
  /**
   * Source type reference being evaluated.
   */
  sourceType: TSType;
  /**
   * Parsed source containing the utility reference.
   */
  parsed: ParsedSource;
  /**
   * Source file containing the utility reference.
   */
  filePath: string;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Resolver used for referenced object-like declarations.
   */
  resolver: TypeResolver;
  /**
   * Current recursive extraction depth.
   */
  depth: number;
  /**
   * Mutable static extraction state for fallback and diagnostics.
   */
  state?: StaticExtractionState;
  /**
   * Generic substitutions available in the current extraction context.
   */
  genericPolicy?: GenericDocPolicy;
  /**
   * Recursive extractor for utility base types.
   */
  extractProperties: RecursivePropertyExtractor;
};

type BuildUnresolvedSourceTypePropertyOptions = {
  /**
   * Source type that could not be statically extracted.
   */
  sourceType: TSType;
  /**
   * Parsed source containing the source type.
   */
  parsed: ParsedSource;
  /**
   * Source file containing the source type.
   */
  filePath: string;
};

type ExtractStringKeysOptions = {
  /**
   * Type node expected to produce string keys.
   */
  tsType: TSType;
  /**
   * Parsed source containing the key type.
   */
  parsed: ParsedSource;
  /**
   * Source file containing the key type.
   */
  filePath: string;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Resolver used for referenced key aliases.
   */
  resolver: TypeResolver;
  /**
   * Current recursive key extraction depth.
   */
  depth: number;
  /**
   * Recursive extractor used by `keyof` evaluation.
   */
  extractProperties: RecursivePropertyExtractor;
};

export const extractPropertiesFromUtilityType = (
  options: ExtractPropertiesFromUtilityTypeOptions,
): DocProperty[] | undefined => {
  const {
    name,
    args,
    sourceType,
    parsed,
    filePath,
    config,
    resolver,
    depth,
    state,
    genericPolicy,
    extractProperties,
  } = options;
  const unresolvedSourceType = () =>
    buildUnresolvedSourceTypeProperty({ sourceType, parsed, filePath });

  if (depth >= MAX_EXTENDS_DEPTH || depth > config.maxDepth) {
    recordBoundedExtractionDiagnostic({
      state,
      parsed,
      filePath,
      start: sourceType.start,
      text: "<max depth>",
      reason: "maxDepth",
    });
    return [
      buildUnresolvedExtractionProperty({
        text: "<max depth>",
        parsed,
        filePath,
        start: sourceType.start,
      }),
    ];
  }

  if (isUnsupportedKnownUtilityType(name)) {
    recordBoundedExtractionDiagnostic({
      state,
      parsed,
      filePath,
      start: sourceType.start,
      text: parsed.source.slice(sourceType.start, sourceType.end),
      reason: "unsupportedUtility",
    });
    return [unresolvedSourceType()];
  }

  if (name === "NonNullable") {
    if (args.length < 1) {
      return [unresolvedSourceType()];
    }
    return extractProperties({
      tsType: args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
      state,
      genericPolicy,
    });
  }

  if (name === "Pick" || name === "Omit") {
    if (args.length < 2) {
      return [unresolvedSourceType()];
    }
    const baseProps = extractProperties({
      tsType: args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
      state,
      genericPolicy,
    });
    if (hasUnresolvedExtraction(baseProps)) {
      return [unresolvedSourceType()];
    }
    const keys = extractStringKeys({
      tsType: args[1],
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
      extractProperties,
    });
    if (!keys) {
      return [unresolvedSourceType()];
    }
    if (name === "Pick") {
      return baseProps.filter((prop) => keys.has(prop.name));
    }
    return baseProps.filter((prop) => !keys.has(prop.name));
  }

  if (name === "Partial" || name === "Required" || name === "Readonly") {
    if (args.length < 1) {
      return [unresolvedSourceType()];
    }
    const baseProps = extractProperties({
      tsType: args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
      state,
      genericPolicy,
    });
    if (hasUnresolvedExtraction(baseProps)) {
      return baseProps;
    }
    return baseProps.map((prop) => ({
      ...prop,
      optional: name === "Partial" ? true : name === "Required" ? false : prop.optional,
      readonly: name === "Readonly" ? true : prop.readonly,
    }));
  }

  if (name === "Record") {
    if (args.length < 2) {
      return [unresolvedSourceType()];
    }
    const keys = extractStringKeys({
      tsType: args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
      extractProperties,
    });
    const valueType = buildDocType({
      tsType: args[1],
      parsed,
      filePath,
      config,
      genericPolicy,
    });
    const source = offsetToLocation({ parsed, offset: sourceType.start, filePath });
    if (keys) {
      return [...keys].sort().map((key) =>
        buildStaticProperty({
          name: key,
          type: valueType,
          optional: false,
          readonly: false,
          description: "",
          tags: {},
          defaultValue: undefined,
          source,
        }),
      );
    }
    return [
      buildStaticProperty({
        name: "[key: string]",
        type: valueType,
        optional: false,
        readonly: false,
        description: "",
        tags: {},
        defaultValue: undefined,
        source,
      }),
    ];
  }

  return undefined;
};

const buildUnresolvedSourceTypeProperty = (
  options: BuildUnresolvedSourceTypePropertyOptions,
): DocProperty => {
  const { sourceType, parsed, filePath } = options;
  return buildUnresolvedExtractionProperty({
    text: parsed.source.slice(sourceType.start, sourceType.end),
    parsed,
    filePath,
    start: sourceType.start,
  });
};

const extractStringKeys = (options: ExtractStringKeysOptions): Set<string> | undefined => {
  const { tsType, parsed, filePath, config, resolver, depth, extractProperties } = options;
  if (depth >= MAX_EXTENDS_DEPTH) {
    return undefined;
  }

  if (tsType.type === "TSLiteralType") {
    const key = extractLiteralKey(tsType.literal);
    return key === undefined ? undefined : new Set([key]);
  }

  if (tsType.type === "TSUnionType") {
    const keys = new Set<string>();
    for (const member of tsType.types) {
      const memberKeys = extractStringKeys({
        tsType: member,
        parsed,
        filePath,
        config,
        resolver,
        depth: depth + 1,
        extractProperties,
      });
      if (!memberKeys) {
        return undefined;
      }
      for (const key of memberKeys) {
        keys.add(key);
      }
    }
    return keys;
  }

  if (tsType.type === "TSParenthesizedType") {
    return extractStringKeys({
      tsType: tsType.typeAnnotation,
      parsed,
      filePath,
      config,
      resolver,
      depth,
      extractProperties,
    });
  }

  if (tsType.type === "TSTypeReference") {
    const name = resolveTypeName(tsType.typeName);
    const resolved = resolver.resolveType({
      typeName: name,
      fromFile: filePath,
      fromParsed: parsed,
    });
    if (!resolved || resolved.decl.type !== "TSTypeAliasDeclaration") {
      return undefined;
    }
    return extractStringKeys({
      tsType: resolved.decl.typeAnnotation,
      parsed: resolved.parsed,
      filePath: resolved.filePath,
      config,
      resolver,
      depth: depth + 1,
      extractProperties,
    });
  }

  if (tsType.type === "TSTypeOperator" && tsType.operator === "keyof") {
    const props = extractProperties({
      tsType: tsType.typeAnnotation,
      parsed,
      filePath,
      config,
      resolver,
      depth: depth + 1,
    });
    if (hasUnresolvedExtraction(props)) {
      return undefined;
    }
    return new Set(props.map((prop) => prop.name));
  }

  return undefined;
};

const extractLiteralKey = (literal: TSLiteral): string | undefined => {
  if (literal.type !== "Literal") {
    return undefined;
  }
  const value = getLiteralLike(literal).value;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
};
