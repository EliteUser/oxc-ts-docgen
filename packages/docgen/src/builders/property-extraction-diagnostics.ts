import type { ResolverDiagnostic } from "../resolver/module-resolver";
import type { ParsedSource } from "../resolver/parser";

import { normalizePath } from "../utils/path-utils";
import { offsetToLocation } from "../utils/source-location";

export type StaticExtractionState = {
  semanticFallbackRequired: boolean;
  diagnostics: ResolverDiagnostic[];
};

export type RecordBoundedExtractionDiagnosticOptions = {
  /**
   * Mutable static extraction state for the current entry.
   */
  state: StaticExtractionState | undefined;
  /**
   * Parsed source containing the bounded node.
   */
  parsed: ParsedSource;
  /**
   * File that owns the bounded node.
   */
  filePath: string;
  /**
   * Source offset for the bounded node.
   */
  start: number;
  /**
   * Human-readable bounded expression.
   */
  text: string;
  /**
   * Reason static extraction intentionally stopped.
   */
  reason: "maxDepth" | "unsupportedUtility";
};

export const createStaticExtractionState = (): StaticExtractionState => {
  return { semanticFallbackRequired: false, diagnostics: [] };
};

export const recordBoundedExtractionDiagnostic = (
  options: RecordBoundedExtractionDiagnosticOptions,
): void => {
  const { state, parsed, filePath, start, text, reason } = options;
  if (!state) {
    return;
  }

  const source = offsetToLocation({ parsed, offset: start, filePath });
  const normalizedFilePath = normalizePath(source.filePath);
  const boundedText = text.trim() || "<unknown>";
  const reasonText =
    reason === "maxDepth"
      ? "configured maxDepth/static recursion limit"
      : "unsupported utility type";
  const message = `Static property extraction stopped at ${source.line}:${source.column} in ${normalizedFilePath} because ${reasonText} was reached while evaluating ${boundedText}.`;

  if (
    state.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "static-extraction-incomplete" &&
        diagnostic.filePath === normalizedFilePath &&
        diagnostic.message === message,
    )
  ) {
    return;
  }

  state.diagnostics.push({
    code: "static-extraction-incomplete",
    message,
    filePath: normalizedFilePath,
  });
};
