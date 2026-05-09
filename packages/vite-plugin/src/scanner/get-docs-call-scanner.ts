import type {
  Argument,
  BindingIdentifier,
  ArrayExpression,
  Expression,
  ObjectExpression,
  ObjectProperty,
  Program,
  TSType,
} from "oxc-parser";
import type { ScopeTrackerImport, ScopeTrackerNode } from "oxc-walker";

import { ScopeTracker, walk } from "oxc-walker";
export type GetDocsJsonValue = string | number | boolean | null;
export type GetDocsStaticTarget = {
  path: string;
  symbol: string;
  metadata: Record<string, GetDocsJsonValue>;
};
export type GetDocsGenericCall = {
  start: number;
  end: number;
  kind: "generic";
  typeArgText: string | undefined;
  typeArg: TSType | undefined;
  typeArgCount: number;
};
export type GetDocsObjectCall = {
  start: number;
  end: number;
  kind: "object";
  target: GetDocsStaticTarget | undefined;
  unsupportedReason: string | undefined;
};
export type GetDocsBatchCall = {
  start: number;
  end: number;
  kind: "batch";
  targets: GetDocsStaticTarget[] | undefined;
  unsupportedReason: string | undefined;
};
export type GetDocsCall = GetDocsGenericCall | GetDocsObjectCall | GetDocsBatchCall;
export type GetDocsBinding = {
  localName: string;
};
export type InsertVirtualImportsOptions = {
  code: string;
  imports: string[];
  program: Program;
};
type ExpandImportRangeOptions = {
  code: string;
  start: number;
  end: number;
};
type StaticEvaluationContext = {
  constExpressions: Map<string, StaticConstExpression>;
  resolveIdentifier?: (identifier: BindingIdentifier) => Expression | undefined;
  seenIdentifiers: Set<string>;
};
type StaticConstExpression = {
  expression: Expression;
  idStart: number;
  idEnd: number;
};
type StaticOptionsResult =
  | {
      kind: "object";
      target: GetDocsStaticTarget | undefined;
      unsupportedReason: string | undefined;
    }
  | {
      kind: "batch";
      targets: GetDocsStaticTarget[] | undefined;
      unsupportedReason: string | undefined;
    };
const DOCGEN_IMPORT_SOURCE = "@synthfall/oxc-ts-docgen";
export const findGetDocsBindings = (program: Program): GetDocsBinding[] => {
  const bindings: GetDocsBinding[] = [];
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") {
      continue;
    }
    const source = stmt.source.value;
    if (!isDocgenImportSource(source)) {
      continue;
    }
    for (const spec of stmt.specifiers ?? []) {
      if (spec.type === "ImportSpecifier") {
        const imported = spec.imported;
        if (imported.type === "Identifier" && imported.name === "getDocs") {
          bindings.push({ localName: spec.local.name });
        }
      }
    }
  }
  return bindings;
};
export const findGetDocsOnlyImportRanges = (
  program: Program,
  code: string,
): Array<{
  start: number;
  end: number;
}> => {
  const ranges: Array<{
    start: number;
    end: number;
  }> = [];
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") {
      continue;
    }
    if (!isDocgenImportSource(stmt.source.value)) {
      continue;
    }
    const specifiers = stmt.specifiers ?? [];
    if (specifiers.length === 0) {
      continue;
    }
    const onlyGetDocs = specifiers.every(
      (spec) =>
        spec.type === "ImportSpecifier" &&
        spec.imported.type === "Identifier" &&
        spec.imported.name === "getDocs",
    );
    if (!onlyGetDocs) {
      continue;
    }
    ranges.push(expandImportRange({ code, start: stmt.start, end: stmt.end }));
  }
  return ranges;
};
export const insertVirtualImports = (options: InsertVirtualImportsOptions): string => {
  const { code, imports, program } = options;
  const offset = findDirectivePrologueEnd(code, program);
  const prefix = imports.join("\n");
  const separator = code[offset] === "\n" || code[offset] === "\r" ? "" : "\n";
  return `${code.slice(0, offset)}${prefix}${separator}${code.slice(offset)}`;
};
export const findGetDocsCalls = (program: Program, source: string): GetDocsCall[] => {
  const calls: GetDocsCall[] = [];
  const constExpressions = collectTopLevelConstExpressions(program);
  const scopeTracker = new ScopeTracker({ preserveExitedScopes: true });
  walk(program, {
    scopeTracker,
    enter() {},
  });
  scopeTracker.freeze();
  walk(program, {
    scopeTracker,
    enter(node) {
      if (node.type !== "CallExpression") {
        return;
      }
      const callee = node.callee as
        | {
            type: string;
            name?: string;
          }
        | undefined;
      if (callee?.type !== "Identifier" || !callee.name) {
        return;
      }
      const declaration = scopeTracker.getDeclaration(callee.name);
      if (!isDocgenGetDocsImport(declaration)) {
        return;
      }
      const args = node.arguments as Argument[];
      const argument = args[0];
      const hasRuntimeOptions = args.length > 0;
      const typeParams = node.typeArguments as {
        start: number;
        end: number;
        params: TSType[];
      } | null;
      let typeArgText: string | undefined;
      let typeArg: TSType | undefined;
      const typeArgCount = typeParams?.params.length ?? 0;
      if (typeParams && typeParams.params.length > 0) {
        const firstParam = typeParams.params[0];
        typeArg = firstParam;
        typeArgText = source.slice(firstParam.start, firstParam.end);
      }
      if (hasRuntimeOptions) {
        const optionsResult =
          args.length !== 1
            ? {
                kind: "object" as const,
                target: undefined,
                unsupportedReason: "must pass exactly one static object or array argument",
              }
            : typeArgCount > 0
              ? {
                  kind: "object" as const,
                  target: undefined,
                  unsupportedReason: "must use either a type argument or static options, not both",
                }
              : evaluateGetDocsOptions({
                  argument,
                  constExpressions,
                  resolveIdentifier: (identifier) =>
                    resolveTopLevelConstIdentifier({
                      identifier,
                      constExpressions,
                      declaration: scopeTracker.getDeclaration(identifier.name),
                    }),
                });
        calls.push({
          start: node.start as number,
          end: node.end as number,
          ...optionsResult,
        });
        return;
      }
      calls.push({
        start: node.start as number,
        end: node.end as number,
        kind: "generic",
        typeArgText,
        typeArg,
        typeArgCount,
      });
    },
  });
  return calls;
};
const collectTopLevelConstExpressions = (program: Program): Map<string, StaticConstExpression> => {
  const constExpressions = new Map<string, StaticConstExpression>();
  for (const stmt of program.body) {
    if (stmt.type !== "VariableDeclaration" || stmt.kind !== "const") {
      continue;
    }
    for (const declaration of stmt.declarations) {
      if (declaration.id.type !== "Identifier" || !declaration.init) {
        continue;
      }
      constExpressions.set(declaration.id.name, {
        expression: declaration.init,
        idStart: declaration.id.start,
        idEnd: declaration.id.end,
      });
    }
  }
  return constExpressions;
};
const evaluateGetDocsOptions = (options: {
  argument: Argument | undefined;
  constExpressions: Map<string, StaticConstExpression>;
  resolveIdentifier: (identifier: BindingIdentifier) => Expression | undefined;
}): StaticOptionsResult => {
  const { argument, constExpressions, resolveIdentifier } = options;
  if (!argument || argument.type === "SpreadElement") {
    return {
      kind: "object",
      target: undefined,
      unsupportedReason: "must pass one static object or array argument",
    };
  }
  const expression = resolveStaticExpression({
    expression: argument,
    constExpressions,
    resolveIdentifier,
    seenIdentifiers: new Set(),
  });
  if (expression.type === "ObjectExpression") {
    return {
      kind: "object",
      ...evaluateStaticTarget({ expression, constExpressions }),
    };
  }
  if (expression.type === "ArrayExpression") {
    return {
      kind: "batch",
      ...evaluateStaticTargetList({ expression, constExpressions }),
    };
  }
  return {
    kind: "object",
    target: undefined,
    unsupportedReason: "must pass a static object or array argument",
  };
};
const evaluateStaticTargetList = (options: {
  expression: ArrayExpression;
  constExpressions: Map<string, StaticConstExpression>;
}): {
  targets: GetDocsStaticTarget[] | undefined;
  unsupportedReason: string | undefined;
} => {
  const { expression, constExpressions } = options;
  const targets: GetDocsStaticTarget[] = [];
  for (const element of expression.elements) {
    if (!element || element.type === "SpreadElement") {
      return {
        targets: undefined,
        unsupportedReason: "batch targets must be static object literals without spreads",
      };
    }
    const resolvedElement = resolveStaticExpression({
      expression: element,
      constExpressions,
      seenIdentifiers: new Set(),
    });
    if (resolvedElement.type !== "ObjectExpression") {
      return {
        targets: undefined,
        unsupportedReason: "batch targets must be static object literals",
      };
    }
    const targetResult = evaluateStaticTarget({
      expression: resolvedElement,
      constExpressions,
    });
    if (!targetResult.target) {
      return {
        targets: undefined,
        unsupportedReason: targetResult.unsupportedReason,
      };
    }
    targets.push(targetResult.target);
  }
  return { targets, unsupportedReason: undefined };
};
const evaluateStaticTarget = (options: {
  expression: ObjectExpression;
  constExpressions: Map<string, StaticConstExpression>;
}): {
  target: GetDocsStaticTarget | undefined;
  unsupportedReason: string | undefined;
} => {
  const { expression, constExpressions } = options;
  const values: Record<string, GetDocsJsonValue> = {};
  for (const property of expression.properties) {
    if (property.type === "SpreadElement") {
      return {
        target: undefined,
        unsupportedReason: "target objects must not use spreads",
      };
    }
    if (property.kind !== "init" || property.method || property.computed) {
      return {
        target: undefined,
        unsupportedReason: "target objects must use static data properties",
      };
    }
    const key = getStaticPropertyKey(property.key);
    if (!key) {
      return {
        target: undefined,
        unsupportedReason: "target objects must use static string property names",
      };
    }
    const value = evaluateJsonValue({
      expression: property.value,
      constExpressions,
      seenIdentifiers: new Set(),
    });
    if (value === undefined) {
      return {
        target: undefined,
        unsupportedReason: "target object values must be static JSON primitives",
      };
    }
    values[key] = value;
  }
  const path = values.path;
  const symbol = values.symbol;
  if (typeof path !== "string" || typeof symbol !== "string") {
    return {
      target: undefined,
      unsupportedReason: "target objects must include string path and symbol properties",
    };
  }
  const { path: _path, symbol: _symbol, ...metadata } = values;
  return {
    target: { path, symbol, metadata },
    unsupportedReason: undefined,
  };
};
const evaluateJsonValue = (options: {
  expression: Expression;
  constExpressions: Map<string, StaticConstExpression>;
  seenIdentifiers: Set<string>;
}): GetDocsJsonValue | undefined => {
  const expression = resolveStaticExpression(options);
  const literal = expression as {
    type: string;
    value?: unknown;
  };
  if (literal.type === "NullLiteral") {
    return null;
  }
  if (
    literal.type === "Literal" ||
    literal.type === "StringLiteral" ||
    literal.type === "NumericLiteral" ||
    literal.type === "BooleanLiteral"
  ) {
    if (
      typeof literal.value === "string" ||
      typeof literal.value === "number" ||
      typeof literal.value === "boolean" ||
      literal.value === null
    ) {
      return literal.value;
    }
  }
  return undefined;
};
const resolveStaticExpression = (
  options: StaticEvaluationContext & { expression: Expression },
): Expression => {
  const { expression, constExpressions, resolveIdentifier, seenIdentifiers } = options;
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "Identifier") {
    return unwrapped;
  }
  if (seenIdentifiers.has(unwrapped.name)) {
    return unwrapped;
  }
  const init = resolveIdentifier?.(unwrapped);
  if (!init) {
    return unwrapped;
  }
  seenIdentifiers.add(unwrapped.name);
  return resolveStaticExpression({
    expression: init,
    constExpressions,
    resolveIdentifier,
    seenIdentifiers,
  });
};
const resolveTopLevelConstIdentifier = (options: {
  identifier: BindingIdentifier;
  constExpressions: Map<string, StaticConstExpression>;
  declaration: ScopeTrackerNode | null;
}): Expression | undefined => {
  const { identifier, constExpressions, declaration } = options;
  const staticConst = constExpressions.get(identifier.name);
  if (!staticConst || declaration?.type !== "Variable" || declaration.scope !== "") {
    return undefined;
  }
  if (
    declaration.node.start !== staticConst.idStart ||
    declaration.node.end !== staticConst.idEnd
  ) {
    return undefined;
  }
  return staticConst.expression;
};
const unwrapExpression = (expression: Expression): Expression => {
  let current = expression;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }
  return current;
};
const getStaticPropertyKey = (key: ObjectProperty["key"]): string | undefined => {
  const literal = key as {
    type: string;
    value?: unknown;
  };
  if (key.type === "Identifier") {
    return key.name;
  }
  if (
    literal.type === "Literal" ||
    literal.type === "StringLiteral" ||
    literal.type === "NumericLiteral"
  ) {
    if (typeof literal.value === "string" || typeof literal.value === "number") {
      return String(literal.value);
    }
  }
  return undefined;
};
const expandImportRange = (
  options: ExpandImportRangeOptions,
): {
  start: number;
  end: number;
} => {
  const { code, start, end } = options;
  let expandedEnd = end;
  if (code[expandedEnd] === ";") expandedEnd++;
  if (code.slice(expandedEnd, expandedEnd + 2) === "\r\n") {
    expandedEnd += 2;
  } else if (code[expandedEnd] === "\n") {
    expandedEnd++;
  }
  return { start, end: expandedEnd };
};
const findDirectivePrologueEnd = (code: string, program: Program): number => {
  let offset = 0;
  for (const stmt of program.body) {
    if (stmt.type !== "ExpressionStatement") {
      break;
    }
    const expression = stmt.expression as {
      type: string;
      value?: unknown;
    };
    if (expression.type !== "StringLiteral" && expression.type !== "Literal") {
      break;
    }
    if (typeof expression.value !== "string") {
      break;
    }
    offset = includeLineBreak(code, stmt.end);
  }
  return offset;
};
const includeLineBreak = (code: string, lineEnd: number): number => {
  return code[lineEnd] === "\n" ? lineEnd + 1 : lineEnd;
};
const isDocgenGetDocsImport = (
  declaration: ReturnType<ScopeTracker["getDeclaration"]>,
): declaration is ScopeTrackerImport => {
  if (declaration?.type !== "Import") {
    return false;
  }
  if (!isDocgenImportSource(declaration.importNode.source.value)) {
    return false;
  }
  const spec = declaration.node;
  return (
    spec.type === "ImportSpecifier" &&
    spec.imported.type === "Identifier" &&
    spec.imported.name === "getDocs"
  );
};
const isDocgenImportSource = (source: string): boolean => {
  return source === DOCGEN_IMPORT_SOURCE;
};
