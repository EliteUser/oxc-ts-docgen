export type {
  DocSchema,
  DocEntry,
  DocProperty,
  DocType,
  DocSourceLocation,
  DocTypeParam,
  DocFnParam,
} from "./schema";

export type { DocgenConfig } from "./config";
export { resolveConfig, DEFAULT_CONFIG } from "./config";

export { generateDocsFromSource, generateDocs, getDocs } from "./api";

export { TypeResolver } from "./resolver";

export type { ParsedSource } from "./parser";
export {
  findAllTypeDeclarations,
  findExportedTypeDeclarations,
  findTypeDeclaration,
} from "./parser";
export { buildDocEntry } from "./builder";
export {
  collectReferencedTypeNames,
  buildRelatedDocEntries,
  attachRelatedToSchema,
} from "./related-types";

export { TYPESCRIPT_IGNORE_TYPES, REACT_IGNORE_TYPES, DOM_IGNORE_TYPES } from "./presets";
