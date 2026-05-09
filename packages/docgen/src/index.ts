export type {
  DocSchema,
  DocEntry,
  DocProperty,
  DocType,
  DocSourceLocation,
  DocTypeParam,
  DocFnParam,
  DocTagValue,
  DocTypeReferenceTarget,
  DocHeritageReference,
  DocHeritageReferenceReason,
} from "./schema/doc-schema";
export type { DocgenConfig, DocTagParser, PropFilterContext } from "./public/config";
export type {
  DocgenDebugCallback,
  DocgenDebugRecord,
  DocgenFilteredPropertyDebugRecord,
  DocgenResolutionDebugRecord,
  DocgenSchemaDependencyDebugRecord,
} from "./public/debug";
export { resolveConfig, DEFAULT_CONFIG } from "./public/config";
export {
  generateDocsFromSource,
  generateDocsResultFromSource,
  generateDocs,
  getDocs,
} from "./public/api";
export type {
  DocGenerationResult,
  GenerateDocsFromSourceOptions,
  GetDocs,
  GetDocsBatchEntry,
  GetDocsBatchResult,
  GetDocsTarget,
} from "./public/api";
export {
  DEFAULT_PRESETS,
  TYPESCRIPT_IGNORE_TYPES,
  REACT_IGNORE_TYPES,
  DOM_IGNORE_TYPES,
} from "./public/presets";
export type { DocgenPresetName } from "./public/presets";

/**
 * Plugin-facing API for official bundler adapters.
 *
 * `DocgenProject` is the intended integration point for adapters that need indexing, schema
 * caching, diagnostics, dependency records, and semantic service lifecycle management.
 */
export type {
  DocgenProjectBuildMode,
  DocgenProjectBuildResult,
  DocgenProjectCacheEntry,
  DocgenProjectDependencyRecord,
  DocgenProjectDiagnostic,
  DocgenProjectIndexEntry,
  DocgenProjectOptions,
  DocgenProjectProcessFileResult,
  DocgenProjectResolveImportedTypeOptions,
  DocgenProjectResolveImportPathOptions,
  DocgenProjectResolvedImportedType,
  DocgenProjectSchemaOptions,
  DocgenProjectTypeKeyOptions,
} from "./project/docgen-project";
export { DocgenProject } from "./project/docgen-project";
