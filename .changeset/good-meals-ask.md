---
"@synthfall/oxc-ts-docgen": minor
"@synthfall/oxc-ts-docgen-vite": minor
---

Initial public release of the Vite-first TypeScript metadata generator.

`@synthfall/oxc-ts-docgen` provides the `getDocs()` compile-time API, programmatic
schema generation, the CLI, configuration presets, and the `DocSchema` types for
custom documentation UIs.

`@synthfall/oxc-ts-docgen-vite` compiles generic, object, and batch `getDocs()`
targets in Vite projects, supports Vue SFC script blocks, tracks schema
dependencies for HMR, and fails production builds when requested type targets
cannot be resolved.
