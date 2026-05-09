import type * as TypeScript from "typescript";

import type { DocgenConfig } from "../public/config";
import type { DocType } from "../schema/doc-schema";

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
import { buildSemanticFnParam, buildSemanticObjectProperties } from "./semantic-property-builder";

export type SemanticResolverContext = {
  /**
   * TypeScript namespace used for checker and syntax guards.
   */
  ts: typeof TypeScript;
  /**
   * Active checker bound to the semantic program.
   */
  checker: TypeScript.TypeChecker;
  /**
   * Source root used as a fallback provenance location.
   */
  rootFile: string;
  /**
   * Effective docgen config used by semantic conversion.
   */
  config: DocgenConfig;
};

type BuildSemanticDocTypeOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * TypeScript type instance to map into DocType.
   */
  type: TypeScript.Type;
  /**
   * Current recursion depth for bounded type conversion.
   */
  depth: number;
};

type GetSemanticTypeArgumentsOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * Candidate type that may carry reference arguments.
   */
  type: TypeScript.Type;
};

type IsSemanticObjectLikeTypeOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * TypeScript type to check before property-table fallback.
   */
  type: TypeScript.Type;
};

export const isSemanticObjectLikeType = (options: IsSemanticObjectLikeTypeOptions): boolean => {
  const { context, type } = options;

  if (type.flags & context.ts.TypeFlags.Object || type.flags & context.ts.TypeFlags.NonPrimitive) {
    return true;
  }

  if (type.isIntersection()) {
    return type.types.some((member) => isSemanticObjectLikeType({ context, type: member }));
  }

  if (type.isUnion()) {
    return type.types.every((member) => isSemanticObjectLikeType({ context, type: member }));
  }

  return false;
};

export const buildSemanticDocType = (options: BuildSemanticDocTypeOptions): DocType => {
  const { context, type, depth } = options;

  if (type.flags & context.ts.TypeFlags.String) {
    return createPrimitiveDocType("string");
  }

  if (type.flags & context.ts.TypeFlags.Number) {
    return createPrimitiveDocType("number");
  }

  if (type.flags & context.ts.TypeFlags.Boolean) {
    return createPrimitiveDocType("boolean");
  }

  if (type.flags & context.ts.TypeFlags.BigInt) {
    return createPrimitiveDocType("bigint");
  }

  if (type.flags & context.ts.TypeFlags.ESSymbol) {
    return createPrimitiveDocType("symbol");
  }

  if (type.flags & context.ts.TypeFlags.Any) {
    return createIntrinsicDocType("any");
  }

  if (type.flags & context.ts.TypeFlags.Unknown) {
    return createIntrinsicDocType("unknown");
  }

  if (type.flags & context.ts.TypeFlags.Never) {
    return createIntrinsicDocType("never");
  }

  if (type.flags & context.ts.TypeFlags.Void) {
    return createIntrinsicDocType("void");
  }

  if (type.flags & context.ts.TypeFlags.Null) {
    return createIntrinsicDocType("null");
  }

  if (type.flags & context.ts.TypeFlags.Undefined) {
    return createIntrinsicDocType("undefined");
  }

  if (type.isStringLiteral()) {
    return createLiteralDocType(`'${type.value}'`);
  }

  if (type.isNumberLiteral()) {
    return createLiteralDocType(String(type.value));
  }

  if (type.flags & context.ts.TypeFlags.BooleanLiteral) {
    return createLiteralDocType(context.checker.typeToString(type));
  }

  if (isBooleanLiteralUnion(context.ts, type)) {
    return createPrimitiveDocType("boolean");
  }

  if (depth > context.config.maxDepth) {
    return createUnresolvedDocType(context.checker.typeToString(type));
  }

  if (type.isUnion()) {
    const members = type.types.map((member) =>
      buildSemanticDocType({
        context,
        type: member,
        depth: depth + 1,
      }),
    );

    return createUnionDocType(members);
  }

  if (type.isIntersection()) {
    const members = type.types.map((member) =>
      buildSemanticDocType({
        context,
        type: member,
        depth: depth + 1,
      }),
    );

    return createIntersectionDocType(members);
  }

  if (context.checker.isTupleType(type)) {
    const elements = context.checker
      .getTypeArguments(type as TypeScript.TypeReference)
      .map((element) =>
        buildSemanticDocType({
          context,
          type: element,
          depth: depth + 1,
        }),
      );

    return createTupleDocType(elements);
  }

  if (context.checker.isArrayType(type)) {
    const elementType = getTypeArgument(type, 0);

    return createArrayDocType(
      elementType
        ? buildSemanticDocType({
            context,
            type: elementType,
            depth: depth + 1,
          })
        : createIntrinsicDocType("unknown"),
    );
  }

  const callSignature = type.getCallSignatures()[0];

  if (callSignature) {
    return {
      kind: "function",
      parameters: callSignature.parameters.map((parameter) =>
        buildSemanticFnParam({
          context,
          symbol: parameter,
          depth: depth + 1,
        }),
      ),
      returnType: buildSemanticDocType({
        context,
        type: context.checker.getReturnTypeOfSignature(callSignature),
        depth: depth + 1,
      }),
    };
  }

  const name = type.aliasSymbol?.getName() ?? type.symbol?.getName();
  const typeArguments = getSemanticTypeArguments({ context, type }).map((typeArgument) =>
    buildSemanticDocType({
      context,
      type: typeArgument,
      depth: depth + 1,
    }),
  );

  if (name && name !== "__type") {
    if (typeArguments.length > 0) {
      return createReferenceDocType({ name, typeArguments });
    }

    return createReferenceDocType({ name });
  }

  const properties = context.checker.getPropertiesOfType(type);

  if (properties.length > 0 && type.flags & context.ts.TypeFlags.Object) {
    const objectProperties = buildSemanticObjectProperties({
      context,
      type,
      depth: depth + 1,
      allowEmpty: false,
    });

    if (objectProperties) {
      return { kind: "object", properties: objectProperties };
    }

    return createUnresolvedDocType(context.checker.typeToString(type));
  }

  return createUnresolvedDocType(context.checker.typeToString(type));
};

const getTypeArgument = (type: TypeScript.Type, index: number): TypeScript.Type | undefined => {
  return (type as TypeScript.TypeReference).typeArguments?.[index];
};

const isBooleanLiteralUnion = (ts: typeof TypeScript, type: TypeScript.Type): boolean => {
  return (
    type.isUnion() &&
    type.types.length === 2 &&
    type.types.every((member) => Boolean(member.flags & ts.TypeFlags.BooleanLiteral))
  );
};

const getSemanticTypeArguments = (
  options: GetSemanticTypeArgumentsOptions,
): readonly TypeScript.Type[] => {
  const { context, type } = options;

  if (!(type.flags & context.ts.TypeFlags.Object)) {
    return [];
  }

  const objectType = type as TypeScript.ObjectType;

  if (!(objectType.objectFlags & context.ts.ObjectFlags.Reference)) {
    return [];
  }

  return context.checker.getTypeArguments(type as TypeScript.TypeReference);
};
