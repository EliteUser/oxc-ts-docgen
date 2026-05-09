import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateDocs, generateDocsFromSource, resolveConfig } from "../../src/index";

describe("docgen presets", () => {
  it("applies TypeScript, React, and DOM presets by default", () => {
    const config = resolveConfig();

    expect(config.presets).toEqual(["typescript", "react", "dom"]);
    expect(config.ignoreTypes).toContain("Promise");
    expect(config.ignoreTypes).toContain("ReactNode");
    expect(config.ignoreTypes).toContain("React.ReactNode");
    expect(config.ignoreTypes).toContain("HTMLAttributes");
    expect(config.ignoreTypes).toContain("React.HTMLAttributes");
  });

  it("lets explicit presets override the default preset set while preserving user ignoreTypes", () => {
    const config = resolveConfig({
      presets: ["typescript"],
      ignoreTypes: ["ProjectOpaque"],
    });

    expect(config.presets).toEqual(["typescript"]);
    expect(config.ignoreTypes).toContain("Promise");
    expect(config.ignoreTypes).toContain("ProjectOpaque");
    expect(config.ignoreTypes).not.toContain("ReactNode");
    expect(config.ignoreTypes).not.toContain("HTMLAttributes");
  });

  it("canonicalizes selected preset order", () => {
    const config = resolveConfig({ presets: ["dom", "typescript", "dom"] });

    expect(config.presets).toEqual(["typescript", "dom"]);
    expect(config.ignoreTypes.indexOf("Promise")).toBeLessThan(
      config.ignoreTypes.indexOf("HTMLAttributes"),
    );
  });

  it("rejects unknown preset names with a focused config error", () => {
    expect(() => resolveConfig({ presets: ["vue"] as unknown as ["typescript"] })).toThrow(
      'Invalid docgen config preset "vue"',
    );
  });

  it("uses the default React preset to keep local ReactNode-style aliases out of related output", () => {
    const result = generateDocsFromSource({
      source: `
        type ReactNode = string | number | null

        interface PublicProps {
          /** Rendered content. */
          children?: ReactNode
        }
      `,
      typeName: "PublicProps",
      fileName: "preset-react-node.ts",
    });

    expect(result.entries[0].properties[0].type).toEqual({
      kind: "reference",
      name: "ReactNode",
    });
    expect(result.related?.map((entry) => entry.name)).not.toContain("ReactNode");
  });

  it("keeps default preset ignored references opaque inside semantic fallback output", () => {
    const result = generateDocsFromSource({
      source: `
        type ReactNode = string | number | null

        type NativeProps<T extends true> = T extends true
          ? {
              /** Rendered content. */
              content?: ReactNode
            }
          : never

        type PublicProps = NativeProps<true>
      `,
      typeName: "PublicProps",
      fileName: "preset-semantic-react-node.ts",
    });

    expect(result.entries[0].properties[0].type).toEqual({
      kind: "reference",
      name: "ReactNode",
    });
    expect(result.related?.map((entry) => entry.name)).not.toContain("ReactNode");
  });

  it("can opt out of React and DOM presets for project-owned aliases", () => {
    const result = generateDocsFromSource({
      source: `
        type ReactNode = string | number | null

        interface PublicProps {
          /** Rendered content. */
          children?: ReactNode
        }
      `,
      typeName: "PublicProps",
      fileName: "preset-react-node-opt-out.ts",
      config: { presets: ["typescript"] },
    });

    expect(result.related?.map((entry) => entry.name)).toContain("ReactNode");
  });

  it("uses React preset fallback triggers for qualified external helper props", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-react-preset-"));
    const reactRoot = join(root, "node_modules", "react");
    mkdirSync(reactRoot, { recursive: true });
    writeFileSync(
      join(reactRoot, "package.json"),
      JSON.stringify({ name: "react", types: "index.d.ts" }),
    );
    writeFileSync(
      join(reactRoot, "index.d.ts"),
      `
        export interface AnchorProps {
          /** Link target URL. */
          href?: string
          /** Browser target. */
          target?: '_blank' | '_self'
        }

        export type ComponentPropsWithoutRef<T extends 'a' | 'button'> = T extends 'a'
          ? AnchorProps
          : { disabled?: boolean }
      `,
    );

    const filePath = join(root, "link.ts");
    writeFileSync(
      filePath,
      `
        import * as React from 'react'

        export type LinkProps = {
          /** Accessible label. */
          label: string
        } & React.ComponentPropsWithoutRef<'a'>
      `,
    );

    const result = generateDocs({
      filePath,
      typeName: "LinkProps",
      config: { externalTypes: "resolve" },
    });

    expect(result.entries[0].properties.map((prop) => prop.name)).toEqual([
      "label",
      "href",
      "target",
    ]);
  });

  it("keeps authored display aliases when semantic fallback resolves polymorphic props", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-link-display-alias-"));
    const reactRoot = join(root, "node_modules", "react");
    mkdirSync(reactRoot, { recursive: true });
    writeFileSync(
      join(reactRoot, "package.json"),
      JSON.stringify({ name: "react", types: "index.d.ts" }),
    );
    writeFileSync(
      join(reactRoot, "index.d.ts"),
      `
        export interface ReactElement<P = unknown, T = unknown> {
          props: P
          type: T
        }
        export type ReactNode =
          | null
          | string
          | number
          | bigint
          | boolean
          | ReactElement<unknown, string>
          | Iterable<ReactNode>
          | Promise<ReactNode>

        export interface CSSProperties {
          color?: string
        }
        export interface AnchorProps {
          href?: string
          target?: '_blank' | '_self'
        }
        export interface ButtonProps {
          disabled?: boolean
        }
        export namespace JSX {
          export interface IntrinsicElements {
            a: AnchorProps
            button: ButtonProps
          }
        }
        export type ElementType = keyof JSX.IntrinsicElements
        export type ComponentPropsWithoutRef<T extends ElementType> = JSX.IntrinsicElements[T]
      `,
    );

    const sharedFile = join(root, "shared.ts");
    writeFileSync(
      sharedFile,
      `
        import type {
          ComponentPropsWithoutRef,
          CSSProperties,
          ElementType,
          JSX,
          ReactNode,
        } from 'react'

        export type DOMProps = {
          /** HTML style attribute. */
          style?: CSSProperties
          /** HTML class attribute. */
          className?: string
        }

        export type FieldLabelProps = {
          /** Slot rendered at the end of the label. */
          endSlot?: ReactNode
        }

        export type FieldBaseProps = {
          /** Slot rendered at the end of the field label. */
          labelEndSlot?: FieldLabelProps['endSlot']
        }

        export type PolymorphicComponentProps<
          BaseProps extends object,
          T extends ElementType = keyof JSX.IntrinsicElements,
        > = BaseProps & {
          /** Rendered tag override. */
          as?: T
        } & Omit<ComponentPropsWithoutRef<T>, keyof BaseProps | 'as'>
      `,
    );

    const linkFile = join(root, "link.ts");
    writeFileSync(
      linkFile,
      `
        import type { ReactNode } from 'react'
        import type { DOMProps, FieldBaseProps, PolymorphicComponentProps } from './shared'

        export type LinkSize = 'l' | 'm' | 's'
        export type LinkVariant = 'primary' | 'secondary'
        export type LinkComponent = 'a' | 'button'

        type LinkBaseProps = DOMProps & Pick<FieldBaseProps, 'labelEndSlot'> & {
          /** Whether the link is disabled. */
          disabled?: boolean
          /** Link size. */
          size?: LinkSize
          /** Link variant. */
          variant?: LinkVariant
        }

        type LinkIconsProps =
          | {
              /** Inner content. */
              children: ReactNode
              /** Icon before the link. */
              startIcon?: ReactNode
              /** Icon after the link. */
              endIcon?: never
            }
          | {
              /** Inner content. */
              children: ReactNode
              startIcon?: never
              endIcon?: ReactNode
            }

        export type LinkInternalProps = LinkBaseProps & LinkIconsProps

        export type LinkProps<T extends LinkComponent = 'a'> =
          PolymorphicComponentProps<LinkInternalProps, T>
      `,
    );

    const result = generateDocs({ filePath: linkFile, typeName: "LinkProps" });
    const byName = new Map(result.entries[0].properties.map((prop) => [prop.name, prop]));

    expect(byName.get("children")?.type).toEqual({ kind: "reference", name: "ReactNode" });
    expect(byName.get("startIcon")?.type).toEqual({ kind: "reference", name: "ReactNode" });
    expect(byName.get("endIcon")?.type).toEqual({ kind: "reference", name: "ReactNode" });
    expect(byName.get("disabled")?.type).toEqual({ kind: "primitive", name: "boolean" });
    expect(byName.get("labelEndSlot")?.type).toEqual({
      kind: "reference",
      name: "ReactNode",
    });
    expect(byName.get("style")?.type).toEqual({ kind: "reference", name: "CSSProperties" });

    expect(byName.get("size")?.type).toMatchObject({
      kind: "reference",
      name: "LinkSize",
      target: {
        name: "LinkSize",
        filePath: linkFile.replace(/\\/g, "/"),
      },
    });
    expect(byName.get("variant")?.type).toMatchObject({
      kind: "reference",
      name: "LinkVariant",
      target: {
        name: "LinkVariant",
        filePath: linkFile.replace(/\\/g, "/"),
      },
    });

    expect(result.related?.map((entry) => entry.name).sort()).toEqual([
      "LinkComponent",
      "LinkSize",
      "LinkVariant",
    ]);
  });

  it("keeps imported Omit heritage props when native attributes trigger semantic fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-native-heritage-"));
    const reactRoot = join(root, "node_modules", "react");
    mkdirSync(reactRoot, { recursive: true });
    writeFileSync(
      join(reactRoot, "package.json"),
      JSON.stringify({ name: "react", types: "index.d.ts" }),
    );
    writeFileSync(
      join(reactRoot, "index.d.ts"),
      `
        export type ReactNode = string | number | null
        export interface TextareaHTMLAttributes<T> {
          /** Native row count. */
          rows?: number
          value?: string
          onChange?: (event: T) => void
        }
      `,
    );

    const sharedFile = join(root, "shared.ts");
    writeFileSync(
      sharedFile,
      `
        import type { ReactNode } from 'react'

        export type DOMProps = {
          /** HTML class attribute. */
          className?: string
        }

        export type FieldLabelProps = {
          /** Slot rendered at the end of the label. */
          endSlot?: ReactNode
        }

        export type FieldSize = 's' | 'm'

        export type FieldBaseProps = DOMProps & {
          /** Slot rendered at the end of the field label. */
          labelEndSlot?: FieldLabelProps['endSlot']
          /** Field size. */
          size?: FieldSize
          /** Disabled state. */
          disabled?: boolean
        }
      `,
    );

    const componentFile = join(root, "component.ts");
    writeFileSync(
      componentFile,
      `
        import type { ReactNode, TextareaHTMLAttributes } from 'react'
        import type { DOMProps, FieldBaseProps } from './shared'

        export interface NativeControlProps
          extends
            DOMProps,
            Omit<FieldBaseProps, 'size'>,
            Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
          /** Controlled text value. */
          value?: string
          /** Extra trailing slot. */
          endSlot?: ReactNode
        }
      `,
    );

    const result = generateDocs({ filePath: componentFile, typeName: "NativeControlProps" });
    const byName = new Map(result.entries[0].properties.map((prop) => [prop.name, prop]));

    expect(byName.get("labelEndSlot")?.type).toEqual({
      kind: "reference",
      name: "ReactNode",
    });
    expect(byName.get("labelEndSlot")?.description).toBe(
      "Slot rendered at the end of the field label.",
    );
    expect(byName.get("disabled")?.type).toEqual({ kind: "primitive", name: "boolean" });
    expect(byName.has("size")).toBe(false);
    expect(byName.has("rows")).toBe(false);
  });
});
