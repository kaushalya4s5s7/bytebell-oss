# `@bb/mongo` — context

## Tier

Infrastructure. May depend on Kernel (`@bb/types`, when domain helpers are
added) and on infra siblings explicitly listed in `package.json` (`@bb/config`
for `Config.MongoUri`). May be imported by Strategy, Domain, and Binaries —
never by `@bb/cli` (CLI talks HTTP only).

## Responsibility

The package owns:

- A single shared `MongoClient` (lazy, idempotent connect; graceful close)
- A health probe (`pingMongo`) backed by the active connection
- An internal `_getDb()` accessor that future typed collection helpers will
  compose against

The package does **not** own:

- Domain CRUD (deferred — see _How to extend_)
- Schema definitions / domain types (live in `@bb/types`)
- Index management (deferred to a later package or domain helper)
- Neo4j / graph queries (`@bb/graph`)
- Telemetry, logging, retry policies (the driver handles transport retries)

## Public exports

```ts
function connectMongo(): Promise<void>
function closeMongo():   Promise<void>
function pingMongo():    Promise<PingResult>

interface PingResult { ok: boolean; latencyMs: number }

class MongoConfigError       extends Error  // missing mongo_uri
class MongoConnectError      extends Error  // driver connect failed
class MongoNotConnectedError extends Error  // _getDb() before connectMongo()
```

`_getDb()` is **internal** — consumed only by future collection helpers
inside this package. Higher tiers cannot reach a raw `Db` handle; they go
through typed domain helpers that this package will expose as they are
added.

## Data ownership

The single shared `MongoClient` instance. Document shapes, indexes, and
migrations are intentionally not owned here.

## Invariants

1. **No env reads.** The Mongo URI comes from
   `getConfigValue(Config.MongoUri)`. No `process.env`, no `.env`, no fallback.
   Enforced repo-wide by [eslint.config.mjs:71-94](../../eslint.config.mjs#L71-L94).
2. **`connectMongo()` is idempotent and concurrent-safe.** Repeated calls
   return the existing client; concurrent calls await the same in-flight
   connect promise.
3. **`closeMongo()` is graceful.** Clears the cached client before awaiting
   `client.close()` so a subsequent `connectMongo()` cleanly re-establishes.
4. **Errors are typed, not strings.** `MongoConfigError` carries the exact
   `bytebell set …` hint; `MongoConnectError` redacts credentials in the URI.
5. **No raw `Db` leaks.** `_getDb()` is not in `src/index.ts`. The only way
   higher tiers touch Mongo is through typed helpers exported from this
   package.

## External dependencies

- `mongodb` — official driver
- `@bb/config` — workspace dep, only for `getConfigValue(Config.MongoUri)`

No logger, no telemetry, no Neo4j, no Redis. This package boots after
`@bb/config` and before everything that needs persistence.

## What is intentionally out of scope (v0)

- Domain CRUD (`getKnowledgeById`, `saveKnowledge`, etc.) — added on need
  basis when the first real caller arrives
- Index creation / migrations
- Transactions helper
- Change streams, GridFS
- Application-level retry / backoff (the driver handles transport retries)
- A standalone "probe a candidate URI" helper for the setup form (added when
  `@bb/cli`'s setup form lands)

## How to extend

Adding the first CRUD helper (e.g. `getKnowledgeById`):

1. Add `@bb/types` to `package.json` `dependencies` (`workspace:*`).
2. Create `src/collections/<name>.ts`.
3. Use `_getDb()` to obtain the `Db` handle and access the named collection
   directly — never expose the raw `Db` to callers.
4. Return the domain type from `@bb/types` (e.g. `Knowledge`), never the
   raw Mongo document shape.
5. Re-export the helper (and any new public types) from `src/index.ts`.
6. Update the _Public exports_ and _Out of scope_ sections of this file.
