# Changesets

Use `pnpm changeset` for every user-visible package change. The generated
changeset chooses the semantic bump and feeds package changelogs.

The two published packages are configured as a fixed release group so the core
schema/runtime package and Vite adapter stay on the same version.
