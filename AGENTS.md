# oxc-ts-docgen Agent Guide

Repository-specific instructions for AI agents. Prefer these over generic
defaults.

## Communication Preference

The user is a B2- English learner aiming for C1. When a task message contains
meaningful natural-language English, briefly help improve it before solving the
coding task.

Use this format only when useful:

```md
**English micro-lesson**

- **C1 rewrite:** Rewrite the request in polished, natural English without changing the technical meaning.
- **Main issue:** Mention 1-2 grammar, vocabulary, or clarity improvements.
- **Useful phrase:** Give 0-2 relevant technical English phrases.
```

Skip the lesson when the message is short, urgent, mostly code/logs/diffs,
mostly filenames/API names, or already clear enough. Never correct code,
commands, identifiers, quoted strings, or error messages unless asked.

## Serena And Memory

Use Serena as the primary code-navigation tool.

At the start of each session:

- Activate the current directory as a Serena project.
- Check onboarding/project memories.
- Read relevant memories before broad exploration.

For traversal:

- Prefer symbol overview, declarations, references, and focused searches.
- Read full files only when symbol-level context is insufficient.
- After substantial changes, check whether durable Serena memories need updates.
- Update only stable project knowledge: architecture, package structure,
  commands, conventions, public APIs, and important workflows.

## Shell

Run terminal commands through Git Bash from PowerShell:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "{COMMAND}"
```

Use `rg` when available. If Git Bash cannot run the bundled `rg`, use `grep`,
`find`, or `git ls-files`.

## Product Direction

`oxc-ts-docgen` is a Vite-first structured type metadata generator for custom
docs UIs.

Honest pitch:

```txt
TypeDoc documents APIs.
oxc-ts-docgen extracts structured metadata for one requested TypeScript type inside a Vite app.
```

Supported compile-time forms:

```ts
const docs = getDocs<MyType>();
const docs = getDocs({ path: "./types", symbol: "MyType" });
const examples = getDocs([{ id: "my-type", path: "./types", symbol: "MyType" }] as const);
```

Do not turn the project into a documentation site generator, TypeDoc/API
Extractor replacement, Storybook argTypes producer, React component detector, or
React auto-docgen clone.

Core architecture:

```txt
OXC = fast syntax/index/transform/HMR scanner
TypeScript = semantic property resolver when needed
Docgen = one normalized schema layer above both
```

Preserve the hybrid direction: OXC for cheap syntax and Vite speed, TypeScript
for semantic fallback, and one stable `DocSchema` output for custom UIs.

## Repository Layout

This is a pnpm monorepo:

- `packages/docgen`: core engine (`@synthfall/oxc-ts-docgen`).
- `packages/vite-plugin`: Vite adapter (`@synthfall/oxc-ts-docgen-vite`).
- `playground`: development app and curated schema-rendering UI.
- `docs`: architecture and maintainer docs.

Core source layout:

- `packages/docgen/src/index.ts`: public package root.
- `packages/docgen/src/cli.ts`: CLI entry.
- `packages/docgen/src/public`: API, config, debug records, presets.
- `packages/docgen/src/schema`: `DocSchema` types and build pipeline.
- `packages/docgen/src/project`: `DocgenProject`, project type index, schema cache.
- `packages/docgen/src/builders`: static OXC builders.
- `packages/docgen/src/resolver`: parser indexes, module resolution, exports,
  heritage, generics, related types, source references.
- `packages/docgen/src/semantic`: TypeScript semantic fallback.
- `packages/docgen/src/graph`, `model`, `utils`: shared internals.

Vite source layout:

- `packages/vite-plugin/src/index.ts`: public package root.
- `packages/vite-plugin/src/plugin.ts`: Vite lifecycle.
- `packages/vite-plugin/src/scanner`: call scanning.
- `packages/vite-plugin/src/transform`: module, writer, and Vue SFC transforms.
- `packages/vite-plugin/src/registry`: registry, dependency collector, source resolver.
- `packages/vite-plugin/src/graph`, `utils`: HMR graphs and path helpers.

Tests mirror source domains under `packages/*/tests/{public,resolver,...}`.

## Scripts

Root scripts:

- `pnpm test`: all Vitest tests.
- `pnpm typecheck`: TypeScript project references.
- `pnpm lint`: oxlint.
- `pnpm format`: oxfmt with import sorting.
- `pnpm build`: package builds with tsdown.
- `pnpm release:check`: build plus publishable artifact verification.
- `pnpm changeset`: create a Changesets release note.
- `pnpm release:version`: apply Changesets versions/changelogs.
- `pnpm release:publish`: verify release artifacts and publish with Changesets.
- `pnpm dev`: playground through the workspace filter.

Useful focused validation:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm exec vitest run packages/docgen/tests/public/api.test.ts packages/docgen/tests/resolver/resolver.test.ts packages/vite-plugin/tests/transform/transform.test.ts"
```

For resolver/Vite contract changes, add:

```powershell
& "C:\WebDev\Git\bin\bash.exe" -lc "pnpm exec vitest run packages/docgen/tests/contracts/architecture-contracts.test.ts packages/vite-plugin/tests/plugin/plugin.test.ts"
```

Run `pnpm typecheck` for TypeScript-facing changes and `pnpm release:check` for
build/package/release changes.

## Tooling

- TypeScript strict mode, ESM, Node target ES2023.
- Published packages support Node >=22.12.0.
- Workspace dev tooling requires Node >=22.18.0.
- CI runs Node 22.18.0 and Node 24.
- pnpm 11 workspaces (`pnpm@11.9.0`).
- Build with `tsdown`; tests with Vitest 4.
- Package builds intentionally emit ESM and CommonJS. Current `tsdown` CommonJS
  recommendation warnings are accepted release noise while CJS entry points are
  intentional.

## Architecture Rules

Hybrid boundary:

- OXC-facing modules may import OXC AST types.
- Semantic modules may import TypeScript checker APIs.
- Vite transform modules must not query TypeScript semantic types directly.
- TypeScript fallback returns normalized intermediate results, not final
  `DocSchema` objects.
- Presets provide policy inputs, not schema-generation pipelines.
- HMR dependency registration must use explicit dependency records from static
  and semantic paths.
- `ProjectSchemaCache` build results carry resolution outcomes, diagnostics,
  and schema dependency records.
- Public package roots export documented user APIs plus `DocgenProject`. Keep
  resolver/cache/graph primitives internal; do not reintroduce hidden
  `/internal` subpaths.

Resolver behavior to preserve:

- local declaration lookup;
- relative/absolute import resolution through `ModuleResolver`;
- extension aliases and directory `index.ts` candidates;
- tsconfig `baseUrl` and wildcard `paths` via `oxc-resolver`;
- clear diagnostics for missing, invalid, and unsupported explicit tsconfig
  paths;
- aliased imports and explicit/aliased/star type re-exports;
- exported-symbol visibility for imported Vite targets and re-export traversal;
- cross-file `extends` and multi-level inherited prop merging;
- bounded generic substitution and supported utility composition;
- hybrid fallback for unsupported object-like utilities and complex semantic
  property sets;
- dependency files for HMR, including semantic fallback and unresolved
  exported-target recovery dependencies.

Output rules:

- Prefer structured `DocType` when cheap and reliable.
- Preserve references or readable display/opaque output when types cannot be
  safely evaluated.
- Do not emit fake user-visible props such as `__unresolved`.
- Do not silently return a successful empty property list for unsupported
  object-like types in hybrid mode.
- Debug records are opt-in through `experimentalDebug` and must not pollute
  normal `DocSchema`.

Vite rules:

- Keep transforms cheap: parse only modules containing `getDocs`.
- Respect shadowed local `getDocs` bindings.
- Object and batch targets must be statically analyzable.
- Imported generic targets and object/batch targets must resolve to exported
  TypeScript module symbols.
- In dev, preserve unresolved or unexported recoverable calls and register watch
  dependencies; in build, fail.
- Do not query semantic types from `transform.ts`.
- Vue SFC support only transforms script blocks and preserves template/style.

## Config Surface

Keep public config small:

- `analysis: "hybrid" | "static"`
- `presets`
- `include`, `exclude`
- `ignoreTypes`
- `maxDepth`
- `tsconfig`
- `buildMode: "indexOnly" | "eagerPublic" | "eagerAll"`
- `outputMode: "inline" | "virtual"`
- `externalTypes: "ignore" | "reference" | "resolve"`
- `tags`
- `propFilter`
- `skipPropsWithName`
- `skipPropsWithoutDoc`
- `skipPropsFromExternalFiles`
- `experimentalDebug`

Defaults apply hybrid analysis plus TypeScript, React, and DOM presets. Setting
`presets` explicitly opts out of the default preset set.

Do not reintroduce `resolveMode` or add broad public fallback-policy options
without concrete, tested user need.

## Release

Changesets handles semantic versioning, changelogs, and publishing for both
published packages. They are configured as a fixed release group.

- Add a changeset for every user-visible package change: `pnpm changeset`.
- The unified CI workflow runs code quality on pull requests and non-`master`
  branches.
- On pushes to `master`, the workflow opens a version PR or publishes after that
  PR is merged.
- Publishing runs `pnpm release:check` before `changeset publish`.
- CI installs pnpm directly with npm and does not use Corepack.
- Publishing requires `NPM_TOKEN` and emits npm provenance metadata.

## Code Style

- Prefer `type` over `interface`.
- Use type-only imports/exports.
- Prefer named exports.
- No `any`; avoid assertions where possible.
- Prefix intentionally unused variables with `_`.
- Use arrow functions unless `this` is required.
- Avoid inline-destructured function parameters.
- Avoid functions with more than two arguments; use typed options objects.
- Prefer guard clauses and straightforward conditionals with blocks.
- Keep modules cohesive; split large utility/constants files over 300 LOC.
- Add JSDoc comments for properties of public/codebase types.
- Comments should explain why, invariants, and external-system quirks.

## Documentation

Update README, package READMEs, architecture docs, and this file when behavior,
source layout, public API, resolver/Vite contracts, release flow, or operational
assumptions change.

Current docs:

- `README.md`: user-facing overview, schema, config, release.
- `packages/docgen/README.md`: core package usage.
- `packages/vite-plugin/README.md`: Vite adapter usage.
- `docs/architecture.md`: current architecture.
- `docs/architecture-deep-dive.md`: maintainer details.

## Definition Of Done

- Relevant tests are added or updated.
- `pnpm typecheck` passes for TypeScript-facing changes.
- `pnpm test` passes, or the exact reason it could not be run is documented.
- Public schema changes are intentional and reflected in tests/snapshots.
- Architecture and release docs stay aligned with code changes.
