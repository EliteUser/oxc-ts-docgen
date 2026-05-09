import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocgenConfig } from "./public/config";

import { generateDocsResultWithResolver } from "./public/api";
import { resolveConfig } from "./public/config";
import { formatResolverDiagnostic } from "./resolver/module-resolver";
import { TypeResolver } from "./resolver/resolver";
import { matchesGlob, normalizePath } from "./utils/path-utils";
export type CliIO = {
  cwd: string;
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
};
type CliConfigFile = Partial<
  Pick<
    DocgenConfig,
    | "analysis"
    | "presets"
    | "include"
    | "exclude"
    | "ignoreTypes"
    | "maxDepth"
    | "externalTypes"
    | "tsconfig"
    | "skipPropsWithName"
    | "skipPropsWithoutDoc"
    | "skipPropsFromExternalFiles"
  >
>;
const printUsage = (stdout: Pick<typeof console, "log">): void => {
  stdout.log(`
Usage: oxc-ts-docgen <file> <typeName> [options]

Arguments:
  file         Path to the TypeScript file
  typeName     Name of the type to document

Options:
  --config <file>              Load JSON config file
  --include <patterns>         Comma-separated file include patterns
  --exclude <patterns>         Comma-separated file exclude patterns
  --ignore <types>             Comma-separated list of types to ignore
  --max-depth <n>              Maximum resolution depth (default: 3)
  --external-types <policy>    ignore, reference, or resolve
  --tsconfig <file>            Explicit tsconfig path
  --allow-empty                Print an empty schema for unresolved type names
  --fail-on-diagnostics        Fail when resolver diagnostics are produced
  --pretty                     Pretty-print output (default)
  --compact                    Compact JSON output
  --help, -h                   Show this help message

Examples:
  oxc-ts-docgen src/Button.ts ButtonProps
  oxc-ts-docgen src/Button.ts ButtonProps --config docgen.config.json
  oxc-ts-docgen src/Button.ts ButtonProps --ignore HTMLAttributes,CSSProperties
  oxc-ts-docgen src/Button.ts ButtonProps --external-types resolve
  oxc-ts-docgen src/Button.ts ButtonProps --compact
`);
};
export const runCli = (args: string[], io: CliIO = defaultIO()): number => {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage(io.stdout);
    return 0;
  }
  const file = args[0];
  const typeName = args[1];
  if (!file || !typeName) {
    io.stderr.error(
      "Error [invalid-arguments]: Both <file> and <typeName> arguments are required.",
    );
    printUsage(io.stdout);
    return 1;
  }
  try {
    const parsed = parseCliOptions(args.slice(2), io.cwd);
    const filePath = resolve(io.cwd, file);
    const config = resolveConfig(parsed.config);
    const relativeFilePath = normalizePath(filePath).startsWith(`${normalizePath(io.cwd)}/`)
      ? normalizePath(filePath).slice(normalizePath(io.cwd).length + 1)
      : normalizePath(file);
    if (!isIncludedFile(relativeFilePath, config)) {
      io.stderr.error(
        `Error [file-excluded]: ${relativeFilePath} is excluded by the active include/exclude patterns.`,
      );
      return 2;
    }
    const resolver = new TypeResolver(config);
    const result = generateDocsResultWithResolver({
      filePath,
      typeName,
      config,
      resolver,
    });
    if (result.schema.entries.length === 0 && !parsed.allowEmpty) {
      io.stderr.error(
        `Error [unresolved-type]: Could not resolve type "${typeName}" in ${filePath}.`,
      );
      return 2;
    }
    const diagnostics = result.diagnostics;
    if (diagnostics.length > 0) {
      const message = [
        "Resolver diagnostics:",
        ...diagnostics.map((diagnostic) => `- ${formatResolverDiagnostic(diagnostic)}`),
      ].join("\n");
      if (parsed.failOnDiagnostics) {
        io.stderr.error(`Error [resolver-diagnostics]: ${message}`);
        return 2;
      }
      io.stderr.error(message);
    }
    const output = parsed.compact
      ? JSON.stringify(result.schema)
      : JSON.stringify(result.schema, null, 2);
    io.stdout.log(output);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.error(`Error ${classifyError(message)}: ${message}`);
    return 1;
  }
};
const parseCliOptions = (
  args: string[],
  cwd: string,
): {
  config: Partial<DocgenConfig>;
  compact: boolean;
  allowEmpty: boolean;
  failOnDiagnostics: boolean;
} => {
  const configPath = optionValue(args, "--config");
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
  const config: Partial<DocgenConfig> = resolvedConfigPath
    ? normalizeConfigFilePaths(loadConfigFile(resolvedConfigPath), dirname(resolvedConfigPath))
    : {};
  const include = optionList(args, "--include");
  if (include) config.include = include;
  const exclude = optionList(args, "--exclude");
  if (exclude) {
    config.exclude = exclude;
  }
  const ignoreTypes = optionList(args, "--ignore");
  if (ignoreTypes) config.ignoreTypes = ignoreTypes;
  const maxDepthValue = optionValue(args, "--max-depth");
  if (maxDepthValue !== undefined) {
    const maxDepth = Number(maxDepthValue);
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      throw new Error(
        `Invalid --max-depth value "${maxDepthValue}". Expected a non-negative integer.`,
      );
    }
    config.maxDepth = maxDepth;
  }
  const externalTypes = optionValue(args, "--external-types");
  if (externalTypes !== undefined) {
    if (
      externalTypes !== "ignore" &&
      externalTypes !== "reference" &&
      externalTypes !== "resolve"
    ) {
      throw new Error(
        `Invalid --external-types value "${externalTypes}". Expected ignore, reference, or resolve.`,
      );
    }
    config.externalTypes = externalTypes;
  }
  const tsconfig = optionValue(args, "--tsconfig");
  if (tsconfig !== undefined) config.tsconfig = resolve(cwd, tsconfig);
  return {
    config,
    compact: args.includes("--compact"),
    allowEmpty: args.includes("--allow-empty"),
    failOnDiagnostics: args.includes("--fail-on-diagnostics"),
  };
};
const loadConfigFile = (filePath: string): CliConfigFile => {
  if (!existsSync(filePath)) {
    throw new Error(`Config file does not exist: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config JSON in ${filePath}: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid config in ${filePath}: root value must be an object.`);
  }
  return parsed as CliConfigFile;
};
const normalizeConfigFilePaths = (
  config: CliConfigFile,
  configDir: string,
): Partial<DocgenConfig> => {
  if (!config.tsconfig || isAbsolute(config.tsconfig)) {
    return config;
  }

  return { ...config, tsconfig: resolve(configDir, config.tsconfig) };
};
const optionValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
};
const optionList = (args: string[], name: string): string[] | undefined => {
  const value = optionValue(args, name);
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};
const classifyError = (message: string): string => {
  if (message.startsWith("Parse errors")) {
    return "[parse-failure]";
  }
  if (message.includes("Config") || message.includes("config")) {
    return "[invalid-configuration]";
  }
  if (message.includes("Invalid --")) {
    return "[invalid-arguments]";
  }
  return "[docgen-failure]";
};
const isIncludedFile = (path: string, config: DocgenConfig): boolean => {
  const normalized = normalizePath(path);
  if (
    config.include.length > 0 &&
    !config.include.some((pattern) => matchesGlob(normalized, pattern))
  ) {
    return false;
  }
  return !config.exclude.some((pattern) => matchesGlob(normalized, pattern));
};
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
const defaultIO = (): CliIO => {
  return {
    cwd: process.cwd(),
    stdout: console,
    stderr: console,
  };
};

const isCliEntryPoint = (): boolean => {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
};

if (isCliEntryPoint()) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}
