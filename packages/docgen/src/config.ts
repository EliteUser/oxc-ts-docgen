import { TYPESCRIPT_IGNORE_TYPES } from "./presets";

export interface DocgenConfig {
  include: string[];
  exclude: string[];
  ignoreTypes: string[];
  maxDepth: number;
  resolveMode: "inline" | "reference" | "auto";
  externalTypes: "ignore" | "reference" | "resolve";
  tsconfig: string | undefined;
  tags: Record<string, (value: string) => unknown>;
}

export const DEFAULT_CONFIG: DocgenConfig = {
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["**/node_modules/**", "**/*.test.ts", "**/*.spec.ts"],
  ignoreTypes: [...TYPESCRIPT_IGNORE_TYPES],
  maxDepth: 3,
  resolveMode: "auto",
  externalTypes: "reference",
  tsconfig: undefined,
  tags: {},
};

export function resolveConfig(partial?: Partial<DocgenConfig>): DocgenConfig {
  if (!partial) return { ...DEFAULT_CONFIG };

  const ignoreTypes = partial.ignoreTypes
    ? [...new Set([...DEFAULT_CONFIG.ignoreTypes, ...partial.ignoreTypes])]
    : [...DEFAULT_CONFIG.ignoreTypes];

  return {
    ...DEFAULT_CONFIG,
    ...partial,
    ignoreTypes,
    tags: { ...DEFAULT_CONFIG.tags, ...partial.tags },
  };
}
