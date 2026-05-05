# oxc-ts-docgen Roadmap

## Product Direction

`oxc-ts-docgen` is a static-analysis-first TypeScript documentation generator.
It is not trying to be a drop-in `react-docgen-typescript` clone and should not
depend on full TypeScript checker semantics for its core behavior.

The primary API is explicit:

```ts
const docs = getDocs<MyType>();
```

The documented target can be an interface, type alias, enum, function type,
utility-composed props object, design-token type, config schema, domain model,
or any other source-authored TypeScript type that a documentation UI wants to
render.

The project should optimize for:

- Fast startup indexing for large libraries.
- Very fast, pointed Vite HMR rebuilds.
- JSDoc-first metadata.
- Source-faithful documentation that preserves authored type boundaries.
- Predictable, structured output for custom documentation UIs.
- Bounded, controllable type resolution instead of full checker emulation.

The project should not optimize for:

- Auto-detecting React components.
- Understanding `memo`, `forwardRef`, styled wrappers, HOCs, or class components.
- Producing Storybook `ComponentDoc` or `argTypes` output directly.
- Expanding every TypeScript or external library helper into checker-perfect output.
- Migrating core docgen to the TypeScript compiler API by default.

Optional adapters can be built later for React, Storybook, or UI controls, but
the core should remain generic and source-oriented.

## Current Status

The broad architecture is good:

- `@oxc-ts-docgen/docgen` parses files with `oxc-parser` and builds stable
  `DocSchema` output.
- Core module specifier resolution is handled through an internal
  `oxc-resolver` wrapper.
- `@oxc-ts-docgen/vite-plugin` indexes project files at dev startup.
- Vite `getDocs<T>()` calls are replaced at compile time.
- HMR reparses changed files and invalidates affected consumers through a type
  dependency graph.
- Non-trivial Vite transform traversal uses `oxc-walker` and `ScopeTracker`.

The current implementation is already fast on fixture benchmarks. Single-file
docgen is sub-millisecond, and cross-file fixture resolution is also well below
typical Vite transform budgets. The bigger remaining risk is correctness and
real-library ergonomics, not raw parser speed.

## Implemented And Verified

Core parsing and indexing:

- `ParsedSource` includes a per-file index for declarations, imports, exported
  type names, line starts, and sorted JSDoc comments.
- Declaration and import lookup use maps instead of repeated program scans.
- JSDoc lookup uses nearest-preceding comment search over sorted comments.
- Parsed JSDoc data is cached per comment.
- Source locations use precomputed line starts and binary search.

Core schema extraction:

- Interfaces, type aliases, and enums are documented.
- Interface properties, methods, index signatures, and call signatures are
  represented as `DocProperty` entries.
- Object type literals preserve nested properties and JSDoc.
- String, number, boolean, bigint, symbol, object, intrinsic, literal, array,
  tuple, union, intersection, function, mapped, conditional, indexed access,
  template literal, `keyof`, `typeof`, `infer`, and rest type shapes are
  represented structurally.
- Generic type parameters, constraints, and defaults are extracted.
- Enum members are represented as readonly properties.
- One-hop related project types are attached for referenced local/project types.

Resolver behavior:

- Local declarations resolve by name.
- Relative and absolute imports resolve through the shared `oxc-resolver`
  wrapper, with compatibility fallback for files, extension candidates, and
  `index.ts`-style directory entries.
- TypeScript extension aliases are supported for authored `.js`/`.jsx`/`.mjs`/
  `.cjs` imports that point at TypeScript sources.
- `tsconfig` discovery is delegated to `oxc-resolver`.
- Explicit `config.tsconfig` paths are supported; in the Vite plugin, relative
  paths are resolved from the Vite root.
- `compilerOptions.baseUrl` and wildcard `compilerOptions.paths` are supported.
- Imported type aliases are followed.
- Aliased imports are supported for common named import cases.
- Common explicit, aliased, and star type re-exports are followed through barrel
  files with bounded cycle guards.
- Interface `extends` chains resolve across files.
- Multi-level inherited properties are merged before own properties.
- `ignoreTypes` prevents noisy or unsupported types from expanding.
- Bare package imports are governed by `externalTypes`:
  - `reference` preserves external references without parsing packages.
  - `ignore` keeps extraction focused on local project types.
  - `resolve` opts into best-effort package source or declaration parsing.
- External type policy is enforced for both direct imports and local barrels
  that re-export package types.
- Resolver traces include traversed barrel and declaration files for Vite HMR
  dependency registration.
- Module specifier resolution is cached per resolver instance and cleared with
  file/registry invalidation.

Object-property extraction:

- Intersection type aliases can expose merged properties.
- `Pick<T, K>`, `Omit<T, K>`, `Partial<T>`, `Required<T>`, `Readonly<T>`,
  and `Record<K, V>` have practical static evaluation.
- Nested utility composition works for common object-shaped props.
- `keyof` can produce keys when the target object shape can be statically
  extracted.

Vite plugin:

- `getDocs<T>()` calls are transformed only when imported from
  `@oxc-ts-docgen/docgen`.
- Aliased `getDocs` imports are transformed.
- Shadowed local `getDocs` bindings are left alone.
- Missing or unresolved calls remain in dev mode and fail in build mode.
- Fully resolved calls remove `getDocs`-only imports.
- Transforms embed valid JSON schemas.
- The type registry eagerly scans included files, caches `DocEntry` data, and
  lazily caches full `DocSchema` objects.
- Include and exclude globs are applied during startup scans.
- HMR invalidates consumers when requested types are removed, restored, renamed,
  changed through JSDoc-only edits, changed through inherited base types, or
  changed through imported property references.
- HMR dependency tracking follows aliases, barrel files, final declaration
  files, and `tsconfig*.json` changes.
- Changing `tsconfig` in dev rebuilds the registry and hard-invalidates known
  `getDocs` consumers.

## Known Gaps

These are the gaps that matter most for the static-analysis product direction:

- Missing or invalid tsconfig files need clearer build-mode diagnostics.
- `resolveMode` exists in config but is not implemented.
- `tags` exists in config but custom tag parsing is not implemented.
- Generic substitution is limited. For example, resolving `Box<string>` should
  be able to document `value: string` when `Box<T>` declares `value: T`.
- Utility support is useful but incomplete. Unsupported utilities can still
  produce empty property lists instead of a visible unresolved marker.
- Related type extraction is shallow and name-based.
- Computed property names and symbol keys are mostly unsupported.
- Default exports and namespace/qualified type references need clearer behavior.
- Startup currently builds every declaration in every scanned file. This is fine
  for the playground, but large libraries need lazy or public-only modes.
- JSON is embedded directly into transformed source modules, which can become
  noisy for large schemas.

## Priority 1: Resolver Ergonomics

Real projects need imports to resolve the way authors write them. This is the
highest-priority next milestone.

### 1. Load And Apply `tsconfig`

Status: implemented for module resolution, `baseUrl`, `paths`, and Vite
registry rebuilds on `tsconfig` changes. Explicit relative `tsconfig` paths in
the Vite plugin are resolved from the Vite root. Error reporting for missing or
invalid tsconfig files still needs hardening.

Use `oxc-resolver` to load the effective tsconfig for module resolution from:

- `config.tsconfig` when provided.
- The nearest project tsconfig otherwise.
- Vite root when running inside the plugin.

Use tsconfig data only for static module resolution. Do not introduce a full
TypeScript `Program` or checker.

Acceptance criteria:

- `baseUrl` imports resolve. Implemented and tested.
- `paths` aliases resolve, including wildcard aliases. Implemented and tested.
- Tests cover monorepo-like aliases such as `@ui/types`. Covered by wildcard
  package-style alias fixtures.
- Missing or invalid tsconfig files produce actionable errors in build mode and
  recoverable unresolved output in dev mode. Still pending.

### 2. Support Re-Exports

Status: implemented for common type barrels with bounded cycle guards and HMR
dependency traces.

The file-level export index sits next to the existing declaration/import index.

Support:

- `export type { Foo } from './foo'`
- `export { type Foo } from './foo'`
- `export { Foo as Bar } from './foo'`
- `export * from './foo'`

Acceptance criteria:

- `getDocs<Foo>()` works when `Foo` is imported from a barrel file.
- Type dependency tracking follows through re-export chains.
- Cycles in barrel files are bounded and do not hang.

### 3. Define External Type Policy

Status: implemented and enforced for direct package imports and local barrels
that re-export package types.

Add an explicit option:

```ts
externalTypes: "ignore" | "reference" | "resolve";
```

Recommended default: `reference`.

Behavior:

- `ignore`: drop external expansion attempts and keep output focused on local
  project types.
- `reference`: preserve external names as references without reading packages.
- `resolve`: best-effort static resolution into packages when source or `.d.ts`
  files are available.

This is config-only by default, with opt-in best-effort package expansion
available through `externalTypes: 'resolve'`.

### 4. Resolver Diagnostics

Status: pending.

Now that resolution behavior is in place, the remaining resolver ergonomics work
is diagnostics quality rather than module lookup capability.

Acceptance criteria:

- Missing explicit `config.tsconfig` paths produce a clear build-mode error.
- Invalid tsconfig JSON or unsupported tsconfig shapes produce actionable
  diagnostics.
- Dev mode keeps unresolved `getDocs<T>()` calls recoverable while surfacing
  enough detail to debug the resolver miss.

## Priority 2: Honest Static Evaluation

The generator should never pretend an unsupported type has no properties. When
static evaluation cannot safely produce a shape, the schema should preserve a
reference or unresolved marker that a UI can display.

### 1. Generic Substitution

Implement bounded substitution for common local generic object types:

```ts
interface Box<T> {
  value: T;
}

type StringBox = Box<string>;
```

Acceptance criteria:

- Interface and type alias type parameters map to supplied type arguments.
- Defaults are used when type arguments are omitted.
- Constraints are preserved for display but do not require checker validation.
- Substitution works through nested object literals, arrays, tuples, functions,
  unions, intersections, and supported utility types.
- Recursive generics stop at `maxDepth` with visible unresolved output.

### 2. Improve Unsupported Utility Behavior

Keep supporting the current utility set, but make failure explicit.

Current supported utilities:

- `Pick`
- `Omit`
- `Partial`
- `Required`
- `Readonly`
- `Record`

Next utilities to consider:

- `NonNullable`
- `Extract`
- `Exclude`
- `ReturnType`
- `Parameters`

Acceptance criteria:

- Unsupported utility types preserve a `reference` or `unresolved` type.
- Object-property extraction does not silently return an empty prop list when a
  utility cannot be evaluated.
- Tests cover nested supported and unsupported utility compositions.

### 3. Clarify `resolveMode`

Either implement or remove `resolveMode`.

If implemented, use:

```ts
resolveMode: "reference" | "inline" | "auto";
```

Expected behavior:

- `reference`: preserve project type references; do not inline nested project
  shapes except for top-level documented entries.
- `inline`: inline statically resolvable project object shapes until `maxDepth`.
- `auto`: inline when it helps property extraction; otherwise preserve references.

If this cannot be made crisp, remove the option until a real use case needs it.

## Priority 3: Vite Scalability

The plugin is already correct enough for the playground. Next work should make it
scale to large component and design-system libraries.

### 1. Configurable Startup Strategy

Add:

```ts
docgenPlugin({
  buildMode: "indexOnly" | "eagerPublic" | "eagerAll",
});
```

Recommended default for Vite dev: `indexOnly`.

Modes:

- `indexOnly`: parse and index files, build schemas lazily on demand.
- `eagerPublic`: eagerly build exported declarations only.
- `eagerAll`: current behavior, useful for exhaustive docs and testing.

Acceptance criteria:

- Startup does not build every declaration by default.
- First request for a type builds and caches its schema.
- HMR invalidation still works after lazy builds.

### 2. Virtual Module Mode

Add an optional transform strategy that compiles:

```ts
const docs = getDocs<ButtonProps>();
```

into an import from a plugin-owned virtual module.

Benefits:

- Smaller transformed consumer modules.
- More targeted HMR.
- Better cache keys for large schemas.
- Easier source maps later.

Keep direct JSON embedding as the simple default until virtual modules prove
worth the extra complexity.

### 3. Better Cache Keys

Registry cache keys currently rely on file path and type name inside a single
config instance. Harden this for long-lived plugin usage.

Acceptance criteria:

- Schema cache keys include a stable config hash.
- Changing plugin options invalidates stale schema entries.
- Related entries are cached together with primary schemas.

## Priority 4: Output Quality

These features improve docs UI usefulness while keeping core schema generic.

### 1. Type Summary Formatter

Add a formatter helper or small package that converts `DocType` into concise,
stable display strings:

```ts
formatDocType(type); // "'s' | 'm' | 'l'"
```

Keep this as a presentation helper, not as replacement for the structured schema.

Acceptance criteria:

- String literal unions format compactly.
- Object, function, tuple, array, and reference types format predictably.
- Deep or unresolved types produce readable fallback summaries.

### 2. Control Hints

Add an adapter/helper that derives UI hints from structured types:

- string literal union -> select options
- enum -> select options
- boolean -> checkbox
- number -> numeric input
- function -> action/disabled control

This belongs outside the core extractor unless a strong core use case appears.

### 3. Prop Filtering

Add first-class filters:

```ts
propFilter?: (prop: DocProperty, context: PropFilterContext) => boolean
skipPropsWithName?: string[]
skipPropsWithoutDoc?: boolean
skipPropsFromExternalFiles?: boolean
```

Acceptance criteria:

- Filtering can run after inherited and utility-composed props are resolved.
- Filtering context includes source file, owner type, inherited/external status,
  and tags.
- Default behavior remains backwards-compatible.

### 4. Custom Tag Parsing

Either implement the existing `tags` config or remove it.

If implemented:

- Allow config-defined tag parsers to normalize values.
- Preserve unknown tags as strings or booleans.
- Add tests for repeated custom tags and malformed values.

## Priority 5: Public API And CLI Hardening

Before publishing beyond experiments, tighten the non-plugin surfaces.

- Document which TypeScript syntax is represented, evaluated, referenced, or
  unresolved.
- Add CLI options for config file, include/exclude, compact output, and failure
  mode.
- Add build-mode errors that clearly distinguish parse failure, unresolved type,
  unsupported syntax, and invalid configuration.
- Add fixture tests for Windows paths, POSIX paths, path aliases, barrels,
  default exports, and external references.
- Keep snapshots stable and avoid output order churn.

## Deferred Or Non-Goals

These are intentionally not near-term roadmap items:

- Full migration to the TypeScript compiler API.
- Checker-perfect conditional or mapped type evaluation.
- Automatic React component discovery.
- HOC, `memo`, `forwardRef`, styled-components, or class component analysis.
- Direct Storybook `argTypes` generation in core.
- Exhaustive expansion of `@types/react` and DOM attribute types.

Adapters can be added later, but they should consume `DocSchema` rather than
changing the core extractor into a React-specific tool.

## Suggested Milestones

### Milestone 1: Real Import Resolution

Status: completed for implementation and regression coverage. Remaining
diagnostics polish is tracked under Priority 1.

- Load tsconfig through `oxc-resolver`.
- Resolve `baseUrl` and `paths`.
- Add export/re-export indexes.
- Support common barrel files.
- Add external type policy.

### Milestone 2: Honest Static Evaluation

Status: next.

- Add generic substitution.
- Make unsupported utility/property extraction visibly unresolved.
- Clarify or remove `resolveMode`.
- Add fixtures for generic and unsupported utility behavior.

### Milestone 3: Large-Library Vite Mode

- Add `buildMode`.
- Make `indexOnly` the Vite dev default.
- Harden schema cache keys with config hashing.
- Keep HMR dependency tracking correct with lazy entries.

### Milestone 4: UI Adapter Layer

- Add type summary formatter.
- Add control hint derivation.
- Add prop filtering.
- Implement or remove custom tag parser config.

### Milestone 5: Publish-Ready Polish

- Document supported syntax and limitations.
- Improve CLI failure modes.
- Expand path, barrel, external, and Windows fixture coverage.
- Pin benchmark expectations for representative large-library fixtures.

## Guiding Principle

Prefer fast, explicit, source-faithful documentation over full TypeScript semantic
perfection. When a type cannot be evaluated safely, preserve a reference or
visible unresolved marker instead of pretending it has no props.
