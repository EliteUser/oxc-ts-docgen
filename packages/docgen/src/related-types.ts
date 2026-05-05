import type { DocEntry, DocProperty, DocType } from "./schema";
import type { DocgenConfig } from "./config";
import { buildDocEntry } from "./builder";
import type { TypeResolver } from "./resolver";
import type { ParsedSource } from "./parser";

function walkDocType(dt: DocType, out: Set<string>): void {
  switch (dt.kind) {
    case "reference":
      out.add(dt.name);
      for (const a of dt.typeArguments ?? []) walkDocType(a, out);
      break;
    case "union":
    case "intersection":
      for (const m of dt.members) walkDocType(m, out);
      break;
    case "array":
      walkDocType(dt.elementType, out);
      break;
    case "tuple":
      for (const e of dt.elements) walkDocType(e, out);
      break;
    case "object":
      for (const p of dt.properties) walkProperty(p, out);
      break;
    case "function":
      for (const p of dt.parameters) walkDocType(p.type, out);
      walkDocType(dt.returnType, out);
      break;
    case "mapped":
      walkDocType(dt.constraint, out);
      walkDocType(dt.type, out);
      break;
    case "conditional":
      walkDocType(dt.checkType, out);
      walkDocType(dt.extendsType, out);
      walkDocType(dt.trueType, out);
      walkDocType(dt.falseType, out);
      break;
    case "indexedAccess":
      walkDocType(dt.objectType, out);
      walkDocType(dt.indexType, out);
      break;
    case "templateLiteral":
      for (const s of dt.spans) {
        if ("type" in s) walkDocType(s.type, out);
      }
      break;
    case "keyof":
      walkDocType(dt.type, out);
      break;
    case "rest":
      walkDocType(dt.type, out);
      break;
    default:
      break;
  }
}

function walkProperty(prop: DocProperty, out: Set<string>): void {
  walkDocType(prop.type, out);
}

/** Collect every named type reference appearing in a doc entry (props + declared type). */
export function collectReferencedTypeNames(entry: DocEntry): Set<string> {
  const out = new Set<string>();
  walkDocType(entry.type, out);
  for (const p of entry.properties) walkProperty(p, out);
  for (const tp of entry.typeParameters) {
    if (tp.constraint) walkDocType(tp.constraint, out);
    if (tp.default) walkDocType(tp.default, out);
  }
  return out;
}

/**
 * Resolve referenced project types into full DocEntry objects for documentation UIs
 * (e.g. expandable type popovers). Skips `ignoreTypes` and unresolved names.
 */
export function buildRelatedDocEntries(
  primary: DocEntry,
  filePath: string,
  resolver: TypeResolver,
  config: DocgenConfig,
  parsedOverride?: ParsedSource,
): DocEntry[] {
  const parsed = parsedOverride ?? resolver.parseFileCached(filePath);
  if (!parsed) return [];

  const candidates = collectReferencedTypeNames(primary);
  candidates.delete(primary.name);

  const result: DocEntry[] = [];
  const seen = new Set<string>();

  const sorted = [...candidates].sort();

  for (const name of sorted) {
    if (config.ignoreTypes.includes(name)) continue;

    const resolved = resolver.resolveType(name, filePath, parsed);
    if (!resolved) continue;

    const declName = resolved.decl.id.name;

    const entry = buildDocEntry(resolved.parsed, declName, resolved.filePath, config, resolver);
    if (!entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    result.push(entry);
  }

  return result;
}

export function attachRelatedToSchema(
  schema: { version: 1; entries: DocEntry[]; related?: DocEntry[] },
  filePath: string,
  resolver: TypeResolver,
  config: DocgenConfig,
  parsedOverride?: ParsedSource,
): { version: 1; entries: DocEntry[]; related: DocEntry[] } {
  const main = schema.entries[0];
  if (!main) {
    return { version: 1, entries: schema.entries, related: [] };
  }
  const related = buildRelatedDocEntries(main, filePath, resolver, config, parsedOverride);
  return { version: 1, entries: schema.entries, related };
}
