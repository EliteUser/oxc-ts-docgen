import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateDocs } from "../../src/index";

describe("heritage resolution", () => {
  it("merges multi-level inherited interface properties with generic substitution", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-heritage-"));
    const baseFile = join(root, "base.ts");
    const middleFile = join(root, "middle.ts");
    const publicFile = join(root, "public.ts");

    writeFileSync(
      baseFile,
      [
        "export interface GrandProps {",
        "  /** Grand property. */",
        "  grand: boolean",
        "}",
        "export interface BaseProps<T = 'default'> extends GrandProps {",
        "  /** Generic value. */",
        "  value: T",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      middleFile,
      [
        "import type { BaseProps } from './base'",
        "export interface MiddleProps extends BaseProps<'resolved'> {",
        "  /** Middle property. */",
        "  middle: number",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { MiddleProps } from './middle'",
        "export interface PublicProps extends MiddleProps {",
        "  /** Own property. */",
        "  own: string",
        "}",
      ].join("\n"),
    );

    const schema = generateDocs({ filePath: publicFile, typeName: "PublicProps" });

    expect(schema.entries[0].properties.map((property) => property.name)).toEqual([
      "grand",
      "value",
      "middle",
      "own",
    ]);
    expect(
      schema.entries[0].properties.find((property) => property.name === "value")?.type,
    ).toEqual({
      kind: "literal",
      value: "'resolved'",
    });
  });

  it("extracts inherited object properties from type aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-heritage-alias-"));
    const baseFile = join(root, "base.ts");
    const publicFile = join(root, "public.ts");

    writeFileSync(
      baseFile,
      ["export type AliasBase<T> = {", "  /** Alias property. */", "  alias: T", "}"].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { AliasBase } from './base'",
        "export interface PublicProps extends AliasBase<'alias-value'> {",
        "  /** Own property. */",
        "  own: string",
        "}",
      ].join("\n"),
    );

    const schema = generateDocs({ filePath: publicFile, typeName: "PublicProps" });

    expect(schema.entries[0].properties.map((property) => property.name)).toEqual(["alias", "own"]);
    expect(schema.entries[0].properties[0].description).toBe("Alias property.");
    expect(schema.entries[0].properties[0].type).toEqual({
      kind: "literal",
      value: "'alias-value'",
    });
  });
});
