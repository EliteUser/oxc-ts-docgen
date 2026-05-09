import type { DocgenConfig } from "../public/config";
import type { ParsedSource } from "../resolver/parser";
import type { TypeResolver } from "../resolver/resolver";
import type { DocSchema } from "../schema/doc-schema";
import type {
  AddDependencyRecordOptions,
  CollectDocTypeDependencyRecordsOptions,
  CollectEntryDependencyRecordsOptions,
  DocSchemaDependencyRecord,
  DocSchemaDependencyRecordKind,
} from "./dependency-record-types";

import { collectStaticTypeReferenceNames } from "../model/static-type-references";
import { isIgnoredTypeName } from "../resolver/ignored-types";
import { findTypeDeclaration } from "../resolver/parser";
import { collectReferencedTypeRecords } from "../resolver/source-reference-collector";
import { normalizePath } from "../utils/path-utils";

export type CollectResolvedDocSchemaDependencyRecordsOptions = {
  /**
   * Schema to inspect for source and type dependencies.
   */
  schema: DocSchema;
  /**
   * Source file that owns the requested schema build.
   */
  ownerFile: string;
  /**
   * Parsed source for the requested type file.
   */
  parsed: ParsedSource;
  /**
   * Resolver used to recover resolver trace files for references.
   */
  resolver: TypeResolver;
  /**
   * Resolved docgen configuration used for ignore policy.
   */
  config: DocgenConfig;
};

export const collectDocSchemaFileDependencies = (
  schema: DocSchema,
  ownerFile: string,
): Set<string> => {
  const records = collectDocSchemaDependencyRecords(schema, ownerFile);
  return new Set(records.map((record) => record.filePath));
};

export const collectDocSchemaDependencyRecords = (
  schema: DocSchema,
  ownerFile: string,
): DocSchemaDependencyRecord[] => {
  const records: DocSchemaDependencyRecord[] = [];
  const seen = new Set<string>();

  addDependencyRecord({
    records,
    seen,
    record: {
      kind: "schemaOwner",
      filePath: ownerFile,
    },
  });

  for (const entry of schema.entries) {
    collectEntryDependencyRecords({ entry, related: false, records, seen });
  }

  for (const entry of schema.related ?? []) {
    collectEntryDependencyRecords({ entry, related: true, records, seen });
  }

  return records;
};

export const collectResolvedDocSchemaDependencyRecords = (
  options: CollectResolvedDocSchemaDependencyRecordsOptions,
): DocSchemaDependencyRecord[] => {
  const { schema, ownerFile, parsed, resolver, config } = options;
  const records: DocSchemaDependencyRecord[] = [];
  const seen = new Set<string>();

  for (const record of collectDocSchemaDependencyRecords(schema, ownerFile)) {
    addDependencyRecord({ records, seen, record });
  }

  const primary = schema.entries[0];
  if (!primary) {
    return records;
  }

  for (const reference of collectReferencedTypeRecords({
    entry: primary,
    fallbackFilePath: ownerFile,
  })) {
    addResolvedTypeDependency({
      records,
      seen,
      resolver,
      config,
      parsed,
      ownerFile,
      entryName: primary.name,
      typeName: reference.name,
      sourceFiles: reference.sourceFiles,
      recordKind: undefined,
    });
  }

  const found = findTypeDeclaration(parsed, primary.name);
  if (!found) {
    return records;
  }

  for (const typeName of collectStaticTypeReferenceNames(found.decl)) {
    addResolvedTypeDependency({
      records,
      seen,
      resolver,
      config,
      parsed,
      ownerFile,
      entryName: primary.name,
      typeName,
      sourceFiles: [ownerFile],
      recordKind: "staticReference",
    });
  }

  return records;
};

const collectEntryDependencyRecords = (options: CollectEntryDependencyRecordsOptions): void => {
  const { entry, related, records, seen } = options;

  addDependencyRecord({
    records,
    seen,
    record: {
      kind: related ? "relatedEntrySource" : "entrySource",
      filePath: entry.source.filePath,
      entryName: entry.name,
    },
  });

  for (const heritage of entry.heritage ?? []) {
    if (!heritage.target) {
      continue;
    }

    addDependencyRecord({
      records,
      seen,
      record: {
        kind: "heritageReference",
        filePath: heritage.target.filePath,
        entryName: entry.name,
        referencedName: heritage.name,
        targetName: heritage.target.name,
        heritageReason: heritage.reason,
      },
    });
  }

  for (const property of entry.properties) {
    addDependencyRecord({
      records,
      seen,
      record: {
        kind: "propertySource",
        filePath: property.source.filePath,
        entryName: entry.name,
        propertyName: property.name,
      },
    });
    collectDocTypeDependencyRecords({
      type: property.type,
      entryName: entry.name,
      propertyName: property.name,
      records,
      seen,
    });
  }

  collectDocTypeDependencyRecords({ type: entry.type, entryName: entry.name, records, seen });

  for (const typeParam of entry.typeParameters) {
    if (typeParam.constraint) {
      collectDocTypeDependencyRecords({
        type: typeParam.constraint,
        entryName: entry.name,
        records,
        seen,
      });
    }

    if (typeParam.default) {
      collectDocTypeDependencyRecords({
        type: typeParam.default,
        entryName: entry.name,
        records,
        seen,
      });
    }
  }
};

type AddResolvedTypeDependencyOptions = {
  /**
   * Mutable dependency record collection.
   */
  records: DocSchemaDependencyRecord[];
  /**
   * Tracks already emitted records.
   */
  seen: Set<string>;
  /**
   * Resolver used for reference lookup.
   */
  resolver: TypeResolver;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Parsed source for the requested type file.
   */
  parsed: ParsedSource;
  /**
   * Source file that owns the requested schema build.
   */
  ownerFile: string;
  /**
   * Entry that owns the reference.
   */
  entryName: string;
  /**
   * Referenced type name to resolve.
   */
  typeName: string;
  /**
   * Source files to try for the reference.
   */
  sourceFiles: string[];
  /**
   * Optional type dependency record to emit in addition to resolver traces.
   */
  recordKind: Extract<DocSchemaDependencyRecordKind, "staticReference"> | undefined;
};
const addResolvedTypeDependency = (options: AddResolvedTypeDependencyOptions): void => {
  const { records, seen, config, ownerFile, entryName, typeName, recordKind } = options;
  if (isIgnoredTypeName({ config, name: typeName })) {
    return;
  }

  const resolved = resolveTypeFromSourceFiles(options);
  if (!resolved) {
    return;
  }

  if (recordKind) {
    addDependencyRecord({
      records,
      seen,
      record: {
        kind: recordKind,
        filePath: resolved.filePath,
        entryName,
        referencedName: typeName,
        targetName: resolved.decl.id.name,
      },
    });
  }

  for (const sourceFile of resolved.sourceFiles) {
    if (normalizePath(sourceFile) === normalizePath(ownerFile)) {
      continue;
    }

    addDependencyRecord({
      records,
      seen,
      record: {
        kind: "resolverTrace",
        filePath: sourceFile,
        entryName,
        referencedName: typeName,
        targetName: resolved.decl.id.name,
      },
    });
  }
};

const resolveTypeFromSourceFiles = (options: AddResolvedTypeDependencyOptions) => {
  const { resolver, parsed, ownerFile, typeName, sourceFiles } = options;

  for (const sourceFile of uniqueFiles(sourceFiles)) {
    const fromParsed =
      normalizePath(sourceFile) === normalizePath(ownerFile)
        ? parsed
        : resolver.parseFileCached(sourceFile);

    if (!fromParsed) {
      continue;
    }

    const resolved = resolver.resolveTypeReference({
      typeName,
      fromFile: sourceFile,
      fromParsed,
    });

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const uniqueFiles = (files: string[]): string[] => {
  return [...new Set(files.map(normalizePath))];
};

const collectDocTypeDependencyRecords = (options: CollectDocTypeDependencyRecordsOptions): void => {
  const { type, entryName, propertyName, records, seen } = options;

  switch (type.kind) {
    case "reference":
      if (type.target) {
        addDependencyRecord({
          records,
          seen,
          record: {
            kind: "referenceTarget",
            filePath: type.target.filePath,
            entryName,
            propertyName,
            referencedName: type.name,
            targetName: type.target.name,
          },
        });
      }

      for (const arg of type.typeArguments ?? []) {
        collectDocTypeDependencyRecords({ type: arg, entryName, propertyName, records, seen });
      }
      break;
    case "union":
    case "intersection":
      for (const member of type.members) {
        collectDocTypeDependencyRecords({ type: member, entryName, propertyName, records, seen });
      }
      break;
    case "array":
      collectDocTypeDependencyRecords({
        type: type.elementType,
        entryName,
        propertyName,
        records,
        seen,
      });
      break;
    case "tuple":
      for (const element of type.elements) {
        collectDocTypeDependencyRecords({ type: element, entryName, propertyName, records, seen });
      }
      break;
    case "object":
      for (const property of type.properties) {
        addDependencyRecord({
          records,
          seen,
          record: {
            kind: "propertySource",
            filePath: property.source.filePath,
            entryName,
            propertyName: property.name,
          },
        });
        collectDocTypeDependencyRecords({
          type: property.type,
          entryName,
          propertyName: property.name,
          records,
          seen,
        });
      }
      break;
    case "function":
      for (const parameter of type.parameters) {
        collectDocTypeDependencyRecords({
          type: parameter.type,
          entryName,
          propertyName,
          records,
          seen,
        });
      }
      collectDocTypeDependencyRecords({
        type: type.returnType,
        entryName,
        propertyName,
        records,
        seen,
      });
      break;
    case "mapped":
      collectDocTypeDependencyRecords({
        type: type.constraint,
        entryName,
        propertyName,
        records,
        seen,
      });
      collectDocTypeDependencyRecords({ type: type.type, entryName, propertyName, records, seen });
      break;
    case "conditional":
      collectDocTypeDependencyRecords({
        type: type.checkType,
        entryName,
        propertyName,
        records,
        seen,
      });
      collectDocTypeDependencyRecords({
        type: type.extendsType,
        entryName,
        propertyName,
        records,
        seen,
      });
      collectDocTypeDependencyRecords({
        type: type.trueType,
        entryName,
        propertyName,
        records,
        seen,
      });
      collectDocTypeDependencyRecords({
        type: type.falseType,
        entryName,
        propertyName,
        records,
        seen,
      });
      break;
    case "indexedAccess":
      collectDocTypeDependencyRecords({
        type: type.objectType,
        entryName,
        propertyName,
        records,
        seen,
      });
      collectDocTypeDependencyRecords({
        type: type.indexType,
        entryName,
        propertyName,
        records,
        seen,
      });
      break;
    case "templateLiteral":
      for (const span of type.spans) {
        if ("type" in span) {
          collectDocTypeDependencyRecords({
            type: span.type,
            entryName,
            propertyName,
            records,
            seen,
          });
        }
      }
      break;
    case "keyof":
    case "rest":
      collectDocTypeDependencyRecords({ type: type.type, entryName, propertyName, records, seen });
      break;
    default:
      break;
  }
};

const addDependencyRecord = (options: AddDependencyRecordOptions): void => {
  const { records, seen, record } = options;
  const normalized: DocSchemaDependencyRecord = {
    ...record,
    filePath: normalizePath(record.filePath),
  };
  const key = JSON.stringify(normalized);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  records.push(normalized);
};
