import type { TSSignature, TSType, TSTypeParameterDeclaration } from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { GenericDocPolicy } from "../resolver/generic-doc-policy";
import type { ParsedSource } from "../resolver/parser";
import type { TypeResolver } from "../resolver/resolver";
import type { DocProperty, DocType, DocTypeParam } from "../schema/doc-schema";
import type { StaticExtractionState } from "./property-extraction-diagnostics";

import { createUnionDocType } from "../model/doc-type-factory";
import { isPresetSemanticFallbackType, isPresetTransparentType } from "../public/presets";
import { createGenericDocPolicy } from "../resolver/generic-doc-policy";
import {
  applyTypeSubstitutionsToProperties,
  buildTypeSubstitutions,
} from "../resolver/generic-substitution";
import { resolveExtends } from "../resolver/heritage";
import { isIgnoredTypeName } from "../resolver/ignored-types";
import { recordBoundedExtractionDiagnostic } from "./property-extraction-diagnostics";
import {
  isKnownUtilityType,
  isObjectLikeUnionType,
  isSemanticObjectBoundary,
  MAX_EXTENDS_DEPTH,
} from "./property-extraction-policy";
import { hasUnresolvedExtraction } from "./property-extraction-result";
import { buildStaticFnParams } from "./static-function-params";
import {
  buildStaticPropertiesFromSignatures,
  buildUnresolvedExtractionProperty,
  UNRESOLVED_PROPERTY_NAME,
} from "./static-property-builder";
import { buildDocType, buildDocTypeShallow, resolveTypeName } from "./type-builder";
import { extractPropertiesFromUtilityType } from "./utility-property-extractor";

export type { StaticExtractionState } from "./property-extraction-diagnostics";
export {
  shouldExtractAliasProperties,
  shouldRequireAliasSemanticFallback,
} from "./property-extraction-policy";
export {
  filterUnresolvedExtractionProperties,
  hasUnresolvedExtraction,
} from "./property-extraction-result";

export type BuildPropertiesFromSignaturesOptions = {
  signatures: TSSignature[];
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  genericPolicy?: GenericDocPolicy;
};
export type ExtractPropertiesFromTypeOptions = {
  tsType: TSType;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  resolver?: TypeResolver;
  depth?: number;
  state?: StaticExtractionState;
  genericPolicy?: GenericDocPolicy;
};
export type ExtractPropertiesFromTypeForHeritageOptions = {
  tsType: TSType;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  resolver: TypeResolver;
  depth: number;
  /**
   * Mutable static extraction state for fallback and diagnostics.
   */
  state?: StaticExtractionState;
  genericPolicy?: GenericDocPolicy;
};
export const buildTypeParams = (decl: TSTypeParameterDeclaration | null): DocTypeParam[] => {
  if (!decl) {
    return [];
  }
  return decl.params.map((p) => ({
    name: p.name.name,
    constraint: p.constraint ? buildDocTypeShallow(p.constraint) : undefined,
    default: p.default ? buildDocTypeShallow(p.default) : undefined,
  }));
};
export const buildPropertiesFromSignatures = (
  options: BuildPropertiesFromSignaturesOptions,
): DocProperty[] => {
  const { signatures, parsed, filePath, config, genericPolicy } = options;
  return buildStaticPropertiesFromSignatures(signatures, {
    parsed,
    filePath,
    config,
    buildType: (type) => buildDocType({ tsType: type, parsed, filePath, config, genericPolicy }),
    buildParams: (params) =>
      buildStaticFnParams(params, {
        buildType: (type) =>
          buildDocType({ tsType: type, parsed, filePath, config, genericPolicy }),
      }),
  });
};
export const extractPropertiesFromType = (
  options: ExtractPropertiesFromTypeOptions,
): DocProperty[] => {
  const { tsType, parsed, filePath, config, resolver, state, genericPolicy } = options;
  const depth = options.depth ?? 0;
  if (depth >= MAX_EXTENDS_DEPTH || depth > config.maxDepth) {
    recordBoundedExtractionDiagnostic({
      state,
      parsed,
      filePath,
      start: tsType.start,
      text: "<max depth>",
      reason: "maxDepth",
    });
    return [
      buildUnresolvedExtractionProperty({
        text: "<max depth>",
        parsed,
        filePath,
        start: tsType.start,
      }),
    ];
  }
  if (tsType.type === "TSTypeLiteral") {
    return buildPropertiesFromSignatures({
      signatures: tsType.members,
      parsed,
      filePath,
      config,
      genericPolicy,
    });
  }
  if (tsType.type === "TSParenthesizedType") {
    return extractPropertiesFromType({
      tsType: tsType.typeAnnotation,
      parsed,
      filePath,
      config,
      resolver,
      depth,
      state,
      genericPolicy,
    });
  }
  if (tsType.type === "TSIntersectionType") {
    const merged: DocProperty[] = [];
    for (const member of tsType.types) {
      mergeProperties(
        merged,
        extractPropertiesFromType({
          tsType: member,
          parsed,
          filePath,
          config,
          resolver,
          depth,
          state,
          genericPolicy,
        }),
      );
    }
    return merged;
  }
  if (tsType.type === "TSUnionType" && isObjectLikeUnionType(tsType)) {
    const merged: DocProperty[] = [];
    for (const member of tsType.types) {
      mergeUnionProperties(
        merged,
        extractPropertiesFromType({
          tsType: member,
          parsed,
          filePath,
          config,
          resolver,
          depth,
          state,
          genericPolicy,
        }),
      );
    }
    if (state && config.analysis !== "static") {
      state.semanticFallbackRequired = true;
    }
    return merged;
  }
  if (tsType.type === "TSTypeReference" && resolver) {
    const name = resolveTypeName(tsType.typeName);
    const args = tsType.typeArguments?.params ?? [];
    const utilityProps = extractPropertiesFromUtilityType({
      name,
      args,
      sourceType: tsType,
      parsed,
      filePath,
      config,
      resolver,
      depth,
      state,
      genericPolicy,
      extractProperties: extractPropertiesFromType,
    });
    if (utilityProps) {
      return utilityProps;
    }
    if (isPresetTransparentType(config.presets, name)) {
      const transparentType = args[0];
      if (!transparentType) {
        return [];
      }

      return extractPropertiesFromType({
        tsType: transparentType,
        parsed,
        filePath,
        config,
        resolver,
        depth: depth + 1,
        state,
        genericPolicy,
      });
    }
    if (isKnownUtilityType(name)) {
      return [
        buildUnresolvedExtractionProperty({
          text: parsed.source.slice(tsType.start, tsType.end),
          parsed,
          filePath,
          start: tsType.start,
        }),
      ];
    }
    if (config.analysis !== "static" && isPresetSemanticFallbackType(config.presets, name)) {
      if (state) {
        state.semanticFallbackRequired = true;
      }
      return [];
    }
    if (isIgnoredTypeName({ config, name })) {
      return [];
    }
    const resolved = resolver.resolveType({
      typeName: name,
      fromFile: filePath,
      fromParsed: parsed,
    });
    if (!resolved) {
      return [];
    }
    if (resolved.decl.type === "TSInterfaceDeclaration") {
      const substitutions = buildTypeSubstitutions({
        decl: resolved.decl,
        args,
        usageParsed: parsed,
        usageFilePath: filePath,
        declarationParsed: resolved.parsed,
        declarationFilePath: resolved.filePath,
        config,
        buildDocType,
        genericPolicy,
      });
      let properties = buildPropertiesFromSignatures({
        signatures: resolved.decl.body.body,
        parsed: resolved.parsed,
        filePath: resolved.filePath,
        config,
        genericPolicy:
          args.length === 0
            ? createGenericDocPolicy(buildTypeParams(resolved.decl.typeParameters))
            : undefined,
      });
      if (resolved.decl.extends && resolved.decl.extends.length > 0) {
        const inherited = resolveExtends({
          heritage: resolved.decl.extends,
          parsed: resolved.parsed,
          filePath: resolved.filePath,
          config,
          resolver,
          depth: depth + 1,
          state,
          options: {
            buildTypeParams,
            buildPropertiesFromSignatures,
            extractPropertiesFromType: extractPropertiesFromTypeForHeritage,
          },
        });
        const ownNames = new Set(properties.map((p) => p.name));
        properties = [...inherited.properties.filter((p) => !ownNames.has(p.name)), ...properties];
      }
      return applyTypeSubstitutionsToProperties({ properties, substitutions });
    }
    if (resolved.decl.type === "TSTypeAliasDeclaration") {
      const substitutions = buildTypeSubstitutions({
        decl: resolved.decl,
        args,
        usageParsed: parsed,
        usageFilePath: filePath,
        declarationParsed: resolved.parsed,
        declarationFilePath: resolved.filePath,
        config,
        buildDocType,
        genericPolicy,
      });
      const properties = extractPropertiesFromType({
        tsType: resolved.decl.typeAnnotation,
        parsed: resolved.parsed,
        filePath: resolved.filePath,
        config,
        resolver,
        depth: depth + 1,
        state,
        genericPolicy:
          args.length === 0
            ? createGenericDocPolicy(buildTypeParams(resolved.decl.typeParameters))
            : undefined,
      });
      return applyTypeSubstitutionsToProperties({ properties, substitutions });
    }
  }
  if (isSemanticObjectBoundary(tsType)) {
    if (state) {
      state.semanticFallbackRequired = true;
    }
  }
  return [];
};
const mergeProperties = (target: DocProperty[], additions: DocProperty[]): void => {
  for (const prop of additions) {
    const existing = target.findIndex((p) => p.name === prop.name);
    if (existing !== -1) {
      target.splice(existing, 1);
    }
    target.push(prop);
  }
};
const mergeUnionProperties = (target: DocProperty[], additions: DocProperty[]): void => {
  for (const prop of additions) {
    if (prop.name === UNRESOLVED_PROPERTY_NAME && prop.type.kind === "unresolved") {
      continue;
    }

    const existingIndex = target.findIndex((candidate) => candidate.name === prop.name);
    if (existingIndex === -1) {
      target.push(prop);
      continue;
    }

    target[existingIndex] = mergeUnionProperty(target[existingIndex], prop);
  }
};
const mergeUnionProperty = (left: DocProperty, right: DocProperty): DocProperty => {
  return {
    ...left,
    type: createUnionDocType(
      uniqueDocTypes([...flattenUnion(left.type), ...flattenUnion(right.type)]),
    ),
    optional: left.optional || right.optional,
    readonly: left.readonly && right.readonly,
    description: left.description || right.description,
    tags: { ...right.tags, ...left.tags },
    defaultValue: left.defaultValue ?? right.defaultValue,
  };
};
const flattenUnion = (type: DocType): DocType[] => {
  return type.kind === "union" ? type.members : [type];
};
const uniqueDocTypes = (types: DocType[]): DocType[] => {
  const seen = new Set<string>();
  const unique: DocType[] = [];
  for (const type of types) {
    const key = JSON.stringify(type);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(type);
  }
  return unique;
};
export const buildObjectDocType = (properties: DocProperty[]): DocType => {
  return { kind: "object", properties };
};
export const extractPropertiesFromTypeForHeritage = (
  options: ExtractPropertiesFromTypeForHeritageOptions,
): DocProperty[] => {
  const { tsType, parsed, filePath, config, resolver, depth, state, genericPolicy } = options;
  const properties = extractPropertiesFromType({
    tsType,
    parsed,
    filePath,
    config,
    resolver,
    depth,
    state,
    genericPolicy,
  });
  if (state && hasUnresolvedExtraction(properties)) {
    state.semanticFallbackRequired = true;
  }

  return properties;
};
