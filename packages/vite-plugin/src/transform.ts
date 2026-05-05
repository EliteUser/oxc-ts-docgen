import { parseSync } from "oxc-parser";
import type { Program } from "oxc-parser";
import { ScopeTracker, walk } from "oxc-walker";
import type { ScopeTrackerImport } from "oxc-walker";
import { generateDocs, resolveConfig, TypeResolver } from "@oxc-ts-docgen/docgen";
import type { DocgenConfig } from "@oxc-ts-docgen/docgen";
import type { TypeRegistry } from "./type-registry";

export interface TransformResult {
  code: string;
  deps: string[];
}

export interface TransformOptions {
  resolver?: TypeResolver;
  registry?: TypeRegistry;
  failOnUnresolved?: boolean;
}

export function transformGetDocs(
  code: string,
  id: string,
  config: Partial<DocgenConfig>,
  options?: TransformOptions,
): TransformResult | null {
  if (!code.includes("getDocs")) return null;

  const result = parseSync(id, code, {
    lang: inferLang(id),
    sourceType: "module",
    preserveParens: false,
  });

  const program = result.program;
  const getDocsBindings = findGetDocsBindings(program);
  if (getDocsBindings.length === 0) return null;

  const calls = findGetDocsCalls(program, code);
  if (calls.length === 0) return null;

  const deps: string[] = [];
  const unresolved: string[] = [];
  let transformed = code;
  const registry = options?.registry;
  const resolver =
    options?.resolver ?? registry?.getResolver() ?? new TypeResolver(resolveConfig(config));

  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    const typeArgSource = call.typeArgText;
    if (!typeArgSource) {
      unresolved.push(`getDocs call at ${call.start} is missing a type argument`);
      continue;
    }

    const typeName = extractTypeName(typeArgSource);
    if (!typeName) {
      unresolved.push(`getDocs<${typeArgSource}> at ${call.start} is not a named type reference`);
      continue;
    }

    const resolvedSource = resolveTypeSource(typeName, program, id, resolver);
    const sourceFile = resolvedSource?.filePath ?? id;
    const resolvedTypeName = resolvedSource?.typeName ?? typeName;
    if (resolvedSource) deps.push(...resolvedSource.deps);

    let schema;
    if (registry) {
      for (const dep of resolvedSource?.deps ?? []) {
        registry.registerFileDependency(id, dep);
      }
      schema = registry.getSchema(resolvedTypeName, sourceFile);
      if (!schema) {
        registry.registerConsumer(id, resolvedTypeName, sourceFile);
        unresolved.push(
          `getDocs<${typeName}> at ${call.start} could not be resolved from ${sourceFile}`,
        );
        continue;
      }
      registry.registerConsumer(id, resolvedTypeName, sourceFile);
    } else {
      try {
        schema = generateDocs({
          filePath: sourceFile,
          typeName: resolvedTypeName,
          config,
          resolver,
        });
      } catch {
        unresolved.push(
          `getDocs<${typeName}> at ${call.start} could not be generated from ${sourceFile}`,
        );
        continue;
      }
    }

    const json = JSON.stringify(schema);
    const replacement = `JSON.parse(${JSON.stringify(json)})`;
    transformed = transformed.slice(0, call.start) + replacement + transformed.slice(call.end);
  }

  if (options?.failOnUnresolved && unresolved.length > 0) {
    throw new Error(
      [
        `@oxc-ts-docgen/vite-plugin could not compile all getDocs<T>() calls in ${id}.`,
        ...unresolved.map((message) => `- ${message}`),
      ].join("\n"),
    );
  }

  if (transformed === code) return null;

  if (unresolved.length === 0) {
    const importRanges = findGetDocsOnlyImportRanges(program, transformed);
    for (let i = importRanges.length - 1; i >= 0; i--) {
      const range = importRanges[i];
      transformed = transformed.slice(0, range.start) + transformed.slice(range.end);
    }
  }

  return { code: transformed, deps };
}

interface GetDocsCall {
  start: number;
  end: number;
  typeArgText: string | undefined;
}

interface GetDocsBinding {
  localName: string;
}

interface ResolvedTypeSource {
  filePath: string;
  typeName: string;
  deps: string[];
}

const DOCGEN_IMPORT_SOURCE = "@oxc-ts-docgen/docgen";

function findGetDocsBindings(program: Program): GetDocsBinding[] {
  const bindings: GetDocsBinding[] = [];
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = stmt.source.value;
    if (!isDocgenImportSource(source)) continue;

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
}

function findGetDocsOnlyImportRanges(
  program: Program,
  code: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    if (!isDocgenImportSource(stmt.source.value)) continue;

    const specifiers = stmt.specifiers ?? [];
    if (specifiers.length === 0) continue;
    const onlyGetDocs = specifiers.every(
      (spec) =>
        spec.type === "ImportSpecifier" &&
        spec.imported.type === "Identifier" &&
        spec.imported.name === "getDocs",
    );
    if (!onlyGetDocs) continue;

    ranges.push(expandImportRange(code, stmt.start, stmt.end));
  }

  return ranges;
}

function expandImportRange(
  code: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let expandedEnd = end;
  if (code[expandedEnd] === ";") expandedEnd++;
  if (code.slice(expandedEnd, expandedEnd + 2) === "\r\n") {
    expandedEnd += 2;
  } else if (code[expandedEnd] === "\n") {
    expandedEnd++;
  }
  return { start, end: expandedEnd };
}

function findGetDocsCalls(program: Program, source: string): GetDocsCall[] {
  const calls: GetDocsCall[] = [];

  const scopeTracker = new ScopeTracker({ preserveExitedScopes: true });
  walk(program, {
    scopeTracker,
    enter() {},
  });
  scopeTracker.freeze();

  walk(program, {
    scopeTracker,
    enter(node) {
      if (node.type !== "CallExpression") return;

      const callee = node.callee as { type: string; name?: string } | undefined;
      if (callee?.type !== "Identifier" || !callee.name) return;

      const declaration = scopeTracker.getDeclaration(callee.name);
      if (!isDocgenGetDocsImport(declaration)) return;

      const typeParams = node.typeArguments as {
        start: number;
        end: number;
        params: unknown[];
      } | null;
      let typeArgText: string | undefined;
      if (typeParams && typeParams.params.length > 0) {
        const firstParam = typeParams.params[0] as { start: number; end: number };
        typeArgText = source.slice(firstParam.start, firstParam.end);
      }

      calls.push({
        start: node.start as number,
        end: node.end as number,
        typeArgText,
      });
    },
  });

  return calls;
}

function isDocgenGetDocsImport(
  declaration: ReturnType<ScopeTracker["getDeclaration"]>,
): declaration is ScopeTrackerImport {
  if (declaration?.type !== "Import") return false;
  if (!isDocgenImportSource(declaration.importNode.source.value)) return false;

  const spec = declaration.node;
  return (
    spec.type === "ImportSpecifier" &&
    spec.imported.type === "Identifier" &&
    spec.imported.name === "getDocs"
  );
}

function extractTypeName(typeArgText: string): string | undefined {
  const cleaned = typeArgText.trim();
  const match = cleaned.match(/^([A-Za-z_$][\w$.]*)/);
  return match ? match[1] : undefined;
}

function resolveTypeSource(
  typeName: string,
  program: Program,
  currentFile: string,
  resolver: TypeResolver,
): ResolvedTypeSource | undefined {
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;

    for (const spec of stmt.specifiers ?? []) {
      let localName: string | undefined;
      let importedName: string | undefined;
      if (spec.type === "ImportSpecifier") {
        localName = spec.local.name;
        importedName = spec.imported.type === "Identifier" ? spec.imported.name : spec.local.name;
      } else if (spec.type === "ImportDefaultSpecifier") {
        localName = spec.local.name;
        importedName = "default";
      }

      if (localName !== typeName) continue;

      const importSource = stmt.source.value;
      const resolved = resolver.resolveImportedType(
        importSource,
        importedName ?? typeName,
        currentFile,
      );
      if (resolved) {
        return {
          filePath: resolved.filePath,
          typeName: resolved.decl.id.name,
          deps: resolved.sourceFiles,
        };
      }

      const unresolvedSourceFile = resolver.resolveImportPath(importSource, currentFile);
      return unresolvedSourceFile
        ? {
            filePath: unresolvedSourceFile,
            typeName: importedName ?? typeName,
            deps: [unresolvedSourceFile],
          }
        : undefined;
    }
  }

  return undefined;
}

function isDocgenImportSource(source: string): boolean {
  return source === DOCGEN_IMPORT_SOURCE;
}

function inferLang(fileName: string): "ts" | "tsx" | "js" | "jsx" {
  if (fileName.endsWith(".tsx")) return "tsx";
  if (fileName.endsWith(".jsx")) return "jsx";
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) return "js";
  return "ts";
}
