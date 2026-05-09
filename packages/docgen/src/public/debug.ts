import type { StaticResolutionStatus } from "../builders/entry-builder";
import type { DocSchemaDependencyRecord } from "../graph/dependency-record-types";
import type { DocEntry } from "../schema/doc-schema";
import type { PropFilterContext } from "./config";

export type DocgenDebugRecord =
  | DocgenResolutionDebugRecord
  | DocgenFilteredPropertyDebugRecord
  | DocgenSchemaDependencyDebugRecord;

export type DocgenResolutionDebugRecord = {
  /**
   * Debug record kind.
   */
  kind: "resolution";
  /**
   * Type name requested by the user or adapter.
   */
  typeName: string;
  /**
   * Source file used as the root resolution context.
   */
  filePath: string;
  /**
   * Configured analysis mode for the request.
   */
  analysis: "hybrid" | "static";
  /**
   * Static OXC resolution status before any semantic fallback replacement.
   */
  staticStatus: StaticResolutionStatus;
  /**
   * Whether TypeScript semantic fallback replaced the static entry.
   */
  usedSemanticFallback: boolean;
  /**
   * Final entry kind when resolution produced an entry.
   */
  entryKind: DocEntry["kind"] | undefined;
};

export type DocgenFilteredPropertyDebugRecord = {
  /**
   * Debug record kind.
   */
  kind: "propertyFiltered";
  /**
   * Filter reason that excluded the property.
   */
  reason:
    | "externalTypes"
    | "skipPropsWithName"
    | "skipPropsWithoutDoc"
    | "skipPropsFromExternalFiles"
    | "propFilter";
  /**
   * Property name that was excluded.
   */
  propertyName: string;
  /**
   * Owner entry name for the filtered property.
   */
  ownerName: string;
  /**
   * Owner entry kind for the filtered property.
   */
  ownerKind: DocEntry["kind"];
  /**
   * Source file that declared the filtered property.
   */
  sourceFile: string;
  /**
   * Root file requested by the current docgen operation.
   */
  rootFile: string;
  /**
   * Whether the filtered property was inherited.
   */
  inherited: boolean;
  /**
   * Whether the filtered property came from outside the root file.
   */
  external: boolean;
};

export type DocgenSchemaDependencyDebugRecord = {
  /**
   * Debug record kind.
   */
  kind: "schemaDependency";
  /**
   * Dependency record collected from the final schema.
   */
  dependency: DocSchemaDependencyRecord;
};

export type DocgenDebugCallback = (record: DocgenDebugRecord) => void;

export const emitDebugRecord = (
  config: { experimentalDebug?: DocgenDebugCallback | undefined },
  record: DocgenDebugRecord,
): void => {
  config.experimentalDebug?.(record);
};

export const createFilteredPropertyDebugRecord = (
  reason: DocgenFilteredPropertyDebugRecord["reason"],
  context: PropFilterContext,
): DocgenFilteredPropertyDebugRecord => {
  return {
    kind: "propertyFiltered",
    reason,
    propertyName: context.propertyName,
    ownerName: context.ownerName,
    ownerKind: context.ownerKind,
    sourceFile: context.sourceFile,
    rootFile: context.rootFile,
    inherited: context.inherited,
    external: context.external,
  };
};
