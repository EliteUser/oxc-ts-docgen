import type { DocgenProjectDependencyRecord } from "@synthfall/oxc-ts-docgen";

export type RegistryDependencyRecordKind =
  | "referenceTarget"
  | "heritageReference"
  | "staticReference";

export type RegistryDependencyRecord = {
  /**
   * Dependency source kind used for debugging registry invalidation.
   */
  kind: RegistryDependencyRecordKind;
  /**
   * Referenced type name that triggered the dependency.
   */
  typeName: string;
  /**
   * Type dependency cache key.
   */
  typeKey: string;
};

export type RegistryDependencyCollectorInput = {
  /**
   * Core schema dependency records collected during schema generation.
   */
  dependencyRecords: DocgenProjectDependencyRecord[];
  /**
   * Registry-specific type cache key factory.
   */
  createTypeKey: (filePath: string, typeName: string) => string;
};

export const collectRegistryTypeDependencies = (
  input: RegistryDependencyCollectorInput,
): Set<string> => {
  return new Set(collectRegistryDependencyRecords(input).map((record) => record.typeKey));
};

export const collectRegistryDependencyRecords = (
  input: RegistryDependencyCollectorInput,
): RegistryDependencyRecord[] => {
  const records: RegistryDependencyRecord[] = [];
  const seen = new Set<string>();

  for (const dependency of input.dependencyRecords) {
    if (!isTypeDependencyRecord(dependency) || !dependency.targetName) {
      continue;
    }

    const record: RegistryDependencyRecord = {
      kind: dependency.kind,
      typeName: dependency.referencedName ?? dependency.targetName,
      typeKey: input.createTypeKey(dependency.filePath, dependency.targetName),
    };
    const key = JSON.stringify(record);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    records.push(record);
  }

  return records;
};

const isTypeDependencyRecord = (
  record: DocgenProjectDependencyRecord,
): record is DocgenProjectDependencyRecord & {
  kind: RegistryDependencyRecordKind;
} => {
  return (
    record.kind === "referenceTarget" ||
    record.kind === "heritageReference" ||
    record.kind === "staticReference"
  );
};
