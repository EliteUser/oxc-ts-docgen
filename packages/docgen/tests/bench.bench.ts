import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, bench } from "vitest";
import { generateDocsFromSource, generateDocs } from "../src/index";

function fixture(name: string): string {
  const filePath = resolve(__dirname, "fixtures", name);
  return readFileSync(filePath, "utf-8");
}

const aliasBarrelFixture = createAliasBarrelFixture();

describe("benchmarks", () => {
  bench("parse simple interface", () => {
    const source = fixture("simple-interface.ts");
    generateDocsFromSource({
      source,
      typeName: "ButtonProps",
      fileName: "simple-interface.ts",
    });
  });

  bench("parse type alias with JSDoc", () => {
    const source = fixture("type-alias.ts");
    generateDocsFromSource({
      source,
      typeName: "ThemeConfig",
      fileName: "type-alias.ts",
    });
  });

  bench("parse nested objects", () => {
    const source = fixture("nested-objects.ts");
    generateDocsFromSource({
      source,
      typeName: "StyledProps",
      fileName: "nested-objects.ts",
    });
  });

  bench("parse generics", () => {
    const source = fixture("generics.ts");
    generateDocsFromSource({
      source,
      typeName: "SelectProps",
      fileName: "generics.ts",
    });
  });

  bench("parse advanced types", () => {
    const source = fixture("advanced-types.ts");
    generateDocsFromSource({
      source,
      typeName: "Config",
      fileName: "advanced-types.ts",
    });
  });

  bench("parse with JSDoc tags", () => {
    const source = fixture("jsdoc-tags.ts");
    generateDocsFromSource({
      source,
      typeName: "DocumentedProps",
      fileName: "jsdoc-tags.ts",
    });
  });

  bench("file-based with cross-file resolution", () => {
    generateDocs({
      filePath: resolve(__dirname, "fixtures", "cross-file", "button.ts"),
      typeName: "ButtonProps",
    });
  });

  bench("multi-level inheritance resolution", () => {
    generateDocs({
      filePath: resolve(__dirname, "fixtures", "cross-file", "icon-button.ts"),
      typeName: "IconButtonProps",
    });
  });

  bench("alias and barrel-heavy resolution", () => {
    generateDocs({
      filePath: aliasBarrelFixture,
      typeName: "ButtonProps",
    });
  });
});

function createAliasBarrelFixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-alias-barrel-"));
  const srcDir = join(root, "src");
  const typesDir = join(srcDir, "types");
  mkdirSync(typesDir, { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@types/*": ["src/types/*"],
        },
      },
    }),
  );
  writeFileSync(
    join(typesDir, "base.ts"),
    [
      "export interface BaseProps {",
      "  /** Stable id. */",
      "  id?: string",
      "  /** Visual tone. */",
      "  tone?: 'neutral' | 'brand'",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(typesDir, "nested.ts"),
    "export type { BaseProps as PublicBaseProps } from './base'\n",
  );
  writeFileSync(join(typesDir, "index.ts"), "export * from './nested'\n");

  const buttonFile = join(srcDir, "button.ts");
  writeFileSync(
    buttonFile,
    [
      "import type { PublicBaseProps } from '@types/index'",
      "export interface ButtonProps extends PublicBaseProps {",
      "  /** Button label. */",
      "  label: string",
      "  /** Disabled state. */",
      "  disabled?: boolean",
      "}",
    ].join("\n"),
  );

  return buttonFile;
}
