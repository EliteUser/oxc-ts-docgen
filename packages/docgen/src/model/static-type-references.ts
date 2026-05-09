import type { ParamPattern, TSSignature, TSType } from "oxc-parser";

import type { FoundDeclaration } from "../resolver/parser";
export const collectStaticTypeReferenceNames = (decl: FoundDeclaration["decl"]): Set<string> => {
  const references = new Set<string>();
  if (decl.type === "TSInterfaceDeclaration") {
    for (const parent of decl.extends ?? []) {
      collectTypeName(parent.expression, references);
      for (const arg of parent.typeArguments?.params ?? []) collectType(arg, references);
    }
    for (const member of decl.body.body) collectSignature(member, references);
  } else if (decl.type === "TSTypeAliasDeclaration") {
    collectType(decl.typeAnnotation, references);
  }
  return references;
};
const collectSignature = (signature: TSSignature, references: Set<string>): void => {
  if (signature.type === "TSPropertySignature") {
    if (signature.typeAnnotation) {
      collectType(signature.typeAnnotation.typeAnnotation, references);
    }
    return;
  }
  if (signature.type === "TSMethodSignature") {
    for (const param of signature.params) collectParam(param, references);
    if (signature.returnType) collectType(signature.returnType.typeAnnotation, references);
    return;
  }
  if (signature.type === "TSIndexSignature") {
    const indexSignature = signature as unknown as {
      parameters?: Array<{
        typeAnnotation?: {
          typeAnnotation: TSType;
        };
      }>;
      typeAnnotation?: {
        typeAnnotation: TSType;
      };
    };
    for (const parameter of indexSignature.parameters ?? []) {
      if (parameter.typeAnnotation)
        collectType(parameter.typeAnnotation.typeAnnotation, references);
    }
    if (indexSignature.typeAnnotation) {
      collectType(indexSignature.typeAnnotation.typeAnnotation, references);
    }
    return;
  }
  if (signature.type === "TSCallSignatureDeclaration") {
    const callSignature = signature as unknown as {
      params?: ParamPattern[];
      returnType?: {
        typeAnnotation: TSType;
      };
    };
    for (const param of callSignature.params ?? []) collectParam(param, references);
    if (callSignature.returnType) collectType(callSignature.returnType.typeAnnotation, references);
  }
};
const collectParam = (param: ParamPattern, references: Set<string>): void => {
  const node = param as {
    type: string;
    typeAnnotation?: {
      typeAnnotation: TSType;
    } | null;
    argument?: {
      typeAnnotation?: {
        typeAnnotation: TSType;
      } | null;
    };
    parameter?: {
      typeAnnotation?: {
        typeAnnotation: TSType;
      } | null;
    };
    left?: {
      typeAnnotation?: {
        typeAnnotation: TSType;
      } | null;
    };
  };
  const annotation =
    node.typeAnnotation ??
    node.argument?.typeAnnotation ??
    node.parameter?.typeAnnotation ??
    node.left?.typeAnnotation;
  if (annotation) collectType(annotation.typeAnnotation, references);
};
const collectType = (type: TSType, references: Set<string>): void => {
  switch (type.type) {
    case "TSTypeReference":
      collectTypeName(type.typeName, references);
      for (const arg of type.typeArguments?.params ?? []) collectType(arg, references);
      break;
    case "TSUnionType":
    case "TSIntersectionType":
      for (const member of type.types) collectType(member, references);
      break;
    case "TSArrayType":
      collectType(type.elementType, references);
      break;
    case "TSTupleType":
      for (const element of type.elementTypes) collectTupleElement(element, references);
      break;
    case "TSTypeLiteral":
      for (const member of type.members) collectSignature(member, references);
      break;
    case "TSFunctionType":
      for (const param of type.params) collectParam(param, references);
      collectType(type.returnType.typeAnnotation, references);
      break;
    case "TSParenthesizedType":
      collectType(type.typeAnnotation, references);
      break;
    case "TSTypeOperator":
      collectType(type.typeAnnotation, references);
      break;
    case "TSConditionalType":
      collectType(type.checkType, references);
      collectType(type.extendsType, references);
      collectType(type.trueType, references);
      collectType(type.falseType, references);
      break;
    case "TSIndexedAccessType":
      collectType(type.objectType, references);
      collectType(type.indexType, references);
      break;
    case "TSMappedType":
      if (type.constraint) collectType(type.constraint, references);
      if (type.typeAnnotation) collectType(type.typeAnnotation, references);
      break;
    case "TSTemplateLiteralType":
      for (const templateType of type.types) collectType(templateType, references);
      break;
    case "TSJSDocNullableType":
    case "TSJSDocNonNullableType":
      collectType(
        (
          type as {
            typeAnnotation: TSType;
          }
        ).typeAnnotation,
        references,
      );
      break;
    case "TSImportType":
    case "TSConstructorType":
    case "TSInferType":
    case "TSNamedTupleMember":
      collectSpecialType(type, references);
      break;
    default:
      break;
  }
};
const collectTupleElement = (element: unknown, references: Set<string>): void => {
  const tupleElement = element as {
    type?: string;
    typeAnnotation?: TSType;
    elementType?: unknown;
  };
  if (tupleElement.type === "TSRestType" && tupleElement.typeAnnotation) {
    collectType(tupleElement.typeAnnotation, references);
    return;
  }
  if (tupleElement.type === "TSOptionalType" && tupleElement.typeAnnotation) {
    collectType(tupleElement.typeAnnotation, references);
    return;
  }
  if (tupleElement.type === "TSNamedTupleMember" && tupleElement.elementType) {
    collectTupleElement(tupleElement.elementType, references);
    return;
  }
  collectType(element as TSType, references);
};
const collectSpecialType = (type: TSType, references: Set<string>): void => {
  const node = type as {
    typeArguments?: {
      params?: TSType[];
    } | null;
    params?: ParamPattern[];
    returnType?: {
      typeAnnotation: TSType;
    };
    typeParameter?: {
      constraint?: TSType;
    };
    elementType?: unknown;
  };
  for (const arg of node.typeArguments?.params ?? []) collectType(arg, references);
  for (const param of node.params ?? []) collectParam(param, references);
  if (node.returnType) collectType(node.returnType.typeAnnotation, references);
  if (node.typeParameter?.constraint) collectType(node.typeParameter.constraint, references);
  if (node.elementType) collectTupleElement(node.elementType, references);
};
const collectTypeName = (typeName: unknown, references: Set<string>): void => {
  const name = resolveStaticTypeName(typeName);
  if (name) references.add(name);
};
const resolveStaticTypeName = (typeName: unknown): string | undefined => {
  if (!typeName || typeof typeName !== "object") {
    return undefined;
  }
  const node = typeName as {
    type?: unknown;
    name?: unknown;
    left?: unknown;
    right?: {
      name?: unknown;
    };
  };
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type === "TSQualifiedName") {
    const left = resolveStaticTypeName(node.left);
    const right = typeof node.right?.name === "string" ? node.right.name : undefined;
    return left && right ? `${left}.${right}` : undefined;
  }
  return undefined;
};
