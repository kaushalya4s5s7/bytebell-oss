# `@bb/config/src` — context

Implementation of `@bb/config`. See [../context.md](../context.md) for the
package-level contract; this file documents how the source tree is split.

## Files

- **[index.ts](index.ts)** — public re-exports. The only entry point other
  packages may import. Anything not re-exported here is internal.
- **[paths.ts](paths.ts)** — `getBytebellHome`, `getConfigPath`, and the
  cache-invalidator registry. Holds the `testHomeOverride` state used by
  `__setBytebellHomeForTests`. Pure: imports nothing from the rest of the
  package.
- **[schema.ts](schema.ts)** — Zod `configSchema`, `Config` enum,
  `BytebellConfig` type, `ConfigValueMap`, `DEFAULT_CONFIG`, `REQUIRED_KEYS`,
  `HINTS`, and the `readField` / `writeField` switch helpers.
- **[loader.ts](loader.ts)** — `loadConfig` (memoized), `getConfigValue`,
  `isConfigComplete`. Subscribes to the cache invalidator on module load.
- **[writer.ts](writer.ts)** — `ensureBytebellHome`, `setConfigValue`, atomic
  `tmp → fsync → rename` write. Notifies the invalidator after a successful
  write.
- **[errors.ts](errors.ts)** — `ConfigIncompleteError`. Type-only import of
  `Config`.

## Module dependency graph

```
errors.ts → schema.ts (type only)
loader.ts → schema.ts, paths.ts, writer.ts
writer.ts → schema.ts, paths.ts
paths.ts  → (leaf — node:os, node:path)
schema.ts → (leaf — zod)
index.ts  → re-exports from all above
```

No cycles. `paths.ts` is the lowest leaf and owns the cache-invalidation
seam so that `loader.ts` and `writer.ts` never have to import each other.

## Invariants enforced here

- Required-field check (`isConfigComplete`) treats empty strings as missing.
- Atomic write: `config.json.tmp` is `openSync` → `writeSync` → `fsyncSync` →
  `closeSync` → `renameSync`.
- File mode `0o600` on `config.json`; directory mode `0o700` on `~/.bytebell/`.
- `loadConfig` always calls `ensureBytebellHome` first — never reads a missing
  file.
