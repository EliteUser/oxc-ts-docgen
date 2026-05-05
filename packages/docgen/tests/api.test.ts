import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { generateDocsFromSource } from "../src/index";

function fixture(name: string): string {
  const filePath = resolve(__dirname, "fixtures", name);
  return readFileSync(filePath, "utf-8");
}

describe("generateDocsFromSource", () => {
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

    it("includes related project types for props table / popovers", () => {
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
      expect(size.type).toEqual({ kind: "reference", name: "ButtonSize" });
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
        typeName: "SelectOption",
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
        typeName: "SelectProps",
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

    it("preserves generic references in properties", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "SelectOption",
        fileName: "generics.ts",
      });

      const value = result.entries[0].properties.find((p) => p.name === "value")!;
      expect(value.type).toEqual({ kind: "reference", name: "T" });
    });

    it("extracts method signatures with generic params", () => {
      const result = generateDocsFromSource({
        source,
        typeName: "SelectProps",
        fileName: "generics.ts",
      });

      const onChange = result.entries[0].properties.find((p) => p.name === "onChange")!;
      expect(onChange.type.kind).toBe("function");
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
      expect(name.tags.deprecated).toBeDefined();
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

    it("SelectProps output matches snapshot", () => {
      const source = fixture("generics.ts");
      const result = generateDocsFromSource({
        source,
        typeName: "SelectProps",
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
