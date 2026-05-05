# oxc-ts-docgen Agent Guide

This file is the operating manual for AI agents working in this repository.
Prefer these instructions over generic assumptions.

## Shell

All terminal commands must use Git Bash through PowerShell:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "{COMMAND}"
```

Examples:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm test"
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm lint"
& "C:\WebDev\Git\bin\bash.exe" -lc "find packages -type f | sort"
```

Use `rg` when available, but in this environment Git Bash may not be able to run
the bundled `rg` binary. If `rg` fails, use `grep`, `find`, or `git ls-files`
when the repository is initialized.

## Product Direction

`oxc-ts-docgen` is a static-analysis-first TypeScript documentation generator.
It should remain fast, explicit, source-faithful, and JSDoc-first.

The core API is:

```ts
const docs = getDocs<MyType>();
```

Documented targets can be interfaces, type aliases, enums, function types,
utility-composed props objects, design-token types, config schemas, domain
models, or any other source-authored TypeScript type.

Optimize for:

- Fast startup indexing for large libraries.
- Very fast Vite HMR rebuilds.
- JSDoc-first metadata.
- Preserving authored type boundaries and source locations.
- Predictable structured output for custom docs UIs.
- Bounded static type resolution.

Do not steer the core toward:

- A full TypeScript compiler API migration.
- Checker-perfect semantic evaluation.
- React component auto-detection.
- `memo`, `forwardRef`, HOC, styled-components, or class component analysis.
- Direct Storybook `ComponentDoc` or `argTypes` output in core.
- Exhaustive expansion of `@types/react` or DOM attribute interfaces.

Adapters can be added later, but they should consume `DocSchema` rather than
making the core React-specific.

## Repository Layout

This is a pnpm monorepo.

- `packages/docgen` - core documentation engine (`@oxc-ts-docgen/docgen`)
- `packages/vite-plugin` - Vite plugin for compile-time `getDocs<T>()`
  transforms (`@oxc-ts-docgen/vite-plugin`)
- `playground` - development/test application
- `roadmap.md` - current product and implementation roadmap; read it before
  large architectural changes

## Key Source Files

Core docgen:

- `packages/docgen/src/parser.ts` - `oxc-parser` wrapper and per-file indexes.
- `packages/docgen/src/builder.ts` - converts OXC AST nodes into `DocSchema`,
  `DocEntry`, `DocProperty`, and `DocType`.
- `packages/docgen/src/module-resolver.ts` - internal `oxc-resolver` wrapper,
  tsconfig-aware module specifier resolution, normalized paths, and resolution
  caching.
- `packages/docgen/src/resolver.ts` - static type resolver and file cache.
- `packages/docgen/src/jsdoc.ts` - JSDoc extraction and tag normalization.
- `packages/docgen/src/related-types.ts` - referenced project type collection.
- `packages/docgen/src/schema.ts` - public output schema.
- `packages/docgen/src/config.ts` - config surface and defaults.
- `packages/docgen/src/cli.ts` - command-line entrypoint.

Vite plugin:

- `packages/vite-plugin/src/transform.ts` - detects and replaces `getDocs<T>()`
  calls.
- `packages/vite-plugin/src/type-registry.ts` - project type index, schema
  cache, type dependency graph, and consumer invalidation.
- `packages/vite-plugin/src/plugin.ts` - Vite lifecycle and HMR integration.
- `packages/vite-plugin/src/hmr.ts` - HMR-related helpers when present.

Tests and fixtures:

- `packages/docgen/tests/api.test.ts` - core schema extraction behavior.
- `packages/docgen/tests/resolver.test.ts` - file-based cross-file resolution.
- `packages/docgen/tests/bench.bench.ts` - performance benchmarks.
- `packages/docgen/tests/fixtures/*` - source fixtures for core tests.
- `packages/vite-plugin/tests/transform.test.ts` - compile-time transform tests.
- `packages/vite-plugin/tests/type-registry.test.ts` - registry/HMR graph tests.
- `packages/vite-plugin/tests/plugin.test.ts` - Vite hook behavior.

## Package Scripts

Root scripts:

- `pnpm test` - run all Vitest tests.
- `pnpm build` - build all packages with tsup.
- `pnpm lint` - run oxlint.
- `pnpm fmt` - run oxfmt.
- `pnpm dev` - start the playground through the workspace filter.

Package scripts:

- `pnpm --filter @oxc-ts-docgen/docgen run build`
- `pnpm --filter @oxc-ts-docgen/vite-plugin run build`
- `pnpm --filter playground run dev`

Benchmark command:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm exec vitest bench packages/docgen/tests/bench.bench.ts --run"
```

## Coding Conventions

- Language: TypeScript.
- Module system: ESM only (`"type": "module"`).
- Node target: ES2023.
- Build: tsup.
- Test: Vitest with fixture-based tests and snapshots.
- Lint: oxlint (`.oxlintrc.json`).
- Format: oxfmt (`.oxfmtrc.json`).
- Package manager: pnpm workspaces.
- Source filenames: kebab-case, e.g. `related-types.ts`.
- Test filenames: `packages/*/tests/<module>.test.ts`.
- Fixtures: `packages/*/tests/fixtures/<name>.ts`.

Keep changes scoped. Avoid unrelated refactors and output churn.

## Architecture Rules

### Static Analysis Boundary

Use `oxc-parser` ASTs and static source analysis for core docgen behavior.
Do not introduce a TypeScript `Program`, `TypeChecker`, or LanguageService into
the default extraction path.

Use `oxc-resolver` for static module resolution, including tsconfig discovery,
`baseUrl`, and `paths`. Do not add `tsconfck` back unless the project needs
direct tsconfig inspection outside module resolution, such as custom diagnostics
or include/exclude interpretation. Keep all tsconfig usage separate from full
checker semantics.

### Output Philosophy

The schema should preserve authored structure. Prefer structured `DocType`
output over flattened type strings.

When a type cannot be safely evaluated:

- Preserve a `reference` when the type name is known.
- Preserve an `unresolved` marker when the syntax is unsupported.
- Do not silently return an empty property list for an unsupported object-like
  type.

This is a documentation generator, not a typechecker.

### Resolver Design

The resolver should be deterministic, bounded, and cache-friendly.

Current behavior includes:

- Local declaration lookup.
- Relative/absolute import resolution through the shared `ModuleResolver`.
- Extension aliases and `index.ts` candidate resolution.
- `tsconfig` discovery, `baseUrl`, and wildcard `paths` aliases through
  `oxc-resolver`.
- Aliased named imports.
- Explicit, aliased, and star type re-exports through common barrel files.
- Cross-file `extends`.
- Multi-level inherited prop merging.
- Static evaluation for common object-shaping utilities.
- Explicit external type policy through
  `externalTypes: 'ignore' | 'reference' | 'resolve'`.
- Resolver trace metadata for Vite HMR dependency registration.

Important pending areas:

- Clear diagnostics for missing or invalid tsconfig files.
- Bounded generic substitution.
- Unsupported utility/property extraction should preserve visible unresolved
  output instead of looking empty.
- Default exports and namespace/qualified type references need clearer behavior.

Before changing resolver behavior, add or update tests in
`packages/docgen/tests/resolver.test.ts`, `packages/docgen/tests/api.test.ts`,
and/or `packages/vite-plugin/tests/type-registry.test.ts`.

### Vite Plugin Design

The Vite plugin must keep transforms cheap.

- `transform.ts` should only parse modules that contain `getDocs`.
- Preserve unresolved `getDocs<T>()` calls in dev mode.
- Fail unresolved calls in build mode.
- Respect shadowed local `getDocs` bindings.
- Keep HMR dependency tracking accurate when types move, disappear, reappear,
  or change through imported references.

Avoid rebuilding the whole project in every transform. Prefer registry indexes,
lazy schema builds, dependency graphs, and file-level invalidation.

## Tests To Run

For docs-only changes:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm test"
```

For core extraction or resolver changes:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm test -- packages/docgen/tests/api.test.ts packages/docgen/tests/resolver.test.ts"
```

For Vite plugin changes:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm test -- packages/vite-plugin/tests"
```

For build or package export changes:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm build"
```

For formatting/lint-sensitive changes:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm fmt && pnpm lint"
```

If test snapshots change, inspect the changed output carefully. Snapshot churn
usually means a schema behavior change and should be intentional.

## Adding Features

When adding core docgen behavior:

1. Add a fixture or inline source test that captures the real TypeScript pattern.
2. Update `DocType` only when the new syntax cannot be represented by existing
   variants.
3. Keep evaluation bounded by `maxDepth` or another explicit guard.
4. Preserve source locations and JSDoc where possible.
5. Add Vite registry/HMR tests when the new behavior affects dependency
   tracking.
6. Update `roadmap.md` when a roadmap item becomes implemented or changes shape.

When adding resolver features:

1. Prefer structured indexes over repeated AST scans.
2. Normalize paths consistently with `/` for keys.
3. Handle cycles explicitly.
4. Keep external package expansion opt-in.
5. Preserve unresolved/reference output instead of dropping information.

When adding Vite features:

1. Keep transforms deterministic and side-effect-light.
2. Register consumers even when a type is currently unresolved so HMR can recover
   when the type is restored.
3. Avoid embedding larger or repeated JSON when a cache or virtual module would
   be more appropriate.
4. Test dev and build behavior separately when unresolved calls are involved.

## Config Surface Notes

Some config fields exist before full behavior is implemented. Treat these as
intentional roadmap items, not completed features:

- `resolveMode`
- `tags`

Do not document these as fully supported until tests prove the behavior.

Potential future config from `roadmap.md`:

- `buildMode: 'indexOnly' | 'eagerPublic' | 'eagerAll'`
- `propFilter`
- `skipPropsWithName`
- `skipPropsWithoutDoc`
- `skipPropsFromExternalFiles`

## Common Pitfalls

- Do not replace structured `DocType` output with `typeToString`-style strings.
- Do not pull in TypeScript checker APIs for convenience in core extraction.
- Do not silently drop props when utility evaluation fails.
- Do not expand React/DOM inherited types by default; use `ignoreTypes` and
  external policy controls.
- Do not forget HMR invalidation when adding new reference-bearing `DocType`
  variants.
- Do not treat absolute Windows paths and POSIX paths differently in registry
  keys.
- Do not remove unresolved `getDocs<T>()` imports in dev when some calls still
  need the runtime stub.

## Definition Of Done

A change is generally done when:

- Relevant tests are added or updated.
- `pnpm test` passes, or the exact reason it could not be run is documented.
- Public schema changes are intentional and reflected in tests/snapshots.
- `roadmap.md` is updated if the change completes or reshapes a roadmap item.
- The implementation preserves the static-analysis-first product direction.
