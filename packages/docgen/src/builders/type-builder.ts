import type {
  TSType,
  TSFunctionType,
  TSTypeLiteral,
  TSMappedType,
  TSTemplateLiteralType,
  TSLiteral,
  TSTupleElement,
} from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { GenericDocPolicy } from "../resolver/generic-doc-policy";
import type { ParsedSource } from "../resolver/parser";
import type { DocProperty, DocType } from "../schema/doc-schema";

import {
  createArrayDocType,
  createIntrinsicDocType,
  createIntersectionDocType,
  createLiteralDocType,
  createPrimitiveDocType,
  createReferenceDocType,
  createTupleDocType,
  createUnionDocType,
  createUnresolvedDocType,
} from "../model/doc-type-factory";
import {
  docTypesEqual,
  flattenUnion,
  removeIntrinsicUnionMembers,
  unionOrNever,
} from "../model/doc-type-utils";
import { resolveGenericDisplayType } from "../resolver/generic-doc-policy";
import { isIgnoredTypeName } from "../resolver/ignored-types";
import {
  getLiteralLike,
  getTupleElementLike,
  getTupleElementType,
  getTypeNameLike,
  getUnaryExpressionLike,
  getWrappedTypeAnnotation,
} from "./oxc-ast-compat";
import { buildStaticFnParams } from "./static-function-params";
import { buildStaticPropertiesFromSignatures } from "./static-property-builder";

type BuildDocTypeOptions = {
  tsType: TSType;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  genericPolicy?: GenericDocPolicy;
};

type BuildDocTypeInternalOptions = BuildDocTypeOptions & {
  depth: number;
};

export const buildDocType = (options: BuildDocTypeOptions): DocType => {
  return buildDocTypeInternal({ ...options, depth: 0 });
};
const buildDocTypeInternal = (options: BuildDocTypeInternalOptions): DocType => {
  const { tsType, parsed, filePath, config, depth, genericPolicy } = options;
  if (depth > config.maxDepth) {
    return createUnresolvedDocType("<max depth>");
  }
  const recurse = (t: TSType) =>
    buildDocTypeInternal({
      tsType: t,
      parsed,
      filePath,
      config,
      depth: depth + 1,
      genericPolicy,
    });
  switch (tsType.type) {
    case "TSStringKeyword":
      return createPrimitiveDocType("string");
    case "TSNumberKeyword":
      return createPrimitiveDocType("number");
    case "TSBooleanKeyword":
      return createPrimitiveDocType("boolean");
    case "TSBigIntKeyword":
      return createPrimitiveDocType("bigint");
    case "TSSymbolKeyword":
      return createPrimitiveDocType("symbol");
    case "TSObjectKeyword":
      return createPrimitiveDocType("object");
    case "TSAnyKeyword":
      return createIntrinsicDocType("any");
    case "TSUnknownKeyword":
      return createIntrinsicDocType("unknown");
    case "TSNeverKeyword":
      return createIntrinsicDocType("never");
    case "TSVoidKeyword":
      return createIntrinsicDocType("void");
    case "TSNullKeyword":
      return createIntrinsicDocType("null");
    case "TSUndefinedKeyword":
      return createIntrinsicDocType("undefined");
    case "TSIntrinsicKeyword":
      return createIntrinsicDocType("intrinsic");
    case "TSThisType":
      return createIntrinsicDocType("this");
    case "TSLiteralType":
      return buildLiteralType(tsType.literal);
    case "TSUnionType":
      return createUnionDocType(tsType.types.map(recurse));
    case "TSIntersectionType":
      return createIntersectionDocType(tsType.types.map(recurse));
    case "TSArrayType":
      return createArrayDocType(recurse(tsType.elementType));
    case "TSTupleType":
      return buildTupleType(tsType.elementTypes, recurse);
    case "TSTypeLiteral":
      return buildTypeLiteral({ tsType, parsed, filePath, config, depth, genericPolicy });
    case "TSTypeReference":
      return buildTypeReference({ tsType, recurse, config, genericPolicy });
    case "TSFunctionType":
      return buildFunctionType({ tsType, parsed, filePath, config, depth, genericPolicy });
    case "TSParenthesizedType":
      return recurse(tsType.typeAnnotation);
    case "TSTypeOperator":
      if (tsType.operator === "keyof") {
        return { kind: "keyof", type: recurse(tsType.typeAnnotation) };
      }
      if (tsType.operator === "readonly") {
        return recurse(tsType.typeAnnotation);
      }
      return createUnresolvedDocType(`${tsType.operator} <type>`);
    case "TSConditionalType":
      return {
        kind: "conditional",
        checkType: recurse(tsType.checkType),
        extendsType: recurse(tsType.extendsType),
        trueType: recurse(tsType.trueType),
        falseType: recurse(tsType.falseType),
      };
    case "TSIndexedAccessType":
      return {
        kind: "indexedAccess",
        objectType: recurse(tsType.objectType),
        indexType: recurse(tsType.indexType),
      };
    case "TSMappedType":
      return buildMappedType(tsType, recurse);
    case "TSTemplateLiteralType":
      return buildTemplateLiteralType(tsType, recurse);
    case "TSInferType":
      return { kind: "infer", name: tsType.typeParameter.name.name };
    case "TSTypeQuery":
      return buildTypeofType(tsType);
    case "TSTypePredicate":
      return createPrimitiveDocType("boolean");
    case "TSJSDocNullableType":
    case "TSJSDocNonNullableType": {
      const annotation = getWrappedTypeAnnotation(tsType);
      return annotation ? recurse(annotation) : createIntrinsicDocType("unknown");
    }
    case "TSJSDocUnknownType":
      return createIntrinsicDocType("unknown");
    case "TSImportType":
    case "TSConstructorType":
    case "TSNamedTupleMember":
      return createUnresolvedDocType(parsed.source.slice(tsType.start, tsType.end));
    default:
      return createUnresolvedDocType("<unknown>");
  }
};
const buildLiteralType = (literal: TSLiteral): DocType => {
  if (literal.type === "Literal") {
    const lit = getLiteralLike(literal);
    const val = lit.value;
    if (typeof val === "string") {
      return createLiteralDocType(`'${val}'`);
    }
    if (typeof val === "number") {
      return createLiteralDocType(String(val));
    }
    if (typeof val === "boolean") {
      return createLiteralDocType(String(val));
    }
    if (typeof val === "bigint") {
      return createLiteralDocType(`${val}n`);
    }
    if (val === null) {
      return createIntrinsicDocType("null");
    }
    return createLiteralDocType(String(val));
  }
  if (literal.type === "UnaryExpression") {
    const unary = getUnaryExpressionLike(literal);
    const argVal = unary.argument?.value;
    return createLiteralDocType(`${unary.operator}${argVal ?? "?"}`);
  }
  if (literal.type === "TemplateLiteral") {
    return createLiteralDocType("`<template>`");
  }
  return createLiteralDocType("<literal>");
};
const buildTupleType = (elements: TSTupleElement[], recurse: (t: TSType) => DocType): DocType => {
  const mapped = elements.map((el) => buildTupleElement(el, recurse));
  return createTupleDocType(mapped);
};
const buildTupleElement = (el: TSTupleElement, recurse: (t: TSType) => DocType): DocType => {
  const element = getTupleElementLike(el);
  if (element.type === "TSRestType" && element.typeAnnotation) {
    return { kind: "rest", type: recurse(element.typeAnnotation) };
  }
  if (element.type === "TSOptionalType" && element.typeAnnotation) {
    return recurse(element.typeAnnotation);
  }
  if (element.type === "TSNamedTupleMember" && element.elementType) {
    return buildTupleElement(element.elementType, recurse);
  }
  return recurse(getTupleElementType(el));
};
type BuildTypeReferenceInput = {
  tsType: {
    typeName: {
      type: string;
      name?: string;
      left?: unknown;
      right?: {
        name: string;
      };
    };
    typeArguments: {
      params: TSType[];
    } | null;
  };
  recurse: (t: TSType) => DocType;
  config: DocgenConfig;
  genericPolicy?: GenericDocPolicy;
};

const buildTypeReference = (input: BuildTypeReferenceInput): DocType => {
  const { tsType, recurse, config, genericPolicy } = input;
  const name = resolveTypeName(tsType.typeName);
  const args = tsType.typeArguments?.params;
  if (!args || args.length === 0) {
    const displayType = resolveGenericDisplayType(name, genericPolicy);
    if (displayType) {
      return displayType;
    }
  }
  if (name === "Array" || name === "ReadonlyArray") {
    if (args && args.length === 1) {
      return { kind: "array", elementType: recurse(args[0]) };
    }
  }
  const typeArguments = args?.map(recurse);
  if (typeArguments && typeArguments.length > 0) {
    const utilityType = buildSupportedUtilityDocType(name, typeArguments);
    if (utilityType) {
      return utilityType;
    }
  }
  if (isIgnoredTypeName({ config, name })) {
    return createReferenceDocType({ name, typeArguments });
  }
  if (typeArguments && typeArguments.length > 0) {
    return createReferenceDocType({ name, typeArguments });
  }
  return createReferenceDocType({ name });
};
const buildSupportedUtilityDocType = (name: string, args: DocType[]): DocType | undefined => {
  if (name === "NonNullable" && args.length >= 1) {
    return removeNullableType(args[0]);
  }
  if ((name === "Extract" || name === "Exclude") && args.length >= 2) {
    const candidates = flattenUnion(args[1]);
    const members = flattenUnion(args[0]).filter((member) => {
      const match = candidates.some((candidate) => docTypesEqual(member, candidate));
      return name === "Extract" ? match : !match;
    });
    return unionOrNever(members);
  }
  if (name === "ReturnType" && args.length >= 1 && args[0].kind === "function") {
    return args[0].returnType;
  }
  if (name === "Parameters" && args.length >= 1 && args[0].kind === "function") {
    return createTupleDocType(args[0].parameters.map((param) => param.type));
  }
  return undefined;
};
const removeNullableType = (type: DocType): DocType => {
  return removeIntrinsicUnionMembers({
    type,
    names: ["null", "undefined"],
    emptyFallback: { kind: "intrinsic", name: "never" },
  });
};
export const resolveTypeName = (typeName: {
  type: string;
  name?: string;
  left?: unknown;
  right?: {
    name: string;
  };
}): string => {
  if (typeName.type === "Identifier" && typeName.name) {
    return typeName.name;
  }
  if (typeName.type === "TSQualifiedName") {
    const left = resolveTypeName(getTypeNameLike(typeName.left));
    return `${left}.${typeName.right?.name ?? ""}`;
  }
  if (typeName.type === "ThisExpression") {
    return "this";
  }
  return "<unknown>";
};
const buildTypeLiteral = (input: {
  tsType: TSTypeLiteral;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  depth: number;
  genericPolicy?: GenericDocPolicy;
}): DocType => {
  const { tsType, parsed, filePath, config, depth, genericPolicy } = input;
  const properties: DocProperty[] = buildStaticPropertiesFromSignatures(tsType.members, {
    parsed,
    filePath,
    config,
    buildType: (type) =>
      buildDocTypeInternal({
        tsType: type,
        parsed,
        filePath,
        config,
        depth: depth + 1,
        genericPolicy,
      }),
    buildParams: (params) =>
      buildStaticFnParams(params, {
        buildType: (type) =>
          buildDocTypeInternal({
            tsType: type,
            parsed,
            filePath,
            config,
            depth: depth + 1,
            genericPolicy,
          }),
      }),
  });
  return { kind: "object", properties };
};
const buildFunctionType = (input: {
  tsType: TSFunctionType;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  depth: number;
  genericPolicy?: GenericDocPolicy;
}): DocType => {
  const { tsType, parsed, filePath, config, depth, genericPolicy } = input;
  const params = buildStaticFnParams(tsType.params, {
    buildType: (type) =>
      buildDocTypeInternal({
        tsType: type,
        parsed,
        filePath,
        config,
        depth: depth + 1,
        genericPolicy,
      }),
  });
  const returnType = buildDocTypeInternal({
    tsType: tsType.returnType.typeAnnotation,
    parsed,
    filePath,
    config,
    depth: depth + 1,
    genericPolicy,
  });
  return { kind: "function", parameters: params, returnType };
};
export const buildDocTypeShallow = (tsType: TSType, genericPolicy?: GenericDocPolicy): DocType => {
  switch (tsType.type) {
    case "TSStringKeyword":
      return createPrimitiveDocType("string");
    case "TSNumberKeyword":
      return createPrimitiveDocType("number");
    case "TSBooleanKeyword":
      return createPrimitiveDocType("boolean");
    case "TSBigIntKeyword":
      return createPrimitiveDocType("bigint");
    case "TSSymbolKeyword":
      return createPrimitiveDocType("symbol");
    case "TSObjectKeyword":
      return createPrimitiveDocType("object");
    case "TSAnyKeyword":
      return createIntrinsicDocType("any");
    case "TSUnknownKeyword":
      return createIntrinsicDocType("unknown");
    case "TSNeverKeyword":
      return createIntrinsicDocType("never");
    case "TSVoidKeyword":
      return createIntrinsicDocType("void");
    case "TSNullKeyword":
      return createIntrinsicDocType("null");
    case "TSUndefinedKeyword":
      return createIntrinsicDocType("undefined");
    case "TSLiteralType":
      return buildLiteralType(tsType.literal);
    case "TSTypeReference": {
      const name = resolveTypeName(tsType.typeName);
      const displayType = resolveGenericDisplayType(name, genericPolicy);
      if (displayType) {
        return displayType;
      }
      return createReferenceDocType({ name });
    }
    case "TSArrayType":
      return createArrayDocType(buildDocTypeShallow(tsType.elementType, genericPolicy));
    case "TSUnionType":
      return createUnionDocType(
        tsType.types.map((type) => buildDocTypeShallow(type, genericPolicy)),
      );
    case "TSIntersectionType":
      return createIntersectionDocType(
        tsType.types.map((type) => buildDocTypeShallow(type, genericPolicy)),
      );
    case "TSParenthesizedType":
      return buildDocTypeShallow(tsType.typeAnnotation, genericPolicy);
    default:
      return createUnresolvedDocType("<shallow>");
  }
};
const buildMappedType = (tsType: TSMappedType, recurse: (t: TSType) => DocType): DocType => {
  return {
    kind: "mapped",
    parameter: tsType.key.name,
    constraint: tsType.constraint ? recurse(tsType.constraint) : createIntrinsicDocType("unknown"),
    type: tsType.typeAnnotation ? recurse(tsType.typeAnnotation) : createIntrinsicDocType("any"),
  };
};
const buildTemplateLiteralType = (
  tsType: TSTemplateLiteralType,
  recurse: (t: TSType) => DocType,
): DocType => {
  const spans: Array<
    | {
        type: DocType;
      }
    | {
        text: string;
      }
  > = [];
  for (let i = 0; i < tsType.quasis.length; i++) {
    const quasi = tsType.quasis[i];
    if (quasi.value.raw) {
      spans.push({ text: quasi.value.raw });
    }
    if (i < tsType.types.length) {
      spans.push({ type: recurse(tsType.types[i]) });
    }
  }
  return { kind: "templateLiteral", spans };
};
const buildTypeofType = (tsType: { exprName: unknown }): DocType => {
  const name = resolveTypeName(getTypeNameLike(tsType.exprName));
  return { kind: "typeof", name };
};
