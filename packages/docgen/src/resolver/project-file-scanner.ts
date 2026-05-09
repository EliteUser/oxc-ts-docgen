import { readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import type { DocgenConfig } from "../public/config";

import { matchesGlob, normalizePath } from "../utils/path-utils";
export const scanProjectFiles = (rootDir: string, config: DocgenConfig): string[] => {
  const results: string[] = [];
  scanDirectory({ rootDir, dirPath: rootDir, config, results });
  return results;
};

type ScanDirectoryOptions = {
  /**
   * Root directory used for relative include and exclude matching.
   */
  rootDir: string;
  /**
   * Directory currently being scanned.
   */
  dirPath: string;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Mutable file result list.
   */
  results: string[];
};

const scanDirectory = (options: ScanDirectoryOptions): void => {
  const { rootDir, dirPath, config, results } = options;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = normalizePath(relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (shouldDescendProjectDirectory(relativePath, config)) {
          scanDirectory({ rootDir, dirPath: fullPath, config, results });
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = extname(entry.name);
      if (ext !== ".ts" && ext !== ".tsx") {
        continue;
      }

      if (!shouldIncludeProjectFile(relativePath, config)) {
        continue;
      }

      results.push(fullPath);
    }
  } catch {
    return;
  }
};
const shouldDescendProjectDirectory = (relativePath: string, config: DocgenConfig): boolean => {
  const normalized = normalizePath(relativePath);
  if (!normalized || normalized === ".") {
    return true;
  }
  if (normalized === ".git" || normalized.startsWith(".git/")) {
    return false;
  }
  if (normalized.split("/").includes("node_modules")) {
    return false;
  }
  if (config.exclude.some((pattern) => excludesDirectory(normalized, pattern))) {
    return false;
  }
  if (config.include.length === 0) {
    return true;
  }
  return config.include.some((pattern) => includeCanMatchDirectory(normalized, pattern));
};
const shouldIncludeProjectFile = (relativePath: string, config: DocgenConfig): boolean => {
  if (relativePath.split("/").includes("node_modules")) {
    return false;
  }
  if (relativePath.endsWith(".d.ts")) {
    return false;
  }
  if (
    config.include.length > 0 &&
    !config.include.some((pattern) => matchesGlob(relativePath, pattern))
  ) {
    return false;
  }
  return !config.exclude.some((pattern) => matchesGlob(relativePath, pattern));
};
const excludesDirectory = (relativePath: string, pattern: string): boolean => {
  const normalizedPattern = normalizePath(pattern);
  if (matchesGlob(relativePath, normalizedPattern)) {
    return true;
  }
  if (matchesGlob(`${relativePath}/`, normalizedPattern)) {
    return true;
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    if (matchesDirectoryPrefix(relativePath, prefix)) {
      return true;
    }
  }
  if (normalizedPattern.endsWith("/**/*")) {
    const prefix = normalizedPattern.slice(0, -5);
    if (matchesDirectoryPrefix(relativePath, prefix)) {
      return true;
    }
  }
  return false;
};
const matchesDirectoryPrefix = (relativePath: string, prefixPattern: string): boolean => {
  const prefix = prefixPattern.endsWith("/") ? prefixPattern.slice(0, -1) : prefixPattern;
  return (
    matchesGlob(relativePath, prefix) || matchesGlob(`${relativePath}/index.ts`, `${prefix}/**`)
  );
};
const includeCanMatchDirectory = (relativePath: string, pattern: string): boolean => {
  const normalizedPattern = normalizePath(pattern);
  if (matchesGlob(`${relativePath}/index.ts`, normalizedPattern)) {
    return true;
  }
  if (matchesGlob(`${relativePath}/index.tsx`, normalizedPattern)) {
    return true;
  }
  if (matchesGlob(`${relativePath}/nested/index.ts`, normalizedPattern)) {
    return true;
  }
  if (matchesGlob(`${relativePath}/nested/index.tsx`, normalizedPattern)) {
    return true;
  }

  const staticPrefix = staticDirectoryPrefix(normalizedPattern);
  if (!staticPrefix) {
    return normalizedPattern.startsWith("**/");
  }
  if (staticPrefix === relativePath || staticPrefix.startsWith(`${relativePath}/`)) {
    return true;
  }
  return normalizedPattern.includes("**") && relativePath.startsWith(`${staticPrefix}/`);
};
const staticDirectoryPrefix = (pattern: string): string => {
  const segments = normalizePath(pattern).split("/");
  const prefix: string[] = [];
  for (const segment of segments) {
    if (segment.includes("*") || segment.includes("?")) {
      break;
    }
    prefix.push(segment);
  }
  if (prefix.length === segments.length) {
    prefix.pop();
  }
  return prefix.join("/");
};
