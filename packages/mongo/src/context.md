# `@bb/mongo/src` — context

Implementation of `@bb/mongo`. See [../context.md](../context.md) for the
package-level contract; this file documents how the source tree is split.

## Files

- **[index.ts](index.ts)** — public re-exports. The only entry point other
  packages may import. Exposes `connectMongo`, `closeMongo`, `pingMongo`, and
  the `PingResult` type. Anything not re-exported here is internal.
- **[client.ts](client.ts)** — module-scoped `MongoClient` singleton plus
  the lifecycle (`connectMongo`, `closeMongo`), the health probe
  (`pingMongo`), and the **internal** `_getDb()` accessor. Reads the URI via
  `getConfigValue(Config.MongoUri)` from `@bb/config` + `@bb/types`. Throws
  typed errors from `@bb/errors` (`MongoConfigError`, `MongoConnectError`,
  `MongoNotConnectedError`). Also exposes `__resetForTests()` — test seam
  only, never imported by production code.

## Module dependency graph

```
client.ts → mongodb, @bb/config (getConfigValue), @bb/types (Config),
            @bb/errors (Mongo* error classes)
index.ts  → re-exports the public surface from client.ts
```

No cycles, no intra-package leaves yet — `client.ts` is the only
implementation file.

## Invariants enforced here

- **Connect is idempotent and concurrent-safe.** `connectMongo()` short-
  circuits if `client !== null`; concurrent callers await the same in-flight
  `connecting` promise so a single connect is performed.
- **Close is graceful and re-entrant.** `closeMongo()` clears the cached
  client _before_ awaiting `client.close()` so a subsequent `connectMongo()`
  cleanly re-establishes; calling `closeMongo()` twice is a no-op.
- **No raw `Db` leak.** `_getDb()` is not in `index.ts`. Future typed
  collection helpers will live in this folder and compose `_getDb()`
  internally; consumers in higher tiers see only the typed helper signatures.
- **No env reads.** Only `getConfigValue(Config.MongoUri)` provides the URI.
  Repo-wide ESLint rule blocks `process.env`.
- **Errors carry typed metadata.** Construction sites use the catalog in
  `@bb/errors` — never inline `new Error(string)`. `MongoConfigError` carries
  the exact `bytebell set …` hint; `MongoConnectError` redacts userinfo in
  the URI before composing the message.

## Adding a CRUD helper

Follow the recipe in [../context.md](../context.md) under _How to extend_.
The new file lives under `src/collections/<name>.ts` and is re-exported from
`index.ts`. The helper composes `_getDb()` to obtain the `Db` handle and
returns a domain type from `@bb/types` — never a raw Mongo document shape.
