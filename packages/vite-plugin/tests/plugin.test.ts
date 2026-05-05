import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModuleNode, Plugin } from "vite";
import { docgenPlugin } from "../src/plugin";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

function getHook<T extends keyof Plugin>(plugin: Plugin, name: T): Exclude<Plugin[T], undefined> {
  const hook = plugin[name];
  if (typeof hook === "function") return hook as Exclude<Plugin[T], undefined>;
  if (hook && typeof hook === "object" && "handler" in hook) {
    return hook.handler as Exclude<Plugin[T], undefined>;
  }
  throw new Error(`Missing ${String(name)} hook`);
}

describe("docgenPlugin HMR", () => {
  it("hard-invalidates affected getDocs consumers before returning them", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");
    const normalizedTypesFile = normalize(typesFile);

    writeFileSync(
      typesFile,
      `
        export interface ButtonProps {
          /**
           * The size of the button.
           *
           * @default m
           */
          size?: string
        }
      `,
    );

    const consumerCode = `
      import { getDocs } from '@oxc-ts-docgen/docgen'
      import type { ButtonProps } from '${normalizedTypesFile}'

      export const docs = getDocs<ButtonProps>()
    `;

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    await getHook(plugin, "transform").call({} as never, consumerCode, consumerFile);

    writeFileSync(
      typesFile,
      `
        export interface ButtonProps {
          /**
           * The size of the button.
           *
           * @default s
           */
          size?: string
        }
      `,
    );

    const consumerModule = { id: normalize(consumerFile) } as ModuleNode;
    const invalidated: ModuleNode[] = [];
    const returned = await getHook(
      plugin,
      "handleHotUpdate",
    )({
      file: typesFile,
      timestamp: Date.now(),
      modules: [],
      read: () => "",
      server: {
        moduleGraph: {
          getModuleById: (id: string) =>
            id === normalize(consumerFile) ? consumerModule : undefined,
          invalidateModule: (mod: ModuleNode) => {
            invalidated.push(mod);
          },
        },
      },
    } as never);

    expect(returned).toContain(consumerModule);
    expect(invalidated).toContain(consumerModule);
  });

  it("rebuilds the registry and invalidates consumers when tsconfig changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-tsconfig-"));
    const aDir = join(root, "src", "a");
    const bDir = join(root, "src", "b");
    mkdirSync(aDir, { recursive: true });
    mkdirSync(bDir, { recursive: true });

    const tsconfigFile = join(root, "tsconfig.json");
    const consumerFile = join(root, "src", "main.tsx");
    const normalizedConsumerFile = normalize(consumerFile);

    writeFileSync(
      join(aDir, "button.ts"),
      `
        export interface ButtonProps {
          /** Label from the first alias target. */
          label: string
        }
      `,
    );
    writeFileSync(
      join(bDir, "button.ts"),
      `
        export interface ButtonProps {
          /** Label from the second alias target. */
          label: string
        }
      `,
    );
    writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["src/a/*"] } },
      }),
    );

    const consumerCode = `
      import { getDocs } from '@oxc-ts-docgen/docgen'
      import type { ButtonProps } from '@alias/button'

      export const docs = getDocs<ButtonProps>()
    `;
    writeFileSync(consumerFile, consumerCode);

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    await getHook(plugin, "transform").call({} as never, consumerCode, consumerFile);

    writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["src/b/*"] } },
      }),
    );

    const consumerModule = { id: normalizedConsumerFile } as ModuleNode;
    const invalidated: ModuleNode[] = [];
    const returned = await getHook(
      plugin,
      "handleHotUpdate",
    )({
      file: tsconfigFile,
      timestamp: Date.now(),
      modules: [],
      read: () => "",
      server: {
        moduleGraph: {
          getModuleById: (id: string) =>
            id === normalizedConsumerFile ? consumerModule : undefined,
          invalidateModule: (mod: ModuleNode) => {
            invalidated.push(mod);
          },
        },
      },
    } as never);

    expect(returned).toContain(consumerModule);
    expect(invalidated).toContain(consumerModule);
  });

  it("resolves explicit relative tsconfig paths from the Vite root", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-root-tsconfig-"));
    const sharedDir = join(root, "src", "shared");
    mkdirSync(sharedDir, { recursive: true });

    const consumerFile = join(root, "src", "main.tsx");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@shared/*": ["src/shared/*"] },
        },
      }),
    );
    writeFileSync(
      join(sharedDir, "button.ts"),
      `
        export interface ButtonProps {
          /** Root alias label. */
          label: string
        }
      `,
    );

    const consumerCode = `
      import { getDocs } from '@oxc-ts-docgen/docgen'
      import type { ButtonProps } from '@shared/button'

      export const docs = getDocs<ButtonProps>()
    `;
    writeFileSync(consumerFile, consumerCode);

    const plugin = docgenPlugin({ tsconfig: "./tsconfig.json" });
    getHook(plugin, "configResolved")({ root } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    const transformed = await getHook(plugin, "transform").call(
      {} as never,
      consumerCode,
      consumerFile,
    );

    expect(transformed).toMatchObject({
      code: expect.stringContaining("Root alias label"),
    });
    expect((transformed as { code: string }).code).not.toContain("getDocs<ButtonProps>");
  });
});
