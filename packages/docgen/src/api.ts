import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DocSchema, DocEntry } from "./schema";
import type { DocgenConfig } from "./config";
import { resolveConfig } from "./config";
import { parseSource } from "./parser";
import { buildDocEntry } from "./builder";
import { TypeResolver } from "./resolver";
import { attachRelatedToSchema } from "./related-types";

export function getDocs<_T>(): DocSchema {
  throw new Error(
    "getDocs<T>() must be compiled away by @oxc-ts-docgen/vite-plugin. " +
      "Ensure the plugin is configured in your vite.config.ts.",
  );
}

export function generateDocsFromSource(options: {
  source: string;
  typeName: string;
  fileName?: string;
  config?: Partial<DocgenConfig>;
}): DocSchema {
  const config = resolveConfig(options.config);
  const fileName = options.fileName ?? "anonymous.ts";
  const parsed = parseSource(options.source, fileName);
  const resolver = new TypeResolver(config);
  const entry = buildDocEntry(parsed, options.typeName, fileName, config, resolver);

  const entries: DocEntry[] = [];
  if (entry) entries.push(entry);

  const base: DocSchema = { version: 1, entries };
  if (!entry) return { ...base, related: [] };

  return attachRelatedToSchema(base, fileName, resolver, config, parsed);
}

export function generateDocs(options: {
  filePath: string;
  typeName: string;
  config?: Partial<DocgenConfig>;
  resolver?: TypeResolver;
}): DocSchema {
  const config = resolveConfig(options.config);
  const filePath = resolve(options.filePath);
  const resolver = options.resolver ?? new TypeResolver(config);

  const parsed = resolver.parseFileCached(filePath);
  if (!parsed) {
    const source = readFileSync(filePath, "utf-8");
    const freshParsed = parseSource(source, filePath);
    const entry = buildDocEntry(freshParsed, options.typeName, filePath, config, resolver);

    const entries: DocEntry[] = [];
    if (entry) entries.push(entry);
    const base: DocSchema = { version: 1, entries };
    if (!entry) return { ...base, related: [] };

    return attachRelatedToSchema(base, filePath, resolver, config, freshParsed);
  }

  const entry = buildDocEntry(parsed, options.typeName, filePath, config, resolver);

  const entries: DocEntry[] = [];
  if (entry) entries.push(entry);
  const base: DocSchema = { version: 1, entries };
  if (!entry) return { ...base, related: [] };

  return attachRelatedToSchema(base, filePath, resolver, config, parsed);
}
