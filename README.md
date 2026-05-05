# oxc-ts-docgen

A fast, controllable TypeScript documentation generator built on [oxc-parser](https://www.npmjs.com/package/oxc-parser).

Designed to replace `react-docgen-typescript` with a more predictable, JSDoc-first approach that gives you full control over type resolution, output shape, and what gets documented.

## Features

- **Fast** — Uses oxc-parser (Rust-based) for parsing. Single-file docgen runs in < 0.1ms.
- **JSDoc-first** — Treats JSDoc comments as the primary source of documentation metadata.
- **Controllable** — Configure which types to ignore, how deep to resolve, and how to handle references.
- **Vite plugin** — Compile-time `getDocs<T>()` API with HMR support.
- **Stable output** — Versioned JSON schema (`DocSchema`) designed for consumption by UI tools and doc renderers.
- **Cross-file resolution** — Uses `oxc-resolver` for module resolution, follows imports and common barrels, resolves `extends`, and merges inherited properties.

## Packages

| Package                      | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `@oxc-ts-docgen/docgen`      | Core documentation engine                              |
| `@oxc-ts-docgen/vite-plugin` | Vite plugin for compile-time `getDocs<T>()` transforms |

## Quick Start

### Programmatic API

```bash
pnpm add @oxc-ts-docgen/docgen
```

```typescript
import { generateDocs } from "@oxc-ts-docgen/docgen";

const result = generateDocs({
  filePath: "src/Button.ts",
  typeName: "ButtonProps",
  config: {
    ignoreTypes: ["HTMLAttributes", "CSSProperties"],
  },
});

console.log(result);
```

### Vite Plugin

```bash
pnpm add @oxc-ts-docgen/docgen @oxc-ts-docgen/vite-plugin
```

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { docgenPlugin } from "@oxc-ts-docgen/vite-plugin";

export default defineConfig({
  plugins: [
    docgenPlugin({
      ignoreTypes: ["HTMLAttributes", "CSSProperties"],
      externalTypes: "reference",
      tsconfig: "./tsconfig.json",
    }),
  ],
});
```

Then in your application code:

```typescript
import { getDocs } from "@oxc-ts-docgen/docgen";
import type { ButtonProps } from "./Button";

// Replaced at compile time with the JSON documentation data
const docs = getDocs<ButtonProps>();
```

### CLI

```bash
npx oxc-ts-docgen src/Button.ts ButtonProps
npx oxc-ts-docgen src/Button.ts ButtonProps --ignore HTMLAttributes,CSSProperties
npx oxc-ts-docgen src/Button.ts ButtonProps --compact
```

## Output Schema

The output follows a stable `DocSchema` format:

```typescript
interface DocSchema {
  version: 1;
  entries: DocEntry[];
}
```

Each `DocEntry` contains:

- `name` — Type name
- `kind` — `'interface'` | `'typeAlias'` | `'enum'` | `'function'`
- `description` — JSDoc description
- `tags` — Extracted JSDoc tags (`@default`, `@deprecated`, `@example`, etc.)
- `typeParameters` — Generic type parameters
- `properties` — Documented properties with types, optionality, JSDoc, and source locations
- `type` — Full recursive type representation

## Configuration

```typescript
interface DocgenConfig {
  include: string[]; // File patterns to include
  exclude: string[]; // File patterns to exclude
  ignoreTypes: string[]; // Types to skip resolution for
  maxDepth: number; // Max resolution depth (default: 3)
  resolveMode: "inline" | "reference" | "auto";
  externalTypes: "ignore" | "reference" | "resolve";
  tsconfig: string | undefined;
  tags: Record<string, (value: string) => unknown>;
}
```

Current defaults:

- `include`: `['**/*.ts', '**/*.tsx']`
- `exclude`: `['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts']`
- `ignoreTypes`: TypeScript built-in utility types
- `maxDepth`: `3`
- `resolveMode`: `'auto'`
- `externalTypes`: `'reference'`
- `tsconfig`: auto-discovered by `oxc-resolver` unless explicitly provided
- `tags`: `{}`

`resolveMode` and custom `tags` are reserved config surface today. They are not
fully implemented behavior yet.

## Resolution Behavior

`oxc-ts-docgen` is static-analysis-first. It uses `oxc-parser` for ASTs,
`oxc-walker` for non-trivial Vite transform traversal, and `oxc-resolver` for
module specifier resolution.

Supported today:

- Relative and absolute imports.
- TypeScript extension aliases such as importing `./button.js` from a
  `button.ts` source file.
- Directory `index` candidates.
- `tsconfig` discovery through `oxc-resolver`.
- `compilerOptions.baseUrl`.
- `compilerOptions.paths`, including wildcard aliases.
- Common type barrels:
  - `export type { Foo } from './foo'`
  - `export { type Foo } from './foo'`
  - `export { Foo as Bar } from './foo'`
  - `export * from './foo'`
- Package imports as references by default.
- Opt-in package expansion with `externalTypes: 'resolve'`.
- Vite HMR invalidation for direct type files, barrel files, final declaration
  files, and `tsconfig*.json` changes.

External type policy:

- `ignore`: do not expand package imports.
- `reference`: preserve external type names as references without parsing
  packages. This is the default.
- `resolve`: best-effort static expansion into package source or declaration
  files when resolvable.

Intentional boundaries:

- No TypeScript `Program`, `TypeChecker`, or LanguageService in the default
  extraction path.
- No checker-perfect semantic evaluation.
- No React component auto-detection, HOC detection, or Storybook-specific
  output in core.
- Default exports, namespace or qualified type references, computed property
  names, symbol keys, and generic substitution are still bounded or incomplete.
- Missing or invalid `tsconfig` diagnostics are still being hardened.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev         # Start playground
```

## License

MIT
