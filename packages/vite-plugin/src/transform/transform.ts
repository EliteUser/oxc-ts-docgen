import type {
  DocSchema,
  DocgenConfig,
  DocgenProjectBuildResult,
  DocgenProjectDiagnostic,
} from "@synthfall/oxc-ts-docgen";

import { DocgenProject, resolveConfig } from "@synthfall/oxc-ts-docgen";
import { parseSync } from "oxc-parser";

import type { TypeRegistry } from "../registry/type-registry";
import type { GetDocsStaticTarget } from "../scanner/get-docs-call-scanner";
import type { VirtualModuleRequest } from "./transform-writer";

import {
  extractExactTypeName,
  resolveExportedTarget,
  resolveTypeSource,
} from "../registry/type-source-resolver";
import {
  findGetDocsBindings,
  findGetDocsCalls,
  findGetDocsOnlyImportRanges,
  insertVirtualImports,
} from "../scanner/get-docs-call-scanner";
import {
  createInlineSchemaReplacement,
  createVirtualSchemaReplacement,
  removeRanges,
  replaceRange,
} from "./transform-writer";
export type { VirtualModuleRequest } from "./transform-writer";
export type TransformOutputMode = "inline" | "virtual";
export type TransformResult = {
  code: string;
  deps: string[];
  virtualModules: string[];
};
export type TransformOptions = {
  project?: DocgenProject;
  registry?: TypeRegistry;
  failOnUnresolved?: boolean;
  onUnresolved?: (messages: string[]) => void;
  outputMode?: TransformOutputMode;
  createVirtualModuleId?: (request: VirtualModuleRequest) => string;
};
export type TransformGetDocsOptions = {
  /**
   * Module source text to transform.
   */
  code: string;
  /**
   * Absolute or Vite-normalized module id for the source text.
   */
  id: string;
  /**
   * Explicit parser language for virtual source slices such as Vue SFC script blocks.
   */
  lang?: "ts" | "tsx" | "js" | "jsx";
  /**
   * Docgen config overrides for this transform.
   */
  config: Partial<DocgenConfig>;
  /**
   * Internal transform services and behavior flags.
   */
  options?: TransformOptions;
};
type SchemaRequest = {
  /**
   * Type name requested by the getDocs call.
   */
  requestedTypeName: string;
  /**
   * Source file where the resolved type should be read.
   */
  sourceFile: string;
  /**
   * Resolved declaration name used for schema generation.
   */
  resolvedTypeName: string;
  /**
   * Direct resolution dependencies for this request.
   */
  deps: string[];
  /**
   * User-facing getDocs call label for diagnostics.
   */
  label: string;
  /**
   * Whether unchanged output should still be returned if schema generation fails.
   */
  watchOnUnchanged?: boolean;
};
type BuildResultFileDependenciesOptions = {
  /**
   * Schema build result containing dependency records.
   */
  result: DocgenProjectBuildResult;
  /**
   * Source file requested by the getDocs call.
   */
  sourceFile: string;
};
type UnresolvedTarget = {
  /**
   * User-facing reason why the target could not produce a schema.
   */
  message: string;
  /**
   * Dependency files that should still be tracked for recovery.
   */
  deps: string[];
  /**
   * Whether unchanged output should still be returned so Vite can watch deps.
   */
  watchOnUnchanged?: boolean;
};
type TargetResolution =
  | {
      /**
       * Target is valid and can be compiled into a schema.
       */
      kind: "schema";
      /**
       * Schema generation request for the resolved target.
       */
      request: SchemaRequest;
    }
  | {
      /**
       * Target is invalid but may still carry recovery dependencies.
       */
      kind: "unresolved";
      /**
       * Unresolved target diagnostics and recovery metadata.
       */
      target: UnresolvedTarget;
    };
type RecordUnresolvedTargetOptions = {
  /**
   * Unresolved target to record.
   */
  target: UnresolvedTarget;
  /**
   * Optional Vite registry used for HMR recovery.
   */
  registry: TypeRegistry | undefined;
  /**
   * Module that owns the getDocs call.
   */
  consumerModule: string;
  /**
   * Transform dependency accumulator.
   */
  deps: string[];
  /**
   * Transform unresolved-message accumulator.
   */
  unresolved: string[];
};
type ResolveStaticTargetOptions = {
  target: GetDocsStaticTarget;
  currentFile: string;
  resolver: DocgenProject | TypeRegistry;
};
type CompileSchemaOptions = {
  request: SchemaRequest;
  registry: TypeRegistry | undefined;
  standaloneProject: DocgenProject;
  consumerModule: string;
  deps: string[];
  unresolved: string[];
};
type CreateSchemaReplacementOptions = {
  schema: DocSchema;
  consumerFile: string;
  sourceFile: string;
  resolvedTypeName: string;
  requestedTypeName: string;
  outputMode: TransformOutputMode | undefined;
  createVirtualModuleId: ((request: VirtualModuleRequest) => string) | undefined;
  virtualImports: string[];
  virtualModules: string[];
};
type BatchSchema = {
  target: GetDocsStaticTarget;
  schema: DocSchema;
  sourceFile: string;
  resolvedTypeName: string;
};
export const transformGetDocs = (input: TransformGetDocsOptions): TransformResult | null => {
  const { code, id, lang, config, options } = input;
  if (!code.includes("getDocs")) {
    return null;
  }
  const result = parseSync(id, code, {
    lang: lang ?? inferLang(id),
    sourceType: "module",
    preserveParens: false,
  });
  const program = result.program;
  const getDocsBindings = findGetDocsBindings(program);
  if (getDocsBindings.length === 0) {
    return null;
  }

  const calls = findGetDocsCalls(program, code);
  if (calls.length === 0) {
    return null;
  }
  const deps: string[] = [];
  const virtualModules: string[] = [];
  const virtualImports: string[] = [];
  const unresolved: string[] = [];
  let hasUnchangedWatchDeps = false;
  let transformed = code;
  const registry = options?.registry;
  const standaloneProject =
    options?.project ??
    new DocgenProject({
      config: resolveConfig(config),
      buildMode: "indexOnly",
    });
  const sourceResolver = registry ?? standaloneProject;
  const initialDiagnosticCount = sourceResolver.getDiagnostics().length;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (call.kind === "batch") {
      if (!call.targets) {
        unresolved.push(formatUnsupportedOptionsMessage(call.unsupportedReason, call.start));
        continue;
      }
      const batchSchemas: BatchSchema[] = [];
      for (const target of call.targets) {
        const targetResolution = resolveStaticTarget({
          target,
          currentFile: id,
          resolver: sourceResolver,
        });
        if (targetResolution.kind === "unresolved") {
          if (
            recordUnresolvedTarget({
              target: targetResolution.target,
              registry,
              consumerModule: id,
              deps,
              unresolved,
            })
          ) {
            hasUnchangedWatchDeps = true;
          }
          continue;
        }
        const schema = compileSchema({
          request: targetResolution.request,
          registry,
          standaloneProject,
          consumerModule: id,
          deps,
          unresolved,
        });
        if (!schema) {
          if (targetResolution.request.watchOnUnchanged) {
            hasUnchangedWatchDeps = true;
          }
          continue;
        }
        batchSchemas.push({
          target,
          schema,
          sourceFile: targetResolution.request.sourceFile,
          resolvedTypeName: targetResolution.request.resolvedTypeName,
        });
      }
      if (batchSchemas.length !== call.targets.length) {
        continue;
      }
      const replacement = createBatchReplacement({
        batchSchemas,
        consumerFile: id,
        outputMode: options?.outputMode,
        createVirtualModuleId: options?.createVirtualModuleId,
        virtualImports,
        virtualModules,
      });
      transformed = replaceRange({ code: transformed, range: call, replacement });
      continue;
    }

    const targetResolution =
      call.kind === "generic"
        ? resolveGenericCall({
            call,
            program,
            currentFile: id,
            resolver: sourceResolver,
            unresolved,
          })
        : resolveObjectCall({
            call,
            currentFile: id,
            resolver: sourceResolver,
            unresolved,
          });
    if (!targetResolution) {
      continue;
    }
    if (targetResolution.kind === "unresolved") {
      if (
        recordUnresolvedTarget({
          target: targetResolution.target,
          registry,
          consumerModule: id,
          deps,
          unresolved,
        })
      ) {
        hasUnchangedWatchDeps = true;
      }
      continue;
    }
    const schema = compileSchema({
      request: targetResolution.request,
      registry,
      standaloneProject,
      consumerModule: id,
      deps,
      unresolved,
    });
    if (!schema) {
      if (targetResolution.request.watchOnUnchanged) {
        hasUnchangedWatchDeps = true;
      }
      continue;
    }
    const replacement = createSchemaReplacement({
      schema,
      consumerFile: id,
      sourceFile: targetResolution.request.sourceFile,
      resolvedTypeName: targetResolution.request.resolvedTypeName,
      requestedTypeName: targetResolution.request.requestedTypeName,
      outputMode: options?.outputMode,
      createVirtualModuleId: options?.createVirtualModuleId,
      virtualImports,
      virtualModules,
    });
    transformed = replaceRange({ code: transformed, range: call, replacement });
  }
  const diagnosticMessages = formatDiagnostics(
    sourceResolver.getDiagnostics(),
    initialDiagnosticCount,
  );
  if (options?.failOnUnresolved && (unresolved.length > 0 || diagnosticMessages.length > 0)) {
    const messages = uniqueMessages([...unresolved, ...diagnosticMessages]);
    throw new Error(
      [
        `@synthfall/oxc-ts-docgen-vite could not compile all getDocs() calls in ${id}.`,
        ...messages.map((message) => `- ${message}`),
      ].join("\n"),
    );
  }
  if (unresolved.length > 0 || diagnosticMessages.length > 0) {
    options?.onUnresolved?.(uniqueMessages([...unresolved, ...diagnosticMessages]));
  }
  if (transformed === code && !hasUnchangedWatchDeps) {
    return null;
  }
  if (unresolved.length === 0) {
    const importRanges = findGetDocsOnlyImportRanges(program, transformed);
    transformed = removeRanges(transformed, importRanges);
  }
  if (virtualImports.length > 0) {
    transformed = insertVirtualImports({ code: transformed, imports: virtualImports, program });
  }
  return { code: transformed, deps, virtualModules };
};
const resolveGenericCall = (options: {
  call: Extract<ReturnType<typeof findGetDocsCalls>[number], { kind: "generic" }>;
  program: ReturnType<typeof parseSync>["program"];
  currentFile: string;
  resolver: DocgenProject | TypeRegistry;
  unresolved: string[];
}): TargetResolution | undefined => {
  const { call, program, currentFile, resolver, unresolved } = options;
  const typeArgSource = call.typeArgText;
  if (!typeArgSource) {
    unresolved.push(`getDocs call at ${call.start} is missing a type argument`);
    return undefined;
  }
  const typeName =
    call.typeArg && call.typeArgCount === 1 ? extractExactTypeName(call.typeArg) : undefined;
  if (!typeName) {
    unresolved.push(formatUnsupportedTypeArgumentMessage(typeArgSource, call.start));
    return undefined;
  }
  const resolvedSource = resolveTypeSource({
    typeName,
    program,
    currentFile,
    resolver,
  });
  if (!resolvedSource) {
    return {
      kind: "schema",
      request: {
        requestedTypeName: typeName,
        sourceFile: currentFile,
        resolvedTypeName: typeName,
        deps: [],
        label: `getDocs<${typeName}>`,
      },
    };
  }
  const label = `getDocs<${typeName}>`;
  const { target } = resolvedSource;
  if (target.status === "resolved") {
    return {
      kind: "schema",
      request: {
        requestedTypeName: typeName,
        sourceFile: target.filePath,
        resolvedTypeName: target.typeName,
        deps: target.deps,
        label,
      },
    };
  }
  return {
    kind: "unresolved",
    target: {
      deps: target.deps,
      message:
        target.status === "moduleUnresolved"
          ? `${label} imports ${resolvedSource.importedName} from ${JSON.stringify(
              resolvedSource.importSource,
            )}, but the target module could not be resolved`
          : `${label} imports ${resolvedSource.importedName} from ${JSON.stringify(
              resolvedSource.importSource,
            )}, but the target module does not export that type`,
      watchOnUnchanged: target.status === "moduleResolvedSymbolUnexported",
    },
  };
};
const resolveObjectCall = (options: {
  call: Extract<ReturnType<typeof findGetDocsCalls>[number], { kind: "object" }>;
  currentFile: string;
  resolver: DocgenProject | TypeRegistry;
  unresolved: string[];
}): TargetResolution | undefined => {
  const { call, currentFile, resolver, unresolved } = options;
  if (!call.target) {
    unresolved.push(formatUnsupportedOptionsMessage(call.unsupportedReason, call.start));
    return undefined;
  }
  return resolveStaticTarget({ target: call.target, currentFile, resolver });
};
const resolveStaticTarget = (options: ResolveStaticTargetOptions): TargetResolution => {
  const { target, currentFile, resolver } = options;
  const label = formatStaticTargetLabel(target);
  const resolved = resolveExportedTarget({
    specifier: target.path,
    importedName: target.symbol,
    fromFile: currentFile,
    resolver,
  });
  if (resolved.status === "resolved") {
    return {
      kind: "schema",
      request: {
        requestedTypeName: target.symbol,
        sourceFile: resolved.filePath,
        resolvedTypeName: resolved.typeName,
        deps: resolved.deps,
        label,
        watchOnUnchanged: true,
      },
    };
  }
  return {
    kind: "unresolved",
    target: {
      deps: resolved.deps,
      message:
        resolved.status === "moduleUnresolved"
          ? `${label} could not resolve the target module`
          : `${label} resolved ${JSON.stringify(target.path)}, but ${
              target.symbol
            } is not exported by the target module`,
      watchOnUnchanged: resolved.status === "moduleResolvedSymbolUnexported",
    },
  };
};
const recordUnresolvedTarget = (options: RecordUnresolvedTargetOptions): boolean => {
  const { target, registry, consumerModule, deps, unresolved } = options;
  deps.push(...target.deps);
  if (registry) {
    for (const dep of target.deps) {
      registry.registerFileDependency(consumerModule, dep);
    }
  }
  unresolved.push(target.message);
  return target.watchOnUnchanged === true && target.deps.length > 0;
};
const compileSchema = (options: CompileSchemaOptions): DocSchema | undefined => {
  const { request, registry, standaloneProject, consumerModule, deps, unresolved } = options;
  deps.push(...request.deps);
  if (registry) {
    for (const dep of request.deps) {
      registry.registerFileDependency(consumerModule, dep);
    }
  }
  if (registry) {
    const result = registry.getSchemaBuildResult(request.resolvedTypeName, request.sourceFile);
    if (!result?.schema) {
      registry.registerConsumer({
        consumerModule,
        typeName: request.resolvedTypeName,
        sourceFile: request.sourceFile,
      });
      unresolved.push(`${request.label} could not be resolved from ${request.sourceFile}`);
      return undefined;
    }
    deps.push(...getBuildResultFileDependencies({ result, sourceFile: request.sourceFile }));
    registry.registerConsumer({
      consumerModule,
      typeName: request.resolvedTypeName,
      sourceFile: request.sourceFile,
    });
    if (result.resolution?.fallbackReason === "semanticFallbackUnavailable") {
      unresolved.push(
        `${request.label} requires semantic fallback, but semantic fallback was unavailable for ${request.sourceFile}`,
      );
      return undefined;
    }
    return result.schema;
  }
  try {
    const schema = standaloneProject.getSchema({
      sourceFile: request.sourceFile,
      typeName: request.resolvedTypeName,
    });
    if (!schema || schema.entries.length === 0) {
      unresolved.push(`${request.label} could not be resolved from ${request.sourceFile}`);
      return undefined;
    }
    return schema;
  } catch {
    unresolved.push(`${request.label} could not be generated from ${request.sourceFile}`);
    return undefined;
  }
};
const getBuildResultFileDependencies = (options: BuildResultFileDependenciesOptions): string[] => {
  const { result, sourceFile } = options;
  const files = result.dependencyRecords.map((record) => record.filePath);
  files.push(sourceFile);
  return [...new Set(files)];
};
const createSchemaReplacement = (options: CreateSchemaReplacementOptions): string => {
  const {
    schema,
    consumerFile,
    sourceFile,
    resolvedTypeName,
    requestedTypeName,
    outputMode,
    createVirtualModuleId,
    virtualImports,
    virtualModules,
  } = options;
  if (outputMode !== "virtual") {
    return createInlineSchemaReplacement(schema);
  }
  const virtual = createVirtualSchemaReplacement(
    {
      consumerFile,
      sourceFile,
      typeName: resolvedTypeName,
      localTypeName: requestedTypeName,
      index: virtualImports.length,
    },
    createVirtualModuleId,
  );
  virtualImports.push(virtual.importStatement);
  virtualModules.push(virtual.moduleId);
  return virtual.replacement;
};
const createBatchReplacement = (options: {
  batchSchemas: BatchSchema[];
  consumerFile: string;
  outputMode: TransformOutputMode | undefined;
  createVirtualModuleId: ((request: VirtualModuleRequest) => string) | undefined;
  virtualImports: string[];
  virtualModules: string[];
}): string => {
  const {
    batchSchemas,
    consumerFile,
    outputMode,
    createVirtualModuleId,
    virtualImports,
    virtualModules,
  } = options;
  if (outputMode !== "virtual") {
    return createInlineSchemaReplacement(
      batchSchemas.map((item) => ({
        ...item.target.metadata,
        docs: item.schema,
      })),
    );
  }
  const entries = batchSchemas.map((item) => {
    const virtual = createVirtualSchemaReplacement(
      {
        consumerFile,
        sourceFile: item.sourceFile,
        typeName: item.resolvedTypeName,
        localTypeName: item.target.symbol,
        index: virtualImports.length,
      },
      createVirtualModuleId,
    );
    virtualImports.push(virtual.importStatement);
    virtualModules.push(virtual.moduleId);
    return createVirtualBatchEntry({
      metadata: item.target.metadata,
      docsExpression: virtual.replacement,
    });
  });
  return `[${entries.join(",")}]`;
};
const createVirtualBatchEntry = (options: {
  metadata: GetDocsStaticTarget["metadata"];
  docsExpression: string;
}): string => {
  const { metadata, docsExpression } = options;
  const fields = Object.entries(metadata).map((entry) => {
    const [key, value] = entry;
    return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  });
  fields.push(`"docs":${docsExpression}`);
  return `{${fields.join(",")}}`;
};
const inferLang = (fileName: string): "ts" | "tsx" | "js" | "jsx" => {
  if (fileName.endsWith(".tsx")) {
    return "tsx";
  }

  if (fileName.endsWith(".jsx")) {
    return "jsx";
  }

  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return "js";
  }

  return "ts";
};
const formatDiagnostics = (
  diagnostics: DocgenProjectDiagnostic[],
  initialDiagnosticCount: number,
): string[] => {
  return diagnostics
    .filter(
      (diagnostic, index) =>
        diagnostic.code !== "module-resolution-failed" || index >= initialDiagnosticCount,
    )
    .map(formatDocgenDiagnostic);
};
const uniqueMessages = (messages: string[]): string[] => {
  return [...new Set(messages)];
};
const formatDocgenDiagnostic = (diagnostic: DocgenProjectDiagnostic): string => {
  const fileLabel = diagnostic.code.startsWith("tsconfig") ? "tsconfig" : "file";
  const details = [
    `[${diagnostic.code}] ${diagnostic.message}`,
    diagnostic.filePath ? `${fileLabel}: ${diagnostic.filePath}` : undefined,
    diagnostic.specifier ? `specifier: ${diagnostic.specifier}` : undefined,
    diagnostic.importer ? `importer: ${diagnostic.importer}` : undefined,
    diagnostic.cause ? `cause: ${diagnostic.cause}` : undefined,
  ].filter(Boolean);
  return details.join(" ");
};
const formatUnsupportedOptionsMessage = (
  unsupportedReason: string | undefined,
  start: number,
): string => {
  return `getDocs options at ${start} ${unsupportedReason ?? "must be static"}.`;
};
const formatStaticTargetLabel = (target: GetDocsStaticTarget): string => {
  return `getDocs({ path: ${JSON.stringify(target.path)}, symbol: ${JSON.stringify(
    target.symbol,
  )} })`;
};
const formatUnsupportedTypeArgumentMessage = (typeArgSource: string, start: number): string => {
  return [
    `getDocs<${typeArgSource}> at ${start} must use a plain named type reference.`,
    "Name the type first, then call getDocs<Name>().",
  ].join(" ");
};
