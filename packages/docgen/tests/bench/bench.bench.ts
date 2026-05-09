import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, describe, bench } from "vitest";

import type { DocgenConfig } from "../../src/index";

import { TypeRegistry } from "../../../vite-plugin/src/registry/type-registry";
import { generateDocsFromSource, generateDocs } from "../../src/index";
import { generateDocsWithResolver } from "../../src/public/api";
import { resolveConfig } from "../../src/public/config";
import { TypeResolver } from "../../src/resolver/resolver";
import { TypeScriptSemanticService } from "../../src/semantic/semantic-service";

export const BENCHMARK_EXPECTATIONS = {
  singleFile: "Keep common single-file extraction well below typical Vite transform budgets.",
  crossFile: "Keep cross-file and barrel-heavy extraction fast enough for lazy per-type builds.",
  representativeComponents:
    "Track real-library-style prop shapes so regressions show up before publish.",
  semanticService:
    "Track TypeScript service cold creation and warm query cost separately from OXC static extraction.",
  semanticFallback:
    "Track first and repeated schema-level semantic fallback over a larger React-like project surface.",
  registryWorkflow:
    "Track index-only startup, lazy schema build, leaf invalidation, and broad rebuild costs.",
} as const;

function fixture(name: string): string {
  const filePath = resolve(__dirname, "..", "fixtures", name);
  return readFileSync(filePath, "utf-8");
}

const aliasBarrelFixture = createAliasBarrelFixture();
const semanticFixture = createSemanticFixture();
const hybridLinkPropsFixture = createHybridLinkPropsFixture();
const hmrFixture = createHmrFixture();
const largeFallbackFixture = createLargeFallbackFixture();
const largeRegistryFixture = createLargeRegistryFixture();
const firstFallbackStats = createFallbackBenchmarkStats("first semantic fallback schema build");
const repeatedFallbackStats = createFallbackBenchmarkStats(
  "repeated semantic fallback schema build",
);
const repeatedFallbackConfig = createFallbackBenchmarkConfig(repeatedFallbackStats);
const repeatedFallbackResolver = new TypeResolver(repeatedFallbackConfig);
const warmSemanticService = new TypeScriptSemanticService({
  config: resolveConfig(),
  rootFiles: [semanticFixture],
  currentDirectory: dirname(semanticFixture),
});
const leafInvalidationRegistry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
leafInvalidationRegistry.initialize(largeRegistryFixture.root);
leafInvalidationRegistry.getSchema(
  largeRegistryFixture.targetTypeName,
  largeRegistryFixture.targetFile,
);
leafInvalidationRegistry.registerConsumer({
  consumerModule: largeRegistryFixture.consumerFile,
  typeName: largeRegistryFixture.targetTypeName,
  sourceFile: largeRegistryFixture.targetFile,
});
const broadRebuildRegistry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
broadRebuildRegistry.initialize(largeRegistryFixture.root);
warmSemanticService.getProgram();
runMeasuredFallbackBuild({
  label: repeatedFallbackStats.label,
  filePath: largeFallbackFixture.linkFile,
  typeName: "LargeLinkProps",
  resolver: repeatedFallbackResolver,
  config: repeatedFallbackConfig,
});
resetFallbackBenchmarkStats(repeatedFallbackStats);

afterAll(() => {
  warmSemanticService.dispose();
  repeatedFallbackResolver.dispose();
  leafInvalidationRegistry.dispose();
  broadRebuildRegistry.dispose();
  printFallbackBenchmarkNotes([firstFallbackStats, repeatedFallbackStats]);
});

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
      typeName: "GenericCollectionProps",
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

  bench("representative component props", () => {
    const source = fixture("real-component-props.ts");
    generateDocsFromSource({
      source,
      typeName: "ButtonProps",
      fileName: "real-component-props.ts",
    });
  });

  bench("file-based with cross-file resolution", () => {
    generateDocs({
      filePath: resolve(__dirname, "..", "fixtures", "cross-file", "button.ts"),
      typeName: "ButtonProps",
    });
  });

  bench("multi-level inheritance resolution", () => {
    generateDocs({
      filePath: resolve(__dirname, "..", "fixtures", "cross-file", "icon-button.ts"),
      typeName: "IconButtonProps",
    });
  });

  bench("alias and barrel-heavy resolution", () => {
    generateDocs({
      filePath: aliasBarrelFixture,
      typeName: "ButtonProps",
    });
  });

  bench("semantic service cold program creation", () => {
    const service = new TypeScriptSemanticService({
      config: resolveConfig(),
      rootFiles: [semanticFixture],
      currentDirectory: dirname(semanticFixture),
    });
    service.getProgram();
    service.dispose();
  });

  bench("semantic service warm checker query", () => {
    warmSemanticService.getTypeChecker();
  });

  bench("hybrid LinkProps semantic fallback", () => {
    generateDocs({
      filePath: hybridLinkPropsFixture,
      typeName: "LinkProps",
    });
  });

  bench("large static-only schema build baseline", () => {
    generateDocs({
      filePath: largeFallbackFixture.staticFile,
      typeName: "StaticCardProps",
      config: { analysis: "static" },
    });
  });

  bench("large first semantic fallback schema build", () => {
    const config = createFallbackBenchmarkConfig(firstFallbackStats);
    const resolver = new TypeResolver(config);
    runMeasuredFallbackBuild({
      label: firstFallbackStats.label,
      filePath: largeFallbackFixture.linkFile,
      typeName: "LargeLinkProps",
      resolver,
      config,
    });
    resolver.dispose();
  });

  bench("large repeated semantic fallback schema build", () => {
    runMeasuredFallbackBuild({
      label: repeatedFallbackStats.label,
      filePath: largeFallbackFixture.linkFile,
      typeName: "LargeLinkProps",
      resolver: repeatedFallbackResolver,
      config: repeatedFallbackConfig,
    });
  });

  bench("registry HMR invalidation", () => {
    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(hmrFixture.root);
    registry.getSchema("LinkProps", hmrFixture.linkFile);
    registry.registerConsumer({
      consumerModule: hmrFixture.consumerFile,
      typeName: "LinkProps",
      sourceFile: hmrFixture.linkFile,
    });
    registry.invalidateFile(hmrFixture.nativeFile);
    registry.dispose();
  });

  bench("large semantic fallback registry HMR invalidation", () => {
    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(largeFallbackFixture.root);
    registry.getSchema("LargeLinkProps", largeFallbackFixture.linkFile);
    registry.registerConsumer({
      consumerModule: largeFallbackFixture.consumerFile,
      typeName: "LargeLinkProps",
      sourceFile: largeFallbackFixture.linkFile,
    });
    registry.invalidateFile(largeFallbackFixture.anchorFile);
    registry.dispose();
  });

  bench("large registry indexOnly startup", () => {
    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(largeRegistryFixture.root);
    registry.dispose();
  });

  bench("large registry indexOnly startup plus lazy schema build", () => {
    const registry = new TypeRegistry(resolveConfig(), { buildMode: "indexOnly" });
    registry.initialize(largeRegistryFixture.root);
    registry.getSchema(largeRegistryFixture.targetTypeName, largeRegistryFixture.targetFile);
    registry.dispose();
  });

  bench("large registry leaf dependency invalidation", () => {
    leafInvalidationRegistry.invalidateFile(largeRegistryFixture.leafFile);
  });

  bench("large registry broad rebuild", () => {
    broadRebuildRegistry.rebuild(largeRegistryFixture.root);
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

function createSemanticFixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-semantic-"));
  const filePath = join(root, "types.ts");
  writeFileSync(
    filePath,
    [
      "export interface ButtonProps {",
      "  /** Button label. */",
      "  label: string",
      "  /** Disabled state. */",
      "  disabled?: boolean",
      "}",
    ].join("\n"),
  );
  return filePath.replace(/\\/g, "/");
}

function createHybridLinkPropsFixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-hybrid-link-"));
  const nativeFile = join(root, "native.ts");
  const helperFile = join(root, "helper.ts");
  const linkFile = join(root, "link.ts");

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

  return linkFile;
}

type LargeFallbackFixture = {
  /**
   * Project root containing the synthetic larger benchmark surface.
   */
  root: string;
  /**
   * File with the semantic-fallback target alias.
   */
  linkFile: string;
  /**
   * Native anchor props file used to test dependency invalidation.
   */
  anchorFile: string;
  /**
   * Static-only baseline file with a large plain interface.
   */
  staticFile: string;
  /**
   * Synthetic consumer module used by registry HMR benchmarks.
   */
  consumerFile: string;
};

type FallbackBenchmarkStats = {
  /**
   * Human-readable benchmark path label.
   */
  label: string;
  /**
   * Number of measured schema builds.
   */
  runs: number;
  /**
   * Number of builds that reported semantic fallback through debug records.
   */
  fallbackCount: number;
  /**
   * Sum of measured schema build durations.
   */
  totalDurationMs: number;
  /**
   * Fastest measured schema build duration.
   */
  minDurationMs: number;
  /**
   * Slowest measured schema build duration.
   */
  maxDurationMs: number;
};

type RunMeasuredFallbackBuildOptions = {
  /**
   * Label used to find the stats bucket for this build.
   */
  label: string;
  /**
   * Type file used as the root schema request.
   */
  filePath: string;
  /**
   * Requested type name.
   */
  typeName: string;
  /**
   * Reused or cold resolver under measurement.
   */
  resolver: TypeResolver;
  /**
   * Config carrying benchmark debug instrumentation.
   */
  config: DocgenConfig;
};

function createFallbackBenchmarkStats(label: string): FallbackBenchmarkStats {
  return {
    label,
    runs: 0,
    fallbackCount: 0,
    totalDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    maxDurationMs: 0,
  };
}

function resetFallbackBenchmarkStats(stats: FallbackBenchmarkStats): void {
  stats.runs = 0;
  stats.fallbackCount = 0;
  stats.totalDurationMs = 0;
  stats.minDurationMs = Number.POSITIVE_INFINITY;
  stats.maxDurationMs = 0;
}

function createFallbackBenchmarkConfig(stats: FallbackBenchmarkStats): DocgenConfig {
  return resolveConfig({
    experimentalDebug: (record) => {
      if (record.kind !== "resolution") {
        return;
      }

      if (!record.usedSemanticFallback) {
        return;
      }

      stats.fallbackCount++;
    },
  });
}

function runMeasuredFallbackBuild(options: RunMeasuredFallbackBuildOptions): void {
  const { label, filePath, typeName, resolver, config } = options;
  const stats = label === firstFallbackStats.label ? firstFallbackStats : repeatedFallbackStats;
  const startedAt = performance.now();
  const schema = generateDocsWithResolver({
    filePath,
    typeName,
    resolver,
    config,
  });
  const durationMs = performance.now() - startedAt;

  if (!schema.entries[0]) {
    throw new Error(`Benchmark schema build failed for ${typeName}`);
  }

  stats.runs++;
  stats.totalDurationMs += durationMs;
  stats.minDurationMs = Math.min(stats.minDurationMs, durationMs);
  stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);
}

function printFallbackBenchmarkNotes(statsList: FallbackBenchmarkStats[]): void {
  for (const stats of statsList) {
    if (stats.runs === 0) {
      continue;
    }

    const average = stats.totalDurationMs / stats.runs;
    console.info(
      [
        `[bench-note] ${stats.label}`,
        `runs=${stats.runs}`,
        `semanticFallbacks=${stats.fallbackCount}`,
        `avgMs=${average.toFixed(3)}`,
        `minMs=${stats.minDurationMs.toFixed(3)}`,
        `maxMs=${stats.maxDurationMs.toFixed(3)}`,
      ].join(" "),
    );
  }
}

function createLargeFallbackFixture(): LargeFallbackFixture {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-large-fallback-"));
  const srcDir = join(root, "src");
  const nativeDir = join(srcDir, "native");
  const helpersDir = join(srcDir, "helpers");
  const tokenDir = join(srcDir, "tokens");
  const componentsDir = join(srcDir, "components");

  mkdirSync(nativeDir, { recursive: true });
  mkdirSync(helpersDir, { recursive: true });
  mkdirSync(tokenDir, { recursive: true });
  mkdirSync(componentsDir, { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );

  for (let index = 0; index < 72; index++) {
    writeFileSync(
      join(tokenDir, `token-${index}.ts`),
      `export type Token${index} = 'token-${index}' | 'token-${index}-active'\n`,
    );
  }

  writeFileSync(
    join(tokenDir, "index.ts"),
    Array.from({ length: 72 }, (_value, index) => {
      return `export type { Token${index} } from './token-${index}'`;
    }).join("\n"),
  );

  writeFileSync(
    join(tokenDir, "theme.ts"),
    [
      "import type { Token0, Token1, Token2, Token3 } from './index'",
      "export type ThemeSlot = Token0 | Token1 | Token2 | Token3",
      "export type Density = 'compact' | 'comfortable'",
    ].join("\n"),
  );

  const anchorFile = join(nativeDir, "anchor.ts");
  writeFileSync(
    anchorFile,
    [
      "import type { Density, ThemeSlot } from '../tokens/theme'",
      "export interface AnchorNativeProps {",
      "  /** Link target URL. */",
      "  href?: string",
      "  /** Browser target. */",
      "  target?: '_blank' | '_self'",
      "  /** Relationship hint. */",
      "  rel?: string",
      "  /** Download filename. */",
      "  download?: string",
      "  /** Native ARIA label. */",
      "  ariaLabel?: string",
      "  /** Design token slot. */",
      "  slot?: ThemeSlot",
      "  /** Density variant. */",
      "  density?: Density",
      ...Array.from({ length: 24 }, (_value, index) => {
        return [`  /** Native data flag ${index}. */`, `  dataFlag${index}?: boolean`].join("\n");
      }),
      "}",
    ].join("\n"),
  );

  writeFileSync(
    join(nativeDir, "button.ts"),
    [
      "export interface ButtonNativeProps {",
      "  /** Disabled state. */",
      "  disabled?: boolean",
      "  /** Button type. */",
      "  type?: 'button' | 'submit'",
      "}",
    ].join("\n"),
  );

  writeFileSync(
    join(helpersDir, "react-like.ts"),
    [
      "import type { AnchorNativeProps } from '../native/anchor'",
      "import type { ButtonNativeProps } from '../native/button'",
      "export type IntrinsicElementName = 'a' | 'button'",
      "export type IntrinsicElementProps = {",
      "  a: AnchorNativeProps",
      "  button: ButtonNativeProps",
      "}",
      "export type ComponentPropsWithoutRef<T extends IntrinsicElementName> = IntrinsicElementProps[T]",
    ].join("\n"),
  );

  const linkFile = join(componentsDir, "link.ts");
  writeFileSync(
    linkFile,
    [
      "import type { ComponentPropsWithoutRef } from '../helpers/react-like'",
      "export interface OwnLinkProps {",
      "  /** Visible label. */",
      "  label: string",
      "  /** Current active state. */",
      "  active?: boolean",
      "}",
      "export type LargeLinkProps = OwnLinkProps & Omit<ComponentPropsWithoutRef<'a'>, 'children'>",
    ].join("\n"),
  );

  const staticFile = join(componentsDir, "static-card.ts");
  writeFileSync(
    staticFile,
    [
      "export interface StaticCardProps {",
      ...Array.from({ length: 64 }, (_value, index) => {
        return [`  /** Static property ${index}. */`, `  prop${index}?: string`].join("\n");
      }),
      "}",
    ].join("\n"),
  );

  const consumerFile = join(srcDir, "consumer.ts");
  writeFileSync(consumerFile, "import { getDocs } from '@synthfall/oxc-ts-docgen'\n");

  return {
    root,
    linkFile,
    anchorFile,
    staticFile,
    consumerFile,
  };
}

type LargeRegistryFixture = {
  /**
   * Project root with many indexed declarations.
   */
  root: string;
  /**
   * Leaf dependency used by the targeted invalidation benchmark.
   */
  leafFile: string;
  /**
   * File containing the lazily requested public schema type.
   */
  targetFile: string;
  /**
   * Lazily requested public schema type name.
   */
  targetTypeName: string;
  /**
   * Synthetic consumer module registered for HMR invalidation.
   */
  consumerFile: string;
};

function createLargeRegistryFixture(): LargeRegistryFixture {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-large-registry-"));
  const srcDir = join(root, "src");
  const generatedDir = join(srcDir, "generated");
  const componentsDir = join(srcDir, "components");
  const sharedDir = join(srcDir, "shared");

  mkdirSync(generatedDir, { recursive: true });
  mkdirSync(componentsDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );

  const leafFile = join(sharedDir, "leaf-token.ts");
  writeFileSync(
    leafFile,
    [
      "export type LeafToken = 'base' | 'active'",
      "export interface LeafSource {",
      "  /** Leaf token. */",
      "  token?: LeafToken",
      "}",
    ].join("\n"),
  );

  for (let index = 0; index < 180; index++) {
    writeFileSync(
      join(generatedDir, `model-${index}.ts`),
      [
        `export type ModelVariant${index} = 'primary' | 'secondary'`,
        `export interface Model${index} {`,
        "  /** Stable id. */",
        "  id: string",
        `  /** Model variant ${index}. */`,
        `  variant?: ModelVariant${index}`,
        "}",
      ].join("\n"),
    );
  }

  for (let index = 0; index < 48; index++) {
    writeFileSync(
      join(componentsDir, `component-${index}.ts`),
      [
        "import type { LeafSource } from '../shared/leaf-token'",
        `import type { Model${index} } from '../generated/model-${index}'`,
        `export interface Component${index}Props extends LeafSource {`,
        "  /** Component label. */",
        "  label: string",
        `  /** Linked model ${index}. */`,
        `  model?: Model${index}`,
        "}",
      ].join("\n"),
    );
  }

  const targetFile = join(componentsDir, "target.ts");
  writeFileSync(
    targetFile,
    [
      "import type { LeafSource } from '../shared/leaf-token'",
      "import type { Model0 } from '../generated/model-0'",
      "export interface TargetProps extends LeafSource {",
      "  /** Target label. */",
      "  label: string",
      "  /** Primary model. */",
      "  model?: Model0",
      "}",
    ].join("\n"),
  );

  const consumerFile = join(srcDir, "consumer.ts");
  writeFileSync(consumerFile, "import { getDocs } from '@synthfall/oxc-ts-docgen'\n");

  return {
    root,
    leafFile,
    targetFile,
    targetTypeName: "TargetProps",
    consumerFile,
  };
}

function createHmrFixture(): {
  root: string;
  nativeFile: string;
  linkFile: string;
  consumerFile: string;
} {
  const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-bench-hmr-"));
  const nativeFile = join(root, "native.ts");
  const helperFile = join(root, "helper.ts");
  const linkFile = join(root, "link.ts");
  const consumerFile = join(root, "consumer.ts");

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
  writeFileSync(consumerFile, "import { getDocs } from '@synthfall/oxc-ts-docgen'\n");

  return { root, nativeFile, linkFile, consumerFile };
}
