import type { DocSchema, DocType } from "../schema/doc-schema";

export type DocSchemaDependencyRecordKind =
  | "schemaOwner"
  | "entrySource"
  | "relatedEntrySource"
  | "propertySource"
  | "referenceTarget"
  | "heritageReference"
  | "staticReference"
  | "resolverTrace";

export type DocSchemaDependencyRecord = {
  /**
   * Source file that should invalidate the schema when it changes.
   */
  filePath: string;
  /**
   * Why this file is tracked.
   */
  kind: DocSchemaDependencyRecordKind;
  /**
   * Entry whose schema caused the dependency when available.
   */
  entryName?: string;
  /**
   * Property whose source or type caused the dependency when available.
   */
  propertyName?: string;
  /**
   * Reference name as it appears in the schema when available.
   */
  referencedName?: string;
  /**
   * Resolved reference target name when it differs from the displayed name.
   */
  targetName?: string;
  /**
   * Preserved heritage reason when the dependency came from an unexpanded heritage reference.
   */
  heritageReason?: string;
};

export type AddDependencyRecordOptions = {
  /**
   * Mutable dependency record collection.
   */
  records: DocSchemaDependencyRecord[];
  /**
   * Tracks already emitted records to keep output deterministic and compact.
   */
  seen: Set<string>;
  /**
   * Dependency record to append if it has not already been emitted.
   */
  record: DocSchemaDependencyRecord;
};

export type CollectEntryDependencyRecordsOptions = {
  /**
   * Entry to inspect.
   */
  entry: DocSchema["entries"][number];
  /**
   * Whether the entry is primary schema output or a related entry.
   */
  related: boolean;
  /**
   * Mutable dependency record collection.
   */
  records: DocSchemaDependencyRecord[];
  /**
   * Tracks already emitted records.
   */
  seen: Set<string>;
};

export type CollectDocTypeDependencyRecordsOptions = {
  /**
   * Doc type to inspect for reference-target dependencies.
   */
  type: DocType;
  /**
   * Entry whose type graph is being inspected.
   */
  entryName: string;
  /**
   * Property context when the type came from a property.
   */
  propertyName?: string;
  /**
   * Mutable dependency record collection.
   */
  records: DocSchemaDependencyRecord[];
  /**
   * Tracks already emitted records.
   */
  seen: Set<string>;
};
