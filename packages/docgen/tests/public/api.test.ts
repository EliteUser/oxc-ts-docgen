import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import type { DocEntry, DocFnParam, DocProperty, DocType } from "../../src/index";

import {
  generateDocs,
  generateDocsFromSource,
  generateDocsResultFromSource,
  resolveConfig,
} from "../../src/index";
import { generateDocsResultWithResolver, generateDocsWithResolver } from "../../src/public/api";
import { TypeResolver } from "../../src/resolver/resolver";

const formatDocTypeForTest = (type: DocType): string => {
  switch (type.kind) {
    case "primitive":
    case "intrinsic":
      return type.name;
    case "literal":
      return type.value;
    case "union":
      return type.members.map(formatDocTypeForTest).join(" | ");
    case "function":
      return `${formatFunctionParamsForTest(type.parameters)} => ${formatDocTypeForTest(type.returnType)}`;
    case "reference":
      return type.name;
    case "object":
      return formatObjectForTest(type.properties);
    default:
      return type.kind;
  }
};

const formatFunctionParamsForTest = (params: DocFnParam[]): string => {
  return `(${params
    .map((param) => {
      const rest = param.rest ? "..." : "";
      const optional = param.optional ? "?" : "";
      return `${rest}${param.name}${optional}: ${formatDocTypeForTest(param.type)}`;
    })
    .join(", ")})`;
};

const formatObjectForTest = (properties: DocProperty[]): string => {
  return `{ ${properties
    .map((property) => {
      const readonly = property.readonly ? "readonly " : "";
      const optional = property.optional ? "?" : "";
      return `${readonly}${property.name}${optional}: ${formatDocTypeForTest(property.type)}`;
    })
    .join("; ")} }`;
};

function fixture(name: string): string {
  const filePath = resolve(__dirname, "..", "fixtures", name);
  return readFileSync(filePath, "utf-8");
}

const comparableEntryShape = (entry: DocEntry): unknown => {
  return stripProvenanceFields({
    kind: entry.kind,
    description: entry.description,
    tags: entry.tags,
    typeParameters: entry.typeParameters,
    properties: entry.properties,
    type: entry.type,
  });
};

const stripProvenanceFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripProvenanceFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "source" && key !== "target" && key !== "circular")
      .map(([key, entryValue]) => [key, stripProvenanceFields(entryValue)]),
  );
};

describe("generateDocsFromSource", () => {
  it("rejects mismatched resolver and generation configs", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-config-mismatch-"));
    const filePath = join(root, "button.ts");
    mkdirSync(root, { recursive: true });
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const resolver = new TypeResolver(resolveConfig({ externalTypes: "reference" }));

    expect(() =>
      generateDocsWithResolver({
        filePath,
        typeName: "ButtonProps",
        config: { externalTypes: "resolve" },
        resolver,
      }),
    ).toThrow("different docgen config");
  });

  it("surfaces diagnostics for intentionally bounded static extraction", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-static-diagnostics-"));
    const filePath = join(root, "button.ts");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      filePath,
      [
        "declare function createButtonProps(): { label: string }",
        "export type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
    );
    const config = resolveConfig({ analysis: "static" });
    const resolver = new TypeResolver(config);

    const result = generateDocsResultWithResolver({
      filePath,
      typeName: "ButtonProps",
      config,
      resolver,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "static-extraction-incomplete",
        filePath: filePath.replace(/\\/g, "/"),
      }),
    ]);
    expect(result.diagnostics[0].message).toContain("unsupported utility type");
  });

  it("surfaces source diagnostics for inherited bounded static extraction", () => {
    const result = generateDocsResultFromSource({
      source: [
        "declare function createBaseProps(): { id: string }",
        "type BaseProps = ReturnType<typeof createBaseProps>",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
      typeName: "ButtonProps",
      fileName: "inherited-static-diagnostics.ts",
      config: { analysis: "static" },
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "static-extraction-incomplete",
        filePath: "inherited-static-diagnostics.ts",
      }),
    ]);
    expect(result.diagnostics[0].message).toContain("unsupported utility type");
    expect(result.schema.entries[0].properties.map((property) => property.name)).toEqual([
      "__unresolved",
      "label",
    ]);
  });

  describe("simple interface", () => {
    const source = fixture("simple-interface.ts");

    it("extracts ButtonProps interface", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });

      expect(result.version).toBe(1);
      expect(result.entries).toHaveLength(1);

      const entry = result.entries[0];
      expect(entry.name).toBe("ButtonProps");
      expect(entry.kind).toBe("interface");
      expect(entry.description).toBe("Props for the Button component.");
    });

    it("includes related project types for schema consumers", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });

      const relatedNames = new Set((result.related ?? []).map((e) => e.name));
      expect(relatedNames.has("ButtonSize")).toBe(true);
      const sizeEntry = (result.related ?? []).find((e) => e.name === "ButtonSize");
      expect(sizeEntry?.kind).toBe("typeAlias");
      expect(sizeEntry?.type.kind).toBe("union");
    });

    it("uses the same schema assembly path for source and file generation", () => {
      const root = mkdtempSync(join(tmpdir(), "oxc-docgen-api-schema-assembly-"));
      const filePath = join(root, "button.ts");
      writeFileSync(filePath, source);

      const fromSource = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: filePath,
      });
      const fromFile = generateDocs({
        filePath,
        typeName: "ButtonProps",
      });

      expect(stripProvenanceFields(fromFile)).toEqual(stripProvenanceFields(fromSource));
    });

    it("includes transitive related project types", () => {
      const result = generateDocsFromSource({
        source: `
          type TokenName = 'primary' | 'secondary'

          type InternalProps = {
            /** Token used by nested content. */
            token: TokenName
          }

          interface ButtonProps {
            /** Internal button configuration. */
            internalProps?: InternalProps
          }
        `,
        typeName: "ButtonProps",
        fileName: "transitive-related.ts",
      });

      const relatedNames = (result.related ?? []).map((e) => e.name);
      expect(relatedNames).toEqual(["InternalProps", "TokenName"]);
    });

    it("uses in-memory source text for semantic fallback in related entries", () => {
      const result = generateDocsFromSource({
        source: `
          declare function createRelated(): {
            /** Related value. */
            value: string
            /** Enabled state. */
            enabled?: boolean
          }

          type RelatedProps = ReturnType<typeof createRelated>

          interface RootProps {
            /** Related props. */
            related: RelatedProps
          }
        `,
        typeName: "RootProps",
        fileName: "related-semantic-fallback.ts",
      });

      const related = result.related?.find((entry) => entry.name === "RelatedProps");
      expect(related?.properties.map((property) => property.name)).toEqual(["value", "enabled"]);
      expect(related?.properties.map((property) => property.description)).toEqual([
        "Related value.",
        "Enabled state.",
      ]);
      expect(related?.type.kind).toBe("object");
    });

    it("keeps schema output usable for custom renderers", () => {
      const result = generateDocsFromSource({
        source: `/** Table-facing props. */
interface TableProps {
  /**
   * Visual density.
   * @default "comfortable"
   */
  density?: "compact" | "comfortable"
  /** Saves the active row. */
  onSave: (id: string) => void
}`,
        typeName: "TableProps",
        fileName: "schema-usability.ts",
      });

      expect(result.version).toBe(1);
      expect(result.entries).toHaveLength(1);

      const entry = result.entries[0];
      expect(entry).toMatchObject({
        name: "TableProps",
        kind: "interface",
        description: "Table-facing props.",
        source: { filePath: "schema-usability.ts", line: 2, column: 0 },
      });
      expect(entry.properties.map((property) => property.name)).toEqual(["density", "onSave"]);

      const density = entry.properties[0];
      expect(density).toMatchObject({
        name: "density",
        optional: true,
        readonly: false,
        description: "Visual density.",
        defaultValue: "comfortable",
        source: { filePath: "schema-usability.ts", line: 7, column: 2 },
      });
      expect(formatDocTypeForTest(density.type)).toBe("'compact' | 'comfortable'");

      const onSave = entry.properties[1];
      expect(onSave).toMatchObject({
        name: "onSave",
        optional: false,
        description: "Saves the active row.",
        source: { filePath: "schema-usability.ts", line: 9, column: 2 },
      });
      expect(formatDocTypeForTest(onSave.type)).toBe("(id: string) => void");
    });

    it("keeps equivalent interface and type literal properties aligned", () => {
      const source = `
          interface InterfaceProps {
            /** Visible label. */
            label: string
            /**
             * Visual density.
             * @default comfortable
             */
            density?: 'compact' | 'comfortable'
            readonly count: number
            submit(value: string): boolean
          }

          type AliasProps = {
            /** Visible label. */
            label: string
            /**
             * Visual density.
             * @default comfortable
             */
            density?: 'compact' | 'comfortable'
            readonly count: number
            submit(value: string): boolean
          }
        `;
      const result = generateDocsFromSource({
        source,
        typeName: "InterfaceProps",
        fileName: "equivalent-static-properties.ts",
      });
      const aliasResult = generateDocsFromSource({
        source,
        typeName: "AliasProps",
        fileName: "equivalent-static-properties.ts",
      });

      const summarize = (entryIndex: number, docs = result) =>
        docs.entries[entryIndex].properties.map((property) => ({
          name: property.name,
          type: formatDocTypeForTest(property.type),
          optional: property.optional,
          readonly: property.readonly,
          description: property.description,
          defaultValue: property.defaultValue,
          tags: property.tags,
        }));

      expect(summarize(0)).toEqual(summarize(0, aliasResult));
    });

    it("resolves named aliases that wrap supported utility types", () => {
      const source = `
          interface BaseButtonProps {
            /** Visible label. */
            label?: string
            /** Disabled state. */
            disabled?: boolean
            /** Stable identifier. */
            readonly id?: string
            /** Visual tone. */
            tone?: 'primary' | 'secondary'
          }

          type RequiredButtonProps = Required<BaseButtonProps>
          type PartialButtonProps = Partial<BaseButtonProps>
          type ReadonlyButtonProps = Readonly<BaseButtonProps>
          type PickButtonProps = Pick<BaseButtonProps, 'label' | 'tone'>
          type OmitButtonProps = Omit<BaseButtonProps, 'disabled' | 'id'>
        `;
      const summarize = (typeName: string) => {
        const result = generateDocsFromSource({
          source,
          typeName,
          fileName: "utility-aliases.ts",
        });

        return result.entries[0].properties.map((property) => ({
          name: property.name,
          optional: property.optional,
          readonly: property.readonly,
          description: property.description,
          type: formatDocTypeForTest(property.type),
        }));
      };

      expect(summarize("RequiredButtonProps")).toEqual([
        {
          name: "label",
          optional: false,
          readonly: false,
          description: "Visible label.",
          type: "string",
        },
        {
          name: "disabled",
          optional: false,
          readonly: false,
          description: "Disabled state.",
          type: "boolean",
        },
        {
          name: "id",
          optional: false,
          readonly: true,
          description: "Stable identifier.",
          type: "string",
        },
        {
          name: "tone",
          optional: false,
          readonly: false,
          description: "Visual tone.",
          type: "'primary' | 'secondary'",
        },
      ]);
      expect(summarize("PartialButtonProps").map((property) => property.optional)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(summarize("ReadonlyButtonProps").map((property) => property.readonly)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(summarize("PickButtonProps").map((property) => property.name)).toEqual([
        "label",
        "tone",
      ]);
      expect(summarize("OmitButtonProps").map((property) => property.name)).toEqual([
        "label",
        "tone",
      ]);
    });

    it("uses maxDepth when semantic fallback converts nested object types", () => {
      const source = `
          type NativeProps<T extends 'button'> = T extends 'button'
            ? {
                nested: {
                  level2: {
                    level3: {
                      label: string
                    }
                  }
                }
              }
            : never

          type ButtonProps = NativeProps<'button'>
        `;
      const shallow = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "semantic-depth.ts",
        config: { maxDepth: 1 },
      });
      const deep = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "semantic-depth.ts",
        config: { maxDepth: 4 },
      });

      const shallowNested = shallow.entries[0].properties[0].type;
      expect(shallowNested.kind).toBe("object");
      if (shallowNested.kind !== "object") {
        return;
      }
      const shallowLevel2 = shallowNested.properties[0].type;
      expect(shallowLevel2.kind).toBe("object");
      if (shallowLevel2.kind !== "object") {
        return;
      }
      expect(shallowLevel2.properties[0].type).toEqual({
        kind: "unresolved",
        text: "{ label: string; }",
      });

      const deepNested = deep.entries[0].properties[0].type;
      expect(deepNested.kind).toBe("object");
      if (deepNested.kind !== "object") {
        return;
      }
      const deepLevel2 = deepNested.properties[0].type;
      expect(deepLevel2.kind).toBe("object");
      if (deepLevel2.kind !== "object") {
        return;
      }
      const deepLevel3 = deepLevel2.properties[0].type;
      expect(deepLevel3.kind).toBe("object");
      if (deepLevel3.kind !== "object") {
        return;
      }
      expect(deepLevel3.properties[0].type).toEqual({ kind: "primitive", name: "string" });
    });

    it("uses semantic fallback instead of returning empty output for unsupported object-like aliases", () => {
      const source = `
          declare function createButtonProps(): {
            /** Visible label. */
            label: string
            /** Disabled state. */
            disabled?: boolean
          }

          type ButtonProps = ReturnType<typeof createButtonProps>
        `;
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "unsupported-utility-fallback.ts",
      });

      expect(result.entries[0].properties.map((property) => property.name)).toEqual([
        "label",
        "disabled",
      ]);
      expect(result.entries[0].properties.map((property) => property.description)).toEqual([
        "Visible label.",
        "Disabled state.",
      ]);
      expect(result.entries[0].properties.map((property) => property.name)).not.toContain(
        "__unresolved",
      );
    });

    it("uses semantic fallback for unsupported utility aliases in heritage", () => {
      const result = generateDocsFromSource({
        source: [
          "declare function createBaseProps(): {",
          "  /** Stable identifier. */",
          "  id: string",
          "}",
          "type BaseProps = ReturnType<typeof createBaseProps>",
          "export interface ButtonProps extends BaseProps {",
          "  /** Visible label. */",
          "  label: string",
          "}",
        ].join("\n"),
        typeName: "ButtonProps",
        fileName: "unsupported-utility-heritage.ts",
      });

      const propertyNames = result.entries[0].properties.map((property) => property.name);
      expect(new Set(propertyNames)).toEqual(new Set(["id", "label"]));
      expect(propertyNames).not.toContain("__unresolved");
    });

    it("uses semantic fallback for object-like union props", () => {
      const result = generateDocsFromSource({
        source: `
          type CSSProperties = {
            display?: string
          }

          type PropsWithChildren<P = unknown> = P & {
            children?: unknown
          }

          type DOMProps = {
            /** HTML style attribute. */
            style?: CSSProperties
            /** HTML class attribute. */
            className?: string
          }

          type DisplayVariant = 'primary' | 'secondary'

          type BaseUnionProps = DOMProps &
            PropsWithChildren & {
              /** Display variant. */
              variant?: DisplayVariant
            }

          type SingleValueProps = BaseUnionProps & {
            /**
             * Single-value mode.
             *
             * @default false
             */
            multiple?: false
            /** Controlled value. */
            value?: string | null
            /** Initial value. */
            defaultValue?: string
            /** Change handler. */
            onChange?: (value: string | null) => void
          }

          type MultipleValueProps = BaseUnionProps & {
            multiple: true
            value?: string[]
            defaultValue?: string[]
            onChange?: (value: string[]) => void
          }

          export type UnionComponentProps = SingleValueProps | MultipleValueProps
        `,
        typeName: "UnionComponentProps",
        fileName: "object-like-union-props.ts",
      });

      const entry = result.entries[0];
      const propertyNames = entry.properties.map((property) => property.name);
      expect(new Set(propertyNames)).toEqual(
        new Set(["className", "style", "variant", "multiple", "value", "defaultValue", "onChange"]),
      );
      expect(propertyNames).not.toContain("children");
      expect(propertyNames).not.toContain("__unresolved");
      expect(entry.type.kind).toBe("union");
      expect(entry.properties.find((property) => property.name === "multiple")?.defaultValue).toBe(
        "false",
      );

      const value = entry.properties.find((property) => property.name === "value");
      expect(value?.type.kind).toBe("union");

      const defaultValue = entry.properties.find((property) => property.name === "defaultValue");
      expect(defaultValue?.type.kind).toBe("union");

      const onChange = entry.properties.find((property) => property.name === "onChange");
      expect(onChange?.type.kind).toBe("union");
    });

    it("discovers semantic-only properties from object-like union branches", () => {
      const result = generateDocsFromSource({
        source: `
          type LocalProps = {
            /** Local branch kind. */
            kind: 'local'
          }

          type ConditionalBranch<T> = T extends 'link'
            ? {
                /** Link target. */
                href: string
                target: '_blank' | '_self'
              }
            : never

          export type UnionProps = LocalProps | ConditionalBranch<'link'>
        `,
        typeName: "UnionProps",
        fileName: "semantic-only-union-branch.ts",
      });

      const entry = result.entries[0];

      expect(entry.type.kind).toBe("union");
      expect(entry.properties.map((property) => property.name)).toEqual(["kind", "href", "target"]);
      expect(entry.properties.find((property) => property.name === "href")?.description).toBe(
        "Link target.",
      );
      expect(entry.properties.find((property) => property.name === "target")?.description).toBe("");
    });

    it("preserves authored aliases in semantic fallback union property annotations", () => {
      const result = generateDocsFromSource({
        source: `
          export type ActivationEvent = 'click' | 'hover' | 'context-menu' | 'none'
          export type SelectionState = {
            /** Start value. */
            start: string
            /** End value. */
            end: string
          }
          export type RenderedNode = string | null

          type PopoverModeProps = {
            /** Popover mode. */
            viewMode?: 'popover'
            /** Events that activate the component. */
            activationEvents?: ActivationEvent | ActivationEvent[]
            /** Activation fallback mode. */
            activationFallback?: ActivationEvent | 'manual'
            /** Details renderer. */
            renderDetails?: (state: SelectionState) => RenderedNode
            /** Deferred details renderer. */
            renderDeferredDetails?: (getState: () => SelectionState) => RenderedNode
            /** Method-style details renderer. */
            renderMethodDetails(state: SelectionState): RenderedNode
            /** Tuple wrapper around aliases. */
            stateTuple?: [SelectionState, ...SelectionState[]]
            /** Key wrapper around an alias. */
            stateKey?: keyof SelectionState
            /** Conditional wrapper around aliases. */
            conditionalState?: SelectionState extends object ? SelectionState : RenderedNode
            /** Mapped wrapper around aliases. */
            mappedState?: { [K in 'state']: SelectionState }
            /** Template wrapper around aliases. */
            templateState?: \`state:\${ActivationEvent}\`
            /** Mixed alias and inline object union. */
            mixedState?: SelectionState | { inline: string }
            /** Object wrapper around aliases. */
            objectState?: {
              /** Nested state alias. */
              state: SelectionState
              /** Scalar mode union. */
              mode?: 'one' | 'many'
              /** Scalar-only callback. */
              onScalarChange?: (value: string) => void
              /** Callable object form. */
              (value: string): void
            }
            /** Generic array wrapper around aliases. */
            stateArray?: Array<SelectionState>
          }

          type SheetModeProps = {
            viewMode: 'sheet'
            /** Sheet-only escape behavior. */
            closeOnEscape?: boolean
            activationEvents?: Extract<ActivationEvent, 'click' | 'none'>
            activationFallback?: ActivationEvent | 'manual'
            renderDetails?: (state: SelectionState) => RenderedNode
            renderDeferredDetails?: (getState: () => SelectionState) => RenderedNode
            renderMethodDetails(state: SelectionState): RenderedNode
            stateTuple?: [SelectionState, ...SelectionState[]]
            stateKey?: keyof SelectionState
            conditionalState?: SelectionState extends object ? SelectionState : RenderedNode
            mappedState?: { [K in 'state']: SelectionState }
            templateState?: \`state:\${ActivationEvent}\`
            mixedState?: SelectionState | { inline: string }
            objectState?: {
              /** Nested state alias. */
              state: SelectionState
              /** Scalar mode union. */
              mode?: 'one' | 'many'
              /** Scalar-only callback. */
              onScalarChange?: (value: string) => void
              /** Callable object form. */
              (value: string): void
            }
            stateArray?: Array<SelectionState>
          }

          export type ModeBranchProps = PopoverModeProps | SheetModeProps
        `,
        typeName: "ModeBranchProps",
        fileName: "alias-union-property-annotations.ts",
      });

      const activationEvents = result.entries[0].properties.find(
        (property) => property.name === "activationEvents",
      );

      expect(activationEvents?.type).toMatchObject({
        kind: "union",
        members: [
          {
            kind: "reference",
            name: "ActivationEvent",
          },
          {
            kind: "array",
            elementType: {
              kind: "reference",
              name: "ActivationEvent",
            },
          },
        ],
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "activationFallback")
          ?.type,
      ).toMatchObject({
        kind: "union",
        members: [
          {
            kind: "reference",
            name: "ActivationEvent",
          },
          {
            kind: "literal",
            value: "'manual'",
          },
        ],
      });
      const renderDetails = result.entries[0].properties.find(
        (property) => property.name === "renderDetails",
      );
      expect(renderDetails?.type).toMatchObject({
        kind: "function",
        parameters: [
          {
            name: "state",
            type: {
              kind: "reference",
              name: "SelectionState",
            },
          },
        ],
        returnType: {
          kind: "reference",
          name: "RenderedNode",
        },
      });
      const renderDeferredDetails = result.entries[0].properties.find(
        (property) => property.name === "renderDeferredDetails",
      );
      expect(renderDeferredDetails?.type).toMatchObject({
        kind: "function",
        parameters: [
          {
            name: "getState",
            type: {
              kind: "function",
              parameters: [],
              returnType: {
                kind: "reference",
                name: "SelectionState",
              },
            },
          },
        ],
        returnType: {
          kind: "reference",
          name: "RenderedNode",
        },
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "renderMethodDetails")
          ?.type,
      ).toMatchObject({
        kind: "function",
        parameters: [
          {
            name: "state",
            type: {
              kind: "reference",
              name: "SelectionState",
            },
          },
        ],
        returnType: {
          kind: "reference",
          name: "RenderedNode",
        },
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "stateTuple")?.type,
      ).toMatchObject({
        kind: "tuple",
        elements: [
          {
            kind: "reference",
            name: "SelectionState",
          },
          {
            kind: "rest",
            type: {
              kind: "array",
              elementType: {
                kind: "reference",
                name: "SelectionState",
              },
            },
          },
        ],
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "stateKey")?.type,
      ).toMatchObject({
        kind: "keyof",
        type: {
          kind: "reference",
          name: "SelectionState",
        },
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "conditionalState")?.type,
      ).toMatchObject({
        kind: "conditional",
        checkType: {
          kind: "reference",
          name: "SelectionState",
        },
        trueType: {
          kind: "reference",
          name: "SelectionState",
        },
        falseType: {
          kind: "reference",
          name: "RenderedNode",
        },
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "mappedState")?.type,
      ).toMatchObject({
        kind: "mapped",
        parameter: "K",
        type: {
          kind: "reference",
          name: "SelectionState",
        },
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "templateState")?.type,
      ).toMatchObject({
        kind: "templateLiteral",
        spans: [
          {
            text: "state:",
          },
          {
            type: {
              kind: "reference",
              name: "ActivationEvent",
            },
          },
          {
            text: "",
          },
        ],
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "mixedState")?.type,
      ).toMatchObject({
        kind: "union",
        members: [
          {
            kind: "reference",
            name: "SelectionState",
          },
          {
            kind: "object",
            properties: [
              {
                name: "inline",
                type: {
                  kind: "primitive",
                  name: "string",
                },
              },
            ],
          },
        ],
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "objectState")?.type,
      ).toMatchObject({
        kind: "object",
        properties: [
          {
            name: "state",
            description: "Nested state alias.",
            type: {
              kind: "reference",
              name: "SelectionState",
            },
          },
          {
            name: "mode",
            type: {
              kind: "union",
              members: [
                {
                  kind: "literal",
                  value: "'one'",
                },
                {
                  kind: "literal",
                  value: "'many'",
                },
              ],
            },
          },
          {
            name: "onScalarChange",
            type: {
              kind: "function",
              parameters: [
                {
                  name: "value",
                  type: {
                    kind: "primitive",
                    name: "string",
                  },
                },
              ],
              returnType: {
                kind: "intrinsic",
                name: "void",
              },
            },
          },
          {
            name: "__call",
            description: "Callable object form.",
            type: {
              kind: "function",
              parameters: [
                {
                  name: "value",
                  type: {
                    kind: "primitive",
                    name: "string",
                  },
                },
              ],
              returnType: {
                kind: "intrinsic",
                name: "void",
              },
            },
          },
        ],
      });
      expect(
        result.entries[0].properties.find((property) => property.name === "stateArray")?.type,
      ).toMatchObject({
        kind: "array",
        elementType: {
          kind: "reference",
          name: "SelectionState",
        },
      });
      expect(result.related?.map((entry) => entry.name)).toContain("ActivationEvent");
      expect(result.related?.map((entry) => entry.name)).toContain("SelectionState");
    });

    it("treats configured aliases as endpoints while resolving internal aliases", () => {
      const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-endpoint-aliases-"));
      const sharedFile = resolve(root, "shared.ts");
      const componentFile = resolve(root, "component.ts");

      writeFileSync(
        sharedFile,
        [
          "export type ExternalToken = {",
          "  /** External token value. */",
          "  value: string",
          "}",
          "export type InternalValue = {",
          "  /** Internal identifier. */",
          "  id: string",
          "}",
        ].join("\n"),
      );
      writeFileSync(
        componentFile,
        [
          "import type { ExternalToken, InternalValue } from './shared'",
          "export namespace Runtime {",
          "  export type Endpoint = {",
          "    /** Endpoint identifier. */",
          "    id: string",
          "  }",
          "}",
          "export type ComponentProps = {",
          "  /** Custom endpoint alias. */",
          "  token?: ExternalToken",
          "  /** Qualified endpoint alias. */",
          "  endpoint?: Runtime.Endpoint",
          "  /** Internal alias. */",
          "  value?: InternalValue",
          "  /** Callback with internal and endpoint aliases. */",
          "  callback?: (value: InternalValue) => ExternalToken",
          "}",
        ].join("\n"),
      );

      const result = generateDocs({
        filePath: componentFile,
        typeName: "ComponentProps",
        config: {
          ignoreTypes: ["ExternalToken", "Endpoint"],
        },
      });
      const byName = new Map(
        result.entries[0].properties.map((property) => [property.name, property]),
      );

      expect(byName.get("token")?.type).toEqual({
        kind: "reference",
        name: "ExternalToken",
      });
      expect(byName.get("endpoint")?.type).toEqual({
        kind: "reference",
        name: "Runtime.Endpoint",
      });
      expect(byName.get("value")?.type).toMatchObject({
        kind: "reference",
        name: "InternalValue",
        target: {
          name: "InternalValue",
        },
      });
      const callbackType = byName.get("callback")?.type;
      expect(callbackType?.kind).toBe("function");

      if (callbackType?.kind !== "function") {
        throw new Error("Expected callback to be documented as a function.");
      }

      expect(callbackType.parameters).toMatchObject([
        {
          name: "value",
          type: {
            kind: "reference",
            name: "InternalValue",
            target: {
              name: "InternalValue",
            },
          },
        },
      ]);
      expect(callbackType.returnType).toEqual({
        kind: "reference",
        name: "ExternalToken",
      });
      expect(result.related?.map((entry) => entry.name)).toEqual(["InternalValue"]);
    });

    it("keeps object-like union entries explicit while exposing branch properties", () => {
      const result = generateDocsFromSource({
        source: `
          type PopoverModeProps = {
            /** Popover mode. */
            viewMode?: 'popover'
            /** Popover placement. */
            placement?: 'top' | 'bottom'
          }

          type DrawerModeProps = {
            /** Sheet mode. */
            viewMode: 'drawer'
            /** Sheet close behavior. */
            closeOnEscape?: boolean
          }

          export type ModeUnionProps = PopoverModeProps | DrawerModeProps
        `,
        typeName: "ModeUnionProps",
        fileName: "branch-union-policy.ts",
      });

      const entry = result.entries[0];

      expect(entry.type.kind).toBe("union");
      expect(entry.properties.map((property) => property.name)).toEqual([
        "viewMode",
        "placement",
        "closeOnEscape",
      ]);
      expect(entry.properties.find((property) => property.name === "closeOnEscape")?.optional).toBe(
        true,
      );
    });

    it("unwraps transparent React-style props wrappers during static extraction", () => {
      const result = generateDocsFromSource({
        source: `
          type CSSProperties = {
            display?: string
          }

          type PropsWithChildren<P = unknown> = P & {
            children?: unknown
          }

          type DOMProps = {
            /** HTML style attribute. */
            style?: CSSProperties
            /** HTML class attribute. */
            className?: string
          }

          export type WrappedComponentProps = DOMProps &
            PropsWithChildren<{
              /** Visible title. */
              title: string
              /** Stable value. */
              value: string
              /** Disabled state. */
              disabled?: boolean
              /** Nested content style. */
              contentStyle?: CSSProperties
              /** Nested content class name. */
              contentClassName?: string
            }>
        `,
        typeName: "WrappedComponentProps",
        fileName: "transparent-wrapper-props.ts",
      });

      const propertyNames = result.entries[0].properties.map((property) => property.name);
      expect(new Set(propertyNames)).toEqual(
        new Set([
          "className",
          "style",
          "title",
          "value",
          "disabled",
          "contentStyle",
          "contentClassName",
        ]),
      );
      expect(propertyNames).not.toContain("children");
      expect(propertyNames).not.toContain("__unresolved");
    });

    it("keeps semantic fallback tuple and array properties bounded", () => {
      const result = generateDocsFromSource({
        source: `
          type NativeProps<T extends true> = T extends true
            ? {
                /** Tuple coordinates. */
                coords: [number, number]
                /** Readonly tuple coordinates. */
                readonlyCoords: readonly [string, number]
                /** List of tags. */
                tags: string[]
                /** Nested object value. */
                nested: {
                  value: string
                }
              }
            : never

          type ButtonProps = NativeProps<true>
        `,
        typeName: "ButtonProps",
        fileName: "semantic-tuples.ts",
      });

      const entry = result.entries[0];
      const coords = entry.properties.find((property) => property.name === "coords");
      const readonlyCoords = entry.properties.find(
        (property) => property.name === "readonlyCoords",
      );
      const tags = entry.properties.find((property) => property.name === "tags");
      const serialized = JSON.stringify(result);

      expect(coords?.type).toEqual({
        kind: "tuple",
        elements: [
          { kind: "primitive", name: "number" },
          { kind: "primitive", name: "number" },
        ],
      });
      expect(readonlyCoords?.type).toEqual({
        kind: "tuple",
        elements: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" },
        ],
      });
      expect(tags?.type).toEqual({
        kind: "array",
        elementType: { kind: "primitive", name: "string" },
      });
      expect(serialized).not.toContain('"push"');
      expect(serialized).not.toContain('"toString"');
      expect(serialized).not.toContain("typescript/lib");
    });

    it("keeps equivalent static and semantic fallback schema shapes aligned", () => {
      const source = `
          type SharedToken = 'primary' | 'secondary'

          type StaticProps = {
            /** Visible label. */
            label: string
            /**
             * Theme mode.
             * @default light
             */
            mode?: 'light' | 'dark'
            /** Immutable count. */
            readonly count: number
            /** Tuple coordinates. */
            coords: [number, number]
            /** Tag list. */
            tags: string[]
            /** Nested options. */
            nested: {
              /** Enabled flag. */
              enabled: boolean
              /** Numeric values. */
              values: number[]
            }
            /** Submit callback. */
            onSubmit: (id: string) => boolean
            /** Token reference. */
            token: SharedToken
          }

          declare function createSemanticProps(): {
            /** Visible label. */
            label: string
            /**
             * Theme mode.
             * @default light
             */
            mode?: 'light' | 'dark'
            /** Immutable count. */
            readonly count: number
            /** Tuple coordinates. */
            coords: [number, number]
            /** Tag list. */
            tags: string[]
            /** Nested options. */
            nested: {
              /** Enabled flag. */
              enabled: boolean
              /** Numeric values. */
              values: number[]
            }
            /** Submit callback. */
            onSubmit: (id: string) => boolean
            /** Token reference. */
            token: SharedToken
          }

          type SemanticProps = ReturnType<typeof createSemanticProps>
        `;
      const staticResult = generateDocsFromSource({
        source,
        typeName: "StaticProps",
        fileName: "schema-parity.ts",
      });
      const semanticResult = generateDocsFromSource({
        source,
        typeName: "SemanticProps",
        fileName: "schema-parity.ts",
      });

      expect(comparableEntryShape(semanticResult.entries[0])).toEqual(
        comparableEntryShape(staticResult.entries[0]),
      );
    });

    it("keeps unsupported object-like aliases explicit in static analysis mode", () => {
      const source = `
          declare function createButtonProps(): {
            label: string
          }

          type ButtonProps = ReturnType<typeof createButtonProps>
        `;
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "unsupported-utility-static.ts",
        config: { analysis: "static" },
      });

      expect(result.entries[0].properties.map((property) => property.name)).toEqual([
        "__unresolved",
      ]);
    });

    it("treats semantically empty object fallback as successful empty output", () => {
      const result = generateDocsFromSource({
        source: `
          declare function createEmptyProps(): {}

          type EmptyProps = ReturnType<typeof createEmptyProps>
        `,
        typeName: "EmptyProps",
        fileName: "semantic-empty-object.ts",
      });

      expect(result.entries[0].properties).toEqual([]);
      expect(result.entries[0].type).toEqual({ kind: "object", properties: [] });
    });

    it("keeps non-object unsupported utility aliases on the static reference path", () => {
      const result = generateDocsFromSource({
        source: `
          declare function getLabel(): string

          type LabelValue = ReturnType<typeof getLabel>
        `,
        typeName: "LabelValue",
        fileName: "semantic-non-object-return.ts",
      });

      expect(result.entries[0].properties).toEqual([]);
      expect(result.entries[0].type).toMatchObject({
        kind: "reference",
        name: "ReturnType",
      });
    });

    it("extracts properties with correct types", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });

      const props = result.entries[0].properties;
      expect(props).toHaveLength(5);

      const size = props.find((p) => p.name === "size")!;
      expect(size.optional).toBe(true);
      expect(size.type).toEqual({
        kind: "reference",
        name: "ButtonSize",
        target: { name: "ButtonSize", filePath: "simple-interface.ts" },
      });
      expect(size.description).toBe("Button size.");
      expect(size.tags).toEqual({ default: "m" });
      expect(size.defaultValue).toBe("m");

      const variant = props.find((p) => p.name === "variant")!;
      expect(variant.optional).toBe(false);
      expect(variant.type.kind).toBe("union");

      const disabled = props.find((p) => p.name === "disabled")!;
      expect(disabled.optional).toBe(true);
      expect(disabled.type).toEqual({ kind: "primitive", name: "boolean" });
    });

    it("extracts union type members for variant", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });

      const variant = result.entries[0].properties.find((p) => p.name === "variant")!;
      expect(variant.type).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'primary'" },
          { kind: "literal", value: "'secondary'" },
          { kind: "literal", value: "'ghost'" },
        ],
      });
    });

    it("extracts function type for onClick", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });

      const onClick = result.entries[0].properties.find((p) => p.name === "onClick")!;
      expect(onClick.optional).toBe(true);
      expect(onClick.type.kind).toBe("function");
      if (onClick.type.kind === "function") {
        expect(onClick.type.parameters).toHaveLength(1);
        expect(onClick.type.parameters[0].name).toBe("event");
        expect(onClick.type.returnType).toEqual({ kind: "intrinsic", name: "void" });
      }
    });

    it("extracts simple ButtonSize type alias", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonSize",
        fileName: "simple-interface.ts",
      });

      expect(result.entries).toHaveLength(1);
      const entry = result.entries[0];
      expect(entry.kind).toBe("typeAlias");
      expect(entry.type.kind).toBe("union");
    });

    it("returns empty entries for unknown type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DoesNotExist",
        fileName: "simple-interface.ts",
      });
      expect(result.entries).toHaveLength(0);
    });
  });

  describe("type alias", () => {
    const source = fixture("type-alias.ts");

    it("extracts ThemeConfig as a type alias with properties", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ThemeConfig",
        fileName: "type-alias.ts",
      });

      const entry = result.entries[0];
      expect(entry.kind).toBe("typeAlias");
      expect(entry.description).toBe("Configuration for the theme.");
      expect(entry.properties).toHaveLength(4);

      const primaryColor = entry.properties.find((p) => p.name === "primaryColor")!;
      expect(primaryColor.type).toEqual({ kind: "primitive", name: "string" });
      expect(primaryColor.tags).toEqual({ default: "#000000" });
      expect(primaryColor.defaultValue).toBe("#000000");

      const borderRadius = entry.properties.find((p) => p.name === "borderRadius")!;
      expect(borderRadius.readonly).toBe(true);
    });
  });

  describe("enums", () => {
    it("extracts string, numeric, auto-increment, mixed, and computed enum members", () => {
      const result = generateDocsFromSource({
        source: `
          /** Mixed enum. */
          enum Mixed {
            /** Starts at zero. */
            A,
            B = 4,
            C,
            D = "d",
            E = -1,
            F,
            G = 1 + 2,
            H,
          }
        `,
        typeName: "Mixed",
        fileName: "enum-semantics.ts",
      });

      const entry = result.entries[0];
      expect(entry.kind).toBe("enum");
      expect(entry.description).toBe("Mixed enum.");
      expect(entry.properties.map((property) => [property.name, property.type])).toEqual([
        ["A", { kind: "literal", value: "0" }],
        ["B", { kind: "literal", value: "4" }],
        ["C", { kind: "literal", value: "5" }],
        ["D", { kind: "literal", value: "'d'" }],
        ["E", { kind: "literal", value: "-1" }],
        ["F", { kind: "literal", value: "0" }],
        ["G", { kind: "literal", value: "3" }],
        ["H", { kind: "literal", value: "4" }],
      ]);
      expect(entry.type).toEqual({
        kind: "union",
        members: entry.properties.map((property) => property.type),
      });
      expect(entry.properties[0].description).toBe("Starts at zero.");
    });
  });

  describe("union types", () => {
    const source = fixture("union-types.ts");

    it("extracts string literal union", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "Size",
        fileName: "union-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("union");
      if (entry.type.kind === "union") {
        expect(entry.type.members).toHaveLength(5);
        expect(entry.type.members[0]).toEqual({ kind: "literal", value: "'xs'" });
      }
    });

    it("extracts primitive union", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "StringOrNumber",
        fileName: "union-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type).toEqual({
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" },
        ],
      });
    });

    it("extracts nullable union", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "NullableString",
        fileName: "union-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("union");
      if (entry.type.kind === "union") {
        expect(entry.type.members).toHaveLength(3);
      }
    });

    it("extracts discriminated union", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "Shape",
        fileName: "union-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("union");
      if (entry.type.kind === "union") {
        expect(entry.type.members).toHaveLength(3);
        expect(entry.type.members[0].kind).toBe("object");
      }
    });
  });

  describe("nested objects", () => {
    const source = fixture("nested-objects.ts");

    it("extracts nested inline object types", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "StyledProps",
        fileName: "nested-objects.ts",
      });

      const entry = result.entries[0];
      expect(entry.properties).toHaveLength(2);

      const style = entry.properties.find((p) => p.name === "style")!;
      expect(style.optional).toBe(true);
      expect(style.type.kind).toBe("object");
      if (style.type.kind === "object") {
        expect(style.type.properties).toHaveLength(3);
        const color = style.type.properties.find((p) => p.name === "color")!;
        expect(color.description).toBe("Text color.");
      }

      const layout = entry.properties.find((p) => p.name === "layout")!;
      expect(layout.type.kind).toBe("object");
      if (layout.type.kind === "object") {
        const margin = layout.type.properties.find((p) => p.name === "margin")!;
        expect(margin.type.kind).toBe("object");
        if (margin.type.kind === "object") {
          expect(margin.type.properties).toHaveLength(4);
        }
      }
    });
  });

  describe("generics", () => {
    const source = fixture("generics.ts");

    it("extracts generic type parameters", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "GenericOption",
        fileName: "generics.ts",
      });

      const entry = result.entries[0];
      expect(entry.typeParameters).toHaveLength(1);
      expect(entry.typeParameters[0].name).toBe("T");
      expect(entry.typeParameters[0].constraint).toBeUndefined();
    });

    it("extracts constrained generic parameters", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "GenericCollectionProps",
        fileName: "generics.ts",
      });

      const entry = result.entries[0];
      expect(entry.typeParameters).toHaveLength(1);
      const param = entry.typeParameters[0];
      expect(param.name).toBe("T");
      expect(param.constraint).toEqual({
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" },
        ],
      });
      expect(param.default).toEqual({ kind: "primitive", name: "string" });
    });

    it("preserves constrained generic defaults for display", () => {
      const result = generateDocsFromSource({
        source: `
          interface LinkProps<T extends 'a' | 'button' = 'a'> {
            /** Render target. */
            as?: T
          }
        `,
        typeName: "LinkProps",
        fileName: "generic-display-contract.ts",
      });

      const param = result.entries[0].typeParameters[0];
      expect(param).toEqual({
        name: "T",
        constraint: {
          kind: "union",
          members: [
            { kind: "literal", value: "'a'" },
            { kind: "literal", value: "'button'" },
          ],
        },
        default: { kind: "literal", value: "'a'" },
      });
      expect(result.entries[0].properties.find((p) => p.name === "as")?.type).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'a'" },
          { kind: "literal", value: "'button'" },
        ],
      });
    });

    it("uses generic defaults for property display when no constraint exists", () => {
      const result = generateDocsFromSource({
        source: `
          interface UseDefault<T = 'a'> {
            /** Render target. */
            as?: T
          }
        `,
        typeName: "UseDefault",
        fileName: "generic-default-display-contract.ts",
      });

      expect(result.entries[0].properties.find((p) => p.name === "as")?.type).toEqual({
        kind: "literal",
        value: "'a'",
      });
    });

    it("uses generic display policy for inherited properties", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps<T> {
            /** Render target. */
            as?: T
          }

          interface LinkProps<T extends 'a' | 'button' = 'a'> extends BaseProps<T> {
            /** Accessible label. */
            label: string
          }
        `,
        typeName: "LinkProps",
        fileName: "generic-inherited-display-contract.ts",
      });

      expect(result.entries[0].properties.find((prop) => prop.name === "as")?.type).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'a'" },
          { kind: "literal", value: "'button'" },
        ],
      });
    });

    it("preserves generic references in properties", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "GenericOption",
        fileName: "generics.ts",
      });

      const value = result.entries[0].properties.find((p) => p.name === "value")!;
      expect(value.type).toEqual({ kind: "reference", name: "T" });
    });

    it("extracts method signatures with generic params", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "GenericCollectionProps",
        fileName: "generics.ts",
      });

      const onChange = result.entries[0].properties.find((p) => p.name === "onChange")!;
      expect(onChange.type.kind).toBe("function");
    });

    it("substitutes generic type arguments when extracting referenced object props", () => {
      const result = generateDocsFromSource({
        source: `
          interface Box<T = string> {
            /** Boxed value. */
            value: T
            values: T[]
            map?: (value: T) => T
          }

          type NumberBox = Box<number>
          type DefaultBox = Box
          type PickedBox = Pick<Box<'token'>, 'value'>
        `,
        typeName: "NumberBox",
        fileName: "generic-substitution.ts",
      });

      const props = result.entries[0].properties;
      expect(props.find((p) => p.name === "value")?.type).toEqual({
        kind: "primitive",
        name: "number",
      });
      expect(props.find((p) => p.name === "values")?.type).toEqual({
        kind: "array",
        elementType: { kind: "primitive", name: "number" },
      });
      expect(props.find((p) => p.name === "map")?.type).toEqual({
        kind: "function",
        parameters: [
          {
            name: "value",
            type: { kind: "primitive", name: "number" },
            optional: false,
            rest: false,
          },
        ],
        returnType: { kind: "primitive", name: "number" },
      });

      const defaultResult = generateDocsFromSource({
        source: `
          interface Box<T = string> {
            value: T
          }

          type DefaultBox = Box
        `,
        typeName: "DefaultBox",
        fileName: "generic-default.ts",
      });
      expect(defaultResult.entries[0].properties[0].type).toEqual({
        kind: "primitive",
        name: "string",
      });

      const utilityResult = generateDocsFromSource({
        source: `
          interface Box<T> {
            value: T
            ignored: boolean
          }

          type PickedBox = Pick<Box<'token'>, 'value'>
        `,
        typeName: "PickedBox",
        fileName: "generic-utility.ts",
      });
      expect(utilityResult.entries[0].properties).toHaveLength(1);
      expect(utilityResult.entries[0].properties[0].type).toEqual({
        kind: "literal",
        value: "'token'",
      });
    });

    it("substitutes generic type arguments in interface heritage props", () => {
      const result = generateDocsFromSource({
        source: `
          interface Field<T> {
            value: T
          }

          interface TextField extends Field<string> {
            label: string
          }
        `,
        typeName: "TextField",
        fileName: "generic-extends.ts",
      });

      expect(result.entries[0].properties.map((p) => [p.name, p.type])).toEqual([
        ["value", { kind: "primitive", name: "string" }],
        ["label", { kind: "primitive", name: "string" }],
      ]);
    });

    it("substitutes generic type arguments through multi-level interface heritage", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseField<T> {
            value: T
          }

          interface Field<T> extends BaseField<T> {
            previous?: T
          }

          interface TextField extends Field<string> {
            label: string
          }
        `,
        typeName: "TextField",
        fileName: "generic-multi-extends.ts",
      });

      expect(result.entries[0].properties.map((p) => [p.name, p.type])).toEqual([
        ["value", { kind: "primitive", name: "string" }],
        ["previous", { kind: "primitive", name: "string" }],
        ["label", { kind: "primitive", name: "string" }],
      ]);
    });
  });

  describe("advanced types", () => {
    const source = fixture("advanced-types.ts");

    it("extracts conditional type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "IsString",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("conditional");
    });

    it("extracts indexed access type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DatabaseConfig",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("indexedAccess");
    });

    it("extracts tuple types", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "Point2D",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("tuple");
    });

    it("extracts template literal type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "EventName",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("templateLiteral");
    });

    it("extracts keyof type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ConfigKeys",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("keyof");
    });

    it("extracts function type alias", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "Formatter",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("function");
      if (entry.type.kind === "function") {
        expect(entry.type.parameters).toHaveLength(2);
        expect(entry.type.returnType).toEqual({ kind: "primitive", name: "string" });
      }
    });

    it("extracts intersection type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "WithTimestamp",
        fileName: "advanced-types.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("intersection");
    });

    it("extracts properties from intersection type aliases", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            /** Base prop. */
            base: string
          }

          type IntersectedProps = BaseProps & {
            /** Own prop. */
            own?: number
          }
        `,
        typeName: "IntersectedProps",
        fileName: "intersection-props.ts",
      });

      const propNames = result.entries[0].properties.map((p) => p.name);
      expect(propNames).toEqual(["base", "own"]);
      expect(result.entries[0].properties[0].description).toBe("Base prop.");
      expect(result.entries[0].properties[1].description).toBe("Own prop.");
    });

    it("extracts properties from common utility type aliases", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            /** Size prop. */
            size: 's' | 'm'
            /** Variant prop. */
            variant?: 'primary' | 'secondary'
            /** Internal prop. */
            internal: boolean
          }

          type PublicProps = Partial<Omit<BaseProps, 'internal'>> & Readonly<Pick<BaseProps, 'size'>>
        `,
        typeName: "PublicProps",
        fileName: "utility-props.ts",
      });

      const props = result.entries[0].properties;
      expect(props.map((p) => p.name)).toEqual(["variant", "size"]);

      const variant = props.find((p) => p.name === "variant")!;
      expect(variant.optional).toBe(true);
      expect(variant.description).toBe("Variant prop.");

      const size = props.find((p) => p.name === "size")!;
      expect(size.readonly).toBe(true);
      expect(size.description).toBe("Size prop.");
    });

    it("extracts properties from Record with literal keys", () => {
      const result = generateDocsFromSource({
        source: `
          type Slots = Record<'start' | 'end', string>
        `,
        typeName: "Slots",
        fileName: "record-props.ts",
      });

      expect(result.entries[0].properties.map((p) => p.name)).toEqual(["end", "start"]);
      expect(result.entries[0].properties[0].type).toEqual({ kind: "primitive", name: "string" });
    });

    it("extracts properties through NonNullable utility aliases", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            /** Label prop. */
            label: string
          }

          type PublicProps = NonNullable<BaseProps>
        `,
        typeName: "PublicProps",
        fileName: "nonnullable-utility.ts",
      });

      expect(result.entries[0].type).toEqual({
        kind: "reference",
        name: "BaseProps",
        target: { name: "BaseProps", filePath: "nonnullable-utility.ts" },
      });
      expect(result.entries[0].properties.map((p) => p.name)).toEqual(["label"]);
      expect(result.entries[0].properties[0].description).toBe("Label prop.");
    });

    it("does not emit synthetic unresolved rows in default hybrid output", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            label: string
          }

          type PublicProps = InstanceType<BaseProps>
        `,
        typeName: "PublicProps",
        fileName: "unsupported-utility.ts",
      });

      expect(result.entries[0].properties).toEqual([]);
      expect(result.entries[0].type).toEqual({
        kind: "reference",
        name: "InstanceType",
        typeArguments: [
          {
            kind: "reference",
            name: "BaseProps",
            target: { name: "BaseProps", filePath: "unsupported-utility.ts" },
          },
        ],
      });
    });

    it("uses semantic fallback for LinkProps-style conditional helper props", () => {
      const result = generateDocsFromSource({
        source: `
          type ElementType = 'a' | 'button'

          interface AnchorProps {
            /** Link target URL. */
            href: string
            /** Browser target. */
            target?: '_blank' | '_self'
          }

          interface ButtonNativeProps {
            /** Native disabled state. */
            disabled?: boolean
          }

          type ComponentPropsWithoutRef<T extends ElementType> = T extends 'a'
            ? AnchorProps
            : ButtonNativeProps

          type LinkProps = {
            /** Rendered element. */
            as?: 'a'
            /** Accessible label. */
            label: string
          } & ComponentPropsWithoutRef<'a'>
        `,
        typeName: "LinkProps",
        fileName: "semantic-link-props.ts",
      });

      const props = result.entries[0].properties;
      expect(props.map((prop) => prop.name)).toEqual(["as", "label", "href", "target"]);

      const href = props.find((prop) => prop.name === "href")!;
      expect(href.description).toBe("Link target URL.");
      expect(href.type).toEqual({ kind: "primitive", name: "string" });

      const target = props.find((prop) => prop.name === "target")!;
      expect(target.optional).toBe(true);
      expect(target.type).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'_blank'" },
          { kind: "literal", value: "'_self'" },
        ],
      });
    });

    it("does not expand external semantic props by default", () => {
      const root = mkdtempSync(join(tmpdir(), "oxc-docgen-external-"));
      const packageRoot = join(root, "node_modules", "external-lib");
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: "external-lib", types: "index.d.ts" }),
      );
      writeFileSync(
        join(packageRoot, "index.d.ts"),
        `
          export interface ExternalProps {
            /** External label from a dependency. */
            externalLabel: string
          }
        `,
      );

      const filePath = join(root, "props.ts");
      writeFileSync(
        filePath,
        `
          import type { ExternalProps } from 'external-lib'

          type ExternalWhenEnabled<T> = T extends true ? ExternalProps : {}

          export type PublicProps = {
            /** Local label. */
            label: string
          } & ExternalWhenEnabled<true>
        `,
      );

      const result = generateDocs({ filePath, typeName: "PublicProps" });

      expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
    });

    it("keeps unsupported utility extraction rows in static mode", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            label: string
          }

          type PublicProps = InstanceType<BaseProps>
        `,
        typeName: "PublicProps",
        fileName: "unsupported-utility-static.ts",
        config: { analysis: "static" },
      });

      expect(result.entries[0].properties).toEqual([
        expect.objectContaining({
          name: "__unresolved",
          type: { kind: "unresolved", text: "InstanceType<BaseProps>" },
        }),
      ]);
    });

    it("extracts nested supported utility composition through NonNullable", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            label: string
          }

          type PublicProps = Partial<NonNullable<BaseProps>>
        `,
        typeName: "PublicProps",
        fileName: "nested-nonnullable-utility.ts",
      });

      expect(result.entries[0].properties).toEqual([
        expect.objectContaining({
          name: "label",
          optional: true,
          type: { kind: "primitive", name: "string" },
        }),
      ]);
    });

    it("does not emit nested synthetic unresolved rows in default hybrid output", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            label: string
          }

          type PublicProps = Partial<InstanceType<BaseProps>>
        `,
        typeName: "PublicProps",
        fileName: "nested-unsupported-utility.ts",
      });

      expect(result.entries[0].properties).toEqual([]);
    });

    it("keeps nested unsupported utility extraction rows in static mode", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            label: string
          }

          type PublicProps = Partial<InstanceType<BaseProps>>
        `,
        typeName: "PublicProps",
        fileName: "nested-unsupported-utility-static.ts",
        config: { analysis: "static" },
      });

      expect(result.entries[0].properties).toEqual([
        expect.objectContaining({
          name: "__unresolved",
          type: { kind: "unresolved", text: "InstanceType<BaseProps>" },
        }),
      ]);
    });

    it("statically evaluates common non-object utility type aliases when bounded", () => {
      const source = `
        type PublicSize = NonNullable<'s' | 'm' | null | undefined>
        type ExtractedSize = Extract<'s' | 'm' | 'l', 's' | 'l'>
        type ExcludedSize = Exclude<'s' | 'm' | 'l', 'm'>
        type InlineReturn = ReturnType<(value: string) => number>
        type InlineParams = Parameters<(value: string, count?: number) => boolean>
      `;

      expect(
        generateDocsFromSource({
          source,
          typeName: "PublicSize",
          fileName: "utility-doc-types.ts",
        }).entries[0].type,
      ).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'s'" },
          { kind: "literal", value: "'m'" },
        ],
      });

      expect(
        generateDocsFromSource({
          source,
          typeName: "ExtractedSize",
          fileName: "utility-doc-types.ts",
        }).entries[0].type,
      ).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'s'" },
          { kind: "literal", value: "'l'" },
        ],
      });

      expect(
        generateDocsFromSource({
          source,
          typeName: "ExcludedSize",
          fileName: "utility-doc-types.ts",
        }).entries[0].type,
      ).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'s'" },
          { kind: "literal", value: "'l'" },
        ],
      });

      expect(
        generateDocsFromSource({
          source,
          typeName: "InlineReturn",
          fileName: "utility-doc-types.ts",
        }).entries[0].type,
      ).toEqual({ kind: "primitive", name: "number" });

      expect(
        generateDocsFromSource({
          source,
          typeName: "InlineParams",
          fileName: "utility-doc-types.ts",
        }).entries[0].type,
      ).toEqual({
        kind: "tuple",
        elements: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" },
        ],
      });
    });

    it("preserves recursive generic extraction max depth as unresolved in static mode", () => {
      const result = generateDocsFromSource({
        source: `
          type Recursive<T> = Recursive<T> & {
            value: T
          }

          type StringRecursive = Recursive<string>
        `,
        typeName: "StringRecursive",
        fileName: "recursive-generic.ts",
        config: { analysis: "static", maxDepth: 2 },
      });

      expect(result.entries[0].properties.map((p) => [p.name, p.type])).toEqual([
        ["__unresolved", { kind: "unresolved", text: "<max depth>" }],
        ["value", { kind: "primitive", name: "string" }],
      ]);
    });
  });

  describe("JSDoc tags", () => {
    const source = fixture("jsdoc-tags.ts");

    it("extracts multiple examples as array", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const title = result.entries[0].properties.find((p) => p.name === "title")!;
      expect(title.tags.example).toBeDefined();
      expect(Array.isArray(title.tags.example)).toBe(true);
    });

    it("extracts @deprecated tag", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const name = result.entries[0].properties.find((p) => p.name === "name")!;
      expect(name.tags.deprecated).toBe("Use `title` instead.");
    });

    it("extracts @default tag and populates defaultValue", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const size = result.entries[0].properties.find((p) => p.name === "size")!;
      expect(size.tags.default).toBe("medium");
      expect(size.defaultValue).toBe("medium");
    });

    it("extracts @internal tag", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const debug = result.entries[0].properties.find((p) => p.name === "_debug")!;
      expect(debug.tags.internal).toBeDefined();
    });

    it("extracts custom @category tag", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const width = result.entries[0].properties.find((p) => p.name === "width")!;
      expect(width.tags.category).toBe("Layout");
    });

    it("extracts interface-level tags", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });

      const entry = result.entries[0];
      expect(entry.tags.since).toBe("1.0.0");
      expect(entry.tags.see).toBeDefined();
    });

    it("normalizes configured custom tags and preserves malformed values", () => {
      const result = generateDocsFromSource({
        source: `
          /**
           * Tagged props.
           *
           * @status stable
           * @status beta
           * @range 1..5
           * @range malformed
           */
          interface TaggedProps {
            /** Visible label. */
            label: string
          }
        `,
        typeName: "TaggedProps",
        fileName: "custom-tags.ts",
        config: {
          tags: {
            status: (value) => ({ value }),
            range: (value) => {
              const match = value.match(/^(\d+)\.\.(\d+)$/);
              if (!match) throw new Error("Invalid range");
              return { min: Number(match[1]), max: Number(match[2]) };
            },
          },
        },
      });

      expect(result.entries[0].tags.status).toEqual([{ value: "stable" }, { value: "beta" }]);
      expect(result.entries[0].tags.range).toEqual([{ min: 1, max: 5 }, "malformed"]);
    });

    it("normalizes configured custom tags on semantic fallback properties", () => {
      const result = generateDocsFromSource({
        source: `
          interface NativeProps {
            /**
             * Visual density.
             *
             * @defaultValue compact
             * @status stable
             * @status beta
             * @range 1..5
             * @range malformed
             */
            density?: 'compact' | 'comfortable'
          }

          type NativeFor<T extends 'button'> = T extends 'button' ? NativeProps : never
          type ButtonProps = NativeFor<'button'>
        `,
        typeName: "ButtonProps",
        fileName: "semantic-custom-tags.ts",
        config: {
          tags: {
            status: (value) => ({ value }),
            range: (value) => {
              const match = value.match(/^(\d+)\.\.(\d+)$/);
              if (!match) {
                throw new Error("Invalid range");
              }

              return { min: Number(match[1]), max: Number(match[2]) };
            },
          },
        },
      });

      const density = result.entries[0].properties.find((property) => property.name === "density");
      expect(density?.tags.default).toBe("compact");
      expect(density?.defaultValue).toBe("compact");
      expect(density?.tags.status).toEqual([{ value: "stable" }, { value: "beta" }]);
      expect(density?.tags.range).toEqual([{ min: 1, max: 5 }, "malformed"]);
    });
  });

  describe("prop filtering", () => {
    it("filters after inherited and utility-composed props are resolved", () => {
      const result = generateDocsFromSource({
        source: `
          interface BaseProps {
            /** Base prop. */
            base: string
            internal: boolean
          }

          interface ButtonProps extends BaseProps {
            /** Button label. */
            label: string
            undocumented: number
          }
        `,
        typeName: "ButtonProps",
        fileName: "prop-filter.ts",
        config: {
          skipPropsWithName: ["internal"],
          skipPropsWithoutDoc: true,
          propFilter: (_prop, context) => context.ownerName === "ButtonProps",
        },
      });

      expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["base", "label"]);
      expect(result.entries[0].type).toEqual({
        kind: "object",
        properties: result.entries[0].properties,
      });
    });

    it("can skip properties sourced from another file", () => {
      const root = mkdtempSync(join(tmpdir(), "oxc-docgen-prop-filter-"));
      const baseFile = join(root, "base.ts");
      const buttonFile = join(root, "button.ts");
      writeFileSync(
        baseFile,
        ["export interface BaseProps {", "  /** Base prop. */", "  base: string", "}"].join("\n"),
      );
      writeFileSync(
        buttonFile,
        [
          "import type { BaseProps } from './base'",
          "export interface ButtonProps extends BaseProps {",
          "  /** Button label. */",
          "  label: string",
          "}",
        ].join("\n"),
      );

      const result = generateDocs({
        filePath: buttonFile,
        typeName: "ButtonProps",
        config: {
          skipPropsFromExternalFiles: true,
        },
      });

      expect(result.entries[0].properties.map((prop) => prop.name)).toEqual(["label"]);
    });
  });

  describe("edge cases", () => {
    const source = fixture("edge-cases.ts");

    it("handles empty interface", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "EmptyProps",
        fileName: "edge-cases.ts",
      });

      expect(result.entries[0].properties).toHaveLength(0);
    });

    it("handles interface without JSDoc on members", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "NoDocProps",
        fileName: "edge-cases.ts",
      });

      const props = result.entries[0].properties;
      expect(props).toHaveLength(3);
      expect(props[0].description).toBe("");
    });

    it("handles method signatures", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "WithMethods",
        fileName: "edge-cases.ts",
      });

      const props = result.entries[0].properties;
      expect(props).toHaveLength(3);

      const getName = props.find((p) => p.name === "getName")!;
      expect(getName.type.kind).toBe("function");

      const calculate = props.find((p) => p.name === "calculate")!;
      expect(calculate.type.kind).toBe("function");
      if (calculate.type.kind === "function") {
        expect(calculate.type.parameters).toHaveLength(3);
        expect(calculate.type.parameters[2].optional).toBe(true);
      }
    });

    it("handles string literal keys", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "StringKeys",
        fileName: "edge-cases.ts",
      });

      const props = result.entries[0].properties;
      expect(props.find((p) => p.name === "data-testid")).toBeDefined();
      expect(props.find((p) => p.name === "aria-label")).toBeDefined();
    });

    it("handles numeric literal type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "HttpStatus",
        fileName: "edge-cases.ts",
      });

      const entry = result.entries[0];
      expect(entry.type.kind).toBe("union");
      if (entry.type.kind === "union") {
        expect(entry.type.members).toHaveLength(3);
        expect(entry.type.members[0]).toEqual({ kind: "literal", value: "200" });
      }
    });

    it("handles boolean literal type", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "True",
        fileName: "edge-cases.ts",
      });

      const entry = result.entries[0];
      expect(entry.type).toEqual({ kind: "literal", value: "true" });
    });
  });

  describe("representative component props", () => {
    const source = fixture("real-component-props.ts");

    it("extracts library-style button props through intersections, utilities, and heritage", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "real-component-props.ts",
      });

      expect(result.entries[0].properties.map((prop) => prop.name)).toEqual([
        "qa",
        "aria-label",
        "aria-labelledby",
        "size",
        "view",
        "disabled",
        "children",
        "id",
        "className",
        "loading",
        "onClick",
      ]);
      expect(result.entries[0].properties.find((prop) => prop.name === "size")?.type).toEqual({
        kind: "reference",
        name: "ButtonSize",
        target: { name: "ButtonSize", filePath: "real-component-props.ts" },
      });
      expect(result.related?.map((entry) => entry.name)).toContain("ButtonSize");
    });

    it("extracts library-style text field props through validation and layout composition", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "TextFieldProps",
        fileName: "real-component-props.ts",
      });

      expect(result.entries[0].properties.map((prop) => prop.name)).toEqual([
        "aria-label",
        "aria-labelledby",
        "isInvalid",
        "validationState",
        "value",
        "placeholder",
        "onChange",
        "id",
        "className",
        "label",
        "description",
      ]);
      expect(
        result.entries[0].properties.find((prop) => prop.name === "validationState")?.type,
      ).toEqual({
        kind: "union",
        members: [
          { kind: "literal", value: "'valid'" },
          { kind: "literal", value: "'invalid'" },
        ],
      });
    });
  });

  describe("snapshot tests", () => {
    it("ButtonProps output matches snapshot", () => {
      const source = fixture("simple-interface.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "ButtonProps",
        fileName: "simple-interface.ts",
      });
      expect(result).toMatchSnapshot();
    });

    it("ThemeConfig output matches snapshot", () => {
      const source = fixture("type-alias.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "ThemeConfig",
        fileName: "type-alias.ts",
      });
      expect(result).toMatchSnapshot();
    });

    it("StyledProps output matches snapshot", () => {
      const source = fixture("nested-objects.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "StyledProps",
        fileName: "nested-objects.ts",
      });
      expect(result).toMatchSnapshot();
    });

    it("GenericCollectionProps output matches snapshot", () => {
      const source = fixture("generics.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "GenericCollectionProps",
        fileName: "generics.ts",
      });
      expect(result).toMatchSnapshot();
    });

    it("DocumentedProps output matches snapshot", () => {
      const source = fixture("jsdoc-tags.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "DocumentedProps",
        fileName: "jsdoc-tags.ts",
      });
      expect(result).toMatchSnapshot();
    });
  });
});
