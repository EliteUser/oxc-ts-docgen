import { parseSync } from "oxc-parser";
import type { Comment, ParseResult, EcmaScriptModule } from "oxc-parser";
import type {
  Program,
  Statement,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  TSEnumDeclaration,
} from "oxc-parser";

export interface ImportInfo {
  source: string;
  importedName: string | undefined;
}

export interface ReExportInfo {
  source: string;
  importedName: string;
}

export interface ParsedSource {
  program: Program;
  comments: Comment[];
  module: EcmaScriptModule;
  source: string;
  fileName: string;
  index: ParsedSourceIndex;
}

export interface ParsedSourceIndex {
  declarationsByName: Map<string, FoundDeclaration>;
  importsByLocalName: Map<string, ImportInfo>;
  localExportsByName: Map<string, string>;
  reExportsByName: Map<string, ReExportInfo[]>;
  exportAllSources: string[];
  typeNames: string[];
  exportedTypeNames: Set<string>;
  lineStarts: number[];
  jsdocComments: Comment[];
}

export function parseSource(source: string, fileName: string): ParsedSource {
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
}

function inferLang(fileName: string): "ts" | "tsx" | "js" | "jsx" {
  if (fileName.endsWith(".tsx")) return "tsx";
  if (fileName.endsWith(".jsx")) return "jsx";
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs"))
    return "js";
  return "ts";
}

export interface FoundDeclaration {
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration;
  /** Start of the outermost statement (including `export` keyword). */
  statementStart: number;
  exported: boolean;
}

export function findTypeDeclaration(
  parsed: ParsedSource,
  typeName: string,
): FoundDeclaration | undefined {
  return parsed.index.declarationsByName.get(typeName);
}

export function findAllTypeDeclarations(parsed: ParsedSource): string[] {
  return [...parsed.index.typeNames];
}

export function findExportedTypeDeclarations(parsed: ParsedSource): string[] {
  return [...parsed.index.exportedTypeNames];
}

function buildParsedSourceIndex(parsed: Omit<ParsedSource, "index">): ParsedSourceIndex {
  const declarationsByName = new Map<string, FoundDeclaration>();
  const typeNames: string[] = [];
  const exportedTypeNames = new Set<string>();

  for (const stmt of parsed.program.body) {
    collectTypeDeclarations(
      stmt,
      stmt.start,
      false,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    );
  }

  return {
    declarationsByName,
    importsByLocalName: buildImportIndex(parsed),
    ...buildExportIndex(parsed),
    typeNames,
    exportedTypeNames,
    lineStarts: buildLineStarts(parsed.source),
    jsdocComments: parsed.comments
      .filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
      .sort((a, b) => a.end - b.end),
  };
}

interface ExportIndex {
  localExportsByName: Map<string, string>;
  reExportsByName: Map<string, ReExportInfo[]>;
  exportAllSources: string[];
}

function collectTypeDeclarations(
  stmt: Statement,
  statementStart: number,
  exported: boolean,
  declarationsByName: Map<string, FoundDeclaration>,
  typeNames: string[],
  exportedTypeNames: Set<string>,
): void {
  if (stmt.type === "TSInterfaceDeclaration") {
    addDeclaration(
      stmt.id.name,
      stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    );
  } else if (stmt.type === "TSTypeAliasDeclaration") {
    addDeclaration(
      stmt.id.name,
      stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    );
  } else if (stmt.type === "TSEnumDeclaration") {
    addDeclaration(
      stmt.id.name,
      stmt,
      statementStart,
      exported,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    );
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    collectTypeDeclarations(
      stmt.declaration as Statement,
      statementStart,
      true,
      declarationsByName,
      typeNames,
      exportedTypeNames,
    );
  } else if (stmt.type === "ExportDefaultDeclaration") {
    const decl = stmt.declaration as { type: string; id?: { name: string } };
    if (
      (decl.type === "TSInterfaceDeclaration" || decl.type === "TSTypeAliasDeclaration") &&
      decl.id
    ) {
      addDeclaration(
        decl.id.name,
        stmt.declaration as TSInterfaceDeclaration | TSTypeAliasDeclaration,
        statementStart,
        true,
        declarationsByName,
        typeNames,
        exportedTypeNames,
      );
    }
  }
}

function addDeclaration(
  name: string,
  decl: TSInterfaceDeclaration | TSTypeAliasDeclaration | TSEnumDeclaration,
  statementStart: number,
  exported: boolean,
  declarationsByName: Map<string, FoundDeclaration>,
  typeNames: string[],
  exportedTypeNames: Set<string>,
): void {
  if (!declarationsByName.has(name)) {
    typeNames.push(name);
  }
  declarationsByName.set(name, { decl, statementStart, exported });
  if (exported) exportedTypeNames.add(name);
}

function buildImportIndex(parsed: Omit<ParsedSource, "index">): Map<string, ImportInfo> {
  const importsByLocalName = new Map<string, ImportInfo>();
  const staticImports = parsed.module.staticImports;
  if (!staticImports) return importsByLocalName;

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
}

function buildExportIndex(parsed: Omit<ParsedSource, "index">): ExportIndex {
  const localExportsByName = new Map<string, string>();
  const reExportsByName = new Map<string, ReExportInfo[]>();
  const exportAllSources: string[] = [];
  const staticExports = parsed.module.staticExports;
  if (!staticExports) return { localExportsByName, reExportsByName, exportAllSources };

  for (const exp of staticExports) {
    for (const entry of exp.entries) {
      const source = entry.moduleRequest?.value;

      if (source) {
        if (entry.importName.kind === "AllButDefault") {
          exportAllSources.push(source);
          continue;
        }

        if (entry.exportName.kind !== "Name" || !entry.exportName.name) continue;
        if (entry.importName.kind !== "Name" || !entry.importName.name) continue;

        const existing = reExportsByName.get(entry.exportName.name) ?? [];
        existing.push({ source, importedName: entry.importName.name });
        reExportsByName.set(entry.exportName.name, existing);
        continue;
      }

      if (entry.exportName.kind !== "Name" || !entry.exportName.name) continue;
      if (entry.localName.kind !== "Name" || !entry.localName.name) continue;
      if (entry.localName.name !== entry.exportName.name) {
        localExportsByName.set(entry.exportName.name, entry.localName.name);
      }
    }
  }

  return { localExportsByName, reExportsByName, exportAllSources };
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}
