import os from "node:os";
import path from "node:path";

let testHomeOverride: string | null = null;
const cacheInvalidators: Array<() => void> = [];

export function getBytebellHome(): string {
  if (testHomeOverride !== null) {
    return testHomeOverride;
  }
  return path.join(os.homedir(), ".bytebell");
}

export function getConfigPath(): string {
  return path.join(getBytebellHome(), "config.json");
}

export function __registerCacheInvalidator(fn: () => void): void {
  cacheInvalidators.push(fn);
}

export function __notifyConfigChanged(): void {
  for (const fn of cacheInvalidators) {
    fn();
  }
}

export function __setBytebellHomeForTests(home: string | null): void {
  testHomeOverride = home;
  __notifyConfigChanged();
}
