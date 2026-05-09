import { resolveConfig } from "@synthfall/oxc-ts-docgen";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createConfigHash } from "../../../docgen/src/public/config";
import { TypeRegistry } from "../../src/registry/type-registry";
import { transformGetDocs } from "../../src/transform/transform";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

describe("TypeRegistry HMR invalidation", () => {
  it("uses stable config hashes in schema cache keys", () => {
    const firstConfig = resolveConfig({
      externalTypes: "reference",
      ignoreTypes: ["ReactNode", "HTMLAttributes"],
      maxDepth: 2,
    });
    const equivalentConfig = resolveConfig({
      maxDepth: 2,
      ignoreTypes: ["ReactNode", "HTMLAttributes"],
      externalTypes: "reference",
    });
    const changedConfig = resolveConfig({
      externalTypes: "reference",
      ignoreTypes: ["ReactNode", "HTMLAttributes"],
      maxDepth: 4,
    });

    expect(createConfigHash(firstConfig)).toBe(createConfigHash(equivalentConfig));
    expect(createConfigHash(firstConfig)).not.toBe(createConfigHash(changedConfig));

    const registry = new TypeRegistry(firstConfig, { buildMode: "indexOnly" });
    const key = registry.getSchemaCacheKey("ButtonProps", "src/button.ts");
    expect(key).toContain(registry.getConfigHash());
    expect(key).toContain("src/button.ts:ButtonProps");
  });

  it("can index startup declarations without eagerly building doc entries", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-index-only-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "export interface PublicProps { label: string }",
        "interface InternalProps { value: string }",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);

    expect(registry.getIndexedTypeCount()).toBe(2);
    expect(registry.getBuiltEntryCount()).toBe(0);

    const firstSchema = registry.getSchema("PublicProps", typesFile);
    expect(firstSchema?.entries[0].name).toBe("PublicProps");
    expect(registry.getBuiltEntryCount()).toBe(1);
    expect(registry.getSchema("PublicProps", typesFile)).toBe(firstSchema);
  });

  it("caches related entries together with the primary schema", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-related-cache-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "export type TokenName = 'primary' | 'secondary'",
        "export interface ButtonProps {",
        "  token: TokenName",
        "}",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);

    const firstSchema = registry.getSchema("ButtonProps", typesFile);
    expect(firstSchema?.related?.map((entry) => entry.name)).toEqual(["TokenName"]);
    expect(registry.getSchema("ButtonProps", typesFile)).toBe(firstSchema);
  });

  it("can eagerly build only exported declarations during startup", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-eager-public-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "export interface PublicProps { label: string }",
        "interface InternalProps { value: string }",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "eagerPublic" });
    registry.initialize(root);

    expect(registry.getIndexedTypeCount()).toBe(2);
    expect(registry.getBuiltEntryCount()).toBe(1);

    expect(registry.getSchema("InternalProps", typesFile)?.entries[0].name).toBe("InternalProps");
    expect(registry.getBuiltEntryCount()).toBe(2);
  });

  it("surfaces cached static extraction diagnostics through the registry", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-static-diagnostics-"));
    const typesFile = join(root, "types.ts");

    writeFileSync(
      typesFile,
      [
        "declare function createButtonProps(): { label: string }",
        "export type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig({ analysis: "static" }));
    registry.initialize(root);

    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "static-extraction-incomplete",
        filePath: normalize(typesFile),
      }),
    ]);
  });

  it("invalidates consumers when a type is renamed or removed", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-"));
    const typesFile = join(root, "types.ts");
    const consumerFile = join(root, "consumer.ts");

    writeFileSync(typesFile, "export interface OldProps { label: string }\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "OldProps",
      sourceFile: typesFile,
    });

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
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ChildProps",
      sourceFile: childFile,
    });

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
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ButtonProps",
      sourceFile: typesFile,
    });

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
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ButtonProps",
      sourceFile: buttonFile,
    });

    writeFileSync(sizeFile, "export type ButtonSize = 's' | 'm' | 'l'\n");

    const affected = registry.invalidateFile(sizeFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
  });

  it("invalidates consumers when an inherited property source reference changes", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-inherited-source-"));
    const tokenFile = join(root, "tokens.ts");
    const baseFile = join(root, "base.ts");
    const publicFile = join(root, "public.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary'\n");
    writeFileSync(
      baseFile,
      [
        "import type { TokenName } from './tokens'",
        "export interface BaseProps {",
        "  /** Design token. */",
        "  token?: TokenName",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { BaseProps } from './base'",
        "export interface PublicProps extends BaseProps {",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    const firstSchema = registry.getSchema("PublicProps", publicFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "PublicProps",
      sourceFile: publicFile,
    });

    expect(firstSchema?.related?.map((entry) => entry.name)).toEqual(["TokenName"]);

    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary' | 'danger'\n");

    const affected = registry.invalidateFile(tokenFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
    expect(
      registry
        .getSchema("PublicProps", publicFile)
        ?.related?.find((entry) => entry.name === "TokenName")?.type,
    ).toEqual({
      kind: "union",
      members: [
        { kind: "literal", value: "'primary'" },
        { kind: "literal", value: "'secondary'" },
        { kind: "literal", value: "'danger'" },
      ],
    });
  });

  it("uses inherited property source files for same-name dependency collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-same-name-source-"));
    const inheritedTokenFile = join(root, "inherited-token.ts");
    const localTokenFile = join(root, "local-token.ts");
    const baseFile = join(root, "base.ts");
    const publicFile = join(root, "public.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(inheritedTokenFile, "export type TokenName = 'inherited'\n");
    writeFileSync(localTokenFile, "export type TokenName = 'local'\n");
    writeFileSync(
      baseFile,
      [
        "import type { TokenName } from './inherited-token'",
        "export interface BaseProps {",
        "  /** Inherited design token. */",
        "  token?: TokenName",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { BaseProps } from './base'",
        "import type { TokenName } from './local-token'",
        "export interface PublicProps extends BaseProps {",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("PublicProps", publicFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "PublicProps",
      sourceFile: publicFile,
    });

    writeFileSync(localTokenFile, "export type TokenName = 'local' | 'ignored'\n");
    expect(registry.invalidateFile(localTokenFile).map(normalize)).not.toContain(
      normalize(consumerFile),
    );

    writeFileSync(inheritedTokenFile, "export type TokenName = 'inherited' | 'updated'\n");
    expect(registry.invalidateFile(inheritedTokenFile).map(normalize)).toContain(
      normalize(consumerFile),
    );
    expect(
      registry
        .getSchema("PublicProps", publicFile)
        ?.related?.find((entry) => entry.name === "TokenName")?.type,
    ).toEqual({
      kind: "union",
      members: [
        { kind: "literal", value: "'inherited'" },
        { kind: "literal", value: "'updated'" },
      ],
    });
  });

  it("invalidates consumers when transitive related type files change", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-related-source-"));
    const tokenFile = join(root, "tokens.ts");
    const baseFile = join(root, "base.ts");
    const publicFile = join(root, "public.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary'\n");
    writeFileSync(
      baseFile,
      [
        "import type { TokenName } from './tokens'",
        "export interface BaseProps {",
        "  /** Design token. */",
        "  token?: TokenName",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { BaseProps } from './base'",
        "export interface PublicProps {",
        "  /** Nested base props. */",
        "  base?: BaseProps",
        "}",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("PublicProps", publicFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "PublicProps",
      sourceFile: publicFile,
    });

    writeFileSync(tokenFile, "export type TokenName = 'primary' | 'secondary' | 'danger'\n");

    const affected = registry.invalidateFile(tokenFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
    expect(
      registry
        .getSchema("PublicProps", publicFile)
        ?.related?.find((entry) => entry.name === "TokenName")?.type,
    ).toEqual({
      kind: "union",
      members: [
        { kind: "literal", value: "'primary'" },
        { kind: "literal", value: "'secondary'" },
        { kind: "literal", value: "'danger'" },
      ],
    });
  });

  it("invalidates consumers when semantic fallback property source files change", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-semantic-source-"));
    const nativeFile = join(root, "native.ts");
    const helperFile = join(root, "helper.ts");
    const linkFile = join(root, "link.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(
      nativeFile,
      ["export interface AnchorProps {", "  /** Link target URL. */", "  href?: string", "}"].join(
        "\n",
      ),
    );
    writeFileSync(
      helperFile,
      [
        "import type { AnchorProps } from './native'",
        "export type NativeProps<T extends 'a' | 'button'> = T extends 'a'",
        "  ? AnchorProps",
        "  : { disabled?: boolean }",
      ].join("\n"),
    );
    writeFileSync(
      linkFile,
      [
        "import type { NativeProps } from './helper'",
        "export type LinkProps = {",
        "  /** Accessible label. */",
        "  label: string",
        "} & NativeProps<'a'>",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("LinkProps", linkFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "LinkProps",
      sourceFile: linkFile,
    });

    writeFileSync(
      nativeFile,
      [
        "export interface AnchorProps {",
        "  /** Link target URL. */",
        "  href?: string",
        "  /** Browser target. */",
        "  target?: '_blank' | '_self'",
        "}",
      ].join("\n"),
    );

    const affected = registry.invalidateFile(nativeFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
    expect(
      registry.getSchema("LinkProps", linkFile)?.entries[0].properties.map((prop) => prop.name),
    ).toEqual(["label", "href", "target"]);
  });

  it("invalidates consumers when semantic fallback helper files change", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-semantic-helper-"));
    const nativeFile = join(root, "native.ts");
    const helperFile = join(root, "helper.ts");
    const linkFile = join(root, "link.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(nativeFile, "export interface AnchorProps { href?: string }\n");
    writeFileSync(
      helperFile,
      [
        "import type { AnchorProps } from './native'",
        "export type NativeProps<T extends 'a' | 'button'> = T extends 'a'",
        "  ? AnchorProps",
        "  : { disabled?: boolean }",
      ].join("\n"),
    );
    writeFileSync(
      linkFile,
      [
        "import type { NativeProps } from './helper'",
        "export type LinkProps = { label: string } & NativeProps<'a'>",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("LinkProps", linkFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "LinkProps",
      sourceFile: linkFile,
    });

    writeFileSync(
      helperFile,
      [
        "import type { AnchorProps } from './native'",
        "export type NativeProps<T extends 'a' | 'button'> = T extends 'a'",
        "  ? { disabled?: boolean }",
        "  : AnchorProps",
      ].join("\n"),
    );

    const affected = registry.invalidateFile(helperFile).map(normalize);
    expect(affected).toContain(normalize(consumerFile));
    expect(
      registry.getSchema("LinkProps", linkFile)?.entries[0].properties.map((prop) => prop.name),
    ).toEqual(["label", "disabled"]);
  });

  it("removes stale file dependencies after a consumer type no longer uses them", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-stale-file-dep-"));
    const nativeFile = join(root, "native.ts");
    const helperFile = join(root, "helper.ts");
    const linkFile = join(root, "link.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(nativeFile, "export interface AnchorProps { href?: string }\n");
    writeFileSync(
      helperFile,
      [
        "import type { AnchorProps } from './native'",
        "export type NativeProps<T extends 'a'> = T extends 'a' ? AnchorProps : {}",
      ].join("\n"),
    );
    writeFileSync(
      linkFile,
      [
        "import type { NativeProps } from './helper'",
        "export type LinkProps = { label: string } & NativeProps<'a'>",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("LinkProps", linkFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "LinkProps",
      sourceFile: linkFile,
    });

    writeFileSync(linkFile, "export type LinkProps = { label: string }\n");
    expect(registry.invalidateFile(linkFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(nativeFile, "export interface AnchorProps { href?: string; target?: string }\n");
    expect(registry.invalidateFile(nativeFile).map(normalize)).not.toContain(
      normalize(consumerFile),
    );
  });

  it("keeps dependency tracking correct after lazy consumer rebuilds", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-lazy-hmr-"));
    const baseFile = join(root, "base.ts");
    const childFile = join(root, "child.ts");
    const consumerFile = join(root, "consumer.ts");

    writeFileSync(baseFile, "export interface BaseProps { base: string }\n");
    writeFileSync(
      childFile,
      [
        "import type { BaseProps } from './base'",
        "export interface ChildProps extends BaseProps { child: string }",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);
    registry.getSchema("ChildProps", childFile);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ChildProps",
      sourceFile: childFile,
    });

    writeFileSync(
      childFile,
      [
        "import type { BaseProps } from './base'",
        "export interface ChildProps extends BaseProps { child: string; local: boolean }",
      ].join("\n"),
    );
    expect(registry.invalidateFile(childFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(baseFile, "export interface BaseProps { base: string; added: boolean }\n");
    expect(registry.invalidateFile(baseFile).map(normalize)).toContain(normalize(consumerFile));
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
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "FirstProps",
      sourceFile: firstFile,
    });

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
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ButtonProps",
      sourceFile: typesFile,
    });

    writeFileSync(typesFile, "export interface OtherProps { label: string }\n");
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from './button'

      export const docs = getDocs<ButtonProps>()
    `;
    registry.clearConsumer(consumerFile);
    const missingResult = transformGetDocs({
      code: consumerCode,
      id: consumerFile,
      config: {},
      options: { registry },
    });

    expect(missingResult).toMatchObject({ code: consumerCode });
    expect(missingResult?.deps.map(normalize)).toContain(normalize(typesFile));

    writeFileSync(typesFile, "export interface ButtonProps { label: string; restored: boolean }\n");
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));
  });

  it("clears stale indexed keys when a type file disappears and recovers on restore", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-missing-file-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);
    registry.registerConsumer({
      consumerModule: consumerFile,
      typeName: "ButtonProps",
      sourceFile: typesFile,
    });

    unlinkSync(typesFile);
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));
    expect(registry.getEntry("ButtonProps", typesFile)).toBeUndefined();

    writeFileSync(typesFile, "export interface ButtonProps { label: string; restored: boolean }\n");
    expect(registry.invalidateFile(typesFile).map(normalize)).toContain(normalize(consumerFile));
    expect(
      registry.getSchema("ButtonProps", typesFile)?.entries[0].properties.map((prop) => prop.name),
    ).toEqual(["label", "restored"]);
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
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { PublicButtonProps } from './index'

      export const docs = getDocs<PublicButtonProps>()
    `;
    expect(
      transformGetDocs({
        code: consumerCode,
        id: consumerFile,
        config: {},
        options: { registry },
      }),
    ).not.toBeNull();

    writeFileSync(buttonFile, "export interface ButtonProps { label: string; added: boolean }\n");
    expect(registry.invalidateFile(buttonFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");
    expect(registry.invalidateFile(barrelFile).map(normalize)).toContain(normalize(consumerFile));
  });

  it("invalidates consumers that use batch getDocs targets through barrel files", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-batch-barrel-"));
    const buttonFile = join(root, "button.ts");
    const linkFile = join(root, "link.ts");
    const barrelFile = join(root, "index.ts");
    const consumerFile = join(root, "main.ts");

    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(linkFile, "export interface LinkProps { href: string }\n");
    writeFileSync(
      barrelFile,
      [
        "export type { ButtonProps as PublicButtonProps } from './button'",
        "export type { LinkProps } from './link'",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig());
    registry.initialize(root);

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'

      export const docs = getDocs([
        { id: 'button-props', path: './index', symbol: 'PublicButtonProps' },
        { id: 'link-props', path: './index', symbol: 'LinkProps' },
      ] as const)
    `;
    expect(
      transformGetDocs({
        code: consumerCode,
        id: consumerFile,
        config: {},
        options: { registry },
      }),
    ).not.toBeNull();

    writeFileSync(buttonFile, "export interface ButtonProps { label: string; added: boolean }\n");
    expect(registry.invalidateFile(buttonFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(linkFile, "export interface LinkProps { href: string; external: boolean }\n");
    expect(registry.invalidateFile(linkFile).map(normalize)).toContain(normalize(consumerFile));

    writeFileSync(
      barrelFile,
      [
        "export type { ButtonProps as PublicButtonProps } from './button'",
        "export type { LinkProps } from './link'",
      ].join("\n"),
    );
    expect(registry.invalidateFile(barrelFile).map(normalize)).toContain(normalize(consumerFile));
  });

  it("invalidates consumers when a named utility alias target changes", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-registry-utility-alias-"));
    const baseFile = join(root, "base.ts");
    const typesFile = join(root, "types.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(
      baseFile,
      ["export interface BaseButtonProps {", "  label?: string", "  disabled?: boolean", "}"].join(
        "\n",
      ),
    );
    writeFileSync(
      typesFile,
      [
        "import type { BaseButtonProps } from './base'",
        "export type ButtonProps = Required<BaseButtonProps>",
      ].join("\n"),
    );

    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(root);

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from './types'

      export const docs = getDocs<ButtonProps>()
    `;
    expect(
      transformGetDocs({
        code: consumerCode,
        id: consumerFile,
        config: {},
        options: { registry },
      }),
    ).not.toBeNull();

    writeFileSync(
      baseFile,
      [
        "export interface BaseButtonProps {",
        "  label?: string",
        "  disabled?: boolean",
        "  tone?: 'primary' | 'secondary'",
        "}",
      ].join("\n"),
    );

    expect(registry.invalidateFile(baseFile).map(normalize)).toContain(normalize(consumerFile));
    expect(
      registry.getSchema("ButtonProps", typesFile)?.entries[0].properties.map((prop) => prop.name),
    ).toEqual(["label", "disabled", "tone"]);
    expect(
      registry
        .getSchema("ButtonProps", typesFile)
        ?.entries[0].properties.map((prop) => prop.optional),
    ).toEqual([false, false, false]);
  });
});
