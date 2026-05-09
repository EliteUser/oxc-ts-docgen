import type { DocFnParam, DocProperty, DocType } from "@synthfall/oxc-ts-docgen";

type FormatDocTypeOptions = {
  /**
   * Maximum nested type depth before using an ellipsis fallback.
   */
  maxDepth?: number;
  /**
   * Maximum object properties to show inline before truncating.
   */
  maxObjectProperties?: number;
};

type FormatContext = {
  maxDepth: number;
  maxObjectProperties: number;
  depth: number;
};

export const formatDocType = (type: DocType, options: FormatDocTypeOptions = {}): string => {
  return formatType(type, {
    maxDepth: options.maxDepth ?? 3,
    maxObjectProperties: options.maxObjectProperties ?? 4,
    depth: 0,
  });
};

const formatType = (type: DocType, context: FormatContext): string => {
  if (context.depth > context.maxDepth) {
    return "...";
  }
  const next = { ...context, depth: context.depth + 1 };

  switch (type.kind) {
    case "primitive":
    case "intrinsic":
      return type.name;
    case "literal":
      return type.value;
    case "reference":
      return formatReference(type, next);
    case "union":
      return type.members.map((member) => formatType(member, next)).join(" | ");
    case "intersection":
      return type.members.map((member) => formatType(member, next)).join(" & ");
    case "array": {
      const element = formatType(type.elementType, next);
      return needsArrayWrapper(type.elementType) ? `Array<${element}>` : `${element}[]`;
    }
    case "tuple":
      return `[${type.elements.map((element) => formatType(element, next)).join(", ")}]`;
    case "object":
      return formatObject(type.properties, next);
    case "function":
      return `${formatFunctionParams(type.parameters, next)} => ${formatType(type.returnType, next)}`;
    case "mapped":
      return `{ [${type.parameter} in ${formatType(type.constraint, next)}]: ${formatType(type.type, next)} }`;
    case "conditional":
      return `${formatType(type.checkType, next)} extends ${formatType(type.extendsType, next)} ? ${formatType(type.trueType, next)} : ${formatType(type.falseType, next)}`;
    case "indexedAccess":
      return `${formatType(type.objectType, next)}[${formatType(type.indexType, next)}]`;
    case "templateLiteral":
      return `\`${type.spans.map((span) => ("text" in span ? span.text : "${...}")).join("")}\``;
    case "keyof":
      return `keyof ${formatType(type.type, next)}`;
    case "typeof":
      return `typeof ${type.name}`;
    case "infer":
      return `infer ${type.name}`;
    case "rest":
      return `...${formatType(type.type, next)}`;
    case "unresolved":
      return type.text || "unknown";
  }
};

const formatReference = (
  type: Extract<
    DocType,
    {
      kind: "reference";
    }
  >,
  context: FormatContext,
): string => {
  const args = type.typeArguments;
  if (!args || args.length === 0) {
    return type.name;
  }
  return `${type.name}<${args.map((arg) => formatType(arg, context)).join(", ")}>`;
};

const formatObject = (properties: DocProperty[], context: FormatContext): string => {
  if (properties.length === 0) {
    return "{}";
  }

  const shown = properties.slice(0, context.maxObjectProperties);

  const parts = shown.map((prop) => {
    const readonly = prop.readonly ? "readonly " : "";
    const optional = prop.optional ? "?" : "";
    return `${readonly}${prop.name}${optional}: ${formatType(prop.type, context)}`;
  });

  if (properties.length > shown.length) {
    parts.push("...");
  }

  return `{ ${parts.join("; ")} }`;
};

const formatFunctionParams = (params: DocFnParam[], context: FormatContext): string => {
  return `(${params
    .map((param) => {
      const rest = param.rest ? "..." : "";
      const optional = param.optional ? "?" : "";
      return `${rest}${param.name}${optional}: ${formatType(param.type, context)}`;
    })
    .join(", ")})`;
};

const needsArrayWrapper = (type: DocType): boolean => {
  return type.kind === "union" || type.kind === "intersection" || type.kind === "function";
};
