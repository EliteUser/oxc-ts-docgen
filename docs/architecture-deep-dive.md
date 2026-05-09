# Architecture Deep Dive

This file keeps the operational details that are too specific for the README
but still useful when changing resolver, semantic fallback, Vite transform, or
HMR behavior.

## Vite Flow

`packages/vite-plugin/src/plugin.ts` owns Vite lifecycle state:

- create/dispose `TypeRegistry`;
- initialize project scanning in `buildStart`;
- route `transform()` to module or Vue SFC transforms;
- emit dev warnings or build errors for resolver diagnostics;
- load virtual schema modules;
- invalidate consumers and virtual modules during HMR.

`packages/vite-plugin/src/transform/transform.ts` is syntax-only. It parses
with OXC, finds the imported `getDocs` binding from `@synthfall/oxc-ts-docgen`,
ignores shadowed locals, and accepts:

```ts
getDocs<MyType>();
getDocs({ path: "./types", symbol: "MyType" });
getDocs([{ id: "my-type", path: "./types", symbol: "MyType" }] as const);
```

`packages/vite-plugin/src/transform/vue-sfc-transform.ts` extracts inline
`<script>` and `<script setup lang="ts">` content, applies the same module
transform, and splices the result back without touching template/style blocks.

The transform resolves targets through the registry. It does not call
TypeScript checker APIs. Dev mode preserves recoverable unresolved calls so HMR
can recover; build mode fails.

## Registry And HMR

`packages/vite-plugin/src/registry/type-registry.ts` adapts Vite to core
`DocgenProject`:

- map consumer modules to requested type keys;
- initialize and rebuild project indexes;
- ask core for schemas;
- collect dependency records from schema build results;
- update semantic snapshots on changed files;
- return affected consumers for Vite invalidation.

`packages/vite-plugin/src/registry/registry-dependency-collector.ts` is the
compatibility layer for dependency records that originate from core schema
builds, resolver traces, related entries, property source files, static
reference walking, semantic declarations, and unresolved exported-target
recovery.

`packages/vite-plugin/src/graph` stores Vite-side dependency and consumer
relationships. Core owns adapter-neutral dependency records; the plugin owns
Vite module invalidation.

## Core Flow

`packages/docgen/src/public/api.ts` exposes:

- `getDocs()` runtime stub;
- `generateDocs()`;
- `generateDocsFromSource()`;
- result-returning variants for diagnostics and dependency records.

Generation steps:

1. Resolve config from `packages/docgen/src/public/config.ts`.
2. Parse with `TypeResolver.parseFileCached()`.
3. Resolve the target through `ResolutionController`.
4. Build static output with `packages/docgen/src/builders`.
5. Route to semantic fallback when static extraction marks a semantic boundary.
6. Attach related entries and dependency records.
7. Return `DocSchema` plus build metadata for adapters.

`packages/docgen/src/project/docgen-project.ts` is the official adapter facade.
It hides `ProjectTypeIndex`, `ProjectSchemaCache`, `TypeResolver`, diagnostics,
and semantic service lifetime behind a stable package-root export.

## Resolver Rules

The resolver stack is deterministic and bounded:

- local declaration lookup;
- relative/absolute resolution through `ModuleResolver`;
- extension aliases and directory `index.ts` candidates;
- tsconfig `baseUrl` and wildcard `paths` through `oxc-resolver`;
- explicit, aliased, and star type re-exports through common barrels;
- exported-symbol visibility for imported targets and re-export traversal;
- cross-file `extends`;
- bounded generic substitution for local object-property extraction.

Private declarations must not be compiled through imported, object, batch,
star re-export, or explicit re-export paths.

Diagnostics from module resolution and semantic tsconfig parsing surface through
the same Vite warning/build-error path.

## Semantic Fallback

Semantic modules are the only modules that import TypeScript checker APIs.
`TypeScriptSemanticService` keeps persistent services keyed by explicit
tsconfig, nearest tsconfig, or a default project bucket.

Fallback is used for property sets that syntax cannot safely compute:

- complex utility aliases;
- mapped, conditional, indexed-access, and `keyof` patterns;
- object-like unions that require branch merging;
- tuples, arrays, function types, nested object literals;
- source-aware related types and in-memory `generateDocsFromSource()` paths.

Fallback returns normalized intermediate property/type data. Final
`DocSchema` generation remains in the shared schema layer.

## Output Rules

Prefer structured `DocType` when cheap and reliable. When a type cannot be
safely evaluated:

- preserve a reference when the type name is known;
- preserve readable display/opaque output for complex semantic types;
- use diagnostics instead of silent successful empty property lists;
- never emit fake normal-output props such as `__unresolved`.

Filtering is policy-driven. Semantic-only union branch properties must not be
filtered solely because they lack JSDoc.

## Release Rules

Changesets is the release source of truth:

- `pnpm changeset` records user-visible package changes.
- `pnpm release:version` applies versions and changelogs.
- `pnpm release:publish` builds, verifies release artifacts, and publishes.
- `.github/workflows/ci.yml` runs code quality for pull requests and non-`master`
  branches, then creates the release PR or publishes on pushes to `master`.
- CI installs pnpm directly with npm; it does not use Corepack.
- Publishing requires `NPM_TOKEN` and emits npm provenance metadata.

The two packages are fixed together because the Vite adapter depends on the
core schema/runtime contract.
