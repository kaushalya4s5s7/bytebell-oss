import fs from "node:fs";
import path from "node:path";

export interface CallerInfo {
  readonly file: string;
  readonly line: number;
  readonly function: string;
}

const UNKNOWN: CallerInfo = { file: "unknown", line: 0, function: "anonymous" };

const SKIP_FRAGMENTS = [
  "node_modules/winston",
  "node_modules/logform",
  "node_modules/readable-stream",
  "node_modules/triple-beam",
  "node_modules/@types",
  "internal/",
  "node:",
  "/packages/logger/src/",
];

const FRAME_PATTERNS: readonly RegExp[] = [
  /\(file:\/\/\/([^:)]+):(\d+):\d+\)/,
  /at\s+file:\/\/\/([^:)]+):(\d+):\d+/,
  /\(([^:)]+):(\d+):\d+\)/,
  /at\s+([^:)]+):(\d+):\d+/,
];

let cachedRoot: string | null = null;

function findProjectRoot(): string {
  if (cachedRoot !== null) {
    return cachedRoot;
  }
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, "package.json");
    try {
      const text = fs.readFileSync(pkg, "utf8");
      const json = JSON.parse(text) as { workspaces?: unknown };
      if (json.workspaces !== undefined) {
        cachedRoot = dir;
        return dir;
      }
    } catch {
      // continue walking up
    }
    dir = path.dirname(dir);
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

function shouldSkip(file: string): boolean {
  for (const frag of SKIP_FRAGMENTS) {
    if (file.includes(frag)) {
      return true;
    }
  }
  return false;
}

function matchFrame(line: string): { file: string; line: number } | null {
  for (const pat of FRAME_PATTERNS) {
    const m = line.match(pat);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      return { file: m[1], line: Number.parseInt(m[2], 10) };
    }
  }
  return null;
}

export function getCallerInfo(): CallerInfo {
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  const err = new Error();
  Error.captureStackTrace(err, getCallerInfo);
  Error.stackTraceLimit = previousLimit;

  const lines = err.stack?.split("\n").slice(1) ?? [];
  for (const raw of lines) {
    const hit = matchFrame(raw);
    if (hit === null || shouldSkip(hit.file)) {
      continue;
    }
    const fnMatch = raw.match(/at\s+([^(]+)\s+\(/);
    return { file: hit.file, line: hit.line, function: fnMatch?.[1]?.trim() ?? "anonymous" };
  }
  return UNKNOWN;
}

export function toProjectRelative(absFile: string): string {
  const root = findProjectRoot();
  if (!absFile.startsWith(root)) {
    return absFile;
  }
  const rel = path.relative(root, absFile);
  return rel.length === 0 ? absFile : rel;
}
