# `@bb/errors` — context

## Tier

Kernel. Sits at the bottom of the import graph alongside `@bb/types`. May
depend on `@bb/types` (for type-only references like the `Config` enum). May
be imported by every higher tier.

## Responsibility

Single catalog of every typed error class thrown across the workspace.
Centralizing them gives the logger and telemetry shipper a stable
discriminator (`error.name`) so structured logs can identify failure modes
without each package re-introducing its own error namespace.

Today the catalog covers:

- **Config** — `ConfigIncompleteError` (missing required keys; carries the
  missing `Config[]` and the corresponding `bytebell set …` hints)
- **Mongo** — `MongoConfigError` (missing URI), `MongoConnectError` (driver
  connect failed; redacts credentials in URI), `MongoNotConnectedError`
  (`_getDb()` called before `connectMongo()`)

New error classes land here as new packages are introduced (Neo4j, Redis,
queue, ingest, llm, license, etc.).

## Public exports

```ts
class ConfigIncompleteError    extends Error
class MongoConfigError         extends Error
class MongoConnectError        extends Error
class MongoNotConnectedError   extends Error
```

## Data ownership

None. Pure class declarations.

## Invariants

1. **No I/O, no logging, no telemetry.** This package never imports
   `@bb/logger` or `@bb/telemetry` — those packages import _from_ this one.
2. **Stable `name`.** Every class sets `override readonly name` to its class
   name. The logger / telemetry shipper key off this string; renaming is a
   coordinated change.
3. **Credential redaction.** Any error message that includes a connection
   URI must redact userinfo (see `redactUri` in `mongo-errors.ts`).
4. **Typed metadata over string parsing.** Errors carry structured fields
   (`hint`, `missing`, `hints`, `cause`) — consumers read those, never parse
   `message`.

## External dependencies

- `@bb/types` — type-only, for the `Config` enum referenced by
  `ConfigIncompleteError`

No runtime dependencies, no Node built-ins.

## What is intentionally out of scope

- Logger formatters / stack-trace pretty-printing — `@bb/logger`'s job.
- Error → HTTP status mapping — the route layer's job.
- Retry / backoff policy — the calling package's job.

## How to extend

To add a new error class:

1. Create or extend `src/<area>-errors.ts` (one file per source package).
2. `extends Error`, `override readonly name = "<ClassName>"`, expose typed
   fields rather than string-encoding context.
3. Re-export from `src/index.ts`.
4. The throwing package adds `@bb/errors` to its `dependencies` (if not
   already) and imports the class.
5. Update the _Public exports_ section of this file.
