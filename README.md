# oxc-ts-docgen

Structured TypeScript metadata for custom docs UIs in Vite apps.

```ts
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./button";

const docs = getDocs<ButtonProps>();
```

`oxc-ts-docgen` turns explicit TypeScript type requests into predictable JSON.
You bring the UI: prop tables, token browsers, config editors, design-system
docs, or any other screen that needs type metadata.

It is not a documentation website generator. It does not replace TypeDoc, API
Extractor, Storybook, or React docgen.

## When To Use It

Use `oxc-ts-docgen` when you want to:

- document one chosen TypeScript type inside a Vite app;
- render the result with your own UI components;
- keep documentation data close to source code;
- support interfaces, type aliases, enums, function types, utility-composed
  props, design tokens, config schemas, and domain models.

## Install

```bash
pnpm add -D @synthfall/oxc-ts-docgen @synthfall/oxc-ts-docgen-vite
```

Application code imports `getDocs()` from `@synthfall/oxc-ts-docgen`. The Vite
plugin replaces those calls at build time.

Published packages support Node.js >=22.12.0.

## Vite Setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { docgenPlugin } from "@synthfall/oxc-ts-docgen-vite";

export default defineConfig({
  plugins: [
    docgenPlugin({
      tsconfig: "./tsconfig.json",
    }),
  ],
});
```

## Basic Usage

Create or export the type you want to document:

```ts
// button.ts
export type ButtonProps = {
  /** Text shown inside the button. */
  label: string;

  /** Visual style. */
  variant?: "primary" | "secondary";

  /** Called when the user activates the button. */
  onClick?: () => void;
};
```

Ask for metadata from app code:

```ts
// docs.ts
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./button";

export const buttonDocs = getDocs<ButtonProps>();
```

During Vite transform, the call is replaced with JSON like this:

```ts
{
  version: 1,
  entries: [
    {
      name: "ButtonProps",
      kind: "type",
      properties: [
        {
          name: "label",
          optional: false,
          description: "Text shown inside the button.",
          type: { kind: "primitive", name: "string" }
        }
      ]
    }
  ]
}
```

## Target Forms

Generic form for imported or local named types:

```ts
const docs = getDocs<ButtonProps>();
```

Object form when you want to point at a file and symbol:

```ts
const docs = getDocs({
  path: "./button",
  symbol: "ButtonProps",
});
```

Batch form when you want several docs records and your own metadata:

```ts
const examples = getDocs([
  { id: "button", title: "Button", path: "./button", symbol: "ButtonProps" },
] as const);
```

Batch output preserves your metadata, removes compile-only `path` and `symbol`,
and adds `docs`.

## Important Rules

Generic targets should be named type references. If the type is complex, name it
first:

```ts
type PublicButtonProps = Required<ButtonProps>;

const docs = getDocs<PublicButtonProps>();
```

Object and batch targets must be statically readable. Inline literals,
top-level const registries, `as const`, and `satisfies` wrappers are supported.
Runtime values, computed keys, spreads, and imported registries are not.

Imported targets must be exported from their source module. In development,
recoverable unresolved calls stay in place so HMR can recover. In production
builds, unresolved targets fail the build.

## Vue SFC Usage

The Vite plugin supports inline `<script>` and
`<script setup lang="ts">` blocks.

```vue
<script setup lang="ts">
import { getDocs } from "@synthfall/oxc-ts-docgen";
import type { ButtonProps } from "./button";

const docs = getDocs<ButtonProps>();
</script>
```

For best results, keep documented types in exported `.ts` or `.tsx` modules.
Same-file `.vue` type declarations are not indexed as source targets yet.

## Programmatic API

Use the core package directly outside the Vite transform:

```ts
import { generateDocs } from "@synthfall/oxc-ts-docgen";

const schema = generateDocs({
  filePath: "src/button.ts",
  typeName: "ButtonProps",
  config: {
    externalTypes: "reference",
  },
});
```

The package also exports schema/config types, preset constants,
`generateDocsFromSource()`, and result-returning APIs for diagnostics.

## CLI

```bash
npx oxc-ts-docgen src/button.ts ButtonProps
npx oxc-ts-docgen src/button.ts ButtonProps --config docgen.config.json
```

The CLI prints `DocSchema` JSON.

## Configuration

```ts
docgenPlugin({
  analysis: "hybrid",
  presets: ["typescript", "react", "dom"],
  include: ["src/**/*.ts", "src/**/*.tsx"],
  exclude: ["node_modules/**"],
  ignoreTypes: ["ReactNode"],
  maxDepth: 3,
  tsconfig: "./tsconfig.json",
  externalTypes: "reference",
  outputMode: "inline",
});
```

Common options:

- `analysis`: `hybrid` or `static`. Hybrid is the default.
- `presets`: built-in TypeScript, React, and DOM policies.
- `include` / `exclude`: source scan globs.
- `ignoreTypes`: type names to keep out of expanded output.
- `maxDepth`: recursive resolution limit.
- `tsconfig`: TypeScript project config for module and semantic resolution.
- `externalTypes`: `ignore`, `reference`, or `resolve`.
- `buildMode`: `indexOnly`, `eagerPublic`, or `eagerAll` startup behavior.
- `outputMode`: `inline` or `virtual`.
- `tags`: custom JSDoc tag parsers keyed by tag name.
- `propFilter`: final callback for including or excluding properties.
- `skipPropsWithName`: property names to omit.
- `skipPropsWithoutDoc`: omit properties without descriptions or tags.
- `skipPropsFromExternalFiles`: omit properties declared outside the project.
- `experimentalDebug`: opt-in callback for diagnostic and dependency records.

## How It Works

```txt
OXC scans and transforms getDocs() calls quickly.
TypeScript resolves semantic property sets when syntax is not enough.
Docgen normalizes both paths into one JSON schema.
```

The output does not expose whether a property came from OXC or TypeScript. Your
UI only consumes `DocSchema`.

## More Documentation

- [GitHub repository](https://github.com/EliteUser/oxc-ts-docgen)
- [Issue tracker](https://github.com/EliteUser/oxc-ts-docgen/issues)
- [Architecture overview](docs/architecture.md)
- [Architecture deep dive](docs/architecture-deep-dive.md)

## Release Process

Changesets manages the two packages as a fixed release group. Pull requests and
non-`master` branches run lint, typecheck, tests, and release artifact checks.
Pushes to `master` create a version pull request or publish after that pull
request is merged. Publishing requires the `NPM_TOKEN` repository secret and
emits npm provenance metadata.

## License

MIT
