import type { Comment, ParseResult, EcmaScriptModule } from "oxc-parser";
import type {
  Program,
  Statement,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  TSEnumDeclaration,
} from "oxc-parser";

import { parseSync } from "oxc-parser";
export type ImportInfo = {
  source: string;
  importedName: string | undefined;
};
export type ReExportInfo = {
  source: string;
  importedName: string;
};
export type ParsedSource = {
  program: Program;
  comments: Comment[];
  module: EcmaScriptModule;
  source: string;
  fileName: string;
  index: ParsedSourceIndex;
};
export type ParsedSourceIndex = {
  declarationsByName: Map<string, FoundDeclaration>;
  importsByLocalName: Map<string, ImportInfo>;
  localExportsByName: Map<string, string>;
  reExportsByName: Map<string, ReExportInfo[]>;
  exportAllSources: string[];
  defaultExportName: string | undefined;
  typeNames: string[];
  exportedTypeNames: Set<string>;
  lineStarts: number[];
  jsdocComments: Comment[];
};
export const parseSource = (source: string, fileName: string): ParsedSource => {
  const lang = inferLang(fileName);
  const result: ParseResult = parseSync(fileName, source, {
    lang,
    sourceType: "module",
    preserveParens: false,
  });
  const errors = result.errors;
  if (errors.length > 0) {
    const msg = errors.map((e) => e.codeframe ?? e.message).join("\n");
    throw new Error(`Parse errors in ${fileName}:\n${msg}`);
  }
  const base = {
    program: result.program,
    comments: result.comments,
    module: result.module,
    source,
    fileName,
  };
  const index = buildParsedSourceIndex(base);
  return {
    ...base,
    index,
  };
};
const inferLang = (fileName: string): "ts" | "tsx" | "js" | "jsx" => {
  if (fileName.endsWith(".tsx")) {
    return "tsx";
  }
  if (fileName.endsWith(".jsx")) {
    return "jsx";
  }
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs"))
    return "js";
  return "ts";
};
export type FoundDeclaration = {
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration;
  /**
   * Start of the outermost statement (including `export` keyword).
   */
  statementStart: number;
  exported: boolean;
};
export const findTypeDeclaration = (
  parsed: ParsedSource,
  typeName: string,
): FoundDeclaration | undefined => {
  return parsed.index.declarationsByName.get(typeName);
};
export const findAllTypeDeclarations = (parsed: ParsedSource): string[] => {
  return [...parsed.index.typeNames];
};
export const findExportedTypeDeclarations = (parsed: ParsedSource): string[] => {
  return [...parsed.index.exportedTypeNames];
};
const buildParsedSourceIndex = (parsed: Omit<ParsedSource, "index">): ParsedSourceIndex => {
  const declarationsByName = new Map<string, FoundDeclaration>();
  const typeNames: string[] = [];
  const exportedTypeNames = new Set<string>();
  for (const stmt of parsed.program.body) {
    collectTypeDeclarations({
      stmt,
      statementStart: stmt.start,
      exported: false,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    });
  }
  const exportIndex = buildExportIndex(parsed);
  for (const localName of exportIndex.localExportsByName.values()) {
    if (declarationsByName.has(localName)) exportedTypeNames.add(localName);
  }
  return {
    declarationsByName,
    importsByLocalName: buildImportIndex(parsed),
    ...exportIndex,
    typeNames,
    exportedTypeNames,
    lineStarts: buildLineStarts(parsed.source),
    jsdocComments: parsed.comments
      .filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
      .sort((a, b) => a.end - b.end),
  };
};
type ExportIndex = {
  localExportsByName: Map<string, string>;
  reExportsByName: Map<string, ReExportInfo[]>;
  exportAllSources: string[];
  defaultExportName: string | undefined;
};
type CollectTypeDeclarationsOptions = {
  stmt: Statement;
  statementStart: number;
  exported: boolean;
  declarationsByName: Map<string, FoundDeclaration>;
  typeNames: string[];
  exportedTypeNames: Set<string>;
};
const collectTypeDeclarations = (options: CollectTypeDeclarationsOptions): void => {
  const { stmt, statementStart, exported, declarationsByName, typeNames, exportedTypeNames } =
    options;
  if (stmt.type === "TSInterfaceDeclaration") {
    addDeclaration({
      name: stmt.id.name,
      decl: stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    });
  } else if (stmt.type === "TSTypeAliasDeclaration") {
    addDeclaration({
      name: stmt.id.name,
      decl: stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    });
  } else if (stmt.type === "TSEnumDeclaration") {
    addDeclaration({
      name: stmt.id.name,
      decl: stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    });
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    collectTypeDeclarations({
      stmt: stmt.declaration as Statement,
      statementStart,
      exported: true,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    });
  } else if (stmt.type === "ExportDefaultDeclaration") {
    const decl = stmt.declaration as {
      type: string;
      id?: {
        name: string;
      };
    };
    if (
      (decl.type === "TSInterfaceDeclaration" ||
        decl.type === "TSTypeAliasDeclaration" ||
        decl.type === "TSEnumDeclaration") &&
      decl.id
    ) {
      addDeclaration({
        name: decl.id.name,
        decl: stmt.declaration as
          | TSInterfaceDeclaration
          | TSTypeAliasDeclaration
          | TSEnumDeclaration,
        statementStart,
        exported: true,
        declarationsByName,
        typeNames,
        exportedTypeNames,
      });
    }
  }
};
type AddDeclarationOptions = {
  name: string;
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration;
  statementStart: number;
  exported: boolean;
  declarationsByName: Map<string, FoundDeclaration>;
  typeNames: string[];
  exportedTypeNames: Set<string>;
};
const addDeclaration = (options: AddDeclarationOptions): void => {
  const { name, decl, statementStart, exported, declarationsByName, typeNames, exportedTypeNames } =
    options;
  if (!declarationsByName.has(name)) {
    typeNames.push(name);
  }
  declarationsByName.set(name, { decl, statementStart, exported });
  if (exported) {
    exportedTypeNames.add(name);
  }
};
const buildImportIndex = (parsed: Omit<ParsedSource, "index">): Map<string, ImportInfo> => {
  const importsByLocalName = new Map<string, ImportInfo>();
  const staticImports = parsed.module.staticImports;
  if (!staticImports) {
    return importsByLocalName;
  }
  for (const imp of staticImports) {
    for (const entry of imp.entries) {
      const localName = entry.localName.value;
      const importedName =
        entry.importName.kind === "Name"
          ? entry.importName.name
          : entry.importName.kind === "Default"
            ? "default"
            : undefined;
      importsByLocalName.set(localName, {
        source: imp.moduleRequest.value,
        importedName: importedName && importedName !== localName ? importedName : undefined,
      });
    }
  }
  return importsByLocalName;
};
const buildExportIndex = (parsed: Omit<ParsedSource, "index">): ExportIndex => {
  const localExportsByName = new Map<string, string>();
  const reExportsByName = new Map<string, ReExportInfo[]>();
  const exportAllSources: string[] = [];
  let defaultExportName: string | undefined;
  for (const stmt of parsed.program.body) {
    if (stmt.type !== "ExportDefaultDeclaration") {
      continue;
    }
    const decl = stmt.declaration as {
      type: string;
      id?: {
        name: string;
      };
    };
    if (
      (decl.type === "TSInterfaceDeclaration" ||
        decl.type === "TSTypeAliasDeclaration" ||
        decl.type === "TSEnumDeclaration") &&
      decl.id
    ) {
      defaultExportName = decl.id.name;
    }
  }
  const staticExports = parsed.module.staticExports;
  if (!staticExports) {
    return { localExportsByName, reExportsByName, exportAllSources, defaultExportName };
  }
  for (const exp of staticExports) {
    for (const entry of exp.entries) {
      const source = entry.moduleRequest?.value;
      if (source) {
        if (entry.importName.kind === "AllButDefault") {
          exportAllSources.push(source);
          continue;
        }
        if (entry.exportName.kind !== "Name" || !entry.exportName.name) {
          continue;
        }
        const importedName = extractExportEntryName(entry.importName);
        if (!importedName) {
          continue;
        }
        const existing = reExportsByName.get(entry.exportName.name) ?? [];
        existing.push({ source, importedName });
        reExportsByName.set(entry.exportName.name, existing);
        continue;
      }
      if (entry.exportName.kind !== "Name" || !entry.exportName.name) {
        continue;
      }
      if (entry.localName.kind !== "Name" || !entry.localName.name) {
        continue;
      }
      localExportsByName.set(entry.exportName.name, entry.localName.name);
    }
  }
  return { localExportsByName, reExportsByName, exportAllSources, defaultExportName };
};
const extractExportEntryName = (entryName: {
  kind: string;
  name?: string | null;
}): string | undefined => {
  if (entryName.kind === "Name" && entryName.name) {
    return entryName.name;
  }
  if (entryName.kind === "Default") {
    return "default";
  }
  return undefined;
};
const buildLineStarts = (source: string): number[] => {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
};
