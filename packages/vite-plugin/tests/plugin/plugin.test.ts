import type { AddressInfo } from "node:net";
import type { ModuleNode, Plugin } from "vite";

import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

import { docgenPlugin } from "../../src/plugin";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

type TestPluginHook = {
  (...args: unknown[]): unknown;
  call(thisArg: unknown, ...args: unknown[]): unknown;
};

function getHook(plugin: Plugin, name: keyof Plugin): TestPluginHook {
  const hook = plugin[name];
  if (typeof hook === "function") return hook as TestPluginHook;
  if (hook && typeof hook === "object" && "handler" in hook) {
    return hook.handler as TestPluginHook;
  }
  throw new Error(`Missing ${String(name)} hook`);
}

type DevServerAddress = {
  httpServer?: { address: () => AddressInfo | string | null } | null;
};

function serverUrl(server: DevServerAddress, path: string): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}${path}`;
}

async function fetchDevModule(server: DevServerAddress, path: string): Promise<string> {
  const response = await fetch(serverUrl(server, path));
  if (!response.ok) {
    throw new Error(
      `Expected ${path} to load, got ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }
  return response.text();
}

async function waitForDevModule(
  server: DevServerAddress,
  path: string,
  predicate: (code: string) => boolean,
): Promise<string> {
  const started = Date.now();
  let lastCode = "";

  while (Date.now() - started < 5_000) {
    lastCode = await fetchDevModule(server, `${path}?t=${Date.now()}`);
    if (predicate(lastCode)) return lastCode;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for transformed ${path}. Last code:\n${lastCode}`);
}

describe("docgenPlugin HMR", () => {
  it("disposes the registry semantic service when the dev server closes", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-close-"));
    const plugin = docgenPlugin();
    const httpServer = new EventEmitter();

    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    await getHook(plugin, "configureServer").call({} as never, { httpServer } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);

    httpServer.emit("close");

    expect(() => getHook(plugin, "buildStart").call({} as never, {} as never)).not.toThrow();
  });

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
      import { getDocs } from '@synthfall/oxc-ts-docgen'
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

  it("registers schema dependency files with Vite's watcher", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-watch-"));
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
        "  /** Token inherited by the public props. */",
        "  token?: TokenName",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        "import type { BaseProps } from './base'",
        "export interface PublicProps extends BaseProps {",
        "  /** Visible label. */",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { PublicProps } from '${normalize(publicFile)}'

      export const docs = getDocs<PublicProps>()
    `;

    const watchedFiles: string[] = [];
    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    await getHook(plugin, "transform").call(
      {
        addWatchFile(filePath: string) {
          watchedFiles.push(normalize(filePath));
        },
      } as never,
      consumerCode,
      consumerFile,
    );

    expect(watchedFiles).toContain(normalize(publicFile));
    expect(watchedFiles).toContain(normalize(baseFile));
    expect(watchedFiles).toContain(normalize(tokenFile));
  });

  it("transforms getDocs calls inside Vue SFC script setup blocks", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-vue-sfc-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "ButtonDocs.vue");

    writeFileSync(
      typesFile,
      [
        "export interface ButtonProps {",
        "  /** Visible button label. */",
        "  label: string",
        "}",
      ].join("\n"),
    );

    const consumerCode = `
<template>
  <pre>{{ docs }}</pre>
</template>

<script setup lang="ts">
import { getDocs } from '@synthfall/oxc-ts-docgen'
import type { ButtonProps } from './button'

const docs = getDocs<ButtonProps>()
</script>
`;

    const watchedFiles: string[] = [];
    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);

    const transformed = await getHook(plugin, "transform").call(
      {
        addWatchFile(filePath: string) {
          watchedFiles.push(normalize(filePath));
        },
      } as never,
      consumerCode,
      consumerFile,
    );

    expect(transformed).toMatchObject({ map: null });
    const transformedCode =
      typeof transformed === "object" &&
      transformed &&
      "code" in transformed &&
      typeof transformed.code === "string"
        ? transformed.code
        : "";
    expect(transformedCode).toContain("<template>");
    expect(transformedCode).toContain('<script setup lang="ts">');
    expect(transformedCode).toContain("JSON.parse(");
    expect(transformedCode).not.toContain("getDocs<ButtonProps>");
    expect(watchedFiles).toContain(normalize(typesFile));
  });

  it("throws a clear build-mode error for malformed scanned source files", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-bad-startup-source-"));
    writeFileSync(join(root, "broken.ts"), "export interface BrokenProps { label: string\n");

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "build" } as never);

    expect(() => getHook(plugin, "buildStart").call({} as never, {} as never)).toThrow(
      /source-parse-failed.*broken\.ts/s,
    );
  });

  it("warns in dev for malformed imported type source files", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-bad-import-source-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");

    writeFileSync(typesFile, "export interface ButtonProps { label: string\n");

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '${normalize(typesFile)}'

      export const docs = getDocs<ButtonProps>()
    `;

    const warnings: string[] = [];
    const plugin = docgenPlugin({ include: ["src/**/*.ts"] });
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call(
      {
        warn(message: string) {
          warnings.push(message);
        },
      } as never,
      {} as never,
    );

    const transformed = await getHook(plugin, "transform").call(
      {
        warn(message: string) {
          warnings.push(message);
        },
        addWatchFile() {},
      } as never,
      consumerCode,
      consumerFile,
    );

    expect(transformed).toMatchObject({ code: consumerCode, map: null });
    expect(warnings.join("\n")).toMatch(/source-parse-failed.*button\.ts/s);
  });

  it("keeps consumers recoverable when a getDocs type disappears and is restored", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-recover-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");
    const normalizedTypesFile = normalize(typesFile);

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '${normalizedTypesFile}'

      export const docs = getDocs<ButtonProps>()
    `;

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    expect(
      await getHook(plugin, "transform").call({ warn() {} } as never, consumerCode, consumerFile),
    ).toMatchObject({ code: expect.stringContaining("label") });

    writeFileSync(typesFile, "export interface OtherProps { label: string }\n");
    const consumerModule = { id: normalize(consumerFile) } as ModuleNode;
    const invalidated: ModuleNode[] = [];
    const hotContext = {
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
    } as never;

    expect(await getHook(plugin, "handleHotUpdate")(hotContext)).toContain(consumerModule);
    expect(
      await getHook(plugin, "transform").call({ warn() {} } as never, consumerCode, consumerFile),
    ).toMatchObject({ code: consumerCode, map: null });

    writeFileSync(typesFile, "export interface ButtonProps { label: string; restored: boolean }\n");
    expect(await getHook(plugin, "handleHotUpdate")(hotContext)).toContain(consumerModule);
    expect(
      await getHook(plugin, "transform").call({ warn() {} } as never, consumerCode, consumerFile),
    ).toMatchObject({ code: expect.stringContaining("restored") });
  });

  it("recovers getDocs consumers through a live Vite dev server HMR cycle", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-live-vite-hmr-"));
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const typesFile = join(srcDir, "button.ts");
    const consumerFile = join(srcDir, "main.tsx");
    writeFileSync(
      consumerFile,
      [
        "import { getDocs } from '@synthfall/oxc-ts-docgen'",
        "import type { ButtonProps } from './button'",
        "",
        "export const docs = getDocs<ButtonProps>()",
      ].join("\n"),
    );
    writeFileSync(
      typesFile,
      ["export interface ButtonProps {", "  /** Initial label. */", "  label: string", "}"].join(
        "\n",
      ),
    );

    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [docgenPlugin()],
      resolve: {
        alias: [
          {
            find: "@synthfall/oxc-ts-docgen",
            replacement: join(__dirname, "..", "..", "..", "docgen", "src", "index.ts"),
          },
        ],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    });

    try {
      await server.listen();

      const initial = await fetchDevModule(server, "/src/main.tsx");
      expect(initial).toContain("Initial label.");
      expect(initial).not.toContain("getDocs<ButtonProps>()");

      writeFileSync(
        typesFile,
        ["export interface OtherProps {", "  /** Different type. */", "  label: string", "}"].join(
          "\n",
        ),
      );
      const unresolved = await waitForDevModule(
        server,
        "/src/main.tsx",
        (code) => code.includes("getDocs()") && !code.includes("Initial label."),
      );
      expect(unresolved).not.toContain("Initial label.");

      writeFileSync(
        typesFile,
        [
          "export interface ButtonProps {",
          "  /** Restored label. */",
          "  label: string",
          "  /** Restored through live HMR. */",
          "  restored: boolean",
          "}",
        ].join("\n"),
      );
      const restored = await waitForDevModule(server, "/src/main.tsx", (code) =>
        code.includes("Restored through live HMR."),
      );
      expect(restored).not.toContain("getDocs()");
      expect(restored).toContain("restored");
    } finally {
      await server.close();
    }
  }, 15_000);

  it("recovers when an external schema dependency changes outside Vite's module graph", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "oxc-docgen-live-vite-external-hmr-"));
    const root = join(workspace, "app");
    const srcDir = join(root, "src");
    const sharedDir = join(workspace, "shared");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    const baseFile = join(sharedDir, "base.ts");
    const publicFile = join(sharedDir, "public.ts");
    const consumerFile = join(srcDir, "main.tsx");
    writeFileSync(
      consumerFile,
      [
        "import { getDocs } from '@synthfall/oxc-ts-docgen'",
        `import type { PublicProps } from '${normalize(publicFile)}'`,
        "",
        "export const docs = getDocs<PublicProps>()",
      ].join("\n"),
    );
    writeFileSync(
      publicFile,
      [
        `import type { BaseProps } from '${normalize(baseFile)}'`,
        "export interface PublicProps extends BaseProps {",
        "  /** Public label. */",
        "  label: string",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      baseFile,
      [
        "export interface BaseProps {",
        "  /** Initial inherited external value. */",
        "  externalValue: string",
        "}",
      ].join("\n"),
    );

    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [docgenPlugin()],
      resolve: {
        alias: [
          {
            find: "@synthfall/oxc-ts-docgen",
            replacement: join(__dirname, "..", "..", "..", "docgen", "src", "index.ts"),
          },
        ],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    });

    try {
      await server.listen();

      const initial = await fetchDevModule(server, "/src/main.tsx");
      expect(initial).toContain("Initial inherited external value.");
      expect(server.moduleGraph.getModuleById(normalize(baseFile))?.transformResult).toBeNull();

      writeFileSync(
        baseFile,
        [
          "export interface BaseProps {",
          "  /** Updated inherited external value. */",
          "  externalValue: string",
          "}",
        ].join("\n"),
      );

      const updated = await waitForDevModule(server, "/src/main.tsx", (code) =>
        code.includes("Updated inherited external value."),
      );
      expect(updated).not.toContain("Initial inherited external value.");
    } finally {
      await server.close();
    }
  }, 15_000);

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
      import { getDocs } from '@synthfall/oxc-ts-docgen'
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
      import { getDocs } from '@synthfall/oxc-ts-docgen'
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

  it("loads schemas through virtual modules when outputMode is virtual", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-virtual-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");
    const normalizedTypesFile = normalize(typesFile);

    writeFileSync(
      typesFile,
      `
        export interface ButtonProps {
          /** Virtual module label. */
          label: string
        }
      `,
    );

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '${normalizedTypesFile}'

      export const docs = getDocs<ButtonProps>()
    `;

    const plugin = docgenPlugin({ outputMode: "virtual" });
    getHook(plugin, "configResolved")({ root } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    const transformed = await getHook(plugin, "transform").call(
      {} as never,
      consumerCode,
      consumerFile,
    );

    const code = (transformed as { code: string }).code;
    expect(code).toContain("virtual:oxc-ts-docgen/schema?");
    expect(code).not.toContain("JSON.parse(");
    expect(code).not.toContain("getDocs<ButtonProps>");

    const moduleId = code.match(/from "([^"]+)"/)?.[1];
    expect(moduleId).toBeDefined();
    expect(moduleId).toContain("config=");

    const resolvedId = await getHook(plugin, "resolveId").call({} as never, moduleId!, undefined);
    expect(resolvedId).toBe(`\0${moduleId}`);

    const loaded = await getHook(plugin, "load").call({} as never, resolvedId as string);
    expect(loaded).toContain("Virtual module label");
  });

  it("changes virtual schema module ids when schema-affecting plugin options change", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-virtual-config-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");
    const normalizedTypesFile = normalize(typesFile);

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '${normalizedTypesFile}'

      export const docs = getDocs<ButtonProps>()
    `;

    const firstPlugin = docgenPlugin({ outputMode: "virtual", maxDepth: 1 });
    getHook(firstPlugin, "configResolved")({ root } as never);
    getHook(firstPlugin, "buildStart").call({} as never, {} as never);
    const first = await getHook(firstPlugin, "transform").call(
      {} as never,
      consumerCode,
      consumerFile,
    );

    const secondPlugin = docgenPlugin({ outputMode: "virtual", maxDepth: 2 });
    getHook(secondPlugin, "configResolved")({ root } as never);
    getHook(secondPlugin, "buildStart").call({} as never, {} as never);
    const second = await getHook(secondPlugin, "transform").call(
      {} as never,
      consumerCode,
      consumerFile,
    );

    const firstModuleId = (first as { code: string }).code.match(/from "([^"]+)"/)?.[1];
    const secondModuleId = (second as { code: string }).code.match(/from "([^"]+)"/)?.[1];

    expect(firstModuleId).toContain("config=");
    expect(secondModuleId).toContain("config=");
    expect(firstModuleId).not.toBe(secondModuleId);
  });

  it("invalidates virtual schema modules with their consumers", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-virtual-hmr-"));
    const typesFile = join(root, "button.ts");
    const consumerFile = join(root, "main.tsx");
    const normalizedConsumerFile = normalize(consumerFile);
    const normalizedTypesFile = normalize(typesFile);

    writeFileSync(typesFile, "export interface ButtonProps { label: string }\n");

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '${normalizedTypesFile}'

      export const docs = getDocs<ButtonProps>()
    `;

    const plugin = docgenPlugin({ outputMode: "virtual" });
    getHook(plugin, "configResolved")({ root } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);
    const transformed = await getHook(plugin, "transform").call(
      {} as never,
      consumerCode,
      consumerFile,
    );
    const moduleId = (transformed as { code: string }).code.match(/from "([^"]+)"/)?.[1];
    const resolvedVirtualId = `\0${moduleId}`;

    writeFileSync(typesFile, "export interface ButtonProps { label: string; added: boolean }\n");

    const consumerModule = { id: normalizedConsumerFile } as ModuleNode;
    const virtualModule = { id: resolvedVirtualId } as ModuleNode;
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
          getModuleById: (id: string) => {
            if (id === normalizedConsumerFile) return consumerModule;
            if (id === resolvedVirtualId) return virtualModule;
            return undefined;
          },
          invalidateModule: (mod: ModuleNode) => {
            invalidated.push(mod);
          },
        },
      },
    } as never);

    expect(returned).toContain(consumerModule);
    expect(returned).toContain(virtualModule);
    expect(invalidated).toContain(consumerModule);
    expect(invalidated).toContain(virtualModule);
  });

  it("throws a clear build-mode error for missing explicit tsconfig paths", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-missing-tsconfig-"));
    const plugin = docgenPlugin({ tsconfig: "./missing.tsconfig.json" });

    getHook(plugin, "configResolved")({ root, command: "build" } as never);

    expect(() => getHook(plugin, "buildStart").call({} as never, {} as never)).toThrow(
      /tsconfig-not-found.*missing\.tsconfig\.json/s,
    );
  });

  it("throws a clear build-mode error for semantic tsconfig diagnostics", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-semantic-tsconfig-"));
    const consumerFile = join(root, "main.tsx");
    const typesFile = join(root, "types.ts");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true },
        include: [123],
      }),
    );
    writeFileSync(
      typesFile,
      [
        "declare function createButtonProps(): {",
        "  /** Semantic label. */",
        "  label: string",
        "}",
        "export type ButtonProps = ReturnType<typeof createButtonProps>",
      ].join("\n"),
    );

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from './types'

      export const docs = getDocs<ButtonProps>()
    `;

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "build" } as never);
    getHook(plugin, "buildStart").call({} as never, {} as never);

    expect(() =>
      getHook(plugin, "transform").call({} as never, consumerCode, consumerFile),
    ).toThrow(/tsconfig-invalid.*include/s);
  });

  it("does not fail build startup for unrelated scanned module misses", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-startup-miss-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "unused.ts"),
      [
        "import type { MissingExternal } from 'missing-external'",
        "export interface UnusedProps {",
        "  value: MissingExternal",
        "}",
      ].join("\n"),
    );

    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "build" } as never);

    expect(() => getHook(plugin, "buildStart").call({} as never, {} as never)).not.toThrow();
  });

  it("does not include stale startup module misses in dev transform warnings", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-stale-miss-"));
    const consumerFile = join(root, "src", "main.tsx");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "unused.ts"),
      [
        "import type { MissingExternal } from 'missing-external'",
        "export interface UnusedProps {",
        "  value: MissingExternal",
        "}",
      ].join("\n"),
    );

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'

      export const docs = getDocs<MissingProps>()
    `;

    const warnings: string[] = [];
    const plugin = docgenPlugin();
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call(
      { warn: (message: string) => warnings.push(message) } as never,
      {} as never,
    );
    await getHook(plugin, "transform").call(
      { warn: (message: string) => warnings.push(message) } as never,
      consumerCode,
      consumerFile,
    );

    expect(warnings.join("\n")).toContain("MissingProps");
    expect(warnings.join("\n")).not.toContain("missing-external");
  });

  it("warns in dev and leaves unresolved getDocs calls recoverable", async () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-plugin-dev-diagnostics-"));
    const consumerFile = join(root, "src", "main.tsx");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(consumerFile, "");

    const consumerCode = `
      import { getDocs } from '@synthfall/oxc-ts-docgen'
      import type { ButtonProps } from '@shared/button'

      export const docs = getDocs<ButtonProps>()
    `;

    const warnings: string[] = [];
    const plugin = docgenPlugin({ tsconfig: "./missing.tsconfig.json" });
    getHook(plugin, "configResolved")({ root, command: "serve" } as never);
    getHook(plugin, "buildStart").call(
      { warn: (message: string) => warnings.push(message) } as never,
      {} as never,
    );
    const transformed = await getHook(plugin, "transform").call(
      { warn: (message: string) => warnings.push(message) } as never,
      consumerCode,
      consumerFile,
    );

    expect(transformed).toBeNull();
    expect(warnings.join("\n")).toMatch(/tsconfig-not-found.*missing\.tsconfig\.json/s);
    expect(warnings.join("\n")).toContain("left unresolved getDocs() calls");
  });
});
