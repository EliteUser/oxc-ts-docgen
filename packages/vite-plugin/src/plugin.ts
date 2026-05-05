import { basename, isAbsolute, resolve as resolvePath } from "node:path";
import type { ModuleNode, Plugin } from "vite";
import type { DocgenConfig } from "@oxc-ts-docgen/docgen";
import { resolveConfig } from "@oxc-ts-docgen/docgen";
import { TypeRegistry } from "./type-registry";
import { transformGetDocs } from "./transform";

export type DocgenPluginOptions = Partial<DocgenConfig>;

export function docgenPlugin(options: DocgenPluginOptions = {}): Plugin {
  let registry: TypeRegistry | undefined;
  let rootDir = "";
  let command: "build" | "serve" = "serve";

  const getRegistry = () => {
    if (!registry) {
      registry = new TypeRegistry(resolveConfig(resolvePluginOptions(options, rootDir)));
    }
    return registry;
  };

  return {
    name: "oxc-ts-docgen",
    enforce: "pre",

    configResolved(resolved) {
      rootDir = resolved.root;
      command = resolved.command;
      registry = new TypeRegistry(resolveConfig(resolvePluginOptions(options, rootDir)));
    },

    buildStart() {
      getRegistry().initialize(rootDir);
    },

    transform(code, id) {
      if (!id.match(/\.[jt]sx?$/)) return null;
      if (id.includes("node_modules")) return null;

      const activeRegistry = getRegistry();
      activeRegistry.clearConsumer(id);

      const result = transformGetDocs(code, id, options, {
        registry: activeRegistry,
        failOnUnresolved: command === "build",
      });
      if (!result) return null;

      return {
        code: result.code,
        map: null,
      };
    },

    handleHotUpdate(ctx) {
      const activeRegistry = getRegistry();
      const affectedConsumers = isTsconfigFile(ctx.file)
        ? activeRegistry.rebuild(rootDir)
        : activeRegistry.invalidateFile(ctx.file);
      if (affectedConsumers.length === 0) return;

      const extraModules: ModuleNode[] = [];
      const invalidatedModules = new Set<ModuleNode>();
      for (const consumerId of affectedConsumers) {
        const mod = ctx.server.moduleGraph.getModuleById(consumerId);
        if (mod) {
          ctx.server.moduleGraph.invalidateModule(mod, invalidatedModules, ctx.timestamp, true);
          extraModules.push(mod);
        }
      }

      if (extraModules.length > 0) {
        return [...(ctx.modules ?? []), ...extraModules];
      }
    },
  };
}

function isTsconfigFile(filePath: string): boolean {
  const name = basename(filePath);
  return name === "tsconfig.json" || (name.startsWith("tsconfig.") && name.endsWith(".json"));
}

function resolvePluginOptions(
  options: DocgenPluginOptions,
  rootDir: string,
): Partial<DocgenConfig> {
  if (!options.tsconfig || isAbsolute(options.tsconfig)) return options;
  return { ...options, tsconfig: resolvePath(rootDir, options.tsconfig) };
}
