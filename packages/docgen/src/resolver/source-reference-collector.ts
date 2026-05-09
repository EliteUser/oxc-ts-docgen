import type { DocEntry, DocProperty, DocType } from "../schema/doc-schema";

import { normalizePath } from "../utils/path-utils";

export type ReferencedTypeRecord = {
  /**
   * Referenced type name as it appears in the current source context.
   */
  name: string;
  /**
   * Source files to try when resolving this reference, in priority order.
   */
  sourceFiles: string[];
};

type ReferencedTypeCollector = {
  /**
   * Collected references with enough source context to resolve later.
   */
  records: ReferencedTypeRecord[];
  /**
   * Stable record keys already collected during the current walk.
   */
  seen: Set<string>;
};

type WalkDocTypeReferencesOptions = {
  /**
   * Doc type node to inspect for references.
   */
  type: DocType;
  /**
   * Source files that can resolve references found in this doc type.
   */
  sourceFiles: string[];
  /**
   * Mutable collector for the current entry walk.
   */
  collector: ReferencedTypeCollector;
};

const walkDocTypeReferences = (options: WalkDocTypeReferencesOptions): void => {
  const { type, sourceFiles, collector } = options;

  switch (type.kind) {
    case "reference":
      addReferencedTypeRecord({ collector, name: type.name, sourceFiles });
      for (const arg of type.typeArguments ?? []) {
        walkDocTypeReferences({ type: arg, sourceFiles, collector });
      }
      break;
    case "union":
    case "intersection":
      for (const member of type.members) {
        walkDocTypeReferences({ type: member, sourceFiles, collector });
      }
      break;
    case "array":
      walkDocTypeReferences({ type: type.elementType, sourceFiles, collector });
      break;
    case "tuple":
      for (const element of type.elements) {
        walkDocTypeReferences({ type: element, sourceFiles, collector });
      }
      break;
    case "object":
      for (const property of type.properties) {
        walkPropertyReferences({
          property,
          ownerFile: sourceFiles[0],
          collector,
        });
      }
      break;
    case "function":
      for (const param of type.parameters) {
        walkDocTypeReferences({ type: param.type, sourceFiles, collector });
      }
      walkDocTypeReferences({ type: type.returnType, sourceFiles, collector });
      break;
    case "mapped":
      walkDocTypeReferences({ type: type.constraint, sourceFiles, collector });
      walkDocTypeReferences({ type: type.type, sourceFiles, collector });
      break;
    case "conditional":
      walkDocTypeReferences({ type: type.checkType, sourceFiles, collector });
      walkDocTypeReferences({ type: type.extendsType, sourceFiles, collector });
      walkDocTypeReferences({ type: type.trueType, sourceFiles, collector });
      walkDocTypeReferences({ type: type.falseType, sourceFiles, collector });
      break;
    case "indexedAccess":
      walkDocTypeReferences({ type: type.objectType, sourceFiles, collector });
      walkDocTypeReferences({ type: type.indexType, sourceFiles, collector });
      break;
    case "templateLiteral":
      for (const span of type.spans) {
        if ("type" in span) {
          walkDocTypeReferences({ type: span.type, sourceFiles, collector });
        }
      }
      break;
    case "keyof":
      walkDocTypeReferences({ type: type.type, sourceFiles, collector });
      break;
    case "rest":
      walkDocTypeReferences({ type: type.type, sourceFiles, collector });
      break;
    default:
      break;
  }
};

type AddReferencedTypeRecordOptions = {
  /**
   * Mutable collector for the current entry walk.
   */
  collector: ReferencedTypeCollector;
  /**
   * Referenced type name as it appears in the current source context.
   */
  name: string;
  /**
   * Source files to try when resolving this reference.
   */
  sourceFiles: string[];
};

const addReferencedTypeRecord = (options: AddReferencedTypeRecordOptions): void => {
  const { collector, name, sourceFiles } = options;
  const files = uniqueFiles(sourceFiles);
  const key = `${name}:${files.join("|")}`;

  if (collector.seen.has(key)) {
    return;
  }

  collector.seen.add(key);
  collector.records.push({ name, sourceFiles: files });
};

const compareReferencedTypeRecords = (
  first: ReferencedTypeRecord,
  second: ReferencedTypeRecord,
): number => {
  const nameOrder = first.name.localeCompare(second.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return first.sourceFiles.join("|").localeCompare(second.sourceFiles.join("|"));
};

type WalkPropertyReferencesOptions = {
  /**
   * Property whose type may contain references.
   */
  property: DocProperty;
  /**
   * Entry or object type source file that owns the property.
   */
  ownerFile: string | undefined;
  /**
   * Mutable collector for the current entry walk.
   */
  collector: ReferencedTypeCollector;
};

const walkPropertyReferences = (options: WalkPropertyReferencesOptions): void => {
  const { property, ownerFile, collector } = options;
  const sourceFiles = uniqueFiles([property.source.filePath, ownerFile]);

  walkDocTypeReferences({ type: property.type, sourceFiles, collector });
};

export type CollectReferencedTypeRecordsOptions = {
  /**
   * Entry whose type graph should be scanned for references.
   */
  entry: DocEntry;
  /**
   * File to use when an entry does not carry a source file.
   */
  fallbackFilePath?: string;
};

export const collectReferencedTypeRecords = (
  options: CollectReferencedTypeRecordsOptions,
): ReferencedTypeRecord[] => {
  const { entry, fallbackFilePath } = options;
  const ownerFile = normalizePath(entry.source.filePath || fallbackFilePath || "");
  const collector: ReferencedTypeCollector = { records: [], seen: new Set() };
  const sourceFiles = uniqueFiles([ownerFile]);

  walkDocTypeReferences({ type: entry.type, sourceFiles, collector });

  for (const property of entry.properties) {
    walkPropertyReferences({ property, ownerFile, collector });
  }

  for (const typeParameter of entry.typeParameters) {
    if (typeParameter.constraint) {
      walkDocTypeReferences({ type: typeParameter.constraint, sourceFiles, collector });
    }

    if (typeParameter.default) {
      walkDocTypeReferences({ type: typeParameter.default, sourceFiles, collector });
    }
  }

  return collector.records.sort(compareReferencedTypeRecords);
};

export const collectReferencedTypeNames = (entry: DocEntry): Set<string> => {
  return new Set(
    collectReferencedTypeRecords({
      entry,
      fallbackFilePath: entry.source.filePath,
    }).map((record) => record.name),
  );
};

const uniqueFiles = (files: Array<string | undefined>): string[] => {
  return [...new Set(files.filter((file): file is string => Boolean(file)).map(normalizePath))];
};
