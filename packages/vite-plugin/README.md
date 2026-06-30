# @synthfall/oxc-ts-docgen-vite

Vite adapter for `oxc-ts-docgen`. It finds supported `getDocs()` calls in Vite
modules and replaces them with structured `DocSchema` JSON for the requested
TypeScript type.

Use this package when your docs UI runs inside a Vite app and you want
compile-time type metadata with dev-server invalidation.

## Install

```bash
pnpm add -D @synthfall/oxc-ts-docgen @synthfall/oxc-ts-docgen-vite
```

Install both packages directly. Your application source imports `getDocs()` from
`@synthfall/oxc-ts-docgen`, while this package provides the Vite transform.

## Configure Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { docgenPlugin } from "@synthfall/oxc-ts-docgen-vite";

export default defineConfig({
  plugins: [
    docgenPlugin({
      buildMode: "indexOnly",
      externalTypes: "reference",
      tsconfig: "./tsconfig.json",
    }),
  ],
});
```

Then call `getDocs()` in application code:

```typescript
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./Button";

const docs = getDocs<ButtonProps>();
```

Vue SFC consumers are supported in inline `<script>` and
`<script setup lang="ts">` blocks:

```vue
<script setup lang="ts">
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./button";

const docs = getDocs<ButtonProps>();
</script>
```

The plugin resolves the requested type, generates a `DocSchema`, and compiles
the call away. Imported generic targets and object/batch targets must resolve
to exported TypeScript module symbols; private declarations are not compiled
through fallback lookup. In dev mode unresolved calls are preserved with watch
dependencies when possible so HMR can recover when types appear later. In build
mode unresolved calls fail with diagnostics.

Keep documented targets in `.ts` / `.tsx` modules, or use object and batch
targets that point at exported TypeScript symbols. Same-file type declarations
inside `.vue` files are not indexed by the core project cache yet.

## Supported Call Forms

```typescript
const docs = getDocs<ButtonProps>();

const byPath = getDocs({
  path: "./Button",
  symbol: "ButtonProps",
});

const registry = getDocs([
  {
    id: "button-props",
    path: "./Button",
    symbol: "ButtonProps",
  },
] as const);
```

Inline type expressions are intentionally unsupported. Name the type first, then
call `getDocs<Name>()`.

## Options

`docgenPlugin()` accepts the core docgen config plus Vite adapter options:

```typescript
docgenPlugin({
  analysis: "hybrid",
  presets: ["typescript", "react", "dom"],
  externalTypes: "reference",
  buildMode: "indexOnly",
  outputMode: "inline",
});
```

Vue projects usually do not need a Vue-specific preset when documenting explicit
project-owned prop types. If React ignore names are not relevant to your codebase,
set `presets: ["typescript", "dom"]` to opt out of the default React preset.

- `buildMode` controls startup indexing and eager schema generation:
  `indexOnly`, `eagerPublic`, or `eagerAll`.
- `outputMode` controls whether schemas are emitted inline or through virtual
  modules: `inline` or `virtual`.

See the [repository README](https://github.com/EliteUser/oxc-ts-docgen#readme)
for the full configuration and schema reference.

## Troubleshooting

Warnings about unresolved targets usually mean the type is not exported, the
target module cannot be resolved from the consumer file, or the configured
`tsconfig`/scan options do not include the file. Dev mode keeps the original
`getDocs()` call in place for recoverable cases and watches the target module
or traversed re-export files. Build mode fails so incomplete schemas are not
shipped.

Warnings mentioning `semanticFallbackUnavailable` mean hybrid analysis reached
an object-like semantic boundary but TypeScript fallback could not produce a
safe property set. Check that the target type is exported, the source file is
included, and the configured `tsconfig` is valid.

## Requirements

Published packages support Node.js >=22.12.0. The Vite plugin declares support
for Vite 6, 7, and 8 through its peer dependency range.

Report adapter problems in the
[issue tracker](https://github.com/EliteUser/oxc-ts-docgen/issues).
