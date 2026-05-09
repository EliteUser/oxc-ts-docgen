import type { DocgenConfig } from "../public/config";
import type { DocEntry, DocProperty, DocType, DocTypeReferenceTarget } from "../schema/doc-schema";
import type { ParsedSource } from "./parser";
import type { TypeResolver } from "./resolver";

import { normalizePath } from "../utils/path-utils";
import { isIgnoredTypeName } from "./ignored-types";

export type ReferenceAnnotationContext = {
  rootFile: string;
  resolver: TypeResolver;
  ignoreTypes: readonly string[];
  parsedOverride?: ParsedSource;
  /**
   * In-memory source text for semantic fallback against the root file.
   */
  sourceTextOverride?: string;
  parsedCache: Map<string, ParsedSource | undefined>;
};

type ReferenceDocType = Extract<
  DocType,
  {
    kind: "reference";
  }
>;

export type CreateReferenceAnnotationContextOptions = {
  rootFile: string;
  resolver: TypeResolver;
  config: DocgenConfig;
  parsedOverride: ParsedSource | undefined;
  /**
   * In-memory source text for semantic fallback against the root file.
   */
  sourceTextOverride?: string;
};

export const createReferenceAnnotationContext = (
  options: CreateReferenceAnnotationContextOptions,
): ReferenceAnnotationContext => {
  const { rootFile, resolver, config, parsedOverride, sourceTextOverride } = options;

  return {
    rootFile: normalizePath(rootFile),
    resolver,
    ignoreTypes: config.ignoreTypes,
    parsedOverride,
    sourceTextOverride,
    parsedCache: new Map(),
  };
};

export const annotateEntryReferences = (
  entry: DocEntry,
  context: ReferenceAnnotationContext,
): DocEntry => {
  const ownerFile = normalizePath(entry.source.filePath || context.rootFile);

  return {
    ...entry,
    typeParameters: entry.typeParameters.map((param) => ({
      ...param,
      constraint: param.constraint
        ? annotateDocTypeReferences({ type: param.constraint, sourceFiles: [ownerFile], context })
        : undefined,
      default: param.default
        ? annotateDocTypeReferences({ type: param.default, sourceFiles: [ownerFile], context })
        : undefined,
    })),
    properties: entry.properties.map((property) =>
      annotatePropertyReferences({ property, ownerFile, context }),
    ),
    type: annotateDocTypeReferences({ type: entry.type, sourceFiles: [ownerFile], context }),
  };
};

type AnnotatePropertyReferencesOptions = {
  property: DocProperty;
  ownerFile: string;
  context: ReferenceAnnotationContext;
};

const annotatePropertyReferences = (options: AnnotatePropertyReferencesOptions): DocProperty => {
  const { property, ownerFile, context } = options;
  const sourceFile = normalizePath(property.source.filePath || ownerFile);

  return {
    ...property,
    type: annotateDocTypeReferences({
      type: property.type,
      sourceFiles: uniqueFiles([sourceFile, ownerFile]),
      context,
    }),
  };
};

type AnnotateDocTypeReferencesOptions = {
  type: DocType;
  sourceFiles: string[];
  context: ReferenceAnnotationContext;
};

const annotateDocTypeReferences = (options: AnnotateDocTypeReferencesOptions): DocType => {
  const { type, sourceFiles, context } = options;

  switch (type.kind) {
    case "reference":
      return annotateReference({ type, sourceFiles, context });
    case "union":
      return {
        ...type,
        members: type.members.map((member) =>
          annotateDocTypeReferences({ type: member, sourceFiles, context }),
        ),
      };
    case "intersection":
      return {
        ...type,
        members: type.members.map((member) =>
          annotateDocTypeReferences({ type: member, sourceFiles, context }),
        ),
      };
    case "array":
      return {
        ...type,
        elementType: annotateDocTypeReferences({ type: type.elementType, sourceFiles, context }),
      };
    case "tuple":
      return {
        ...type,
        elements: type.elements.map((element) =>
          annotateDocTypeReferences({ type: element, sourceFiles, context }),
        ),
      };
    case "object":
      return {
        ...type,
        properties: type.properties.map((property) =>
          annotatePropertyReferences({
            property,
            ownerFile: sourceFiles[0] ?? context.rootFile,
            context,
          }),
        ),
      };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((param) => ({
          ...param,
          type: annotateDocTypeReferences({ type: param.type, sourceFiles, context }),
        })),
        returnType: annotateDocTypeReferences({ type: type.returnType, sourceFiles, context }),
      };
    case "mapped":
      return {
        ...type,
        constraint: annotateDocTypeReferences({ type: type.constraint, sourceFiles, context }),
        type: annotateDocTypeReferences({ type: type.type, sourceFiles, context }),
      };
    case "conditional":
      return {
        ...type,
        checkType: annotateDocTypeReferences({ type: type.checkType, sourceFiles, context }),
        extendsType: annotateDocTypeReferences({ type: type.extendsType, sourceFiles, context }),
        trueType: annotateDocTypeReferences({ type: type.trueType, sourceFiles, context }),
        falseType: annotateDocTypeReferences({ type: type.falseType, sourceFiles, context }),
      };
    case "indexedAccess":
      return {
        ...type,
        objectType: annotateDocTypeReferences({ type: type.objectType, sourceFiles, context }),
        indexType: annotateDocTypeReferences({ type: type.indexType, sourceFiles, context }),
      };
    case "templateLiteral":
      return {
        ...type,
        spans: type.spans.map((span) =>
          "type" in span
            ? { type: annotateDocTypeReferences({ type: span.type, sourceFiles, context }) }
            : span,
        ),
      };
    case "keyof":
      return {
        ...type,
        type: annotateDocTypeReferences({ type: type.type, sourceFiles, context }),
      };
    case "rest":
      return {
        ...type,
        type: annotateDocTypeReferences({ type: type.type, sourceFiles, context }),
      };
    default:
      return type;
  }
};

type AnnotateReferenceOptions = {
  type: ReferenceDocType;
  sourceFiles: string[];
  context: ReferenceAnnotationContext;
};

const annotateReference = (options: AnnotateReferenceOptions): ReferenceDocType => {
  const { type, sourceFiles, context } = options;
  const typeArguments = type.typeArguments?.map((arg) =>
    annotateDocTypeReferences({ type: arg, sourceFiles, context }),
  );
  const target = isIgnoredTypeName({ config: context, name: type.name })
    ? undefined
    : resolveReferenceTarget({ typeName: type.name, sourceFiles, context });

  return {
    ...type,
    ...(typeArguments ? { typeArguments } : {}),
    ...(target ? { target } : {}),
  };
};

type ResolveReferenceTargetOptions = {
  typeName: string;
  sourceFiles: string[];
  context: ReferenceAnnotationContext;
};

const resolveReferenceTarget = (
  options: ResolveReferenceTargetOptions,
): DocTypeReferenceTarget | undefined => {
  const { typeName, sourceFiles, context } = options;

  for (const filePath of uniqueFiles(sourceFiles)) {
    const parsed = getParsedForFile(filePath, context);
    if (!parsed) {
      continue;
    }

    const resolved = context.resolver.resolveType({
      typeName,
      fromFile: filePath,
      fromParsed: parsed,
    });
    if (!resolved) {
      continue;
    }

    return {
      name: resolved.decl.id.name,
      filePath: normalizePath(resolved.filePath),
    };
  }

  return undefined;
};

export const getParsedForFile = (
  filePath: string,
  context: ReferenceAnnotationContext,
): ParsedSource | undefined => {
  const normalized = normalizePath(filePath);

  if (normalized === context.rootFile && context.parsedOverride) {
    return context.parsedOverride;
  }

  if (context.parsedCache.has(normalized)) {
    return context.parsedCache.get(normalized);
  }

  const parsed = context.resolver.parseFileCached(normalized);
  context.parsedCache.set(normalized, parsed);

  return parsed;
};

export const getSourceTextForFile = (
  filePath: string,
  context: ReferenceAnnotationContext,
): string | undefined => {
  if (normalizePath(filePath) !== context.rootFile) {
    return undefined;
  }

  return context.sourceTextOverride;
};

export const uniqueFiles = (files: Array<string | undefined>): string[] => {
  return [...new Set(files.filter((file): file is string => Boolean(file)).map(normalizePath))];
};
