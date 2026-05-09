import type * as TypeScript from "typescript";

import type { DocFnParam, DocProperty, DocType } from "../schema/doc-schema";
import type { SemanticResolverContext } from "./semantic-doc-type-builder";

import { normalizeBooleanLiteralUnion, removeIntrinsicUnionMembers } from "../model/doc-type-utils";
import { emitDocProperty, normalizeDocProperty } from "../model/property-model";
import { buildSemanticDocType } from "./semantic-doc-type-builder";
import { getSemanticJSDoc } from "./semantic-jsdoc";
import { shouldKeepSemanticProperty } from "./semantic-property-policy";
import { hasReadonlyModifier, isRestParameter, semanticSourceLocation } from "./semantic-source";
import {
  buildIgnoredTypeAnnotation,
  buildPropertyTypeAnnotation,
} from "./semantic-type-annotation";

type BuildSemanticPropertyOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * Property symbol to convert into doc schema property.
   */
  symbol: TypeScript.Symbol;
  /**
   * Current recursion depth for bounded type conversion.
   */
  depth?: number;
};

export const buildSemanticProperty = (options: BuildSemanticPropertyOptions): DocProperty => {
  const { context, symbol } = options;
  const depth = options.depth ?? 0;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  const type = declaration
    ? context.checker.getTypeOfSymbolAtLocation(symbol, declaration)
    : context.checker.getDeclaredTypeOfSymbol(symbol);
  const jsdoc = getSemanticJSDoc({ context, symbol });
  const optional = Boolean(symbol.flags & context.ts.SymbolFlags.Optional);
  const annotationType = buildPropertyTypeAnnotation({ context, symbol });
  const docType =
    annotationType ??
    buildSemanticDocType({
      context,
      type,
      depth,
    });
  const source = declaration
    ? semanticSourceLocation(declaration)
    : { filePath: context.rootFile, line: 1, column: 0 };

  return emitDocProperty(
    normalizeDocProperty({
      name: symbol.getName(),
      type: optional ? removeUndefinedFromDocType(docType) : docType,
      optional,
      readonly: declaration ? hasReadonlyModifier(context.ts, declaration) : false,
      description: jsdoc.description,
      tags: jsdoc.tags,
      defaultValue: jsdoc.defaultValue,
      source,
      provenance: { kind: "semantic", filePath: source.filePath },
    }),
  );
};

const removeUndefinedFromDocType = (type: DocType): DocType => {
  return normalizeBooleanLiteralUnion(
    removeIntrinsicUnionMembers({
      type,
      names: ["undefined"],
      emptyFallback: { kind: "intrinsic", name: "undefined" },
    }),
  );
};

export type BuildSemanticObjectPropertiesOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * TypeScript object-like type whose properties should be converted.
   */
  type: TypeScript.Type;
  /**
   * Current recursion depth for bounded type conversion.
   */
  depth: number;
  /**
   * Whether a filtered empty object should remain an object.
   */
  allowEmpty: boolean;
};

export const buildSemanticObjectProperties = (
  options: BuildSemanticObjectPropertiesOptions,
): DocProperty[] | undefined => {
  const { context, type, depth, allowEmpty } = options;
  const properties = context.checker
    .getPropertiesOfType(type)
    .map((property) =>
      buildSemanticProperty({
        context,
        symbol: property,
        depth,
      }),
    )
    .filter((prop) => shouldKeepSemanticProperty({ prop, context }));

  if (properties.length > 0 || allowEmpty) {
    return properties;
  }

  return undefined;
};

type BuildSemanticFnParamOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticResolverContext;
  /**
   * Parameter symbol to convert into DocFnParam output.
   */
  symbol: TypeScript.Symbol;
  /**
   * Current recursion depth for bounded type conversion.
   */
  depth: number;
};

export const buildSemanticFnParam = (options: BuildSemanticFnParamOptions): DocFnParam => {
  const { context, symbol, depth } = options;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  const type = declaration
    ? context.checker.getTypeOfSymbolAtLocation(symbol, declaration)
    : context.checker.getAnyType();
  const annotationType = declaration
    ? buildIgnoredTypeAnnotation({ context, declaration })
    : undefined;

  return {
    name: symbol.getName(),
    type:
      annotationType ??
      buildSemanticDocType({
        context,
        type,
        depth,
      }),
    optional: Boolean(symbol.flags & context.ts.SymbolFlags.Optional),
    rest: isRestParameter(context.ts, declaration),
  };
};
