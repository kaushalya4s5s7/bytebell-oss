export class RedisConfigError extends Error {
  override readonly name = "RedisConfigError";
  readonly hint: string;

  constructor(hint: string) {
    super(`Redis URL is not configured. Run:\n  ${hint}`);
    this.hint = hint;
  }
}

export class RedisConnectError extends Error {
  override readonly name = "RedisConnectError";

  constructor(url: string, cause: unknown) {
    super(`Failed to connect to Redis at ${redactUri(url)}: ${describe(cause)}`);
    this.cause = cause;
  }
}

export class RedisNotConnectedError extends Error {
  override readonly name = "RedisNotConnectedError";

  constructor() {
    super("Redis client is not connected. Call connectRedis() first.");
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/u, "//$1:***@");
}
