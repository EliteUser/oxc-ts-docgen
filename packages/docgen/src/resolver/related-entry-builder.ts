import type { DocgenConfig } from "../public/config";
import type { DocEntry } from "../schema/doc-schema";
import type { ParsedSource } from "./parser";
import type { ReferenceAnnotationContext } from "./reference-annotation";
import type { SemanticFallbackResolver } from "./resolution-controller";
import type { TypeResolver } from "./resolver";
import type { ReferencedTypeRecord } from "./source-reference-collector";

import { TypeScriptSemanticFallbackResolver } from "../semantic/semantic-property-resolver";
import { normalizePath } from "../utils/path-utils";
import { isIgnoredTypeName } from "./ignored-types";
import {
  annotateEntryReferences,
  createReferenceAnnotationContext,
  getParsedForFile,
  getSourceTextForFile,
  uniqueFiles,
} from "./reference-annotation";
import { resolveDocEntry } from "./resolution-controller";
import { collectReferencedTypeRecords } from "./source-reference-collector";

const typeKey = (filePath: string, typeName: string): string => {
  return `${normalizePath(filePath)}:${typeName}`;
};

export type BuildRelatedDocEntriesOptions = {
  primary: DocEntry;
  filePath: string;
  resolver: TypeResolver;
  config: DocgenConfig;
  semanticFallback?: SemanticFallbackResolver;
  parsedOverride?: ParsedSource;
  /**
   * In-memory source text for the root file when no on-disk file exists.
   */
  sourceTextOverride?: string;
};

export const buildRelatedDocEntries = (options: BuildRelatedDocEntriesOptions): DocEntry[] => {
  const {
    primary,
    filePath,
    resolver,
    config,
    semanticFallback: inputSemanticFallback,
    parsedOverride,
    sourceTextOverride,
  } = options;
  const parsed = parsedOverride ?? resolver.parseFileCached(filePath);

  if (!parsed) {
    return [];
  }

  const semanticFallback =
    inputSemanticFallback ?? new TypeScriptSemanticFallbackResolver(config, resolver);
  const result: DocEntry[] = [];
  const seenEntries = new Set<string>([typeKey(primary.source.filePath || filePath, primary.name)]);
  const processedRefs = new Set<string>();
  const context = createReferenceAnnotationContext({
    rootFile: filePath,
    resolver,
    config,
    parsedOverride: parsed,
    sourceTextOverride,
  });
  const queue = collectReferencedTypeRecords({ entry: primary, fallbackFilePath: filePath });

  for (let index = 0; index < queue.length; index++) {
    const candidate = queue[index];
    const refKey = `${candidate.name}:${candidate.sourceFiles.join("|")}`;

    if (processedRefs.has(refKey)) {
      continue;
    }

    processedRefs.add(refKey);

    if (isIgnoredTypeName({ config, name: candidate.name })) {
      continue;
    }

    const resolved = resolveRelatedCandidate({
      candidate,
      context,
    });

    if (!resolved) {
      continue;
    }

    const declName = resolved.decl.id.name;
    const entryKey = typeKey(resolved.filePath, declName);

    if (seenEntries.has(entryKey)) {
      continue;
    }

    const entry = resolveDocEntry({
      request: {
        parsed: resolved.parsed,
        typeName: declName,
        filePath: resolved.filePath,
        sourceText: getSourceTextForFile(resolved.filePath, context),
      },
      config,
      resolver,
      semanticFallback,
    }).entry;

    if (!entry) {
      continue;
    }

    seenEntries.add(entryKey);
    result.push(entry);

    for (const nested of collectReferencedTypeRecords({
      entry,
      fallbackFilePath: resolved.filePath,
    })) {
      if (isIgnoredTypeName({ config, name: nested.name })) {
        continue;
      }

      queue.push(nested);
    }
  }

  return result;
};

type ResolveRelatedCandidateOptions = {
  /**
   * Reference candidate with its local source resolution contexts.
   */
  candidate: ReferencedTypeRecord;
  /**
   * Shared resolver, config, and parsed-source cache.
   */
  context: ReferenceAnnotationContext;
};

const resolveRelatedCandidate = (options: ResolveRelatedCandidateOptions) => {
  const { candidate, context } = options;

  for (const filePath of uniqueFiles(candidate.sourceFiles)) {
    const parsed = getParsedForFile(filePath, context);
    if (!parsed) {
      continue;
    }

    const resolved = context.resolver.resolveType({
      typeName: candidate.name,
      fromFile: filePath,
      fromParsed: parsed,
    });

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

export type AttachRelatedToSchemaOptions = {
  schema: {
    version: 1;
    entries: DocEntry[];
    related?: DocEntry[];
  };
  filePath: string;
  resolver: TypeResolver;
  config: DocgenConfig;
  semanticFallback?: SemanticFallbackResolver;
  parsedOverride?: ParsedSource;
  /**
   * In-memory source text for the root file when no on-disk file exists.
   */
  sourceTextOverride?: string;
};

export const attachRelatedToSchema = (
  options: AttachRelatedToSchemaOptions,
): {
  version: 1;
  entries: DocEntry[];
  related: DocEntry[];
} => {
  const {
    schema,
    filePath,
    resolver,
    config,
    semanticFallback,
    parsedOverride,
    sourceTextOverride,
  } = options;
  const main = schema.entries[0];

  if (!main) {
    return { version: 1, entries: schema.entries, related: [] };
  }

  const related = buildRelatedDocEntries({
    primary: main,
    filePath,
    resolver,
    config,
    semanticFallback,
    parsedOverride,
    sourceTextOverride,
  });
  const context = createReferenceAnnotationContext({
    rootFile: filePath,
    resolver,
    config,
    parsedOverride,
    sourceTextOverride,
  });

  return {
    version: 1,
    entries: schema.entries.map((entry) => annotateEntryReferences(entry, context)),
    related: related.map((entry) => annotateEntryReferences(entry, context)),
  };
};
