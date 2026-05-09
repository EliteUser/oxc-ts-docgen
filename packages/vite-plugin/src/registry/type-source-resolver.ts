import type { Program, TSType } from "oxc-parser";

export type TypeSourceImportResolver = {
  /**
   * Resolve an imported type declaration to its owner file and declaration name.
   */
  resolveImportedTypeSource: (
    options: ResolveImportedTypeSourceOptions,
  ) => ResolvedImportedTypeSource | undefined;
  /**
   * Return files inspected while resolving an imported type, even when the type is not exported.
   */
  resolveImportedTypeDependencies?: (options: ResolveImportedTypeSourceOptions) => string[];
  /**
   * Resolve an import specifier to a concrete source file when declaration lookup fails.
   */
  resolveImportPath: (options: ResolveImportPathOptions) => string | undefined;
};

export type ResolvedImportedTypeSource = {
  /**
   * Source file where the imported type declaration was found.
   */
  filePath: string;
  /**
   * Resolved declaration name, after export aliasing.
   */
  typeName: string;
  /**
   * Files traversed while resolving the imported type.
   */
  sourceFiles: string[];
};

export type ResolveImportedTypeSourceOptions = {
  /**
   * Import specifier from the consuming module.
   */
  specifier: string;
  /**
   * Imported type name to resolve.
   */
  importedName: string;
  /**
   * File that owns the import declaration.
   */
  fromFile: string;
};

export type ResolveImportPathOptions = {
  /**
   * Import specifier from the consuming module.
   */
  specifier: string;
  /**
   * File that owns the import declaration.
   */
  fromFile: string;
};

export type ResolvedExportedTarget = {
  /**
   * Resolution status for a valid exported symbol target.
   */
  status: "resolved";
  /**
   * Source file where the exported type declaration was found.
   */
  filePath: string;
  /**
   * Declaration name after export alias resolution.
   */
  typeName: string;
  /**
   * Files traversed while resolving the exported target.
   */
  deps: string[];
};
export type ModuleResolvedSymbolUnexportedTarget = {
  /**
   * Resolution status when the module exists but does not export the requested symbol.
   */
  status: "moduleResolvedSymbolUnexported";
  /**
   * Resolved module file that should be tracked for HMR recovery.
   */
  filePath: string;
  /**
   * Requested symbol name.
   */
  typeName: string;
  /**
   * Recovery dependency files.
   */
  deps: string[];
};
export type ModuleUnresolvedTarget = {
  /**
   * Resolution status when the import specifier cannot be resolved to a module.
   */
  status: "moduleUnresolved";
  /**
   * Requested symbol name.
   */
  typeName: string;
  /**
   * Recovery dependency files.
   */
  deps: [];
};
export type ExportedTargetResolution =
  | ResolvedExportedTarget
  | ModuleResolvedSymbolUnexportedTarget
  | ModuleUnresolvedTarget;
export type TypeSourceResolution = {
  /**
   * Import specifier from the consuming module.
   */
  importSource: string;
  /**
   * Imported symbol name after local alias lookup.
   */
  importedName: string;
  /**
   * Exported-target resolution result.
   */
  target: ExportedTargetResolution;
};
export type ResolveExportedTargetOptions = {
  /**
   * Import specifier from the consuming module.
   */
  specifier: string;
  /**
   * Exported symbol name to resolve.
   */
  importedName: string;
  /**
   * File that owns the import-like target.
   */
  fromFile: string;
  /**
   * Resolver used for exported type and module-path lookup.
   */
  resolver: TypeSourceImportResolver;
};
export type ResolveTypeSourceOptions = {
  typeName: string;
  program: Program;
  currentFile: string;
  resolver: TypeSourceImportResolver;
};
export const extractExactTypeName = (typeArg: TSType): string | undefined => {
  if (typeArg.type !== "TSTypeReference") {
    return undefined;
  }
  if (typeArg.typeArguments && typeArg.typeArguments.params.length > 0) {
    return undefined;
  }
  const typeName = typeArg.typeName;
  return typeName.type === "Identifier" ? typeName.name : undefined;
};
export const resolveExportedTarget = (
  options: ResolveExportedTargetOptions,
): ExportedTargetResolution => {
  const { specifier, importedName, fromFile, resolver } = options;
  const resolved = resolver.resolveImportedTypeSource({
    specifier,
    importedName,
    fromFile,
  });
  if (resolved) {
    return {
      status: "resolved",
      filePath: resolved.filePath,
      typeName: resolved.typeName,
      deps: resolved.sourceFiles,
    };
  }
  const dependencyOptions = {
    specifier,
    importedName,
    fromFile,
  };
  const dependencyFiles = resolver.resolveImportedTypeDependencies?.(dependencyOptions) ?? [];
  const unresolvedSourceFile =
    dependencyFiles[0] ??
    resolver.resolveImportPath({
      specifier,
      fromFile,
    });
  if (!unresolvedSourceFile) {
    return {
      status: "moduleUnresolved",
      typeName: importedName,
      deps: [],
    };
  }
  return {
    status: "moduleResolvedSymbolUnexported",
    filePath: unresolvedSourceFile,
    typeName: importedName,
    deps: dependencyFiles.length > 0 ? dependencyFiles : [unresolvedSourceFile],
  };
};
export const resolveTypeSource = (
  options: ResolveTypeSourceOptions,
): TypeSourceResolution | undefined => {
  const { typeName, program, currentFile, resolver } = options;
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") {
      continue;
    }
    for (const spec of stmt.specifiers ?? []) {
      let localName: string | undefined;
      let importedName: string | undefined;
      if (spec.type === "ImportSpecifier") {
        localName = spec.local.name;
        importedName = spec.imported.type === "Identifier" ? spec.imported.name : spec.local.name;
      } else if (spec.type === "ImportDefaultSpecifier") {
        localName = spec.local.name;
        importedName = "default";
      }
      if (localName !== typeName) {
        continue;
      }
      const importSource = stmt.source.value;
      const importedTypeName = importedName ?? typeName;
      return {
        importSource,
        importedName: importedTypeName,
        target: resolveExportedTarget({
          specifier: importSource,
          importedName: importedTypeName,
          fromFile: currentFile,
          resolver,
        }),
      };
    }
  }
  return undefined;
};
