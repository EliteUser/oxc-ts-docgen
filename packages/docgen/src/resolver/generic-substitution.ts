import type { TSInterfaceDeclaration, TSType, TSTypeAliasDeclaration } from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { DocProperty, DocType } from "../schema/doc-schema";
import type { GenericDocPolicy } from "./generic-doc-policy";
import type { ParsedSource } from "./parser";
export type BuildDocTypeOptions = {
  tsType: TSType;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  genericPolicy?: GenericDocPolicy;
};
export type BuildDocTypeFn = (options: BuildDocTypeOptions) => DocType;
export type BuildTypeSubstitutionsOptions = {
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration;
  args: TSType[];
  usageParsed: ParsedSource;
  usageFilePath: string;
  declarationParsed: ParsedSource;
  declarationFilePath: string;
  config: DocgenConfig;
  buildDocType: BuildDocTypeFn;
  genericPolicy?: GenericDocPolicy;
};
export type ApplyTypeSubstitutionsToPropertiesOptions = {
  properties: DocProperty[];
  substitutions: Map<string, DocType>;
};
export type SubstituteDocTypeOptions = {
  type: DocType;
  substitutions: Map<string, DocType>;
  resolving?: Set<string>;
};

export const buildTypeSubstitutions = (
  options: BuildTypeSubstitutionsOptions,
): Map<string, DocType> => {
  const {
    decl,
    args,
    usageParsed,
    usageFilePath,
    declarationParsed,
    declarationFilePath,
    config,
    buildDocType,
    genericPolicy,
  } = options;
  const params = decl.typeParameters?.params ?? [];
  const substitutions = new Map<string, DocType>();
  for (let index = 0; index < params.length; index++) {
    const param = params[index];
    const name = param.name.name;
    const arg = args[index];
    if (arg) {
      substitutions.set(
        name,
        buildDocType({
          tsType: arg,
          parsed: usageParsed,
          filePath: usageFilePath,
          config,
          genericPolicy,
        }),
      );
    } else if (param.default) {
      substitutions.set(
        name,
        buildDocType({
          tsType: param.default,
          parsed: declarationParsed,
          filePath: declarationFilePath,
          config,
        }),
      );
    }
  }
  return substitutions;
};
export const applyTypeSubstitutionsToProperties = (
  options: ApplyTypeSubstitutionsToPropertiesOptions,
): DocProperty[] => {
  const { properties, substitutions } = options;
  if (substitutions.size === 0) {
    return properties;
  }
  return properties.map((prop) => ({
    ...prop,
    type: substituteDocType({ type: prop.type, substitutions }),
  }));
};
export const substituteDocType = (options: SubstituteDocTypeOptions): DocType => {
  const { type, substitutions } = options;
  const resolving = options.resolving ?? new Set<string>();
  switch (type.kind) {
    case "reference": {
      const replacement = substitutions.get(type.name);
      if (replacement) {
        if (resolving.has(type.name)) {
          return type;
        }
        resolving.add(type.name);
        const substituted = substituteDocType({ type: replacement, substitutions, resolving });
        resolving.delete(type.name);
        return substituted;
      }
      if (!type.typeArguments?.length) {
        return type;
      }
      return {
        ...type,
        typeArguments: type.typeArguments.map((arg) =>
          substituteDocType({ type: arg, substitutions, resolving }),
        ),
      };
    }
    case "union":
      return {
        ...type,
        members: type.members.map((member) =>
          substituteDocType({ type: member, substitutions, resolving }),
        ),
      };
    case "intersection":
      return {
        ...type,
        members: type.members.map((member) =>
          substituteDocType({ type: member, substitutions, resolving }),
        ),
      };
    case "array":
      return {
        ...type,
        elementType: substituteDocType({ type: type.elementType, substitutions, resolving }),
      };
    case "tuple":
      return {
        ...type,
        elements: type.elements.map((element) =>
          substituteDocType({ type: element, substitutions, resolving }),
        ),
      };
    case "object":
      return {
        ...type,
        properties: applyTypeSubstitutionsToProperties({
          properties: type.properties,
          substitutions,
        }),
      };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((param) => ({
          ...param,
          type: substituteDocType({ type: param.type, substitutions, resolving }),
        })),
        returnType: substituteDocType({ type: type.returnType, substitutions, resolving }),
      };
    case "mapped":
      return {
        ...type,
        constraint: substituteDocType({ type: type.constraint, substitutions, resolving }),
        type: substituteDocType({ type: type.type, substitutions, resolving }),
      };
    case "conditional":
      return {
        ...type,
        checkType: substituteDocType({ type: type.checkType, substitutions, resolving }),
        extendsType: substituteDocType({ type: type.extendsType, substitutions, resolving }),
        trueType: substituteDocType({ type: type.trueType, substitutions, resolving }),
        falseType: substituteDocType({ type: type.falseType, substitutions, resolving }),
      };
    case "indexedAccess":
      return {
        ...type,
        objectType: substituteDocType({ type: type.objectType, substitutions, resolving }),
        indexType: substituteDocType({ type: type.indexType, substitutions, resolving }),
      };
    case "templateLiteral":
      return {
        ...type,
        spans: type.spans.map((span) =>
          "type" in span
            ? { type: substituteDocType({ type: span.type, substitutions, resolving }) }
            : span,
        ),
      };
    case "keyof":
      return { ...type, type: substituteDocType({ type: type.type, substitutions, resolving }) };
    case "rest":
      return { ...type, type: substituteDocType({ type: type.type, substitutions, resolving }) };
    default:
      return type;
  }
};
