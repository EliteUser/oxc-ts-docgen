import type { DocgenConfig } from "../public/config";
import type { DocEntry, DocProperty } from "../schema/doc-schema";

import { createFilteredPropertyDebugRecord, emitDebugRecord } from "../public/debug";
import { normalizePath } from "../utils/path-utils";
import { isExternalPath } from "./semantic-source";

type SemanticPropertyPolicyContext = {
  /**
   * Effective docgen config used for nested semantic property filtering.
   */
  config: Pick<DocgenConfig, "externalTypes" | "skipPropsWithName" | "skipPropsWithoutDoc">;
};

export type ShouldKeepSemanticPropertyOptions = {
  /**
   * Semantic property candidate before nested filtering.
   */
  prop: DocProperty;
  /**
   * Shared semantic conversion context.
   */
  context: SemanticPropertyPolicyContext;
};

export const shouldKeepSemanticProperty = (options: ShouldKeepSemanticPropertyOptions): boolean => {
  const { prop, context } = options;

  if (context.config.skipPropsWithName.includes(prop.name)) {
    return false;
  }

  if (context.config.skipPropsWithoutDoc && prop.description.trim() === "") {
    return false;
  }

  if (context.config.externalTypes !== "resolve" && isExternalPath(prop.source.filePath)) {
    return false;
  }

  return true;
};

export type ShouldKeepSemanticExternalPropertyOptions = {
  /**
   * Semantic property candidate before external package filtering.
   */
  prop: DocProperty;
  /**
   * Resolved docgen configuration.
   */
  config: DocgenConfig;
  /**
   * Root file requested by the current docgen operation.
   */
  rootFile: string;
  /**
   * Entry receiving semantic fallback properties.
   */
  owner: DocEntry;
};

export const shouldKeepSemanticExternalProperty = (
  options: ShouldKeepSemanticExternalPropertyOptions,
): boolean => {
  const { prop, config, rootFile, owner } = options;

  if (config.externalTypes === "resolve") {
    return true;
  }

  if (!isExternalPath(prop.source.filePath)) {
    return true;
  }

  emitDebugRecord(
    config,
    createFilteredPropertyDebugRecord("externalTypes", {
      propertyName: prop.name,
      ownerName: owner.name,
      ownerKind: owner.kind,
      sourceFile: normalizePath(prop.source.filePath),
      rootFile,
      inherited: false,
      external: true,
      tags: prop.tags,
    }),
  );

  return false;
};
