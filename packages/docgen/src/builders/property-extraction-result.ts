import type { DocgenConfig } from "../public/config";
import type { DocProperty } from "../schema/doc-schema";

import { UNRESOLVED_PROPERTY_NAME } from "./static-property-builder";

export const hasUnresolvedExtraction = (properties: DocProperty[]): boolean => {
  return properties.some(
    (property) => property.name === UNRESOLVED_PROPERTY_NAME && property.type.kind === "unresolved",
  );
};

export const filterUnresolvedExtractionProperties = (
  properties: DocProperty[],
  config: DocgenConfig,
): DocProperty[] => {
  if (config.analysis === "static") {
    return properties;
  }

  return properties.filter(
    (property) =>
      !(property.name === UNRESOLVED_PROPERTY_NAME && property.type.kind === "unresolved"),
  );
};
