import type {
  TSInterfaceHeritage,
  TSSignature,
  TSType,
  TSTypeName,
  TSTypeParameterDeclaration,
} from "oxc-parser";

import type { StaticExtractionState } from "../builders/property-extraction-diagnostics";
import type { DocgenConfig } from "../public/config";
import type {
  DocHeritageReference,
  DocProperty,
  DocTypeParam,
  DocTypeReferenceTarget,
} from "../schema/doc-schema";
import type { GenericDocPolicy } from "./generic-doc-policy";
import type { ParsedSource } from "./parser";
import type { TypeResolver } from "./resolver";

import { getTypeArgumentParams } from "../builders/oxc-ast-compat";
import { isKnownUtilityType } from "../builders/property-extraction-policy";
import { buildDocType } from "../builders/type-builder";
import { normalizePath } from "../utils/path-utils";
import { offsetToLocation } from "../utils/source-location";
import { createGenericDocPolicy } from "./generic-doc-policy";
import { applyTypeSubstitutionsToProperties, buildTypeSubstitutions } from "./generic-substitution";
import { isIgnoredTypeName } from "./ignored-types";
const MAX_HERITAGE_DEPTH = 10;
export type BuildTypeParamsFn = (decl: TSTypeParameterDeclaration | null) => DocTypeParam[];
export type BuildPropertiesFromSignaturesOptions = {
  signatures: TSSignature[];
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  genericPolicy?: GenericDocPolicy;
};
export type BuildPropertiesFromSignaturesFn = (
  options: BuildPropertiesFromSignaturesOptions,
) => DocProperty[];
export type ExtractHeritagePropertiesFromTypeOptions = {
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
export type ExtractHeritagePropertiesFromTypeFn = (
  options: ExtractHeritagePropertiesFromTypeOptions,
) => DocProperty[];
export type ResolveExtendsOptions = {
  buildTypeParams: BuildTypeParamsFn;
  buildPropertiesFromSignatures: BuildPropertiesFromSignaturesFn;
  extractPropertiesFromType: ExtractHeritagePropertiesFromTypeFn;
  genericPolicy?: GenericDocPolicy;
};
export type ResolveExtendsInput = {
  heritage: TSInterfaceHeritage[];
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  resolver: TypeResolver;
  depth: number;
  /**
   * Mutable static extraction state shared by the current entry build.
   */
  state?: StaticExtractionState;
  options: ResolveExtendsOptions;
};
export type ResolveExtendsResult = {
  /**
   * Properties expanded from resolvable heritage clauses.
   */
  properties: DocProperty[];
  /**
   * Heritage clauses preserved instead of expanded.
   */
  references: DocHeritageReference[];
};
export const resolveExtends = (input: ResolveExtendsInput): ResolveExtendsResult => {
  const { heritage, parsed, filePath, config, resolver, depth, state, options } = input;
  if (depth >= MAX_HERITAGE_DEPTH) {
    return { properties: [], references: [] };
  }
  const allProps: DocProperty[] = [];
  const allReferences: DocHeritageReference[] = [];
  for (const parent of heritage) {
    const expr = parent.expression;
    const parentName = resolveHeritageName({ parent, parsed });
    if (expr.type !== "Identifier") {
      allReferences.push(
        createHeritageReference({
          parent,
          parsed,
          filePath,
          name: parentName,
          reason: isIgnoredTypeName({ config, name: parentName }) ? "ignored" : "unsupported",
        }),
      );
      continue;
    }
    if (isKnownUtilityType(parentName)) {
      const extracted = options.extractPropertiesFromType({
        tsType: {
          type: "TSTypeReference",
          typeName: parent.expression as TSTypeName,
          typeArguments: parent.typeArguments,
          start: parent.start,
          end: parent.end,
        },
        parsed,
        filePath,
        config,
        resolver,
        depth: depth + 1,
        state,
        genericPolicy: options.genericPolicy,
      });
      allProps.push(...extracted);
      continue;
    }
    if (isIgnoredTypeName({ config, name: parentName })) {
      allReferences.push(
        createHeritageReference({
          parent,
          parsed,
          filePath,
          name: parentName,
          reason: "ignored",
          target: resolveHeritageReferenceTarget({
            resolver,
            typeName: parentName,
            fromFile: filePath,
            fromParsed: parsed,
          }),
        }),
      );
      continue;
    }
    const resolved = resolver.resolveType({
      typeName: parentName,
      fromFile: filePath,
      fromParsed: parsed,
    });
    if (!resolved) {
      const target = resolveHeritageReferenceTarget({
        resolver,
        typeName: parentName,
        fromFile: filePath,
        fromParsed: parsed,
      });
      allReferences.push(
        createHeritageReference({
          parent,
          parsed,
          filePath,
          name: parentName,
          reason: getUnexpandedHeritageReason({ config, target }),
          target,
        }),
      );
      continue;
    }
    if (resolved.decl.type === "TSInterfaceDeclaration") {
      const args = extractHeritageTypeArguments(parent);
      const parentGenericPolicy =
        args.length === 0
          ? createGenericDocPolicy(options.buildTypeParams(resolved.decl.typeParameters))
          : undefined;
      const parentProps = options.buildPropertiesFromSignatures({
        signatures: resolved.decl.body.body,
        parsed: resolved.parsed,
        filePath: resolved.filePath,
        config,
        genericPolicy: parentGenericPolicy,
      });
      const substitutions = buildTypeSubstitutions({
        decl: resolved.decl,
        args,
        usageParsed: parsed,
        usageFilePath: filePath,
        declarationParsed: resolved.parsed,
        declarationFilePath: resolved.filePath,
        config,
        buildDocType,
        genericPolicy: options.genericPolicy,
      });
      const substitutedParentProps = applyTypeSubstitutionsToProperties({
        properties: parentProps,
        substitutions,
      });
      if (resolved.decl.extends && resolved.decl.extends.length > 0) {
        const grandparent = resolveExtends({
          heritage: resolved.decl.extends,
          parsed: resolved.parsed,
          filePath: resolved.filePath,
          config,
          resolver,
          depth: depth + 1,
          state,
          options: { ...options, genericPolicy: undefined },
        });
        allReferences.push(...grandparent.references);
        const substitutedGrandparentProps = applyTypeSubstitutionsToProperties({
          properties: grandparent.properties,
          substitutions,
        });
        const parentNames = new Set(substitutedParentProps.map((p) => p.name));
        const merged = substitutedGrandparentProps.filter((p) => !parentNames.has(p.name));
        allProps.push(...merged);
      }
      allProps.push(...substitutedParentProps);
    } else if (resolved.decl.type === "TSTypeAliasDeclaration") {
      const args = extractHeritageTypeArguments(parent);
      const extracted = options.extractPropertiesFromType({
        tsType: resolved.decl.typeAnnotation,
        parsed: resolved.parsed,
        filePath: resolved.filePath,
        config,
        resolver,
        depth: depth + 1,
        state,
        genericPolicy:
          args.length === 0
            ? createGenericDocPolicy(options.buildTypeParams(resolved.decl.typeParameters))
            : undefined,
      });
      const substitutions = buildTypeSubstitutions({
        decl: resolved.decl,
        args,
        usageParsed: parsed,
        usageFilePath: filePath,
        declarationParsed: resolved.parsed,
        declarationFilePath: resolved.filePath,
        config,
        buildDocType,
        genericPolicy: options.genericPolicy,
      });
      allProps.push(
        ...applyTypeSubstitutionsToProperties({
          properties: extracted,
          substitutions,
        }),
      );
    }
  }
  return { properties: allProps, references: allReferences };
};
export const extractHeritageTypeArguments = (parent: TSInterfaceHeritage): TSType[] => {
  return getTypeArgumentParams(parent);
};
type ResolveHeritageNameOptions = {
  /**
   * Heritage clause to name.
   */
  parent: TSInterfaceHeritage;
  /**
   * Parsed source used for fallback display text.
   */
  parsed: ParsedSource;
};
const resolveHeritageName = (options: ResolveHeritageNameOptions): string => {
  const { parent, parsed } = options;
  const expression = parent.expression as {
    type: string;
    name?: string;
    start: number;
    end: number;
  };

  if (expression.type === "Identifier" && expression.name) {
    return expression.name;
  }

  return parsed.source.slice(expression.start, expression.end).trim() || "<unknown>";
};
type ResolveHeritageReferenceTargetOptions = {
  /**
   * Resolver used for reference-only target lookup.
   */
  resolver: TypeResolver;
  /**
   * Referenced heritage type name.
   */
  typeName: string;
  /**
   * Source file containing the heritage clause.
   */
  fromFile: string;
  /**
   * Parsed source containing the heritage clause.
   */
  fromParsed: ParsedSource;
};
const resolveHeritageReferenceTarget = (
  options: ResolveHeritageReferenceTargetOptions,
): DocTypeReferenceTarget | undefined => {
  const resolved = options.resolver.resolveTypeReference({
    typeName: options.typeName,
    fromFile: options.fromFile,
    fromParsed: options.fromParsed,
  });

  if (!resolved) {
    return undefined;
  }

  return {
    name: resolved.decl.id.name,
    filePath: normalizePath(resolved.filePath),
  };
};
type GetUnexpandedHeritageReasonOptions = {
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Resolved reference target when one exists.
   */
  target: DocTypeReferenceTarget | undefined;
};
const getUnexpandedHeritageReason = (
  options: GetUnexpandedHeritageReasonOptions,
): DocHeritageReference["reason"] => {
  const { config, target } = options;
  if (!target) {
    return "unresolved";
  }

  if (!normalizePath(target.filePath).includes("/node_modules/")) {
    return "unresolved";
  }

  return config.externalTypes === "ignore" ? "ignored" : "externalReference";
};
type CreateHeritageReferenceOptions = {
  /**
   * Heritage clause that produced the reference.
   */
  parent: TSInterfaceHeritage;
  /**
   * Parsed source containing the heritage clause.
   */
  parsed: ParsedSource;
  /**
   * Source file containing the heritage clause.
   */
  filePath: string;
  /**
   * Display name for the referenced heritage type.
   */
  name: string;
  /**
   * Why this heritage clause was not expanded into properties.
   */
  reason: DocHeritageReference["reason"];
  /**
   * Resolved target when known.
   */
  target?: DocTypeReferenceTarget;
};
const createHeritageReference = (options: CreateHeritageReferenceOptions): DocHeritageReference => {
  const { parent, parsed, filePath, name, reason, target } = options;
  return {
    name,
    reason,
    source: offsetToLocation({
      parsed,
      offset: parent.expression.start,
      filePath: normalizePath(filePath),
    }),
    ...(target ? { target } : {}),
  };
};
