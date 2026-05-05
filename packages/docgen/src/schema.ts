export interface DocSchema {
  version: 1;
  entries: DocEntry[];
  /**
   * Types referenced by the primary entry (aliases, enums, interfaces) resolved
   * from the same project. Omitted or empty when none; not used by the core
   * docgen CLI output unless enabled.
   */
  related?: DocEntry[];
}

export interface DocEntry {
  name: string;
  kind: "interface" | "typeAlias" | "enum" | "function";
  description: string;
  tags: Record<string, string | string[] | true>;
  typeParameters: DocTypeParam[];
  properties: DocProperty[];
  type: DocType;
  source: DocSourceLocation;
}

export interface DocProperty {
  name: string;
  type: DocType;
  optional: boolean;
  readonly: boolean;
  description: string;
  tags: Record<string, string | string[] | true>;
  defaultValue: string | undefined;
  source: DocSourceLocation;
}

export interface DocSourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface DocTypeParam {
  name: string;
  constraint: DocType | undefined;
  default: DocType | undefined;
}

export interface DocFnParam {
  name: string;
  type: DocType;
  optional: boolean;
  rest: boolean;
}

export type DocType =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string }
  | { kind: "reference"; name: string; typeArguments?: DocType[]; circular?: boolean }
  | { kind: "union"; members: DocType[] }
  | { kind: "intersection"; members: DocType[] }
  | { kind: "array"; elementType: DocType }
  | { kind: "tuple"; elements: DocType[] }
  | { kind: "object"; properties: DocProperty[] }
  | { kind: "function"; parameters: DocFnParam[]; returnType: DocType }
  | { kind: "mapped"; parameter: string; constraint: DocType; type: DocType }
  | {
      kind: "conditional";
      checkType: DocType;
      extendsType: DocType;
      trueType: DocType;
      falseType: DocType;
    }
  | { kind: "indexedAccess"; objectType: DocType; indexType: DocType }
  | { kind: "templateLiteral"; spans: TemplateLiteralSpan[] }
  | { kind: "keyof"; type: DocType }
  | { kind: "typeof"; name: string }
  | { kind: "infer"; name: string }
  | { kind: "rest"; type: DocType }
  | { kind: "intrinsic"; name: string }
  | { kind: "unresolved"; text: string };

export type TemplateLiteralSpan = { type: DocType } | { text: string };
