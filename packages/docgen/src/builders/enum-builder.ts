import type { TSEnumDeclaration } from "oxc-parser";

import type { DocgenConfig } from "../public/config";
import type { ParsedSource } from "../resolver/parser";
import type { DocProperty, DocType } from "../schema/doc-schema";

import { emitDocProperty, normalizeDocProperty } from "../model/property-model";
import { extractJSDocForNode } from "../utils/jsdoc";
import { offsetToLocation } from "../utils/source-location";
import { getEnumMembers, type EnumInitializerLike, type EnumMemberLike } from "./oxc-ast-compat";

type BuildEnumMembersOptions = {
  decl: TSEnumDeclaration;
  parsed: ParsedSource;
  filePath: string;
  config: DocgenConfig;
};

export const buildEnumMembers = (options: BuildEnumMembersOptions): DocProperty[] => {
  const { decl, parsed, filePath, config } = options;
  const members = getEnumMembers(decl);
  let nextAutoValue: number | undefined = 0;
  return members.map((member) => {
    const name = enumMemberName(member);
    const jsdoc = extractJSDocForNode({
      parsed,
      nodeStart: member.start,
      tagParsers: config.tags,
    });
    const evaluated = evaluateEnumMemberType({
      member,
      parsed,
      nextAutoValue,
      fallbackName: name,
    });
    nextAutoValue = evaluated.nextAutoValue;
    const type = evaluated.type;
    const source = offsetToLocation({ parsed, offset: member.start, filePath });
    return emitDocProperty(
      normalizeDocProperty({
        name,
        type,
        optional: false,
        readonly: true,
        description: jsdoc.description,
        tags: jsdoc.tags,
        defaultValue: jsdoc.defaultValue,
        source,
        provenance: { kind: "static", filePath: source.filePath },
      }),
    );
  });
};
const enumMemberName = (member: EnumMemberLike): string => {
  if (member.id.type === "Identifier") {
    return member.id.name ?? "";
  }
  return member.id.value != null ? String(member.id.value) : "";
};
type EvaluateEnumMemberTypeOptions = {
  member: EnumMemberLike;
  parsed: ParsedSource;
  nextAutoValue: number | undefined;
  fallbackName: string;
};

const evaluateEnumMemberType = (
  options: EvaluateEnumMemberTypeOptions,
): {
  type: DocType;
  nextAutoValue: number | undefined;
} => {
  const { member, parsed, nextAutoValue, fallbackName } = options;
  const initializer = member.initializer;
  if (!initializer) {
    if (nextAutoValue === undefined) {
      return { type: { kind: "literal", value: fallbackName }, nextAutoValue: undefined };
    }
    return {
      type: { kind: "literal", value: String(nextAutoValue) },
      nextAutoValue: nextAutoValue + 1,
    };
  }
  const literal = literalEnumValue(initializer);
  if (typeof literal === "string") {
    return { type: { kind: "literal", value: `'${literal}'` }, nextAutoValue: undefined };
  }
  if (typeof literal === "number") {
    return { type: { kind: "literal", value: String(literal) }, nextAutoValue: literal + 1 };
  }
  if (typeof literal === "boolean") {
    return { type: { kind: "literal", value: String(literal) }, nextAutoValue: undefined };
  }
  return {
    type: { kind: "unresolved", text: parsed.source.slice(initializer.start, initializer.end) },
    nextAutoValue: undefined,
  };
};
const literalEnumValue = (
  initializer: EnumInitializerLike,
): string | number | boolean | undefined => {
  if (initializer.type === "Literal") {
    return typeof initializer.value === "string" ||
      typeof initializer.value === "number" ||
      typeof initializer.value === "boolean"
      ? initializer.value
      : undefined;
  }
  return numericEnumExpressionValue(initializer);
};
const numericEnumExpressionValue = (initializer: EnumInitializerLike): number | undefined => {
  if (initializer.type === "UnaryExpression") {
    const value = initializer.argument
      ? numericEnumExpressionValue(initializer.argument)
      : undefined;
    if (value === undefined) {
      return undefined;
    }
    if (initializer.operator === "-") {
      return -value;
    }
    if (initializer.operator === "+") {
      return value;
    }
    if (initializer.operator === "~") {
      return ~value;
    }
    return undefined;
  }
  if (initializer.type === "BinaryExpression") {
    const left = initializer.left ? numericEnumExpressionValue(initializer.left) : undefined;
    const right = initializer.right ? numericEnumExpressionValue(initializer.right) : undefined;
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return evaluateNumericBinaryExpression({
      left,
      operator: initializer.operator,
      right,
    });
  }
  if (initializer.type === "Literal" && typeof initializer.value === "number") {
    return initializer.value;
  }
  return undefined;
};
type EvaluateNumericBinaryExpressionOptions = {
  left: number;
  operator: string | undefined;
  right: number;
};

const evaluateNumericBinaryExpression = (
  options: EvaluateNumericBinaryExpressionOptions,
): number | undefined => {
  const { left, operator, right } = options;
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    case "**":
      return left ** right;
    case "<<":
      return left << right;
    case ">>":
      return left >> right;
    case ">>>":
      return left >>> right;
    case "|":
      return left | right;
    case "&":
      return left & right;
    case "^":
      return left ^ right;
    default:
      return undefined;
  }
};
