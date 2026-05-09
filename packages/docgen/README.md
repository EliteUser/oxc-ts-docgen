# @synthfall/oxc-ts-docgen

Core package for `oxc-ts-docgen`. It provides the structured doc schema,
programmatic generation APIs, the `getDocs()` runtime stub used by bundler
adapters, and the `oxc-ts-docgen` CLI.

Use this package directly when you want to generate documentation metadata from
Node.js, build a custom adapter, or import `getDocs()` in Vite application
source.

## Install

```bash
pnpm add @synthfall/oxc-ts-docgen
```

For Vite projects, install this package directly alongside the Vite adapter:

```bash
pnpm add -D @synthfall/oxc-ts-docgen @synthfall/oxc-ts-docgen-vite
```

`@synthfall/oxc-ts-docgen-vite` depends on this package internally, but strict
package managers still require `@synthfall/oxc-ts-docgen` to be a direct
dependency when your source imports `getDocs()`.

## Programmatic API

```typescript
import { generateDocs } from "@synthfall/oxc-ts-docgen";

const schema = generateDocs({
  filePath: "src/Button.ts",
  typeName: "ButtonProps",
  config: {
    externalTypes: "reference",
  },
});
```

`generateDocs()` returns a `DocSchema` for one requested type. The package also
exports schema/config types, `generateDocsFromSource()`, result-returning
variants for diagnostics/dependencies, and `DocgenProject` for official adapter
integrations that need cache and dependency records.

## Vite Runtime Stub

Application code imports `getDocs()` from this package:

```typescript
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./Button";

const docs = getDocs<ButtonProps>();
```

`getDocs()` is intentionally a compile-time API. It must be transformed by
`@synthfall/oxc-ts-docgen-vite`; calling it at runtime throws an error that points
to the missing Vite configuration.

## CLI

```bash
npx oxc-ts-docgen src/Button.ts ButtonProps
npx oxc-ts-docgen src/Button.ts ButtonProps --config docgen.config.json
```

The CLI prints `DocSchema` JSON and supports serializable config options such as
`include`, `exclude`, `ignoreTypes`, `maxDepth`, `externalTypes`, and
`tsconfig`.

## Requirements

Published packages support Node.js >=22.12.0 and ESM-first projects. CommonJS
entry points are also emitted for tooling that still requires them.

See the [repository README](https://github.com/EliteUser/oxc-ts-docgen#readme)
for the full schema, configuration, hybrid fallback troubleshooting, and
resolution behavior reference. Report problems in the
[issue tracker](https://github.com/EliteUser/oxc-ts-docgen/issues).
