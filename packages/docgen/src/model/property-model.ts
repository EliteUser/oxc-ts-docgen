import type { DocProperty } from "../schema/doc-schema";

import { normalizePath } from "../utils/path-utils";
export type PropertyProvenanceKind = "static" | "semantic";
export type PropertyProvenance = {
  kind: PropertyProvenanceKind;
  filePath: string;
};
export type NormalizedDocProperty = DocProperty & {
  provenance: PropertyProvenance;
  dependencies: string[];
};
export type NormalizeDocPropertyInput = DocProperty & {
  provenance: PropertyProvenance;
  dependencies?: string[];
};
export const normalizeDocProperty = (input: NormalizeDocPropertyInput): NormalizedDocProperty => {
  const source = {
    ...input.source,
    filePath: normalizePath(input.source.filePath),
  };
  const provenance = {
    ...input.provenance,
    filePath: normalizePath(input.provenance.filePath),
  };
  const dependencies = uniqueNormalizedPaths([
    provenance.filePath,
    source.filePath,
    ...(input.dependencies ?? []),
  ]);
  return {
    name: input.name,
    type: input.type,
    optional: input.optional,
    readonly: input.readonly,
    description: input.description,
    tags: input.tags,
    defaultValue: input.defaultValue,
    source,
    provenance,
    dependencies,
  };
};
export const emitDocProperty = (property: NormalizedDocProperty): DocProperty => {
  return {
    name: property.name,
    type: property.type,
    optional: property.optional,
    readonly: property.readonly,
    description: property.description,
    tags: property.tags,
    defaultValue: property.defaultValue,
    source: property.source,
  };
};
export const emitDocProperties = (properties: NormalizedDocProperty[]): DocProperty[] => {
  return properties.map(emitDocProperty);
};
const uniqueNormalizedPaths = (paths: string[]): string[] => {
  return [...new Set(paths.map(normalizePath))];
};
