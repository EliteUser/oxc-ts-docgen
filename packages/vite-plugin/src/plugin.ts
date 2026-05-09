import type { DocgenConfig, DocgenProjectDiagnostic } from "@synthfall/oxc-ts-docgen";
import type { ModuleNode, Plugin } from "vite";

import { resolveConfig } from "@synthfall/oxc-ts-docgen";
import { basename, isAbsolute, resolve as resolvePath } from "node:path";

import type { TransformOptions } from "./transform/transform";

import { TypeRegistry } from "./registry/type-registry";
import { transformGetDocs } from "./transform/transform";
import { transformVueSfcGetDocs } from "./transform/vue-sfc-transform";
import { normalizePath } from "./utils/path-utils";
export type DocgenPluginOptions = Partial<DocgenConfig> & {
  /**
   * Startup indexing and eager schema build policy for the Vite registry.
   */
  buildMode?: "indexOnly" | "eagerPublic" | "eagerAll";
  /**
   * Emits schema inline or through Vite virtual modules.
   */
  outputMode?: "inline" | "virtual";
};
export const docgenPlugin = (options: DocgenPluginOptions = {}): Plugin => {
  let registry: TypeRegistry | undefined;
  let rootDir = "";
  let command: "build" | "serve" = "serve";
  const consumerToVirtualModules = new Map<string, Set<string>>();
  const disposeRegistry = () => {
    registry?.dispose();
    registry = undefined;
  };
  const getRegistry = () => {
    if (!registry) {
      registry = createRegistry(options, rootDir);
    }
    return registry;
  };
  return {
    name: "oxc-ts-docgen",
    enforce: "pre",
    configResolved(resolved) {
      rootDir = resolved.root;
      command = resolved.command;
      registry = createRegistry(options, rootDir);
    },
    configureServer(server) {
      server.httpServer?.once("close", disposeRegistry);
    },
    resolveId(id) {
      if (isVirtualDocModuleId(id)) {
        return toResolvedVirtualDocModuleId(id);
      }

      return null;
    },
    load(id) {
      const request = parseVirtualDocModuleId(id);
      if (!request) {
        return null;
      }

      const activeRegistry = getRegistry();
      if (request.configHash !== activeRegistry.getConfigHash()) {
        throw new Error(
          `@synthfall/oxc-ts-docgen-vite virtual schema module config hash ${request.configHash} does not match active config ${activeRegistry.getConfigHash()}.`,
        );
      }
      const schema = activeRegistry.getSchema(request.typeName, request.sourceFile);
      if (!schema) {
        throw new Error(
          `@synthfall/oxc-ts-docgen-vite could not load virtual schema module for ${request.typeName} from ${request.sourceFile}.`,
        );
      }
      const json = JSON.stringify(schema);
      return `export default JSON.parse(${JSON.stringify(json)});`;
    },
    buildStart() {
      const activeRegistry = getRegistry();
      activeRegistry.initialize(rootDir);
      const diagnostics = formatResolverDiagnostics(activeRegistry);
      if (diagnostics.length === 0) {
        return;
      }

      const message = [
        "@synthfall/oxc-ts-docgen-vite resolver diagnostics:",
        ...diagnostics.map((diagnostic) => `- ${diagnostic}`),
      ].join("\n");
      if (command === "build") {
        throw new Error(message);
      }

      this.warn(message);
    },
    transform(code, id) {
      const transformKind = getTransformKind(id);
      if (!transformKind) {
        return null;
      }

      if (id.includes("node_modules")) {
        return null;
      }

      const activeRegistry = getRegistry();
      activeRegistry.clearConsumer(id);
      clearVirtualModules({
        map: consumerToVirtualModules,
        consumerModule: id,
      });
      const unresolvedMessages: string[] = [];
      const transformOptions: TransformOptions = {
        registry: activeRegistry,
        failOnUnresolved: command === "build",
        onUnresolved: (messages: string[]) => unresolvedMessages.push(...messages),
        outputMode: options.outputMode ?? "inline",
        createVirtualModuleId: (request) => {
          const { sourceFile, typeName } = request;

          return createVirtualDocModuleId({
            sourceFile,
            typeName,
            configHash: activeRegistry.getConfigHash(),
          });
        },
      };
      const result =
        transformKind === "vue"
          ? transformVueSfcGetDocs({
              code,
              id,
              config: options,
              options: transformOptions,
            })
          : transformGetDocs({
              code,
              id,
              config: options,
              options: transformOptions,
            });
      if (unresolvedMessages.length > 0 && command === "serve") {
        this.warn(
          [
            `@synthfall/oxc-ts-docgen-vite left unresolved getDocs() calls in ${id}.`,
            ...[...new Set(unresolvedMessages)].map((message) => `- ${message}`),
          ].join("\n"),
        );
      }
      if (!result) {
        return null;
      }

      const addWatchFile = this.addWatchFile;
      if (typeof addWatchFile === "function") {
        for (const dep of new Set(result.deps.map(normalizePath))) {
          addWatchFile.call(this, dep);
        }
      }

      if (result.virtualModules.length > 0) {
        consumerToVirtualModules.set(
          normalizePath(id),
          new Set(result.virtualModules.map(toResolvedVirtualDocModuleId)),
        );
      }
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
      if (affectedConsumers.length === 0) {
        return;
      }

      const extraModules: ModuleNode[] = [];
      const invalidatedModules = new Set<ModuleNode>();
      for (const consumerId of affectedConsumers) {
        const virtualIds = consumerToVirtualModules.get(normalizePath(consumerId));
        if (virtualIds) {
          for (const virtualId of virtualIds) {
            const virtualMod = ctx.server.moduleGraph.getModuleById(virtualId);
            if (virtualMod) {
              ctx.server.moduleGraph.invalidateModule(
                virtualMod,
                invalidatedModules,
                ctx.timestamp,
                true,
              );
              extraModules.push(virtualMod);
            }
          }
        }
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
    buildEnd() {
      if (command === "build") {
        disposeRegistry();
      }
    },
  };
};
const getTransformKind = (id: string): "module" | "vue" | undefined => {
  if (id.includes("?")) {
    return undefined;
  }

  if (id.endsWith(".vue")) {
    return "vue";
  }

  return id.match(/\.[jt]sx?$/) ? "module" : undefined;
};
const formatResolverDiagnostics = (registry: TypeRegistry): string[] => {
  return registry
    .getDiagnostics()
    .filter((diagnostic) => diagnostic.code !== "module-resolution-failed")
    .map(formatDocgenDiagnostic);
};

const formatDocgenDiagnostic = (diagnostic: DocgenProjectDiagnostic): string => {
  const fileLabel = diagnostic.code.startsWith("tsconfig") ? "tsconfig" : "file";
  const details = [
    `[${diagnostic.code}] ${diagnostic.message}`,
    diagnostic.filePath ? `${fileLabel}: ${diagnostic.filePath}` : undefined,
    diagnostic.specifier ? `specifier: ${diagnostic.specifier}` : undefined,
    diagnostic.importer ? `importer: ${diagnostic.importer}` : undefined,
    diagnostic.cause ? `cause: ${diagnostic.cause}` : undefined,
  ].filter(Boolean);
  return details.join(" ");
};
const isTsconfigFile = (filePath: string): boolean => {
  const name = basename(filePath);
  return name === "tsconfig.json" || (name.startsWith("tsconfig.") && name.endsWith(".json"));
};
const resolvePluginOptions = (
  options: DocgenPluginOptions,
  rootDir: string,
): Partial<DocgenConfig> => {
  const { buildMode: _buildMode, outputMode: _outputMode, ...configOptions } = options;
  if (!configOptions.tsconfig || isAbsolute(configOptions.tsconfig)) {
    return configOptions;
  }

  return { ...configOptions, tsconfig: resolvePath(rootDir, configOptions.tsconfig) };
};
const createRegistry = (options: DocgenPluginOptions, rootDir: string): TypeRegistry => {
  return new TypeRegistry(resolveConfig(resolvePluginOptions(options, rootDir)), {
    buildMode: options.buildMode ?? "indexOnly",
  });
};
const VIRTUAL_DOC_MODULE_PREFIX = "virtual:oxc-ts-docgen/schema";
const RESOLVED_VIRTUAL_DOC_MODULE_PREFIX = `\0${VIRTUAL_DOC_MODULE_PREFIX}`;
type CreateVirtualDocModuleIdOptions = {
  sourceFile: string;
  typeName: string;
  configHash: string;
};
const createVirtualDocModuleId = (options: CreateVirtualDocModuleIdOptions): string => {
  const { sourceFile, typeName, configHash } = options;
  const params = new URLSearchParams({
    config: configHash,
    source: sourceFile,
    type: typeName,
  });
  return `${VIRTUAL_DOC_MODULE_PREFIX}?${params.toString()}`;
};
const isVirtualDocModuleId = (id: string): boolean => {
  return id.startsWith(`${VIRTUAL_DOC_MODULE_PREFIX}?`);
};
const toResolvedVirtualDocModuleId = (id: string): string => {
  if (id.startsWith("\0")) {
    return id;
  }

  return `\0${id}`;
};
const parseVirtualDocModuleId = (
  id: string,
):
  | {
      configHash: string;
      sourceFile: string;
      typeName: string;
    }
  | undefined => {
  const publicId = id.startsWith(RESOLVED_VIRTUAL_DOC_MODULE_PREFIX) ? id.slice(1) : id;
  if (!isVirtualDocModuleId(publicId)) {
    return undefined;
  }

  const params = new URLSearchParams(publicId.slice(VIRTUAL_DOC_MODULE_PREFIX.length + 1));
  const configHash = params.get("config");
  const sourceFile = params.get("source");
  const typeName = params.get("type");
  if (!configHash || !sourceFile || !typeName) {
    return undefined;
  }

  return { configHash, sourceFile, typeName };
};
type ClearVirtualModulesOptions = {
  /**
   * Consumer module whose generated virtual modules should be forgotten.
   */
  consumerModule: string;
  /**
   * Consumer-to-virtual-module index.
   */
  map: Map<string, Set<string>>;
};
const clearVirtualModules = (options: ClearVirtualModulesOptions): void => {
  const { map, consumerModule } = options;
  map.delete(normalizePath(consumerModule));
};
