import type { ParamPattern, TSType } from "oxc-parser";

import type { DocFnParam, DocType } from "../schema/doc-schema";

import { getParamLike } from "./oxc-ast-compat";
type StaticFunctionParamContext = {
  buildType: (type: TSType) => DocType;
};
type TypeAnnotationLike = {
  typeAnnotation?: TSType;
};
export const buildStaticFnParams = (
  params: ParamPattern[],
  context: StaticFunctionParamContext,
): DocFnParam[] => {
  return params.map((param) => buildStaticFnParam(param, context));
};
const buildStaticFnParam = (
  param: ParamPattern,
  context: StaticFunctionParamContext,
): DocFnParam => {
  const anyParam = getParamLike(param);
  if (anyParam.type === "RestElement") {
    const name =
      anyParam.argument?.type === "Identifier" ? (anyParam.argument.name ?? "...") : "...";
    const type = buildParamType(
      anyParam.typeAnnotation ?? anyParam.argument?.typeAnnotation,
      context,
    );
    return { name, type, optional: false, rest: true };
  }
  if (anyParam.type === "TSParameterProperty") {
    const inner = anyParam.parameter;
    if (inner?.type === "Identifier") {
      return {
        name: inner.name ?? "<param>",
        type: buildParamType(inner.typeAnnotation, context),
        optional: inner.optional ?? false,
        rest: false,
      };
    }
    return unknownParam();
  }
  if (anyParam.type === "Identifier") {
    return {
      name: anyParam.name ?? "<param>",
      type: buildParamType(anyParam.typeAnnotation, context),
      optional: anyParam.optional ?? false,
      rest: false,
    };
  }
  if (anyParam.type === "AssignmentPattern") {
    const left = anyParam.left;
    const name = left?.type === "Identifier" ? (left.name ?? "<param>") : "<param>";
    const type =
      left?.type === "Identifier" && left.typeAnnotation
        ? buildParamType(left.typeAnnotation, context)
        : anyType();
    return { name, type, optional: true, rest: false };
  }
  return unknownParam();
};
const buildParamType = (
  annotation: TypeAnnotationLike | null | undefined,
  context: StaticFunctionParamContext,
): DocType => {
  return annotation?.typeAnnotation ? context.buildType(annotation.typeAnnotation) : anyType();
};
const unknownParam = (): DocFnParam => {
  return {
    name: "<param>",
    type: anyType(),
    optional: false,
    rest: false,
  };
};
const anyType = (): DocType => {
  return { kind: "intrinsic", name: "any" };
};
