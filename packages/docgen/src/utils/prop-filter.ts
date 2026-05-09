import type { DocgenConfig, PropFilterContext } from "../public/config";
import type { DocEntry, DocProperty } from "../schema/doc-schema";

import { createFilteredPropertyDebugRecord, emitDebugRecord } from "../public/debug";
import { normalizePath } from "./path-utils";
export const filterEntryProperties = (input: {
  entry: DocEntry;
  config: DocgenConfig;
  rootFile: string;
  inheritedNames?: Set<string>;
}): DocEntry => {
  const { entry, config, rootFile: inputRootFile, inheritedNames } = input;
  const rootFile = normalizePath(inputRootFile);
  const properties = entry.properties.filter((prop) =>
    shouldKeepProperty({
      prop,
      config,
      propertyName: prop.name,
      ownerName: entry.name,
      ownerKind: entry.kind,
      sourceFile: normalizePath(prop.source.filePath),
      rootFile,
      inherited: inheritedNames?.has(prop.name) ?? false,
      external: normalizePath(prop.source.filePath) !== rootFile,
      tags: prop.tags,
    }),
  );
  const type =
    entry.type.kind === "object"
      ? { ...entry.type, properties }
      : entry.kind === "enum" && entry.type.kind === "union"
        ? { ...entry.type, members: properties.map((prop) => prop.type) }
        : entry.type;
  return { ...entry, properties, type };
};
const shouldKeepProperty = (
  input: {
    prop: DocProperty;
    config: DocgenConfig;
  } & PropFilterContext,
): boolean => {
  const { prop, config, ...context } = input;
  if (config.skipPropsWithName.includes(prop.name)) {
    emitFilteredProperty({ config, context, reason: "skipPropsWithName" });
    return false;
  }
  if (config.skipPropsWithoutDoc && prop.description.trim() === "") {
    emitFilteredProperty({ config, context, reason: "skipPropsWithoutDoc" });
    return false;
  }
  if (config.skipPropsFromExternalFiles && context.external) {
    emitFilteredProperty({ config, context, reason: "skipPropsFromExternalFiles" });
    return false;
  }
  if (config.propFilter && !config.propFilter(prop, context)) {
    emitFilteredProperty({ config, context, reason: "propFilter" });
    return false;
  }
  return true;
};
type EmitFilteredPropertyOptions = {
  config: DocgenConfig;
  context: PropFilterContext;
  reason: "skipPropsWithName" | "skipPropsWithoutDoc" | "skipPropsFromExternalFiles" | "propFilter";
};
const emitFilteredProperty = (options: EmitFilteredPropertyOptions): void => {
  const { config, context, reason } = options;
  emitDebugRecord(config, createFilteredPropertyDebugRecord(reason, context));
};
