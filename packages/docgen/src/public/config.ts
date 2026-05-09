import type { DocEntry, DocProperty, DocTagValue } from "../schema/doc-schema";
import type { DocgenDebugCallback } from "./debug";
import type { DocgenPresetName } from "./presets";

import { DEFAULT_PRESETS, isDocgenPresetName, resolvePresetIgnoreTypes } from "./presets";
export type PropFilterContext = {
  /**
   * Property name being evaluated by the filter.
   */
  propertyName: string;
  /**
   * Entry name that owns the property.
   */
  ownerName: string;
  /**
   * Entry kind that owns the property.
   */
  ownerKind: DocEntry["kind"];
  /**
   * Source file where the property declaration was found.
   */
  sourceFile: string;
  /**
   * Root file for the requested documented type.
   */
  rootFile: string;
  /**
   * Whether the property came from inherited or composed declarations.
   */
  inherited: boolean;
  /**
   * Whether the property source is outside the root project.
   */
  external: boolean;
  /**
   * Parsed JSDoc tags available on the property.
   */
  tags: Record<string, DocTagValue>;
};
export type DocTagParser = (value: string) => DocTagValue;
export type DocgenConfig = {
  /**
   * Analysis strategy: hybrid uses TypeScript semantic fallback when static extraction is
   * insufficient.
   */
  analysis: "hybrid" | "static";
  /**
   * Built-in ignore/filter/display preset names to apply.
   */
  presets: DocgenPresetName[];
  /**
   * Project scan globs included by adapter-level indexing.
   */
  include: string[];
  /**
   * Project scan globs excluded by adapter-level indexing.
   */
  exclude: string[];
  /**
   * Type names that should remain references instead of being expanded.
   */
  ignoreTypes: string[];
  /**
   * Maximum nested type-conversion depth before emitting an unresolved fallback.
   */
  maxDepth: number;
  /**
   * Policy for types declared outside the project source tree.
   */
  externalTypes: "ignore" | "reference" | "resolve";
  /**
   * Explicit tsconfig path used for module resolution and semantic analysis.
   */
  tsconfig: string | undefined;
  /**
   * Custom JSDoc tag parsers keyed by tag name.
   */
  tags: Record<string, DocTagParser>;
  /**
   * User property filter invoked after built-in filtering decisions.
   */
  propFilter: ((prop: DocProperty, context: PropFilterContext) => boolean) | undefined;
  /**
   * Optional diagnostic callback for experimental resolution and dependency records.
   */
  experimentalDebug: DocgenDebugCallback | undefined;
  /**
   * Property names to omit from generated entries.
   */
  skipPropsWithName: string[];
  /**
   * Whether to omit properties that do not have JSDoc descriptions or tags.
   */
  skipPropsWithoutDoc: boolean;
  /**
   * Whether to omit properties whose source file is external to the root project.
   */
  skipPropsFromExternalFiles: boolean;
};
export const DEFAULT_CONFIG: DocgenConfig = {
  analysis: "hybrid",
  presets: [...DEFAULT_PRESETS],
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["**/node_modules/**", "**/*.test.ts", "**/*.spec.ts"],
  ignoreTypes: resolvePresetIgnoreTypes(DEFAULT_PRESETS),
  maxDepth: 3,
  externalTypes: "reference",
  tsconfig: undefined,
  tags: {},
  propFilter: undefined,
  experimentalDebug: undefined,
  skipPropsWithName: [],
  skipPropsWithoutDoc: false,
  skipPropsFromExternalFiles: false,
};
export const resolveConfig = (partial?: Partial<DocgenConfig>): DocgenConfig => {
  const options = partial ?? {};
  const analysis = normalizeAnalysis(options.analysis);
  const presets = normalizePresets(options.presets ?? DEFAULT_CONFIG.presets);
  const optionIgnoreTypes = normalizeStringArrayOption("ignoreTypes", options.ignoreTypes);
  const ignoreTypes = optionIgnoreTypes
    ? [...new Set([...resolvePresetIgnoreTypes(presets), ...optionIgnoreTypes])]
    : resolvePresetIgnoreTypes(presets);
  const tags = normalizeTagParsers({
    ...DEFAULT_CONFIG.tags,
    ...normalizeTagParserOption(options.tags),
  });
  return {
    ...DEFAULT_CONFIG,
    ...options,
    analysis,
    presets,
    include: normalizeStringArrayOption("include", options.include) ?? [...DEFAULT_CONFIG.include],
    exclude: normalizeStringArrayOption("exclude", options.exclude) ?? [...DEFAULT_CONFIG.exclude],
    ignoreTypes,
    maxDepth: normalizeMaxDepth(options.maxDepth),
    externalTypes: normalizeExternalTypes(options.externalTypes),
    tsconfig: normalizeOptionalStringOption("tsconfig", options.tsconfig),
    tags,
    propFilter: normalizeOptionalFunctionOption("propFilter", options.propFilter),
    experimentalDebug: normalizeOptionalFunctionOption(
      "experimentalDebug",
      options.experimentalDebug,
    ),
    skipPropsWithName:
      normalizeStringArrayOption("skipPropsWithName", options.skipPropsWithName) ?? [],
    skipPropsWithoutDoc: normalizeBooleanOption("skipPropsWithoutDoc", options.skipPropsWithoutDoc),
    skipPropsFromExternalFiles: normalizeBooleanOption(
      "skipPropsFromExternalFiles",
      options.skipPropsFromExternalFiles,
    ),
  };
};
export const createConfigHash = (config: DocgenConfig): string => {
  return hashString(stableSerialize(config));
};
const normalizeAnalysis = (value: unknown): DocgenConfig["analysis"] => {
  const analysis = value ?? DEFAULT_CONFIG.analysis;
  if (analysis !== "hybrid" && analysis !== "static") {
    throw new Error(
      `Invalid docgen config analysis "${String(analysis)}". Expected "hybrid" or "static".`,
    );
  }
  return analysis;
};
const normalizePresets = (values: unknown): DocgenPresetName[] => {
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
    throw new Error("Invalid docgen config presets. Expected an array of strings.");
  }
  const invalid = values.find((value) => !isDocgenPresetName(value));
  if (invalid) {
    throw new Error(
      `Invalid docgen config preset "${invalid}". Expected one of: typescript, react, dom.`,
    );
  }
  const selected = new Set(values);
  return DEFAULT_PRESETS.filter((preset) => selected.has(preset));
};
const normalizeMaxDepth = (value: unknown): number => {
  const maxDepth = value ?? DEFAULT_CONFIG.maxDepth;
  if (!Number.isInteger(maxDepth) || typeof maxDepth !== "number" || maxDepth < 0) {
    throw new Error(
      `Invalid docgen config maxDepth "${String(maxDepth)}". Expected a non-negative integer.`,
    );
  }
  return maxDepth;
};
const normalizeExternalTypes = (value: unknown): DocgenConfig["externalTypes"] => {
  const externalTypes = value ?? DEFAULT_CONFIG.externalTypes;
  if (externalTypes !== "ignore" && externalTypes !== "reference" && externalTypes !== "resolve") {
    throw new Error(
      `Invalid docgen config externalTypes "${String(externalTypes)}". Expected "ignore", "reference", or "resolve".`,
    );
  }
  return externalTypes;
};
const normalizeStringArrayOption = (name: string, value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid docgen config ${name}. Expected an array of strings.`);
  }
  return [...value];
};
const normalizeOptionalStringOption = (name: string, value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid docgen config ${name}. Expected a string.`);
  }
  return value;
};
const normalizeBooleanOption = (name: string, value: unknown): boolean => {
  if (value === undefined) {
    return DEFAULT_CONFIG[name as "skipPropsWithoutDoc" | "skipPropsFromExternalFiles"];
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid docgen config ${name}. Expected a boolean.`);
  }
  return value;
};
const normalizeOptionalFunctionOption = <T>(name: string, value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new Error(`Invalid docgen config ${name}. Expected a function.`);
  }
  return value;
};
const normalizeTagParserOption = (value: unknown): Record<string, DocTagParser> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid docgen config tags. Expected an object of functions.");
  }
  const tags: Record<string, DocTagParser> = {};
  for (const [name, parser] of Object.entries(value)) {
    if (typeof parser !== "function") {
      throw new Error(`Invalid docgen config tags.${name}. Expected a function.`);
    }
    tags[name] = parser as DocTagParser;
  }
  return tags;
};
const normalizeTagParsers = (tags: Record<string, DocTagParser>): Record<string, DocTagParser> => {
  const normalized: Record<string, DocTagParser> = {};
  for (const [name, parser] of Object.entries(tags)) {
    normalized[name.toLowerCase()] = parser;
  }
  return normalized;
};
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
const stableSerialize = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "function") {
    return `function:${value.name}:${String(value)}`;
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")}}`;
};
const hashString = (input: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
