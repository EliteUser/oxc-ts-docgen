import type { StaticResolutionStatus } from "../builders/entry-builder";
import type { DocgenConfig } from "../public/config";
import type { DocEntry } from "../schema/doc-schema";
import type { ResolverDiagnostic } from "./module-resolver";
import type { ParsedSource } from "./parser";
import type { TypeResolver } from "./resolver";

import { buildStaticDocEntry } from "../builders/entry-builder";
import { emitDebugRecord } from "../public/debug";
export type ResolutionRequest = {
  parsed: ParsedSource;
  typeName: string;
  filePath: string;
  sourceText?: string;
};
export type SemanticFallbackRequest = ResolutionRequest & {
  staticEntry: DocEntry;
  staticStatus: StaticResolutionStatus;
};
export type SemanticFallbackResolver = {
  resolveEntry(request: SemanticFallbackRequest): DocEntry | undefined;
};
export type ResolutionFallbackReason =
  | "staticResolved"
  | "staticAnalysis"
  | "staticOpaque"
  | "semanticFallbackSucceeded"
  | "semanticFallbackUnavailable";
export type ResolutionResult = {
  /**
   * Static extraction status before any semantic replacement.
   */
  status: StaticResolutionStatus;
  /**
   * Final entry selected for schema assembly.
   */
  entry: DocEntry | undefined;
  /**
   * Whether the final entry came from TypeScript semantic fallback.
   */
  usedSemanticFallback: boolean;
  /**
   * Traceable reason explaining the static/semantic path taken.
   */
  fallbackReason: ResolutionFallbackReason;
  /**
   * Resolver and semantic setup diagnostics visible when this outcome was produced.
   */
  diagnostics: ResolverDiagnostic[];
};
export type ResolutionControllerOptions = {
  /**
   * Resolved docgen config for this controller.
   */
  config: DocgenConfig;
  /**
   * Static resolver used by the OXC path.
   */
  resolver: TypeResolver;
  /**
   * Optional semantic fallback used in hybrid analysis.
   */
  semanticFallback?: SemanticFallbackResolver;
};
export class ResolutionController {
  private readonly config: DocgenConfig;
  private readonly resolver: TypeResolver;
  private readonly semanticFallback: SemanticFallbackResolver | undefined;

  constructor(options: ResolutionControllerOptions) {
    const { config, resolver, semanticFallback } = options;

    this.config = config;
    this.resolver = resolver;
    this.semanticFallback = semanticFallback;
  }
  resolveEntry(request: ResolutionRequest): ResolutionResult {
    const staticResult = buildStaticDocEntry({
      parsed: request.parsed,
      typeName: request.typeName,
      filePath: request.filePath,
      config: this.config,
      resolver: this.resolver,
    });
    if (
      this.config.analysis !== "hybrid" ||
      staticResult.status !== "semanticFallbackRequired" ||
      !staticResult.entry
    ) {
      const fallbackReason = getStaticFallbackReason({
        analysis: this.config.analysis,
        status: staticResult.status,
        hasEntry: Boolean(staticResult.entry),
      });
      emitDebugRecord(this.config, {
        kind: "resolution",
        typeName: request.typeName,
        filePath: request.filePath,
        analysis: this.config.analysis,
        staticStatus: staticResult.status,
        usedSemanticFallback: false,
        entryKind: staticResult.entry?.kind,
      });
      return {
        ...staticResult,
        usedSemanticFallback: false,
        fallbackReason,
        diagnostics: this.collectDiagnostics(staticResult.diagnostics),
      };
    }
    const semanticEntry = this.semanticFallback?.resolveEntry({
      ...request,
      staticEntry: staticResult.entry,
      staticStatus: staticResult.status,
    });
    if (!semanticEntry) {
      emitDebugRecord(this.config, {
        kind: "resolution",
        typeName: request.typeName,
        filePath: request.filePath,
        analysis: this.config.analysis,
        staticStatus: staticResult.status,
        usedSemanticFallback: false,
        entryKind: staticResult.entry.kind,
      });
      return {
        ...staticResult,
        usedSemanticFallback: false,
        fallbackReason: "semanticFallbackUnavailable",
        diagnostics: this.collectDiagnostics(staticResult.diagnostics),
      };
    }
    emitDebugRecord(this.config, {
      kind: "resolution",
      typeName: request.typeName,
      filePath: request.filePath,
      analysis: this.config.analysis,
      staticStatus: staticResult.status,
      usedSemanticFallback: true,
      entryKind: semanticEntry.kind,
    });
    return {
      status: "resolved",
      entry: semanticEntry,
      usedSemanticFallback: true,
      fallbackReason: "semanticFallbackSucceeded",
      diagnostics: this.resolver.getDiagnostics(),
    };
  }

  private collectDiagnostics(staticDiagnostics: ResolverDiagnostic[]): ResolverDiagnostic[] {
    return [...this.resolver.getDiagnostics(), ...staticDiagnostics];
  }
}
type ResolveDocEntryOptions = {
  request: ResolutionRequest;
  config: DocgenConfig;
  resolver: TypeResolver;
  semanticFallback?: SemanticFallbackResolver;
};

export const resolveDocEntry = (options: ResolveDocEntryOptions): ResolutionResult => {
  const { request, config, resolver, semanticFallback } = options;
  return new ResolutionController({
    config,
    resolver,
    semanticFallback,
  }).resolveEntry(request);
};
type GetStaticFallbackReasonOptions = {
  analysis: DocgenConfig["analysis"];
  status: StaticResolutionStatus;
  hasEntry: boolean;
};
const getStaticFallbackReason = (
  options: GetStaticFallbackReasonOptions,
): ResolutionFallbackReason => {
  const { analysis, status, hasEntry } = options;
  if (analysis === "static" && status === "semanticFallbackRequired") {
    return "staticAnalysis";
  }
  if (!hasEntry || status === "opaque") {
    return "staticOpaque";
  }
  return "staticResolved";
};
