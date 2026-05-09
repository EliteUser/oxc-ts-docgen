import type { DocSchemaDependencyRecord } from "../graph/dependency-record-types";
import type { DocgenConfig } from "../public/config";
import type { ResolverDiagnostic } from "../resolver/module-resolver";
import type { ParsedSource } from "../resolver/parser";
import type { ResolutionResult, SemanticFallbackResolver } from "../resolver/resolution-controller";
import type { TypeResolver } from "../resolver/resolver";
import type { DocEntry, DocSchema } from "./doc-schema";

import { collectResolvedDocSchemaDependencyRecords } from "../graph/dependency-records";
import { emitDebugRecord } from "../public/debug";
import { attachRelatedToSchema } from "../resolver/related-types";
import { ResolutionController } from "../resolver/resolution-controller";
import { TypeScriptSemanticFallbackResolver } from "../semantic/semantic-property-resolver";

export type DocSchemaBuildOptions = {
  /**
   * Parsed source that owns the requested type.
   */
  parsed: ParsedSource;
  /**
   * Type name to generate schema for.
   */
  typeName: string;
  /**
   * Source file path that owns the requested type.
   */
  filePath: string;
  /**
   * Resolved docgen configuration for this build.
   */
  config: DocgenConfig;
  /**
   * Resolver reused for static resolution, semantic services, and dependencies.
   */
  resolver: TypeResolver;
  /**
   * In-memory source text for the root file when no on-disk file exists.
   */
  sourceText?: string;
};

export type DocSchemaBuildResult = {
  /**
   * Generated documentation schema.
   */
  schema: DocSchema;
  /**
   * Resolution outcome used to build the primary schema entry.
   */
  resolution: ResolutionResult;
  /**
   * Parsed source used for dependency analysis.
   */
  parsed: ParsedSource;
  /**
   * Schema dependency records collected at generation time.
   */
  dependencyRecords: DocSchemaDependencyRecord[];
  /**
   * Resolver and semantic setup diagnostics collected at generation time.
   */
  diagnostics: ResolverDiagnostic[];
};

export const buildDocSchema = (options: DocSchemaBuildOptions): DocSchemaBuildResult => {
  const { parsed, typeName, filePath, config, resolver, sourceText } = options;
  const semanticFallback = new TypeScriptSemanticFallbackResolver(config, resolver);
  const controller = new ResolutionController({
    config,
    resolver,
    semanticFallback,
  });
  const resolution = controller.resolveEntry({
    parsed,
    typeName,
    filePath,
    sourceText,
  });
  const schema = buildSchemaFromResolution({
    resolution,
    parsed,
    ownerFile: filePath,
    resolver,
    config,
    semanticFallback,
    sourceText,
  });
  const dependencyRecords = collectResolvedDocSchemaDependencyRecords({
    schema,
    ownerFile: filePath,
    parsed,
    resolver,
    config,
  });

  emitSchemaDependencyDebug({ config, dependencyRecords });

  return {
    schema,
    resolution,
    parsed,
    dependencyRecords,
    diagnostics: mergeDiagnostics(resolution.diagnostics, resolver.getDiagnostics()),
  };
};

type BuildSchemaFromResolutionOptions = {
  /**
   * Resolution result for the requested entry.
   */
  resolution: ResolutionResult;
  /**
   * Parsed source that owns the requested type.
   */
  parsed: ParsedSource;
  /**
   * Source file path that owns the requested type.
   */
  ownerFile: string;
  /**
   * Resolver reused for reference annotation and related entries.
   */
  resolver: TypeResolver;
  /**
   * Resolved docgen configuration for this build.
   */
  config: DocgenConfig;
  /**
   * Shared semantic fallback resolver for primary and related entries.
   */
  semanticFallback: SemanticFallbackResolver;
  /**
   * In-memory source text for the root file when no on-disk file exists.
   */
  sourceText?: string;
};

const buildSchemaFromResolution = (options: BuildSchemaFromResolutionOptions): DocSchema => {
  const { resolution, parsed, ownerFile, resolver, config, semanticFallback, sourceText } = options;
  const entries: DocEntry[] = [];
  if (resolution.entry) {
    entries.push(resolution.entry);
  }

  const base: DocSchema = { version: 1, entries };
  if (!resolution.entry) {
    return { ...base, related: [] };
  }

  return attachRelatedToSchema({
    schema: base,
    filePath: ownerFile,
    resolver,
    config,
    semanticFallback,
    parsedOverride: parsed,
    sourceTextOverride: sourceText,
  });
};

const mergeDiagnostics = (
  first: ResolverDiagnostic[],
  second: ResolverDiagnostic[],
): ResolverDiagnostic[] => {
  const diagnostics: ResolverDiagnostic[] = [];
  const seen = new Set<string>();

  for (const diagnostic of [...first, ...second]) {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    diagnostics.push(diagnostic);
  }

  return diagnostics;
};

type EmitSchemaDependencyDebugOptions = {
  /**
   * Resolved docgen configuration for this build.
   */
  config: DocgenConfig;
  /**
   * Dependency records produced by this schema build.
   */
  dependencyRecords: DocSchemaDependencyRecord[];
};

const emitSchemaDependencyDebug = (options: EmitSchemaDependencyDebugOptions): void => {
  const { config, dependencyRecords } = options;
  if (!config.experimentalDebug) {
    return;
  }

  for (const dependency of dependencyRecords) {
    emitDebugRecord(config, { kind: "schemaDependency", dependency });
  }
};
