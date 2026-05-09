import { describe, expect, it } from "vitest";

import type { SemanticFallbackResolver } from "../../src/resolver/resolution-controller";
import type { DocEntry } from "../../src/schema/doc-schema";

import { resolveConfig } from "../../src/public/config";
import { parseSource } from "../../src/resolver/parser";
import { ResolutionController } from "../../src/resolver/resolution-controller";
import { TypeResolver } from "../../src/resolver/resolver";
import { TypeScriptSemanticFallbackResolver } from "../../src/semantic/semantic-property-resolver";

describe("ResolutionController", () => {
  it("does not call semantic fallback for fully resolved static entries", () => {
    const source = "interface ButtonProps { label: string }\n";
    const parsed = parseSource(source, "button.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    let calls = 0;
    const semanticFallback: SemanticFallbackResolver = {
      resolveEntry() {
        calls++;
        return undefined;
      },
    };

    const result = new ResolutionController({ config, resolver, semanticFallback }).resolveEntry({
      parsed,
      typeName: "ButtonProps",
      filePath: "button.ts",
    });

    expect(result.status).toBe("resolved");
    expect(result.usedSemanticFallback).toBe(false);
    expect(result.fallbackReason).toBe("staticResolved");
    expect(result.entry?.properties.map((prop) => prop.name)).toEqual(["label"]);
    expect(calls).toBe(0);
  });

  it("returns an opaque static outcome for unresolved targets", () => {
    const source = "interface ButtonProps { label: string }\n";
    const parsed = parseSource(source, "button.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);

    const result = new ResolutionController({ config, resolver }).resolveEntry({
      parsed,
      typeName: "MissingProps",
      filePath: "button.ts",
    });

    expect(result.status).toBe("opaque");
    expect(result.usedSemanticFallback).toBe(false);
    expect(result.fallbackReason).toBe("staticOpaque");
    expect(result.entry).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("marks unsupported object extraction as a semantic fallback boundary in hybrid mode", () => {
    const source = `
      type ElementType = 'a' | 'button'
      interface AnchorProps { href: string }
      interface ButtonNativeProps { disabled?: boolean }
      type ComponentPropsWithoutRef<T extends ElementType> = T extends 'a'
        ? AnchorProps
        : ButtonNativeProps

      type LinkProps = { label: string } & ComponentPropsWithoutRef<'a'>
    `;
    const parsed = parseSource(source, "fallback.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);

    const result = new ResolutionController({ config, resolver }).resolveEntry({
      parsed,
      typeName: "LinkProps",
      filePath: "fallback.ts",
    });

    expect(result.status).toBe("semanticFallbackRequired");
    expect(result.usedSemanticFallback).toBe(false);
    expect(result.fallbackReason).toBe("semanticFallbackUnavailable");
    expect(result.entry?.properties.map((prop) => prop.name)).toEqual(["label"]);
  });

  it("marks unsupported top-level utility aliases as a semantic fallback boundary in hybrid mode", () => {
    const source = `
      declare function createButtonProps(): {
        label: string
      }

      type ButtonProps = ReturnType<typeof createButtonProps>
    `;
    const parsed = parseSource(source, "unsupported-utility.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);

    const result = new ResolutionController({ config, resolver }).resolveEntry({
      parsed,
      typeName: "ButtonProps",
      filePath: "unsupported-utility.ts",
    });

    expect(result.status).toBe("semanticFallbackRequired");
    expect(result.usedSemanticFallback).toBe(false);
    expect(result.fallbackReason).toBe("semanticFallbackUnavailable");
    expect(result.entry?.properties).toEqual([]);
  });

  it("uses semantic fallback for intentionally empty object-like aliases", () => {
    const source = `
      declare function createEmptyProps(): {}

      type EmptyProps = ReturnType<typeof createEmptyProps>
    `;
    const parsed = parseSource(source, "semantic-empty.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);

    const result = new ResolutionController({
      config,
      resolver,
      semanticFallback: new TypeScriptSemanticFallbackResolver(config, resolver),
    }).resolveEntry({
      parsed,
      typeName: "EmptyProps",
      filePath: "semantic-empty.ts",
      sourceText: source,
    });

    expect(result.status).toBe("resolved");
    expect(result.usedSemanticFallback).toBe(true);
    expect(result.fallbackReason).toBe("semanticFallbackSucceeded");
    expect(result.entry?.properties).toEqual([]);
    expect(result.entry?.type).toEqual({ kind: "object", properties: [] });
  });

  it("uses semantic fallback output only when hybrid static extraction requires it", () => {
    const source = `
      type ElementType = 'a' | 'button'
      interface AnchorProps { href: string }
      interface ButtonNativeProps { disabled?: boolean }
      type ComponentPropsWithoutRef<T extends ElementType> = T extends 'a'
        ? AnchorProps
        : ButtonNativeProps

      type LinkProps = { label: string } & ComponentPropsWithoutRef<'a'>
    `;
    const parsed = parseSource(source, "semantic.ts");
    const config = resolveConfig();
    const resolver = new TypeResolver(config);
    const semanticFallback: SemanticFallbackResolver = {
      resolveEntry(request) {
        return {
          ...request.staticEntry,
          properties: [
            {
              name: "label",
              type: { kind: "primitive", name: "string" },
              optional: false,
              readonly: false,
              description: "",
              tags: {},
              defaultValue: undefined,
              source: request.staticEntry.source,
            },
          ],
        } satisfies DocEntry;
      },
    };

    const result = new ResolutionController({ config, resolver, semanticFallback }).resolveEntry({
      parsed,
      typeName: "LinkProps",
      filePath: "semantic.ts",
    });

    expect(result.status).toBe("resolved");
    expect(result.usedSemanticFallback).toBe(true);
    expect(result.fallbackReason).toBe("semanticFallbackSucceeded");
    expect(result.entry?.properties.map((prop) => prop.name)).toEqual(["label"]);
  });

  it("keeps static unresolved rows in static analysis mode without invoking fallback", () => {
    const source = `
      interface BaseProps {
        label: string
      }

      type PublicProps = InstanceType<BaseProps>
    `;
    const config = resolveConfig({ analysis: "static" });
    const parsed = parseSource(source, "static.ts");
    const resolver = new TypeResolver(config);
    let calls = 0;
    const semanticFallback: SemanticFallbackResolver = {
      resolveEntry() {
        calls++;
        return undefined;
      },
    };

    const result = new ResolutionController({ config, resolver, semanticFallback }).resolveEntry({
      parsed,
      typeName: "PublicProps",
      filePath: "static.ts",
    });

    expect(result.status).toBe("semanticFallbackRequired");
    expect(result.usedSemanticFallback).toBe(false);
    expect(result.fallbackReason).toBe("staticAnalysis");
    expect(result.entry?.properties.map((prop) => prop.name)).toEqual(["__unresolved"]);
    expect(calls).toBe(0);
  });
});
