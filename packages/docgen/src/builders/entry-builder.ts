import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "../resolver/module-resolver";
import type { ParsedSource } from "../resolver/parser";
import type { TypeResolver } from "../resolver/resolver";
import type { DocEntry, DocHeritageReference, DocType } from "../schema/doc-schema";

import { createGenericDocPolicy } from "../resolver/generic-doc-policy";
import { resolveExtends } from "../resolver/heritage";
import { findTypeDeclaration } from "../resolver/parser";
import { extractJSDocForNode } from "../utils/jsdoc";
import { filterEntryProperties } from "../utils/prop-filter";
import { offsetToLocation } from "../utils/source-location";
import { buildEnumMembers } from "./enum-builder";
import { createStaticExtractionState } from "./property-extraction-diagnostics";
import {
  buildObjectDocType,
  buildPropertiesFromSignatures,
  buildTypeParams,
  extractPropertiesFromType,
  extractPropertiesFromTypeForHeritage,
  filterUnresolvedExtractionProperties,
  hasUnresolvedExtraction,
  shouldExtractAliasProperties,
  shouldRequireAliasSemanticFallback,
  type StaticExtractionState,
} from "./property-extractor";
import { buildDocType } from "./type-builder";
export type StaticResolutionStatus = "resolved" | "partial" | "semanticFallbackRequired" | "opaque";
export type StaticDocEntryResult = {
  status: StaticResolutionStatus;
  entry: DocEntry | undefined;
  diagnostics: ResolverDiagnostic[];
};
type BuildDocEntryOptions = {
  parsed: ParsedSource;
  typeName: string;
  filePath: string;
  config: DocgenConfig;
  resolver?: TypeResolver;
};

export const buildDocEntry = (options: BuildDocEntryOptions): DocEntry | undefined => {
  return buildStaticDocEntry(options).entry;
};
export const buildStaticDocEntry = (options: BuildDocEntryOptions): StaticDocEntryResult => {
  const { parsed, typeName, filePath, config, resolver } = options;
  const state: StaticExtractionState = createStaticExtractionState();
  const entry = buildDocEntryInternal({ parsed, typeName, filePath, config, resolver, state });
  if (!entry) {
    return { status: "opaque", entry: undefined, diagnostics: state.diagnostics };
  }
  return { status: classifyStaticEntry(entry, state), entry, diagnostics: state.diagnostics };
};
type BuildDocEntryInternalOptions = BuildDocEntryOptions & {
  resolver: TypeResolver | undefined;
  state: StaticExtractionState;
};

const buildDocEntryInternal = (options: BuildDocEntryInternalOptions): DocEntry | undefined => {
  const { parsed, typeName, filePath, config, resolver, state } = options;
  const found = findTypeDeclaration(parsed, typeName);
  if (!found) {
    return undefined;
  }
  const { decl, statementStart } = found;
  const jsdoc = extractJSDocForNode({
    parsed,
    nodeStart: statementStart,
    tagParsers: config.tags,
  });
  const source = offsetToLocation({ parsed, offset: decl.start, filePath });
  if (decl.type === "TSInterfaceDeclaration") {
    const typeParams = buildTypeParams(decl.typeParameters);
    const genericPolicy = createGenericDocPolicy(typeParams);
    let properties = buildPropertiesFromSignatures({
      signatures: decl.body.body,
      parsed,
      filePath,
      config,
      genericPolicy,
    });
    const ownNames = new Set(properties.map((p) => p.name));
    const inheritedNames = new Set<string>();
    let heritage: DocHeritageReference[] | undefined;
    if (decl.extends && decl.extends.length > 0 && resolver) {
      const inherited = resolveExtends({
        heritage: decl.extends,
        parsed,
        filePath,
        config,
        resolver,
        depth: 0,
        state,
        options: {
          buildTypeParams,
          buildPropertiesFromSignatures,
          extractPropertiesFromType: extractPropertiesFromTypeForHeritage,
          genericPolicy,
        },
      });
      const merged = inherited.properties.filter((p) => !ownNames.has(p.name));
      for (const prop of merged) inheritedNames.add(prop.name);
      properties = [...merged, ...properties];
      heritage = inherited.references.length > 0 ? inherited.references : undefined;
    }
    const type = buildObjectDocType(properties);
    return filterEntryProperties({
      entry: {
        name: typeName,
        kind: "interface",
        description: jsdoc.description,
        tags: jsdoc.tags,
        typeParameters: typeParams,
        properties,
        type,
        source,
        ...(heritage ? { heritage } : {}),
      },
      config,
      rootFile: filePath,
      inheritedNames,
    });
  }
  if (decl.type === "TSTypeAliasDeclaration") {
    const typeParams = buildTypeParams(decl.typeParameters);
    const genericPolicy = createGenericDocPolicy(typeParams);
    const type = buildDocType({
      tsType: decl.typeAnnotation,
      parsed,
      filePath,
      config,
      genericPolicy,
    });
    let properties = type.kind === "object" ? type.properties : [];
    const shouldExtractProperties =
      type.kind !== "object" && shouldExtractAliasProperties(decl.typeAnnotation, config);
    if (shouldExtractProperties) {
      properties = extractPropertiesFromType({
        tsType: decl.typeAnnotation,
        parsed,
        filePath,
        config,
        resolver,
        depth: 0,
        state,
        genericPolicy,
      });
    }
    if (
      type.kind !== "object" &&
      !shouldExtractProperties &&
      shouldRequireAliasSemanticFallback({
        tsType: decl.typeAnnotation,
        docType: type,
        config,
      })
    ) {
      state.semanticFallbackRequired = true;
    }
    if (hasUnresolvedExtraction(properties)) {
      state.semanticFallbackRequired = true;
    }
    properties = filterUnresolvedExtractionProperties(properties, config);
    return filterEntryProperties({
      entry: {
        name: typeName,
        kind: "typeAlias",
        description: jsdoc.description,
        tags: jsdoc.tags,
        typeParameters: typeParams,
        properties,
        type,
        source,
      },
      config,
      rootFile: filePath,
    });
  }
  if (decl.type === "TSEnumDeclaration") {
    const properties = buildEnumMembers({ decl, parsed, filePath, config });
    const memberTypes = properties.map((p) => p.type);
    const type: DocType =
      memberTypes.length > 0
        ? { kind: "union", members: memberTypes }
        : { kind: "intrinsic", name: "never" };
    return filterEntryProperties({
      entry: {
        name: typeName,
        kind: "enum",
        description: jsdoc.description,
        tags: jsdoc.tags,
        typeParameters: [],
        properties,
        type,
        source,
      },
      config,
      rootFile: filePath,
    });
  }
  return undefined;
};
const classifyStaticEntry = (
  entry: DocEntry,
  state: StaticExtractionState,
): StaticResolutionStatus => {
  if (state.semanticFallbackRequired) {
    return "semanticFallbackRequired";
  }
  if (entry.type.kind === "unresolved") {
    return "opaque";
  }
  if (
    containsUnresolvedDocType(entry.type) ||
    entry.properties.some((property) => containsUnresolvedDocType(property.type))
  ) {
    return "partial";
  }
  return "resolved";
};
const containsUnresolvedDocType = (type: DocType): boolean => {
  switch (type.kind) {
    case "unresolved":
      return true;
    case "union":
    case "intersection":
      return type.members.some(containsUnresolvedDocType);
    case "array":
      return containsUnresolvedDocType(type.elementType);
    case "tuple":
      return type.elements.some(containsUnresolvedDocType);
    case "object":
      return type.properties.some((property) => containsUnresolvedDocType(property.type));
    case "function":
      return (
        type.parameters.some((parameter) => containsUnresolvedDocType(parameter.type)) ||
        containsUnresolvedDocType(type.returnType)
      );
    case "mapped":
      return containsUnresolvedDocType(type.constraint) || containsUnresolvedDocType(type.type);
    case "conditional":
      return (
        containsUnresolvedDocType(type.checkType) ||
        containsUnresolvedDocType(type.extendsType) ||
        containsUnresolvedDocType(type.trueType) ||
        containsUnresolvedDocType(type.falseType)
      );
    case "indexedAccess":
      return (
        containsUnresolvedDocType(type.objectType) || containsUnresolvedDocType(type.indexType)
      );
    case "templateLiteral":
      return type.spans.some((span) => "type" in span && containsUnresolvedDocType(span.type));
    case "keyof":
    case "rest":
      return containsUnresolvedDocType(type.type);
    case "reference":
      return type.typeArguments?.some(containsUnresolvedDocType) ?? false;
    default:
      return false;
  }
};
