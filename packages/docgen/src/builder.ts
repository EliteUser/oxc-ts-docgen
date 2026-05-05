import type {
  TSType,
  TSPropertySignature,
  TSMethodSignature,
  TSSignature,
  TSTypeParameterDeclaration,
  TSFunctionType,
  TSTypeLiteral,
  TSMappedType,
  TSTemplateLiteralType,
  TSLiteral,
  TSTupleElement,
  ParamPattern,
  TSEnumDeclaration,
  TSInterfaceHeritage,
} from "oxc-parser";
import type {
  DocEntry,
  DocProperty,
  DocType,
  DocTypeParam,
  DocFnParam,
  DocSourceLocation,
} from "./schema";
import type { DocgenConfig } from "./config";
import type { ParsedSource } from "./parser";
import { findTypeDeclaration } from "./parser";
import { extractJSDocForNode } from "./jsdoc";
import type { TypeResolver } from "./resolver";

export function buildDocEntry(
  parsed: ParsedSource,
  typeName: string,
  filePath: string,
  config: DocgenConfig,
  resolver?: TypeResolver,
): DocEntry | undefined {
  const found = findTypeDeclaration(parsed, typeName);
  if (!found) return undefined;

  const { decl, statementStart } = found;
  const jsdoc = extractJSDocForNode(parsed, statementStart);
  const source = offsetToLocation(parsed, decl.start, filePath);

  if (decl.type === "TSInterfaceDeclaration") {
    const typeParams = buildTypeParams(decl.typeParameters);
    let properties = buildPropertiesFromSignatures(decl.body.body, parsed, filePath, config);

    if (decl.extends && decl.extends.length > 0 && resolver) {
      const inheritedProps = resolveExtends(decl.extends, parsed, filePath, config, resolver, 0);
      const ownNames = new Set(properties.map((p) => p.name));
      const merged = inheritedProps.filter((p) => !ownNames.has(p.name));
      properties = [...merged, ...properties];
    }

    const type = buildObjectDocType(properties);

    return {
      name: typeName,
      kind: "interface",
      description: jsdoc.description,
      tags: jsdoc.tags,
      typeParameters: typeParams,
      properties,
      type,
      source,
    };
  }

  if (decl.type === "TSTypeAliasDeclaration") {
    const typeParams = buildTypeParams(decl.typeParameters);
    const type = buildDocType(decl.typeAnnotation, parsed, filePath, config);
    const properties =
      type.kind === "object"
        ? type.properties
        : extractPropertiesFromType(decl.typeAnnotation, parsed, filePath, config, resolver);

    return {
      name: typeName,
      kind: "typeAlias",
      description: jsdoc.description,
      tags: jsdoc.tags,
      typeParameters: typeParams,
      properties,
      type,
      source,
    };
  }

  if (decl.type === "TSEnumDeclaration") {
    const properties = buildEnumMembers(decl, parsed, filePath);
    const memberTypes = properties.map((p) => p.type);
    const type: DocType =
      memberTypes.length > 0
        ? { kind: "union", members: memberTypes }
        : { kind: "intrinsic", name: "never" };

    return {
      name: typeName,
      kind: "enum",
      description: jsdoc.description,
      tags: jsdoc.tags,
      typeParameters: [],
      properties,
      type,
      source,
    };
  }

  return undefined;
}

const MAX_EXTENDS_DEPTH = 10;

function resolveExtends(
  heritage: TSInterfaceHeritage[],
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  resolver: TypeResolver,
  depth: number,
): DocProperty[] {
  if (depth >= MAX_EXTENDS_DEPTH) return [];

  const allProps: DocProperty[] = [];

  for (const parent of heritage) {
    const expr = parent.expression;
    if (expr.type !== "Identifier") continue;
    const parentName = expr.name;
    if (config.ignoreTypes.includes(parentName)) continue;

    const resolved = resolver.resolveType(parentName, filePath, parsed);
    if (!resolved) continue;

    if (resolved.decl.type === "TSInterfaceDeclaration") {
      const parentProps = buildPropertiesFromSignatures(
        resolved.decl.body.body,
        resolved.parsed,
        resolved.filePath,
        config,
      );

      if (resolved.decl.extends && resolved.decl.extends.length > 0) {
        const grandparentProps = resolveExtends(
          resolved.decl.extends,
          resolved.parsed,
          resolved.filePath,
          config,
          resolver,
          depth + 1,
        );
        const parentNames = new Set(parentProps.map((p) => p.name));
        const merged = grandparentProps.filter((p) => !parentNames.has(p.name));
        allProps.push(...merged);
      }

      allProps.push(...parentProps);
    } else if (resolved.decl.type === "TSTypeAliasDeclaration") {
      const extracted = extractPropertiesFromType(
        resolved.decl.typeAnnotation,
        resolved.parsed,
        resolved.filePath,
        config,
        resolver,
        depth + 1,
      );
      allProps.push(...extracted);
    }
  }

  return allProps;
}

function buildEnumMembers(
  decl: TSEnumDeclaration,
  parsed: ParsedSource,
  filePath: string,
): DocProperty[] {
  const members = (
    decl as unknown as {
      members: Array<{
        type: string;
        id: { type: string; name?: string };
        initializer?: { type: string; value?: unknown; raw?: string };
        start: number;
      }>;
    }
  ).members;

  return members.map((member) => {
    const name = member.id.type === "Identifier" ? (member.id.name ?? "") : "";
    const jsdoc = extractJSDocForNode(parsed, member.start);

    let type: DocType;
    if (member.initializer) {
      const init = member.initializer as { type: string; value?: unknown };
      if (typeof init.value === "string") {
        type = { kind: "literal", value: `'${init.value}'` };
      } else if (typeof init.value === "number") {
        type = { kind: "literal", value: String(init.value) };
      } else {
        type = { kind: "literal", value: name };
      }
    } else {
      type = { kind: "literal", value: name };
    }

    return {
      name,
      type,
      optional: false,
      readonly: true,
      description: jsdoc.description,
      tags: jsdoc.tags,
      defaultValue: jsdoc.defaultValue,
      source: offsetToLocation(parsed, member.start, filePath),
    };
  });
}

function buildTypeParams(decl: TSTypeParameterDeclaration | null): DocTypeParam[] {
  if (!decl) return [];
  return decl.params.map((p) => ({
    name: p.name.name,
    constraint: p.constraint ? buildDocTypeShallow(p.constraint) : undefined,
    default: p.default ? buildDocTypeShallow(p.default) : undefined,
  }));
}

function buildPropertiesFromSignatures(
  signatures: TSSignature[],
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocProperty[] {
  const properties: DocProperty[] = [];

  for (const sig of signatures) {
    if (sig.type === "TSPropertySignature") {
      const prop = buildPropertyFromSignature(sig, parsed, filePath, config);
      if (prop) properties.push(prop);
    } else if (sig.type === "TSMethodSignature") {
      const prop = buildMethodProperty(sig, parsed, filePath, config);
      if (prop) properties.push(prop);
    } else if (sig.type === "TSIndexSignature") {
      const prop = buildIndexSignatureProperty(sig, parsed, filePath, config);
      if (prop) properties.push(prop);
    } else if (sig.type === "TSCallSignatureDeclaration") {
      const prop = buildCallSignatureProperty(sig, parsed, filePath, config);
      if (prop) properties.push(prop);
    }
  }

  return properties;
}

function buildPropertyFromSignature(
  sig: TSPropertySignature,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocProperty | undefined {
  const name = extractPropertyName(sig.key);
  if (!name) return undefined;

  const jsdoc = extractJSDocForNode(parsed, sig.start);
  const type = sig.typeAnnotation
    ? buildDocType(sig.typeAnnotation.typeAnnotation, parsed, filePath, config)
    : ({ kind: "intrinsic", name: "any" } as const);

  return {
    name,
    type,
    optional: sig.optional,
    readonly: sig.readonly,
    description: jsdoc.description,
    tags: jsdoc.tags,
    defaultValue: jsdoc.defaultValue,
    source: offsetToLocation(parsed, sig.start, filePath),
  };
}

function buildMethodProperty(
  sig: TSMethodSignature,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocProperty | undefined {
  const name = extractPropertyName(sig.key);
  if (!name) return undefined;

  const jsdoc = extractJSDocForNode(parsed, sig.start);
  const params = buildFnParams(sig.params);
  const returnType = sig.returnType
    ? buildDocType(sig.returnType.typeAnnotation, parsed, filePath, config)
    : ({ kind: "intrinsic", name: "void" } as const);

  const type: DocType = {
    kind: "function",
    parameters: params,
    returnType,
  };

  return {
    name,
    type,
    optional: sig.optional,
    readonly: false,
    description: jsdoc.description,
    tags: jsdoc.tags,
    defaultValue: jsdoc.defaultValue,
    source: offsetToLocation(parsed, sig.start, filePath),
  };
}

function buildIndexSignatureProperty(
  sig: TSSignature,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocProperty | undefined {
  const indexSig = sig as unknown as {
    parameters: Array<{ name: string; typeAnnotation?: { typeAnnotation: TSType } }>;
    typeAnnotation?: { typeAnnotation: TSType };
    readonly: boolean;
    start: number;
  };
  const param = indexSig.parameters?.[0];
  if (!param) return undefined;

  const keyType = param.typeAnnotation
    ? buildDocType(param.typeAnnotation.typeAnnotation, parsed, filePath, config)
    : ({ kind: "primitive", name: "string" } as const);
  const valueType = indexSig.typeAnnotation
    ? buildDocType(indexSig.typeAnnotation.typeAnnotation, parsed, filePath, config)
    : ({ kind: "intrinsic", name: "any" } as const);

  const jsdoc = extractJSDocForNode(parsed, indexSig.start);
  const name = `[${param.name}: ${keyType.kind === "primitive" ? keyType.name : "key"}]`;

  return {
    name,
    type: valueType,
    optional: false,
    readonly: indexSig.readonly ?? false,
    description: jsdoc.description,
    tags: jsdoc.tags,
    defaultValue: jsdoc.defaultValue,
    source: offsetToLocation(parsed, indexSig.start, filePath),
  };
}

function buildCallSignatureProperty(
  sig: TSSignature,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocProperty | undefined {
  const callSig = sig as unknown as {
    params: ParamPattern[];
    returnType?: { typeAnnotation: TSType };
    start: number;
  };
  const params = buildFnParams(callSig.params ?? []);
  const returnType = callSig.returnType
    ? buildDocType(callSig.returnType.typeAnnotation, parsed, filePath, config)
    : ({ kind: "intrinsic", name: "void" } as const);

  const jsdoc = extractJSDocForNode(parsed, callSig.start);

  return {
    name: "__call",
    type: { kind: "function", parameters: params, returnType },
    optional: false,
    readonly: false,
    description: jsdoc.description,
    tags: jsdoc.tags,
    defaultValue: jsdoc.defaultValue,
    source: offsetToLocation(parsed, callSig.start, filePath),
  };
}

function extractPropertyName(
  key: TSPropertySignature["key"] | TSMethodSignature["key"],
): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") {
    const k = key as { value?: unknown };
    return k.value != null ? String(k.value) : undefined;
  }
  return undefined;
}

export function buildDocType(
  tsType: TSType,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
): DocType {
  return buildDocTypeInternal(tsType, parsed, filePath, config, 0);
}

function buildDocTypeInternal(
  tsType: TSType,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  depth: number,
): DocType {
  if (depth > config.maxDepth) {
    return { kind: "unresolved", text: "<max depth>" };
  }

  const recurse = (t: TSType) => buildDocTypeInternal(t, parsed, filePath, config, depth + 1);

  switch (tsType.type) {
    case "TSStringKeyword":
      return { kind: "primitive", name: "string" };
    case "TSNumberKeyword":
      return { kind: "primitive", name: "number" };
    case "TSBooleanKeyword":
      return { kind: "primitive", name: "boolean" };
    case "TSBigIntKeyword":
      return { kind: "primitive", name: "bigint" };
    case "TSSymbolKeyword":
      return { kind: "primitive", name: "symbol" };
    case "TSObjectKeyword":
      return { kind: "primitive", name: "object" };

    case "TSAnyKeyword":
      return { kind: "intrinsic", name: "any" };
    case "TSUnknownKeyword":
      return { kind: "intrinsic", name: "unknown" };
    case "TSNeverKeyword":
      return { kind: "intrinsic", name: "never" };
    case "TSVoidKeyword":
      return { kind: "intrinsic", name: "void" };
    case "TSNullKeyword":
      return { kind: "intrinsic", name: "null" };
    case "TSUndefinedKeyword":
      return { kind: "intrinsic", name: "undefined" };
    case "TSIntrinsicKeyword":
      return { kind: "intrinsic", name: "intrinsic" };
    case "TSThisType":
      return { kind: "intrinsic", name: "this" };

    case "TSLiteralType":
      return buildLiteralType(tsType.literal);

    case "TSUnionType":
      return { kind: "union", members: tsType.types.map(recurse) };

    case "TSIntersectionType":
      return { kind: "intersection", members: tsType.types.map(recurse) };

    case "TSArrayType":
      return { kind: "array", elementType: recurse(tsType.elementType) };

    case "TSTupleType":
      return buildTupleType(tsType.elementTypes, recurse);

    case "TSTypeLiteral":
      return buildTypeLiteral(tsType, parsed, filePath, config, depth);

    case "TSTypeReference":
      return buildTypeReference(tsType, recurse, config);

    case "TSFunctionType":
      return buildFunctionType(tsType, parsed, filePath, config, depth);

    case "TSParenthesizedType":
      return recurse(tsType.typeAnnotation);

    case "TSTypeOperator":
      if (tsType.operator === "keyof") {
        return { kind: "keyof", type: recurse(tsType.typeAnnotation) };
      }
      if (tsType.operator === "readonly") {
        return recurse(tsType.typeAnnotation);
      }
      return { kind: "unresolved", text: `${tsType.operator} <type>` };

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
      return { kind: "primitive", name: "boolean" };

    case "TSJSDocNullableType":
    case "TSJSDocNonNullableType":
      return recurse((tsType as { typeAnnotation: TSType }).typeAnnotation);

    case "TSJSDocUnknownType":
      return { kind: "intrinsic", name: "unknown" };

    case "TSImportType":
    case "TSConstructorType":
    case "TSNamedTupleMember":
      return { kind: "unresolved", text: parsed.source.slice(tsType.start, tsType.end) };

    default:
      return { kind: "unresolved", text: "<unknown>" };
  }
}

function buildLiteralType(literal: TSLiteral): DocType {
  if (literal.type === "Literal") {
    const lit = literal as { value: unknown; raw?: string | null };
    const val = lit.value;
    if (typeof val === "string") {
      return { kind: "literal", value: `'${val}'` };
    }
    if (typeof val === "number") {
      return { kind: "literal", value: String(val) };
    }
    if (typeof val === "boolean") {
      return { kind: "literal", value: String(val) };
    }
    if (typeof val === "bigint") {
      return { kind: "literal", value: `${val}n` };
    }
    if (val === null) {
      return { kind: "intrinsic", name: "null" };
    }
    return { kind: "literal", value: String(val) };
  }
  if (literal.type === "UnaryExpression") {
    const unary = literal as { operator: string; argument: { value?: unknown } };
    const argVal = unary.argument?.value;
    return { kind: "literal", value: `${unary.operator}${argVal ?? "?"}` };
  }
  if (literal.type === "TemplateLiteral") {
    return { kind: "literal", value: "`<template>`" };
  }
  return { kind: "literal", value: "<literal>" };
}

function buildTupleType(elements: TSTupleElement[], recurse: (t: TSType) => DocType): DocType {
  const mapped = elements.map((el) => buildTupleElement(el, recurse));
  return { kind: "tuple", elements: mapped };
}

function buildTupleElement(el: TSTupleElement, recurse: (t: TSType) => DocType): DocType {
  const element = el as { type: string; typeAnnotation?: TSType; elementType?: TSTupleElement };
  if (element.type === "TSRestType" && element.typeAnnotation) {
    return { kind: "rest", type: recurse(element.typeAnnotation) };
  }
  if (element.type === "TSOptionalType" && element.typeAnnotation) {
    return recurse(element.typeAnnotation);
  }
  if (element.type === "TSNamedTupleMember" && element.elementType) {
    return buildTupleElement(element.elementType, recurse);
  }
  return recurse(el as TSType);
}

function buildTypeReference(
  tsType: {
    typeName: { type: string; name?: string; left?: unknown; right?: { name: string } };
    typeArguments: { params: TSType[] } | null;
  },
  recurse: (t: TSType) => DocType,
  config: DocgenConfig,
): DocType {
  const name = resolveTypeName(tsType.typeName);

  if (name === "Array" || name === "ReadonlyArray") {
    const args = tsType.typeArguments?.params;
    if (args && args.length === 1) {
      return { kind: "array", elementType: recurse(args[0]) };
    }
  }

  const typeArguments = tsType.typeArguments?.params.map(recurse);
  if (config.ignoreTypes.includes(name)) {
    return typeArguments && typeArguments.length > 0
      ? { kind: "reference", name, typeArguments }
      : { kind: "reference", name };
  }

  if (typeArguments && typeArguments.length > 0) {
    return { kind: "reference", name, typeArguments };
  }
  return { kind: "reference", name };
}

function resolveTypeName(typeName: {
  type: string;
  name?: string;
  left?: unknown;
  right?: { name: string };
}): string {
  if (typeName.type === "Identifier" && typeName.name) {
    return typeName.name;
  }
  if (typeName.type === "TSQualifiedName") {
    const left = resolveTypeName(
      typeName.left as { type: string; name?: string; left?: unknown; right?: { name: string } },
    );
    return `${left}.${typeName.right?.name ?? ""}`;
  }
  if (typeName.type === "ThisExpression") {
    return "this";
  }
  return "<unknown>";
}

function buildTypeLiteral(
  tsType: TSTypeLiteral,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  depth: number,
): DocType {
  const properties: DocProperty[] = [];
  for (const member of tsType.members) {
    if (member.type === "TSPropertySignature") {
      const name = extractPropertyName(member.key);
      if (!name) continue;
      const jsdoc = extractJSDocForNode(parsed, member.start);
      const type = member.typeAnnotation
        ? buildDocTypeInternal(
            member.typeAnnotation.typeAnnotation,
            parsed,
            filePath,
            config,
            depth + 1,
          )
        : ({ kind: "intrinsic", name: "any" } as const);
      properties.push({
        name,
        type,
        optional: member.optional,
        readonly: member.readonly,
        description: jsdoc.description,
        tags: jsdoc.tags,
        defaultValue: jsdoc.defaultValue,
        source: offsetToLocation(parsed, member.start, filePath),
      });
    } else if (member.type === "TSMethodSignature") {
      const name = extractPropertyName(member.key);
      if (!name) continue;
      const jsdoc = extractJSDocForNode(parsed, member.start);
      const params = buildFnParams(member.params);
      const returnType = member.returnType
        ? buildDocTypeInternal(
            member.returnType.typeAnnotation,
            parsed,
            filePath,
            config,
            depth + 1,
          )
        : ({ kind: "intrinsic", name: "void" } as const);
      properties.push({
        name,
        type: { kind: "function", parameters: params, returnType },
        optional: member.optional,
        readonly: false,
        description: jsdoc.description,
        tags: jsdoc.tags,
        defaultValue: jsdoc.defaultValue,
        source: offsetToLocation(parsed, member.start, filePath),
      });
    }
  }
  return { kind: "object", properties };
}

function buildFunctionType(
  tsType: TSFunctionType,
  _parsed: ParsedSource,
  _filePath: string,
  config: DocgenConfig,
  depth: number,
): DocType {
  const params = buildFnParams(tsType.params);
  const returnType = buildDocTypeInternal(
    tsType.returnType.typeAnnotation,
    _parsed,
    _filePath,
    config,
    depth + 1,
  );
  return { kind: "function", parameters: params, returnType };
}

function buildFnParams(params: ParamPattern[]): DocFnParam[] {
  return params.map((param) => buildSingleParam(param));
}

function buildSingleParam(param: ParamPattern): DocFnParam {
  const anyParam = param as {
    type: string;
    name?: string;
    argument?: { type: string; name?: string };
    parameter?: {
      type: string;
      name?: string;
      typeAnnotation?: { typeAnnotation: TSType };
      optional?: boolean;
    };
    typeAnnotation?: { typeAnnotation: TSType } | null;
    optional?: boolean;
    left?: { type: string; name?: string; typeAnnotation?: { typeAnnotation: TSType } | null };
  };

  if (anyParam.type === "RestElement") {
    const name =
      anyParam.argument?.type === "Identifier" ? (anyParam.argument.name ?? "...") : "...";
    const type = anyParam.typeAnnotation
      ? buildDocTypeShallow(anyParam.typeAnnotation.typeAnnotation)
      : ({ kind: "intrinsic", name: "any" } as const);
    return { name, type, optional: false, rest: true };
  }

  if (anyParam.type === "TSParameterProperty") {
    const inner = anyParam.parameter;
    if (inner?.type === "Identifier") {
      const type = inner.typeAnnotation
        ? buildDocTypeShallow(inner.typeAnnotation.typeAnnotation)
        : ({ kind: "intrinsic", name: "any" } as const);
      return {
        name: inner.name ?? "<param>",
        type,
        optional: inner.optional ?? false,
        rest: false,
      };
    }
    return {
      name: "<param>",
      type: { kind: "intrinsic" as const, name: "any" },
      optional: false,
      rest: false,
    };
  }

  if (anyParam.type === "Identifier") {
    const type = anyParam.typeAnnotation
      ? buildDocTypeShallow(anyParam.typeAnnotation.typeAnnotation)
      : ({ kind: "intrinsic", name: "any" } as const);
    return {
      name: anyParam.name ?? "<param>",
      type,
      optional: anyParam.optional ?? false,
      rest: false,
    };
  }

  if (anyParam.type === "AssignmentPattern") {
    const left = anyParam.left;
    const name = left?.type === "Identifier" ? (left.name ?? "<param>") : "<param>";
    const type =
      left?.type === "Identifier" && left.typeAnnotation
        ? buildDocTypeShallow(left.typeAnnotation.typeAnnotation)
        : ({ kind: "intrinsic", name: "any" } as const);
    return { name, type, optional: true, rest: false };
  }

  return {
    name: "<param>",
    type: { kind: "intrinsic" as const, name: "any" },
    optional: false,
    rest: false,
  };
}

function buildDocTypeShallow(tsType: TSType): DocType {
  switch (tsType.type) {
    case "TSStringKeyword":
      return { kind: "primitive", name: "string" };
    case "TSNumberKeyword":
      return { kind: "primitive", name: "number" };
    case "TSBooleanKeyword":
      return { kind: "primitive", name: "boolean" };
    case "TSBigIntKeyword":
      return { kind: "primitive", name: "bigint" };
    case "TSSymbolKeyword":
      return { kind: "primitive", name: "symbol" };
    case "TSObjectKeyword":
      return { kind: "primitive", name: "object" };
    case "TSAnyKeyword":
      return { kind: "intrinsic", name: "any" };
    case "TSUnknownKeyword":
      return { kind: "intrinsic", name: "unknown" };
    case "TSNeverKeyword":
      return { kind: "intrinsic", name: "never" };
    case "TSVoidKeyword":
      return { kind: "intrinsic", name: "void" };
    case "TSNullKeyword":
      return { kind: "intrinsic", name: "null" };
    case "TSUndefinedKeyword":
      return { kind: "intrinsic", name: "undefined" };
    case "TSLiteralType":
      return buildLiteralType(tsType.literal);
    case "TSTypeReference": {
      const name = resolveTypeName(tsType.typeName);
      return { kind: "reference", name };
    }
    case "TSArrayType":
      return { kind: "array", elementType: buildDocTypeShallow(tsType.elementType) };
    case "TSUnionType":
      return { kind: "union", members: tsType.types.map(buildDocTypeShallow) };
    case "TSIntersectionType":
      return { kind: "intersection", members: tsType.types.map(buildDocTypeShallow) };
    case "TSParenthesizedType":
      return buildDocTypeShallow(tsType.typeAnnotation);
    default:
      return { kind: "unresolved", text: "<shallow>" };
  }
}

function buildMappedType(tsType: TSMappedType, recurse: (t: TSType) => DocType): DocType {
  return {
    kind: "mapped",
    parameter: tsType.key.name,
    constraint: tsType.constraint
      ? recurse(tsType.constraint)
      : { kind: "intrinsic", name: "unknown" },
    type: tsType.typeAnnotation
      ? recurse(tsType.typeAnnotation)
      : { kind: "intrinsic", name: "any" },
  };
}

function buildTemplateLiteralType(
  tsType: TSTemplateLiteralType,
  recurse: (t: TSType) => DocType,
): DocType {
  const spans: Array<{ type: DocType } | { text: string }> = [];
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
}

function buildTypeofType(tsType: {
  exprName: { type: string; name?: string; left?: unknown; right?: { name: string } };
}): DocType {
  const name = resolveTypeName(
    tsType.exprName as { type: string; name?: string; left?: unknown; right?: { name: string } },
  );
  return { kind: "typeof", name };
}

function extractPropertiesFromType(
  tsType: TSType,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  resolver?: TypeResolver,
  depth = 0,
): DocProperty[] {
  if (depth >= MAX_EXTENDS_DEPTH) return [];

  if (tsType.type === "TSTypeLiteral") {
    return buildPropertiesFromSignatures(tsType.members, parsed, filePath, config);
  }
  if (tsType.type === "TSParenthesizedType") {
    return extractPropertiesFromType(
      tsType.typeAnnotation,
      parsed,
      filePath,
      config,
      resolver,
      depth,
    );
  }
  if (tsType.type === "TSIntersectionType") {
    const merged: DocProperty[] = [];
    for (const member of tsType.types) {
      mergeProperties(
        merged,
        extractPropertiesFromType(member, parsed, filePath, config, resolver, depth + 1),
      );
    }
    return merged;
  }
  if (tsType.type === "TSTypeReference" && resolver) {
    const name = resolveTypeName(tsType.typeName);
    const args = tsType.typeArguments?.params ?? [];

    const utilityProps = extractPropertiesFromUtilityType(
      name,
      args,
      tsType,
      parsed,
      filePath,
      config,
      resolver,
      depth,
    );
    if (utilityProps) return utilityProps;

    if (config.ignoreTypes.includes(name)) return [];

    const resolved = resolver.resolveType(name, filePath, parsed);
    if (!resolved) return [];

    if (resolved.decl.type === "TSInterfaceDeclaration") {
      let properties = buildPropertiesFromSignatures(
        resolved.decl.body.body,
        resolved.parsed,
        resolved.filePath,
        config,
      );

      if (resolved.decl.extends && resolved.decl.extends.length > 0) {
        const inheritedProps = resolveExtends(
          resolved.decl.extends,
          resolved.parsed,
          resolved.filePath,
          config,
          resolver,
          depth + 1,
        );
        const ownNames = new Set(properties.map((p) => p.name));
        properties = [...inheritedProps.filter((p) => !ownNames.has(p.name)), ...properties];
      }

      return properties;
    }

    if (resolved.decl.type === "TSTypeAliasDeclaration") {
      return extractPropertiesFromType(
        resolved.decl.typeAnnotation,
        resolved.parsed,
        resolved.filePath,
        config,
        resolver,
        depth + 1,
      );
    }
  }
  return [];
}

function extractPropertiesFromUtilityType(
  name: string,
  args: TSType[],
  sourceType: TSType,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  resolver: TypeResolver,
  depth: number,
): DocProperty[] | undefined {
  if (depth >= MAX_EXTENDS_DEPTH) return [];

  if ((name === "Pick" || name === "Omit") && args.length >= 2) {
    const baseProps = extractPropertiesFromType(
      args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth + 1,
    );
    const keys = extractStringKeys(args[1], parsed, filePath, config, resolver, depth + 1);
    if (!keys) return undefined;

    if (name === "Pick") {
      return baseProps.filter((prop) => keys.has(prop.name));
    }
    return baseProps.filter((prop) => !keys.has(prop.name));
  }

  if ((name === "Partial" || name === "Required" || name === "Readonly") && args.length >= 1) {
    const baseProps = extractPropertiesFromType(
      args[0],
      parsed,
      filePath,
      config,
      resolver,
      depth + 1,
    );
    return baseProps.map((prop) => ({
      ...prop,
      optional: name === "Partial" ? true : name === "Required" ? false : prop.optional,
      readonly: name === "Readonly" ? true : prop.readonly,
    }));
  }

  if (name === "Record" && args.length >= 2) {
    const keys = extractStringKeys(args[0], parsed, filePath, config, resolver, depth + 1);
    const valueType = buildDocType(args[1], parsed, filePath, config);
    const source = offsetToLocation(parsed, sourceType.start, filePath);

    if (keys) {
      return [...keys].sort().map((key) => ({
        name: key,
        type: valueType,
        optional: false,
        readonly: false,
        description: "",
        tags: {},
        defaultValue: undefined,
        source,
      }));
    }

    return [
      {
        name: "[key: string]",
        type: valueType,
        optional: false,
        readonly: false,
        description: "",
        tags: {},
        defaultValue: undefined,
        source,
      },
    ];
  }

  return undefined;
}

function extractStringKeys(
  tsType: TSType,
  parsed: ParsedSource,
  filePath: string,
  config: DocgenConfig,
  resolver: TypeResolver,
  depth: number,
): Set<string> | undefined {
  if (depth >= MAX_EXTENDS_DEPTH) return undefined;

  if (tsType.type === "TSLiteralType") {
    const key = extractLiteralKey(tsType.literal);
    return key === undefined ? undefined : new Set([key]);
  }

  if (tsType.type === "TSUnionType") {
    const keys = new Set<string>();
    for (const member of tsType.types) {
      const memberKeys = extractStringKeys(member, parsed, filePath, config, resolver, depth + 1);
      if (!memberKeys) return undefined;
      for (const key of memberKeys) keys.add(key);
    }
    return keys;
  }

  if (tsType.type === "TSParenthesizedType") {
    return extractStringKeys(tsType.typeAnnotation, parsed, filePath, config, resolver, depth);
  }

  if (tsType.type === "TSTypeReference") {
    const name = resolveTypeName(tsType.typeName);
    const resolved = resolver.resolveType(name, filePath, parsed);
    if (!resolved || resolved.decl.type !== "TSTypeAliasDeclaration") return undefined;
    return extractStringKeys(
      resolved.decl.typeAnnotation,
      resolved.parsed,
      resolved.filePath,
      config,
      resolver,
      depth + 1,
    );
  }

  if (tsType.type === "TSTypeOperator" && tsType.operator === "keyof") {
    const props = extractPropertiesFromType(
      tsType.typeAnnotation,
      parsed,
      filePath,
      config,
      resolver,
      depth + 1,
    );
    return new Set(props.map((prop) => prop.name));
  }

  return undefined;
}

function extractLiteralKey(literal: TSLiteral): string | undefined {
  if (literal.type !== "Literal") return undefined;
  const value = (literal as { value?: unknown }).value;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function mergeProperties(target: DocProperty[], additions: DocProperty[]): void {
  for (const prop of additions) {
    const existing = target.findIndex((p) => p.name === prop.name);
    if (existing !== -1) {
      target.splice(existing, 1);
    }
    target.push(prop);
  }
}

function buildObjectDocType(properties: DocProperty[]): DocType {
  return { kind: "object", properties };
}

export function offsetToLocation(
  parsed: ParsedSource,
  offset: number,
  filePath: string,
): DocSourceLocation {
  const lineStarts = parsed.index.lineStarts;
  let low = 0;
  let high = lineStarts.length - 1;
  let lineIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      lineIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const line = lineIndex + 1;
  const column = offset - lineStarts[lineIndex];
  return { filePath, line, column };
}
