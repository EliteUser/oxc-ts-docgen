import type {
  ParamPattern,
  TSMethodSignature,
  TSPropertySignature,
  TSSignature,
  TSType,
} from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { ParsedSource } from "../resolver/parser";
import type { DocFnParam, DocProperty, DocType } from "../schema/doc-schema";

import { emitDocProperty, normalizeDocProperty } from "../model/property-model";
import { extractJSDocForNode } from "../utils/jsdoc";
import { offsetToLocation } from "../utils/source-location";
import { getCallSignatureLike, getIndexSignatureLike, getLiteralKeyValue } from "./oxc-ast-compat";
export const UNRESOLVED_PROPERTY_NAME = "__unresolved";
type StaticPropertyBuilderContext = {
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
  buildType: (type: TSType) => DocType;
  buildParams: (params: ParamPattern[]) => DocFnParam[];
};
export const buildStaticPropertiesFromSignatures = (
  signatures: TSSignature[],
  context: StaticPropertyBuilderContext,
): DocProperty[] => {
  const properties: DocProperty[] = [];
  for (const signature of signatures) {
    const property = buildStaticPropertyFromSignature(signature, context);
    if (property) {
      properties.push(property);
    }
  }
  return properties;
};
const buildStaticPropertyFromSignature = (
  signature: TSSignature,
  context: StaticPropertyBuilderContext,
): DocProperty | undefined => {
  if (signature.type === "TSPropertySignature") {
    return buildPropertySignature(signature, context);
  }
  if (signature.type === "TSMethodSignature") {
    return buildMethodSignature(signature, context);
  }
  if (signature.type === "TSIndexSignature") {
    return buildIndexSignature(signature, context);
  }
  if (signature.type === "TSCallSignatureDeclaration") {
    return buildCallSignature(signature, context);
  }
  return undefined;
};
const buildPropertySignature = (
  signature: TSPropertySignature,
  context: StaticPropertyBuilderContext,
): DocProperty | undefined => {
  const name = extractPropertyName(signature.key);
  if (!name) {
    return undefined;
  }
  const type = signature.typeAnnotation
    ? context.buildType(signature.typeAnnotation.typeAnnotation)
    : ({ kind: "intrinsic", name: "any" } as const);
  return buildDocumentedStaticProperty({
    context,
    nodeStart: signature.start,
    property: {
      name,
      type,
      optional: signature.optional,
      readonly: signature.readonly,
    },
  });
};
const buildMethodSignature = (
  signature: TSMethodSignature,
  context: StaticPropertyBuilderContext,
): DocProperty | undefined => {
  const name = extractPropertyName(signature.key);
  if (!name) {
    return undefined;
  }
  const returnType = signature.returnType
    ? context.buildType(signature.returnType.typeAnnotation)
    : ({ kind: "intrinsic", name: "void" } as const);
  return buildDocumentedStaticProperty({
    context,
    nodeStart: signature.start,
    property: {
      name,
      type: {
        kind: "function",
        parameters: context.buildParams(signature.params),
        returnType,
      },
      optional: signature.optional,
      readonly: false,
    },
  });
};
const buildIndexSignature = (
  signature: TSSignature,
  context: StaticPropertyBuilderContext,
): DocProperty | undefined => {
  const indexSignature = getIndexSignatureLike(signature);
  const parameter = indexSignature.parameters?.[0];
  if (!parameter) {
    return undefined;
  }
  const keyType = parameter.typeAnnotation
    ? buildAnnotatedType({
        annotation: parameter.typeAnnotation,
        fallback: { kind: "primitive", name: "string" },
        context,
      })
    : ({ kind: "primitive", name: "string" } as const);
  const valueType = indexSignature.typeAnnotation
    ? buildAnnotatedType({
        annotation: indexSignature.typeAnnotation,
        fallback: { kind: "intrinsic", name: "any" },
        context,
      })
    : ({ kind: "intrinsic", name: "any" } as const);
  const name = `[${parameter.name}: ${keyType.kind === "primitive" ? keyType.name : "key"}]`;
  return buildDocumentedStaticProperty({
    context,
    nodeStart: indexSignature.start,
    property: {
      name,
      type: valueType,
      optional: false,
      readonly: indexSignature.readonly ?? false,
    },
  });
};
const buildCallSignature = (
  signature: TSSignature,
  context: StaticPropertyBuilderContext,
): DocProperty | undefined => {
  const callSignature = getCallSignatureLike(signature);
  const returnType = callSignature.returnType
    ? buildAnnotatedType({
        annotation: callSignature.returnType,
        fallback: { kind: "intrinsic", name: "void" },
        context,
      })
    : ({ kind: "intrinsic", name: "void" } as const);
  return buildDocumentedStaticProperty({
    context,
    nodeStart: callSignature.start,
    property: {
      name: "__call",
      type: {
        kind: "function",
        parameters: context.buildParams(callSignature.params ?? []),
        returnType,
      },
      optional: false,
      readonly: false,
    },
  });
};
type BuildAnnotatedTypeOptions = {
  /**
   * OXC wrapper that may contain a nested type annotation.
   */
  annotation: {
    /**
     * Nested type annotation.
     */
    typeAnnotation?: TSType;
  };
  /**
   * Fallback type when OXC omits the nested annotation.
   */
  fallback: DocType;
  /**
   * Static property builder context.
   */
  context: StaticPropertyBuilderContext;
};

const buildAnnotatedType = (options: BuildAnnotatedTypeOptions): DocType => {
  const { annotation, fallback, context } = options;

  if (annotation.typeAnnotation) {
    return context.buildType(annotation.typeAnnotation);
  }

  return fallback;
};
const buildDocumentedStaticProperty = (input: {
  context: StaticPropertyBuilderContext;
  nodeStart: number;
  property: Pick<DocProperty, "name" | "type" | "optional" | "readonly">;
}): DocProperty => {
  const { context, nodeStart, property } = input;
  const jsdoc = extractJSDocForNode({
    parsed: context.parsed,
    nodeStart,
    tagParsers: context.config.tags,
  });
  return buildStaticProperty({
    ...property,
    description: jsdoc.description,
    tags: jsdoc.tags,
    defaultValue: jsdoc.defaultValue,
    source: offsetToLocation({
      parsed: context.parsed,
      offset: nodeStart,
      filePath: context.filePath,
    }),
  });
};
export const extractPropertyName = (
  key: TSPropertySignature["key"] | TSMethodSignature["key"],
): string | undefined => {
  if (key.type === "Identifier") {
    return key.name;
  }
  if (key.type === "Literal") {
    const value = getLiteralKeyValue(key);
    return value != null ? String(value) : undefined;
  }
  return undefined;
};
type BuildUnresolvedExtractionPropertyOptions = {
  text: string;
  parsed: ParsedSource;
  filePath: string;
  start: number;
};

export const buildUnresolvedExtractionProperty = (
  options: BuildUnresolvedExtractionPropertyOptions,
): DocProperty => {
  const { text, parsed, filePath, start } = options;
  return buildStaticProperty({
    name: UNRESOLVED_PROPERTY_NAME,
    type: { kind: "unresolved", text },
    optional: false,
    readonly: false,
    description: "",
    tags: {},
    defaultValue: undefined,
    source: offsetToLocation({ parsed, offset: start, filePath }),
  });
};
export const buildStaticProperty = (property: DocProperty): DocProperty => {
  return emitDocProperty(
    normalizeDocProperty({
      ...property,
      provenance: { kind: "static", filePath: property.source.filePath },
    }),
  );
};
