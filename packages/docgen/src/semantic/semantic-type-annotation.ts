import type * as TypeScript from "typescript";

import type { DocgenConfig } from "../public/config";
import type { DocFnParam, DocProperty, DocType } from "../schema/doc-schema";

import {
  createArrayDocType,
  createIntersectionDocType,
  createIntrinsicDocType,
  createLiteralDocType,
  createPrimitiveDocType,
  createReferenceDocType,
  createTupleDocType,
  createUnionDocType,
} from "../model/doc-type-factory";
import { resolvePresetDisplayAlias } from "../public/presets";
import { isIgnoredTypeName } from "../resolver/ignored-types";
import { getSemanticJSDoc, getSemanticSignatureJSDoc } from "./semantic-jsdoc";
import { hasReadonlyModifier, semanticSourceLocation } from "./semantic-source";

type SemanticTypeAnnotationContext = {
  /**
   * TypeScript namespace used for syntax guards.
   */
  ts: typeof TypeScript;
  /**
   * Active checker used to resolve indexed-access annotations.
   */
  checker: TypeScript.TypeChecker;
  /**
   * Effective docgen config used for ignored and display-aliased type references.
   */
  config: Pick<DocgenConfig, "ignoreTypes" | "presets" | "tags">;
};

export type BuildIgnoredTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Declaration that may have an ignored explicit type annotation.
   */
  declaration: TypeScript.Declaration;
};

export const buildIgnoredTypeAnnotation = (
  options: BuildIgnoredTypeAnnotationOptions,
): DocType | undefined => {
  const { context, declaration } = options;
  const typeNode = getDeclarationTypeNode(context.ts, declaration);

  if (!typeNode) {
    return undefined;
  }

  const reference = buildTypeReferenceAnnotation({ context, typeNode });

  if (!reference) {
    return undefined;
  }

  const rawName = getTypeReferenceName(context.ts, typeNode);
  if (!rawName || !isIgnoredTypeName({ config: context.config, name: rawName })) {
    return undefined;
  }

  return reference;
};

export type BuildPropertyTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Symbol whose declaration annotations should be inspected.
   */
  symbol: TypeScript.Symbol;
};

export const buildPropertyTypeAnnotation = (
  options: BuildPropertyTypeAnnotationOptions,
): DocType | undefined => {
  const { context, symbol } = options;
  const declarations = symbol.declarations ?? [];

  for (const declaration of declarations) {
    if (context.ts.isMethodSignature(declaration)) {
      const type = buildMethodSignatureTypeAnnotation({
        context,
        member: declaration,
      });

      if (type && containsReferenceType(type)) {
        return type;
      }
    }

    const typeNode = getDeclarationTypeNode(context.ts, declaration);

    if (!typeNode || isNeverTypeNode(context.ts, typeNode)) {
      continue;
    }

    const reference = buildPreservedTypeAnnotation({
      context,
      typeNode,
      requireReference: true,
    });

    if (reference) {
      return reference;
    }
  }

  return undefined;
};

type BuildTypeReferenceAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Type node potentially encoding a reference annotation.
   */
  typeNode: TypeScript.TypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
  /**
   * Whether primitive and literal nodes can be preserved as part of a richer wrapper.
   */
  allowScalar?: boolean;
  /**
   * Whether the built type must contain a reference to override checker output.
   */
  requireReference?: boolean;
};

const buildPreservedTypeAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const preserved = buildAnyPreservedTypeAnnotation(options);

  if (!preserved) {
    return undefined;
  }

  if (options.requireReference && !containsReferenceType(preserved)) {
    return undefined;
  }

  return preserved;
};

const buildAnyPreservedTypeAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const reference = buildTypeReferenceAnnotation(options);

  if (reference) {
    return reference;
  }

  if (context.ts.isFunctionTypeNode(typeNode)) {
    return buildFunctionTypeAnnotation({
      context,
      typeNode,
      resolving: options.resolving,
    });
  }

  if (context.ts.isParenthesizedTypeNode(typeNode)) {
    return buildPreservedTypeAnnotation({
      context,
      typeNode: typeNode.type,
      resolving: options.resolving,
      allowScalar: options.allowScalar,
    });
  }

  if (context.ts.isArrayTypeNode(typeNode)) {
    const elementType = buildPreservedTypeAnnotation({
      context,
      typeNode: typeNode.elementType,
      resolving: options.resolving,
      allowScalar: options.allowScalar,
    });

    return elementType ? createArrayDocType(elementType) : undefined;
  }

  if (context.ts.isUnionTypeNode(typeNode)) {
    return buildPreservedTypeListAnnotation({
      context,
      typeNodes: typeNode.types,
      kind: "union",
      resolving: options.resolving,
    });
  }

  if (context.ts.isIntersectionTypeNode(typeNode)) {
    return buildPreservedTypeListAnnotation({
      context,
      typeNodes: typeNode.types,
      kind: "intersection",
      resolving: options.resolving,
    });
  }

  if (context.ts.isTypeLiteralNode(typeNode)) {
    return buildTypeLiteralAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isTupleTypeNode(typeNode)) {
    return buildTupleTypeAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isTypeOperatorNode(typeNode)) {
    return buildTypeOperatorAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isConditionalTypeNode(typeNode)) {
    return buildConditionalTypeAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isIndexedAccessTypeNode(typeNode)) {
    return buildIndexedAccessTypeAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isMappedTypeNode(typeNode)) {
    return buildMappedTypeAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (context.ts.isTemplateLiteralTypeNode(typeNode)) {
    return buildTemplateLiteralTypeAnnotation({ context, typeNode, resolving: options.resolving });
  }

  if (options.allowScalar) {
    return (
      buildPrimitiveTypeAnnotation({ context, typeNode }) ??
      buildLiteralTypeAnnotation({ context, typeNode })
    );
  }

  return undefined;
};

const buildTypeReferenceAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;

  if (!context.ts.isTypeReferenceNode(typeNode)) {
    return undefined;
  }

  const rawName = getTypeReferenceName(context.ts, typeNode);

  if (!rawName) {
    return undefined;
  }

  const name = resolvePresetDisplayAlias(context.config.presets, rawName);
  const typeArguments: DocType[] = [];

  for (const arg of typeNode.typeArguments ?? []) {
    const typeArgument = buildPreservedTypeAnnotation({
      context,
      typeNode: arg,
      resolving: options.resolving,
      allowScalar: true,
    });

    if (!typeArgument) {
      return undefined;
    }

    typeArguments.push(typeArgument);
  }

  if ((rawName === "Array" || rawName === "ReadonlyArray") && typeArguments.length === 1) {
    return createArrayDocType(typeArguments[0]);
  }

  if (typeArguments.length > 0) {
    return createReferenceDocType({ name, typeArguments });
  }

  return createReferenceDocType({ name });
};

type BuildPreservedTypeListAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Type nodes to preserve as a union or intersection.
   */
  typeNodes: readonly TypeScript.TypeNode[];
  /**
   * Container kind to build after preserving all members.
   */
  kind: "union" | "intersection";
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildPreservedTypeListAnnotation = (
  options: BuildPreservedTypeListAnnotationOptions,
): DocType | undefined => {
  const { context, typeNodes, kind } = options;
  const members: DocType[] = [];

  for (const typeNode of typeNodes) {
    const member = buildPreservedTypeAnnotation({
      context,
      typeNode,
      resolving: options.resolving,
      allowScalar: true,
    });

    if (!member) {
      return undefined;
    }

    members.push(member);
  }

  return kind === "union" ? createUnionDocType(members) : createIntersectionDocType(members);
};

type BuildFunctionTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Function type node whose explicit annotations should be preserved.
   */
  typeNode: TypeScript.FunctionTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildFunctionTypeAnnotation = (
  options: BuildFunctionTypeAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const parameters: DocFnParam[] = [];

  for (const parameter of typeNode.parameters) {
    const docParam = buildFunctionParameterAnnotation({
      context,
      parameter,
      resolving: options.resolving,
    });

    if (!docParam) {
      return undefined;
    }

    parameters.push(docParam);
  }

  const returnType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.type,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!returnType) {
    return undefined;
  }

  return {
    kind: "function",
    parameters,
    returnType,
  };
};

type BuildTypeLiteralAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Type literal node whose members should be preserved.
   */
  typeNode: TypeScript.TypeLiteralNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTypeLiteralAnnotation = (
  options: BuildTypeLiteralAnnotationOptions,
): DocType | undefined => {
  const properties = options.typeNode.members
    .map((member) =>
      buildTypeElementProperty({
        context: options.context,
        member,
        resolving: options.resolving,
      }),
    )
    .filter((property): property is NonNullable<typeof property> => Boolean(property));

  if (properties.length !== options.typeNode.members.length) {
    return undefined;
  }

  return { kind: "object", properties };
};

type BuildTypeElementPropertyOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Object type member to preserve as a property.
   */
  member: TypeScript.TypeElement;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTypeElementProperty = (
  options: BuildTypeElementPropertyOptions,
): DocProperty | undefined => {
  const { context, member } = options;

  if (context.ts.isPropertySignature(member)) {
    const name = getPropertyNameText(context.ts, member.name);
    const jsDoc = getTypeElementJSDoc({ context, member });
    const type = member.type
      ? buildPreservedTypeAnnotation({
          context,
          typeNode: member.type,
          resolving: options.resolving,
          allowScalar: true,
        })
      : createIntrinsicDocType("any");

    if (!name || !type) {
      return undefined;
    }

    return {
      name,
      type,
      optional: Boolean(member.questionToken),
      readonly: hasReadonlyModifier(context.ts, member),
      description: jsDoc.description,
      tags: jsDoc.tags,
      defaultValue: jsDoc.defaultValue,
      source: semanticSourceLocation(member),
    };
  }

  if (context.ts.isMethodSignature(member)) {
    const name = getPropertyNameText(context.ts, member.name);
    const jsDoc = getTypeElementJSDoc({ context, member });
    const type = buildMethodSignatureTypeAnnotation({
      context,
      member,
      resolving: options.resolving,
    });

    if (!name || !type) {
      return undefined;
    }

    return {
      name,
      type,
      optional: Boolean(member.questionToken),
      readonly: false,
      description: jsDoc.description,
      tags: jsDoc.tags,
      defaultValue: jsDoc.defaultValue,
      source: semanticSourceLocation(member),
    };
  }

  if (context.ts.isIndexSignatureDeclaration(member)) {
    const parameter = member.parameters[0];
    const keyType = parameter?.type
      ? buildPreservedTypeAnnotation({
          context,
          typeNode: parameter.type,
          resolving: options.resolving,
          allowScalar: true,
        })
      : createPrimitiveDocType("string");
    const valueType = member.type
      ? buildPreservedTypeAnnotation({
          context,
          typeNode: member.type,
          resolving: options.resolving,
          allowScalar: true,
        })
      : createIntrinsicDocType("any");

    if (!parameter || !keyType || !valueType) {
      return undefined;
    }

    return {
      name: `[${parameter.name.getText(parameter.getSourceFile())}: ${
        keyType.kind === "primitive" ? keyType.name : "key"
      }]`,
      type: valueType,
      optional: false,
      readonly: hasReadonlyModifier(context.ts, member),
      description: "",
      tags: {},
      defaultValue: undefined,
      source: semanticSourceLocation(member),
    };
  }

  if (context.ts.isCallSignatureDeclaration(member)) {
    const type = buildCallSignatureTypeAnnotation({
      context,
      member,
      resolving: options.resolving,
    });

    if (!type) {
      return undefined;
    }

    return {
      name: "__call",
      type,
      optional: false,
      readonly: false,
      ...getCallSignatureJSDoc({ context, member }),
      source: semanticSourceLocation(member),
    };
  }

  return undefined;
};

type GetTypeElementJSDocOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Object type member whose documentation should be preserved.
   */
  member: TypeScript.TypeElement;
};

const getTypeElementJSDoc = (
  options: GetTypeElementJSDocOptions,
): Pick<DocProperty, "description" | "tags" | "defaultValue"> => {
  const { context, member } = options;

  const name = "name" in member ? member.name : undefined;

  if (!name) {
    return {
      description: "",
      tags: {},
      defaultValue: undefined,
    };
  }

  const symbol = context.checker.getSymbolAtLocation(name);

  if (!symbol) {
    return {
      description: "",
      tags: {},
      defaultValue: undefined,
    };
  }

  return getSemanticJSDoc({ context, symbol });
};

type GetCallSignatureJSDocOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Call signature whose documentation should be preserved.
   */
  member: TypeScript.CallSignatureDeclaration;
};

const getCallSignatureJSDoc = (
  options: GetCallSignatureJSDocOptions,
): Pick<DocProperty, "description" | "tags" | "defaultValue"> => {
  const { context, member } = options;
  const signature = context.checker.getSignatureFromDeclaration(member);

  if (!signature) {
    return {
      description: "",
      tags: {},
      defaultValue: undefined,
    };
  }

  return getSemanticSignatureJSDoc({ context, signature });
};

type BuildMethodSignatureTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Method member to preserve as a function type.
   */
  member: TypeScript.MethodSignature;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildMethodSignatureTypeAnnotation = (
  options: BuildMethodSignatureTypeAnnotationOptions,
): DocType | undefined => {
  const { context, member } = options;
  const parameters: DocFnParam[] = [];

  for (const parameter of member.parameters) {
    const docParam = buildFunctionParameterAnnotation({
      context,
      parameter,
      resolving: options.resolving,
    });

    if (!docParam) {
      return undefined;
    }

    parameters.push(docParam);
  }

  const returnType = member.type
    ? buildPreservedTypeAnnotation({
        context,
        typeNode: member.type,
        resolving: options.resolving,
        allowScalar: true,
      })
    : createIntrinsicDocType("void");

  if (!returnType) {
    return undefined;
  }

  return {
    kind: "function",
    parameters,
    returnType,
  };
};

type BuildCallSignatureTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Call signature member to preserve as a function type.
   */
  member: TypeScript.CallSignatureDeclaration;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildCallSignatureTypeAnnotation = (
  options: BuildCallSignatureTypeAnnotationOptions,
): DocType | undefined => {
  const { context, member } = options;
  const parameters: DocFnParam[] = [];

  for (const parameter of member.parameters) {
    const docParam = buildFunctionParameterAnnotation({
      context,
      parameter,
      resolving: options.resolving,
    });

    if (!docParam) {
      return undefined;
    }

    parameters.push(docParam);
  }

  const returnType = member.type
    ? buildPreservedTypeAnnotation({
        context,
        typeNode: member.type,
        resolving: options.resolving,
        allowScalar: true,
      })
    : createIntrinsicDocType("void");

  if (!returnType) {
    return undefined;
  }

  return {
    kind: "function",
    parameters,
    returnType,
  };
};

type BuildTupleTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Tuple node to preserve.
   */
  typeNode: TypeScript.TupleTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTupleTypeAnnotation = (
  options: BuildTupleTypeAnnotationOptions,
): DocType | undefined => {
  const elements: DocType[] = [];

  for (const element of options.typeNode.elements) {
    const docType = buildTupleElementAnnotation({
      context: options.context,
      typeNode: element,
      resolving: options.resolving,
    });

    if (!docType) {
      return undefined;
    }

    elements.push(docType);
  }

  return createTupleDocType(elements);
};

type BuildTupleElementAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Tuple element node to preserve.
   */
  typeNode: TypeScript.TypeNode | TypeScript.NamedTupleMember;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTupleElementAnnotation = (
  options: BuildTupleElementAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;

  if (context.ts.isNamedTupleMember(typeNode)) {
    return buildTupleElementAnnotation({
      context,
      typeNode: typeNode.type,
      resolving: options.resolving,
    });
  }

  if (context.ts.isRestTypeNode(typeNode)) {
    const type = buildPreservedTypeAnnotation({
      context,
      typeNode: typeNode.type,
      resolving: options.resolving,
      allowScalar: true,
    });

    return type ? { kind: "rest", type } : undefined;
  }

  if (context.ts.isOptionalTypeNode(typeNode)) {
    return buildPreservedTypeAnnotation({
      context,
      typeNode: typeNode.type,
      resolving: options.resolving,
      allowScalar: true,
    });
  }

  return buildPreservedTypeAnnotation({
    context,
    typeNode,
    resolving: options.resolving,
    allowScalar: true,
  });
};

type BuildTypeOperatorAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Type operator node to preserve.
   */
  typeNode: TypeScript.TypeOperatorNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTypeOperatorAnnotation = (
  options: BuildTypeOperatorAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const type = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.type,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!type) {
    return undefined;
  }

  if (typeNode.operator === context.ts.SyntaxKind.KeyOfKeyword) {
    return { kind: "keyof", type };
  }

  if (typeNode.operator === context.ts.SyntaxKind.ReadonlyKeyword) {
    return type;
  }

  return undefined;
};

type BuildConditionalTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Conditional type node to preserve.
   */
  typeNode: TypeScript.ConditionalTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildConditionalTypeAnnotation = (
  options: BuildConditionalTypeAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const checkType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.checkType,
    resolving: options.resolving,
    allowScalar: true,
  });
  const extendsType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.extendsType,
    resolving: options.resolving,
    allowScalar: true,
  });
  const trueType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.trueType,
    resolving: options.resolving,
    allowScalar: true,
  });
  const falseType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.falseType,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!checkType || !extendsType || !trueType || !falseType) {
    return undefined;
  }

  return {
    kind: "conditional",
    checkType,
    extendsType,
    trueType,
    falseType,
  };
};

type BuildIndexedAccessTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Indexed access node to preserve.
   */
  typeNode: TypeScript.IndexedAccessTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildIndexedAccessTypeAnnotation = (
  options: BuildIndexedAccessTypeAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const resolvedProperty = buildIndexedAccessPropertyAnnotation(options);

  if (resolvedProperty) {
    return resolvedProperty;
  }

  const objectType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.objectType,
    resolving: options.resolving,
    allowScalar: true,
  });
  const indexType = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.indexType,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!objectType || !indexType) {
    return undefined;
  }

  return {
    kind: "indexedAccess",
    objectType,
    indexType,
  };
};

type BuildMappedTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Mapped type node to preserve.
   */
  typeNode: TypeScript.MappedTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildMappedTypeAnnotation = (
  options: BuildMappedTypeAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const constraintNode = typeNode.typeParameter.constraint;

  if (!constraintNode || !typeNode.type) {
    return undefined;
  }

  const constraint = buildPreservedTypeAnnotation({
    context,
    typeNode: constraintNode,
    resolving: options.resolving,
    allowScalar: true,
  });
  const type = buildPreservedTypeAnnotation({
    context,
    typeNode: typeNode.type,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!constraint || !type) {
    return undefined;
  }

  return {
    kind: "mapped",
    parameter: typeNode.typeParameter.name.text,
    constraint,
    type,
  };
};

type BuildTemplateLiteralTypeAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Template literal type node to preserve.
   */
  typeNode: TypeScript.TemplateLiteralTypeNode;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildTemplateLiteralTypeAnnotation = (
  options: BuildTemplateLiteralTypeAnnotationOptions,
): DocType | undefined => {
  const spans: Array<{ text: string } | { type: DocType }> = [{ text: options.typeNode.head.text }];

  for (const span of options.typeNode.templateSpans) {
    const type = buildPreservedTypeAnnotation({
      context: options.context,
      typeNode: span.type,
      resolving: options.resolving,
      allowScalar: true,
    });

    if (!type) {
      return undefined;
    }

    spans.push({ type }, { text: span.literal.text });
  }

  return {
    kind: "templateLiteral",
    spans,
  };
};

type BuildFunctionParameterAnnotationOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticTypeAnnotationContext;
  /**
   * Parameter declaration to preserve.
   */
  parameter: TypeScript.ParameterDeclaration;
  /**
   * Declaration positions currently being resolved.
   */
  resolving?: Set<string>;
};

const buildFunctionParameterAnnotation = (
  options: BuildFunctionParameterAnnotationOptions,
): DocFnParam | undefined => {
  const { context, parameter } = options;

  if (!parameter.type) {
    return undefined;
  }

  const type = buildPreservedTypeAnnotation({
    context,
    typeNode: parameter.type,
    resolving: options.resolving,
    allowScalar: true,
  });

  if (!type) {
    return undefined;
  }

  return {
    name: parameter.name.getText(parameter.getSourceFile()),
    type,
    optional: Boolean(parameter.questionToken),
    rest: Boolean(parameter.dotDotDotToken),
  };
};

const buildPrimitiveTypeAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;

  if (typeNode.kind === context.ts.SyntaxKind.StringKeyword) {
    return createPrimitiveDocType("string");
  }

  if (typeNode.kind === context.ts.SyntaxKind.NumberKeyword) {
    return createPrimitiveDocType("number");
  }

  if (typeNode.kind === context.ts.SyntaxKind.BooleanKeyword) {
    return createPrimitiveDocType("boolean");
  }

  if (typeNode.kind === context.ts.SyntaxKind.BigIntKeyword) {
    return createPrimitiveDocType("bigint");
  }

  if (typeNode.kind === context.ts.SyntaxKind.SymbolKeyword) {
    return createPrimitiveDocType("symbol");
  }

  if (typeNode.kind === context.ts.SyntaxKind.ObjectKeyword) {
    return createPrimitiveDocType("object");
  }

  if (typeNode.kind === context.ts.SyntaxKind.AnyKeyword) {
    return createIntrinsicDocType("any");
  }

  if (typeNode.kind === context.ts.SyntaxKind.UnknownKeyword) {
    return createIntrinsicDocType("unknown");
  }

  if (typeNode.kind === context.ts.SyntaxKind.VoidKeyword) {
    return createIntrinsicDocType("void");
  }

  if (typeNode.kind === context.ts.SyntaxKind.UndefinedKeyword) {
    return createIntrinsicDocType("undefined");
  }

  if (typeNode.kind === context.ts.SyntaxKind.NullKeyword) {
    return createIntrinsicDocType("null");
  }

  return undefined;
};

const buildLiteralTypeAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;

  if (!context.ts.isLiteralTypeNode(typeNode)) {
    return undefined;
  }

  const literal = typeNode.literal;

  if (context.ts.isStringLiteral(literal)) {
    return createLiteralDocType(`'${literal.text}'`);
  }

  return createLiteralDocType(literal.getText(literal.getSourceFile()));
};

const containsReferenceType = (type: DocType): boolean => {
  switch (type.kind) {
    case "reference":
      return true;
    case "array":
      return containsReferenceType(type.elementType);
    case "tuple":
      return type.elements.some(containsReferenceType);
    case "object":
      return type.properties.some((property) => containsReferenceType(property.type));
    case "function":
      return (
        type.parameters.some((parameter) => containsReferenceType(parameter.type)) ||
        containsReferenceType(type.returnType)
      );
    case "mapped":
      return containsReferenceType(type.constraint) || containsReferenceType(type.type);
    case "conditional":
      return (
        containsReferenceType(type.checkType) ||
        containsReferenceType(type.extendsType) ||
        containsReferenceType(type.trueType) ||
        containsReferenceType(type.falseType)
      );
    case "indexedAccess":
      return containsReferenceType(type.objectType) || containsReferenceType(type.indexType);
    case "templateLiteral":
      return type.spans.some((span) => "type" in span && containsReferenceType(span.type));
    case "keyof":
    case "rest":
      return containsReferenceType(type.type);
    case "union":
    case "intersection":
      return type.members.some(containsReferenceType);
    default:
      return false;
  }
};

const buildIndexedAccessPropertyAnnotation = (
  options: BuildTypeReferenceAnnotationOptions,
): DocType | undefined => {
  const { context, typeNode } = options;
  const resolving = options.resolving ?? new Set<string>();

  if (!context.ts.isIndexedAccessTypeNode(typeNode)) {
    return undefined;
  }

  const propertyName = getStringLiteralIndexName(context.ts, typeNode.indexType);

  if (!propertyName) {
    return undefined;
  }

  const objectType = context.checker.getTypeAtLocation(typeNode.objectType);
  const property = objectType.getProperty(propertyName);
  const declarations = property?.declarations ?? [];

  for (const declaration of declarations) {
    const declarationKey = `${declaration.getSourceFile().fileName}:${declaration.pos}`;
    if (resolving.has(declarationKey)) {
      continue;
    }

    const propertyTypeNode = getDeclarationTypeNode(context.ts, declaration);

    if (!propertyTypeNode || isNeverTypeNode(context.ts, propertyTypeNode)) {
      continue;
    }

    resolving.add(declarationKey);
    const preserved = buildPreservedTypeAnnotation({
      context,
      typeNode: propertyTypeNode,
      resolving,
    });
    resolving.delete(declarationKey);

    if (preserved) {
      return preserved;
    }
  }

  return undefined;
};

const getTypeReferenceName = (
  ts: typeof TypeScript,
  typeNode: TypeScript.TypeNode,
): string | undefined => {
  if (!ts.isTypeReferenceNode(typeNode)) {
    return undefined;
  }

  return typeNode.typeName.getText(typeNode.getSourceFile());
};

const getStringLiteralIndexName = (
  ts: typeof TypeScript,
  typeNode: TypeScript.TypeNode,
): string | undefined => {
  if (!ts.isLiteralTypeNode(typeNode) || !ts.isStringLiteral(typeNode.literal)) {
    return undefined;
  }

  return typeNode.literal.text;
};

const getPropertyNameText = (
  ts: typeof TypeScript,
  name: TypeScript.PropertyName,
): string | undefined => {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }

  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return name.getText(name.getSourceFile());
};

const getDeclarationTypeNode = (
  ts: typeof TypeScript,
  declaration: TypeScript.Declaration,
): TypeScript.TypeNode | undefined => {
  if (
    ts.isPropertySignature(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isParameter(declaration)
  ) {
    return declaration.type;
  }

  return undefined;
};

const isNeverTypeNode = (ts: typeof TypeScript, typeNode: TypeScript.TypeNode): boolean => {
  return typeNode.kind === ts.SyntaxKind.NeverKeyword;
};
