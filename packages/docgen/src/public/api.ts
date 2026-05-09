import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { DocSchema } from "../schema/doc-schema";
import type { DocSchemaBuildResult } from "../schema/schema-build";
import type { DocgenConfig } from "./config";

import { parseSource } from "../resolver/parser";
import { TypeResolver } from "../resolver/resolver";
import { buildDocSchema } from "../schema/schema-build";
import { createConfigHash, resolveConfig } from "./config";

export type GetDocsTarget = {
  /**
   * Import specifier resolved from the calling file.
   */
  path: string;
  /**
   * Exported type name to document.
   */
  symbol: string;
};

export type GetDocsBatchEntry<TTarget extends GetDocsTarget> = Omit<
  TTarget,
  keyof GetDocsTarget
> & {
  /**
   * Generated docgen schema for this target.
   */
  docs: DocSchema;
};

export type GetDocsBatchResult<TTargets extends readonly GetDocsTarget[]> = {
  readonly [TIndex in keyof TTargets]: TTargets[TIndex] extends GetDocsTarget
    ? GetDocsBatchEntry<TTargets[TIndex]>
    : never;
};

export type GetDocs = {
  <_T>(): DocSchema;
  (target: GetDocsTarget): DocSchema;
  <const TTargets extends readonly GetDocsTarget[]>(
    targets: TTargets,
  ): GetDocsBatchResult<TTargets>;
};

export const getDocs: GetDocs = () => {
  throw new Error(
    "getDocs() must be compiled away by @synthfall/oxc-ts-docgen-vite. " +
      "Ensure the plugin is configured in your vite.config.ts.",
  );
};

export type GenerateDocsFromSourceOptions = {
  /**
   * Source text that contains the requested type.
   */
  source: string;
  /**
   * Type name to generate schema for.
   */
  typeName: string;
  /**
   * Optional source file name for diagnostics and source locations.
   */
  fileName?: string;
  /**
   * Docgen config overrides for this generation.
   */
  config?: Partial<DocgenConfig>;
};

export const generateDocsFromSource = (options: GenerateDocsFromSourceOptions): DocSchema => {
  return generateDocsResultFromSource(options).schema;
};

export type GenerateDocsOptions = {
  /**
   * Source file path that contains the requested type.
   */
  filePath: string;
  /**
   * Type name to generate schema for.
   */
  typeName: string;
  /**
   * Docgen config overrides for this generation.
   */
  config?: Partial<DocgenConfig>;
};

export const generateDocs = (options: GenerateDocsOptions): DocSchema => {
  return generateDocsWithResolver(options);
};

export type GenerateDocsWithResolverOptions = {
  /**
   * Source file path that contains the requested type.
   */
  filePath: string;
  /**
   * Type name to generate schema for.
   */
  typeName: string;
  /**
   * Docgen config overrides for this generation.
   */
  config?: Partial<DocgenConfig>;
  /**
   * Optional resolver instance for cache/service reuse.
   */
  resolver?: TypeResolver;
};
export type DocGenerationResult = DocSchemaBuildResult;

export const generateDocsResultFromSource = (
  options: GenerateDocsFromSourceOptions,
): DocGenerationResult => {
  const config = resolveConfig(options.config);
  const fileName = options.fileName ?? "anonymous.ts";
  const parsed = parseSource(options.source, fileName);
  const resolver = new TypeResolver(config);
  try {
    return buildDocSchema({
      parsed,
      typeName: options.typeName,
      filePath: fileName,
      config,
      resolver,
      sourceText: options.source,
    });
  } finally {
    resolver.dispose();
  }
};

export const generateDocsWithResolver = (options: GenerateDocsWithResolverOptions): DocSchema => {
  return generateDocsResultWithResolver(options).schema;
};

export const generateDocsResultWithResolver = (
  options: GenerateDocsWithResolverOptions,
): DocGenerationResult => {
  const config =
    options.config === undefined && options.resolver
      ? options.resolver.config
      : resolveConfig(options.config);
  const filePath = resolve(options.filePath);
  const ownsResolver = !options.resolver;
  const resolver = options.resolver ?? new TypeResolver(config);
  try {
    assertResolverConfig({ resolver, config });

    const parsed = resolver.parseFileCached(filePath);
    if (!parsed) {
      const source = readFileSync(filePath, "utf-8");
      const freshParsed = parseSource(source, filePath);
      return buildDocSchema({
        parsed: freshParsed,
        typeName: options.typeName,
        filePath,
        config,
        resolver,
      });
    }

    return buildDocSchema({
      parsed,
      typeName: options.typeName,
      filePath,
      config,
      resolver,
    });
  } finally {
    if (ownsResolver) {
      resolver.dispose();
    }
  }
};
type AssertResolverConfigOptions = {
  /**
   * Resolver whose config should match the generation config.
   */
  resolver: TypeResolver;
  /**
   * Resolved generation config.
   */
  config: DocgenConfig;
};
const assertResolverConfig = (options: AssertResolverConfigOptions): void => {
  const { resolver, config } = options;
  if (createConfigHash(resolver.config) === createConfigHash(config)) {
    return;
  }

  throw new Error(
    "generateDocsWithResolver received a TypeResolver created with a different docgen config. " +
      "Create a new resolver for this config or omit the config option when reusing a resolver.",
  );
};
