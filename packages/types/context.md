# `@bb/types` — context

## Tier

Kernel. Sits at the bottom of the import graph; depended on by every higher
tier (Infrastructure, Strategy, Domain, Binaries). Has no workspace
dependencies and no runtime dependencies — pure type / enum surface.

## Responsibility

Single home for shared types and enums that cross package boundaries:

- `Config` — the enumeration of every key under `~/.bytebell/config.json`.
  Lives here (not in `@bb/config`) because consumers in higher tiers — e.g.
  `@bb/logger`, `@bb/mongo` — refer to it without wanting an implementation
  dependency on `@bb/config`'s schema/loader/writer.

Future inhabitants (added on need basis): `Knowledge`, `Raw`, `Node`,
`MCP*`, `JobPayload` — the cross-package domain shapes named in
[docs/arch.md:69](../../docs/arch.md#L69).

## Public exports

```ts
enum Config { ... }
```

That is the entire surface today. Add new shared types here only when **two
or more** packages need to refer to the same shape.

## Data ownership

None. This package owns no runtime state — only types and enum members.

## Invariants

1. **No runtime dependencies.** `dependencies` block stays empty.
2. **No I/O, no logic.** Pure declarations. If logic creeps in, it belongs
   in a higher tier package.
3. **Stable surface.** Renaming an exported member is a breaking change for
   the entire workspace; treat additions as additive and removals as
   coordinated migrations.

## External dependencies

None.

## What is intentionally out of scope

- Runtime helpers (validators, parsers, narrowing functions) — those belong
  in the package that owns the data.
- Default values, hint strings, schema parsing — those stay in `@bb/config`.

## How to extend

To promote a type from a single-package internal to a shared kernel type:

1. Confirm at least two packages need to import it.
2. Move the declaration into `src/<name>.ts`.
3. Re-export from `src/index.ts`.
4. Add `@bb/types` to the importing package's `package.json` dependencies.
5. Update the source-of-record package to import from `@bb/types` rather
   than re-defining locally.
