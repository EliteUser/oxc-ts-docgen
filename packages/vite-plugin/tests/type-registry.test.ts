import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@oxc-ts-docgen/docgen";
import { transformGetDocs } from "../src/transform";
import { TypeRegistry } from "../src/type-registry";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

describe("TypeRegistry HMR invalidation", () => {
  it("invalidates consumers when a type is renamed or removed", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const typesFile = join(root, "types.ts");
    const consumerFile = join(root, "consumer.ts");

    writeFileSync(typesFile, "export interface OldProps { label: string }\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer(consumerFile, "OldProps", typesFile);

    writeFileSync(typesFile, "export interface NewProps { label: string }\n");

    const affected = registry.invalidateFile(typesFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
  });

  it("invalidates consumers when an aliased base interface changes", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const baseFile = join(root, "base.ts");
    const childFile = join(root, "child.ts");
    const consumerFile = join(root, "consumer.ts");

    mkdirSync(root, { recursive: true });
    writeFileSync(baseFile, "export interface BaseProps { base: string }\n");
    writeFileSync(
      childFile,
      [
        "import type { BaseProps as RenamedBase } from './base'",
        "export interface ChildProps extends RenamedBase { child: string }",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer(consumerFile, "ChildProps", childFile);

    writeFileSync(baseFile, "export interface BaseProps { base: string; added: boolean }\n");

    const affected = registry.invalidateFile(baseFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
  });

  it("rebuilds doc-only JSDoc changes across remove and restore edits", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");

    const source = (defaultTag: string) => `
      export type ButtonSize = 's' | 'm'

      export interface ButtonProps {
        /**
         * The size of the button.
         *
         * ${defaultTag}
         */
        size?: ButtonSize
      }
    `;

    writeFileSync(typesFile, source("@default m"));

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer(consumerFile, "ButtonProps", typesFile);

    writeFileSync(typesFile, source("@default"));
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));

    let size = registry
      .getEntry("ButtonProps", typesFile)
      ?.properties.find((p) => p.name === "size");
    expect(size?.defaultValue).toBeUndefined();

    writeFileSync(typesFile, source("@default m"));
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));

    size = registry.getEntry("ButtonProps", typesFile)?.properties.find((p) => p.name === "size");
    expect(size?.defaultValue).toBe("m");
  });

  it("invalidates consumers when an imported property reference changes", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const sizeFile = join(root, "size.ts");
    const buttonFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(sizeFile, "export type ButtonSize = 's' | 'm'\n");
    writeFileSync(
      buttonFile,
      [
        "import type { ButtonSize } from './size'",
        "export interface ButtonProps {",
        "  /** Button size. */",
        "  size?: ButtonSize",
        "}",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer(consumerFile, "ButtonProps", buttonFile);

    writeFileSync(sizeFile, "export type ButtonSize = 's' | 'm' | 'l'\n");

    const affected = registry.invalidateFile(sizeFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
  });

  it("respects include and exclude globs during startup scans", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const srcDir = join(root, "src");
    const testDir = join(root, "tests");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const includedFile = join(srcDir, "included.ts");
    const excludedFile = join(testDir, "excluded.ts");
    writeFileSync(includedFile, "export interface IncludedProps { label: string }\n");
    writeFileSync(excludedFile, "export interface ExcludedProps { label: string }\n");

    const registry = new TypeRegistry(
      resolveConfig({
        include: ["src/**/*.ts"],
        exclude: ["**/*.test.ts", "tests/**"],
      }),
    );
    registry.initialize(root);

    expect(registry.getEntry("IncludedProps")).toBeDefined();
    expect(registry.getEntry("ExcludedProps")).toBeUndefined();
  });

  it("resets stale entries and consumers on repeated initialization", () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const firstFile = join(firstRoot, "first.ts");
    const secondFile = join(secondRoot, "second.ts");
    const consumerFile = join(firstRoot, "consumer.ts");

    writeFileSync(firstFile, "export interface FirstProps { label: string }\n");
    writeFileSync(secondFile, "export interface SecondProps { label: string }\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(firstRoot);
    registry.registerConsumer(consumerFile, "FirstProps", firstFile);

    registry.initialize(secondRoot);

    expect(registry.getEntry("FirstProps")).toBeUndefined();
    expect(registry.getEntry("SecondProps")).toBeDefined();

    writeFileSync(firstFile, "export interface FirstProps { label: string; changed: boolean }\n");
    expect(registry.invalidateFile(firstFile)).toEqual([]);
  });

  it("keeps unresolved consumers registered so removed types can recover on restore", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer(consumerFile, "ButtonProps", typesFile);

    writeFileSync(typesFile, "export interface OtherProps { label: string }\n");
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));

    const consumerCode = `
      import { getDocs } from '@oxc-ts-docgen/docgen'
      import type { ButtonProps } from './button'

      export const docs = getDocs<ButtonProps>()
    `;
    registry.clearConsumer(consumerFile);
    expect(transformGetDocs(consumerCode, consumerFile, {}, { registry })).toBeNull();

    writeFileSync(typesFile, "export interface ButtonProps { label: string; restored: boolean }\n");
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));
  });

  it("invalidates consumers that import getDocs types through barrel files", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-barrel-"));
    const buttonFile = join(root, "button.ts");
    const barrelFile = join(root, "index.ts");
    const consumerFile = join(root, "main.ts");

    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);

    const consumerCode = `
      import { getDocs } from '@oxc-ts-docgen/docgen'
      import type { PublicButtonProps } from './index'

      export const docs = getDocs<PublicButtonProps>()
    `;
    expect(transformGetDocs(consumerCode, consumerFile, {}, { registry })).not.toBeNull();

    writeFileSync(buttonFile, "export interface ButtonProps { label: string; added: boolean }\n");
    expect(registry.invalidateFile(buttonFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");
    expect(registry.invalidateFile(barrelFile).map(normalize)).toContain(normalize(consumerFile));
  });
});
