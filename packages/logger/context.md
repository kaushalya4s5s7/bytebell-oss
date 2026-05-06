# `@bb/logger` — context

## Tier

Infrastructure. Depends on `@bb/config`, `winston`, and
`winston-daily-rotate-file`. May be imported by every higher tier (Strategy,
Domain, Binaries).

## Responsibility

Single logging surface for the workspace. Two sinks:

- **File** — daily-rotated `~/.bytebell/logs/<scope>-YYYY-MM-DD.log`, gzipped
  on rotation, retained for `log_retention_days`.
- **Console** — always on; verbosity from `log_level`. Colorized when stdout
  is a TTY.

OTLP / OpenTelemetry / ByteBell-research telemetry are out of scope — they
live in `@bb/telemetry` and attach to a logger via winston's standard
`Logger.add(transport)` hook.

## Public exports

```ts
type LoggerScope = "server" | "cli"
type Logger                                          // re-exported from winston

function getLogger(scope: LoggerScope): Logger
function shutdownLoggers(): Promise<void>
function getLogsDir(): string
function ensureLogsDir(): void

function __resetLoggersForTests(): void              // test-only
```

`getLogger(scope)` is idempotent. Workers tag via
`getLogger("server").child({ worker: "pdf-1" })` — there is no per-worker file
split.

## Sugar log API

`logger.info("message", obj)` auto-stringifies `obj` via `util.inspect` —
single-line for compact objects, multi-line for big ones. Circular refs are
handled gracefully.

## File layout

- `src/dirs.ts` — log dir resolution (under `getBytebellHome()/logs`)
- `src/caller.ts` — stack-walk `file:line` helper
- `src/formats.ts` — sugar splat format + caller format + printf
- `src/transports.ts` — daily-rotate file + console transport factories
- `src/logger.ts` — `getLogger`, scope cache, shutdown
- `src/index.ts` — public re-exports

## Invariants

1. **No `process.env` reads.** All config flows through `@bb/config`.
2. **No OTLP.** No `@opentelemetry/*` dependency. `@bb/telemetry` plugs in
   later via `Logger.add(...)`.
3. **One file root per scope.** Scopes write to distinct rotated files.
4. **Console always on.** Local-first tool — the console is the UX. Verbosity
   via `log_level`.
5. **Idempotent `getLogger`.** Same scope → same `Logger` instance.
6. **`shutdownLoggers` drains.** Awaits each transport's `finish` / `close`
   event before resolving (with a 1-second hard cap so SIGTERM can't hang).

## Data ownership

- `~/.bytebell/logs/` directory creation (mode `0700`)
- `~/.bytebell/logs/<scope>-*.log` rotated files (mode `0600`)
- `~/.bytebell/logs/<scope>-*.log.gz` compressed rotated files

This package does **not** own:

- `~/.bytebell/logs/telemetry-buffer.ndjson` — `@bb/telemetry`

## What is intentionally out of scope

- OpenTelemetry SDK / OTLP exporter
- Per-worker file split
- Manual startup-archive utility (rotation + retention replace it)
- JS↔TS path remapping (Bun runs TS directly)
- Custom log levels (winston defaults are kept)
