import { randomBytes } from "node:crypto";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";
import {
  DockerComposeError,
  DockerHealthTimeoutError,
  DockerNotFoundError,
  DockerPortConflictError,
  composeFilePath,
  down,
  up,
  type UpResult,
} from "./dockerInfra.ts";
import { ServerStartTimeoutError, ensureServerRunning } from "./serverSpawn.ts";
import { createSpinner, error, info, success } from "./output.ts";
import {
  labelForService,
  readInfraPorts,
  serviceForPort,
  setInfraPort,
  type InfraPorts,
  type InfraService,
} from "./infraPorts.ts";
import { diagnosePortConflict, promptPortConflict } from "./portConflictPrompt.ts";
import { removeContainer } from "./dockerPortDiagnostics.ts";

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/bytebell";
const DEFAULT_NEO4J_URI = "bolt://127.0.0.1:7687";
const DEFAULT_NEO4J_USER = "neo4j";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

const MAX_CONFLICT_ROUNDS = 4;

interface DefaultEntry {
  cliKey: string;
  configKey: Config;
  computeDefault: () => string;
}

const DEFAULTS: readonly DefaultEntry[] = [
  { cliKey: "mongo", configKey: Config.MongoUri, computeDefault: () => DEFAULT_MONGO_URI },
  { cliKey: "neo4j", configKey: Config.Neo4jUri, computeDefault: () => DEFAULT_NEO4J_URI },
  { cliKey: "neo4j-user", configKey: Config.Neo4jUser, computeDefault: () => DEFAULT_NEO4J_USER },
  { cliKey: "redis", configKey: Config.RedisUrl, computeDefault: () => DEFAULT_REDIS_URL },
  { cliKey: "neo4j-password", configKey: Config.Neo4jPassword, computeDefault: generateNeo4jPassword },
];

export interface ApplyDefaultsResult {
  written: { cliKey: string; redacted: boolean }[];
  neo4jPassword: string;
}

export function applyInfraDefaults(): ApplyDefaultsResult {
  const written: { cliKey: string; redacted: boolean }[] = [];
  for (const entry of DEFAULTS) {
    const current = readString(entry.configKey);
    if (current.length > 0) {
      continue;
    }
    const value = entry.computeDefault();
    const setter = KEY_MAP[entry.cliKey];
    if (setter === undefined) {
      throw new Error(`internal: KEY_MAP entry "${entry.cliKey}" missing`);
    }
    setter.setter(value);
    written.push({ cliKey: entry.cliKey, redacted: setter.redact });
  }
  return {
    written,
    neo4jPassword: readString(Config.Neo4jPassword),
  };
}

export interface PreflightResult {
  ok: boolean;
  missing: { configKey: Config; hintKey: string }[];
}

export function checkPreflight(): PreflightResult {
  const missing: PreflightResult["missing"] = [];
  if (readString(Config.OpenrouterApiKey).length === 0) {
    missing.push({ configKey: Config.OpenrouterApiKey, hintKey: "openrouter-api-key" });
  }
  if (readString(Config.OpenrouterModel).length === 0) {
    missing.push({ configKey: Config.OpenrouterModel, hintKey: "openrouter-model" });
  }
  return { ok: missing.length === 0, missing };
}

export async function bringInfraUp(neo4jPassword: string): Promise<UpResult | null> {
  const skipServices = new Set<"mongo" | "neo4j" | "redis">();
  for (let round = 0; round < MAX_CONFLICT_ROUNDS; round += 1) {
    const ports = readInfraPorts();
    const watched = composeServicesToStart(skipServices);
    const spinner = createSpinner("Starting Docker infrastructure...");
    try {
      const result = await up({
        neo4jPassword,
        ports,
        servicesToStart: watched,
        onProgress: (line) => spinner.update(`Docker: ${line}`),
      });
      spinner.stop(true, `Docker infra is up (${composeFilePath()})`);
      for (const svc of skipServices) {
        info(`reusing existing service on port ${portFor(svc, ports)} for ${svc} (not managed by bytebell)`);
      }
      return result;
    } catch (cause: unknown) {
      spinner.stop(false, "Docker startup failed");
      if (cause instanceof DockerPortConflictError) {
        const handled = await handlePortConflict(cause, ports, skipServices);
        if (handled) {
          continue;
        }
        process.exitCode = 1;
        return null;
      }
      handleDockerError(cause);
      return null;
    }
  }
  error(`Gave up after ${MAX_CONFLICT_ROUNDS} attempts to resolve port conflicts.`);
  process.exitCode = 1;
  return null;
}

export async function startServer(): Promise<boolean> {
  const spinner = createSpinner("Starting ByteBell server...");
  try {
    const ctx = await ensureServerRunning((line) => spinner.update(`Server: ${line}`));
    if (ctx.alreadyRunning) {
      spinner.stop(true, "Server already running");
    } else {
      spinner.stop(true, `Server started (logs: ${ctx.logPath ?? "n/a"})`);
    }
    return true;
  } catch (cause: unknown) {
    spinner.stop(false, "Server startup failed");
    if (cause instanceof ServerStartTimeoutError) {
      error(cause.message);
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
    return false;
  }
}

async function handlePortConflict(
  cause: DockerPortConflictError,
  ports: InfraPorts,
  skipServices: Set<"mongo" | "neo4j" | "redis">,
): Promise<boolean> {
  const infraService = serviceForPort(cause.port, ports);
  if (infraService === null) {
    error(`Port ${cause.port} conflict, but it doesn't match a known bytebell service. Aborting.`);
    info(cause.stderr.trim());
    return false;
  }
  const composeService = composeServiceFor(infraService);
  const serviceLabel = labelForService(infraService);
  const ctx = await diagnosePortConflict(cause.port, serviceLabel);

  if (process.stdin.isTTY !== true) {
    await safeComposeDown();
    skipServices.add(composeService);
    info(`port ${cause.port} already in use — reusing existing ${serviceLabel} (non-interactive mode).`);
    return true;
  }

  const resolution = await promptPortConflict(ctx);

  if (resolution.action === "cancel") {
    error("Boot cancelled.");
    return false;
  }

  await safeComposeDown();

  if (resolution.action === "reuse") {
    skipServices.add(composeService);
    success(`will reuse existing ${serviceLabel} on port ${cause.port}.`);
    return true;
  }
  if (resolution.action === "kill") {
    if (ctx.container === null) {
      error("Nothing to remove — the conflicting process isn't a docker container. Stop it manually and retry.");
      return false;
    }
    try {
      await removeContainer(ctx.container.id);
      success(`removed conflicting container ${ctx.container.name}.`);
    } catch (e: unknown) {
      error(`docker rm -f ${ctx.container.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    return true;
  }
  if (resolution.action === "change") {
    const newPort = resolution.newPort;
    if (newPort === undefined) {
      error("internal: change selected without a new port.");
      return false;
    }
    setInfraPort(infraService, newPort);
    success(`updated bytebell ${serviceLabel} → port ${newPort}.`);
    skipServices.delete(composeService);
    return true;
  }
  return false;
}

async function safeComposeDown(): Promise<void> {
  try {
    await down();
  } catch {
    // best-effort cleanup — ignore failures
  }
}

function composeServicesToStart(skip: Set<"mongo" | "neo4j" | "redis">): readonly ("mongo" | "neo4j" | "redis")[] {
  if (skip.size === 0) {
    return ["mongo", "neo4j", "redis"];
  }
  return (["mongo", "neo4j", "redis"] as const).filter((s) => !skip.has(s));
}

function composeServiceFor(service: InfraService): "mongo" | "neo4j" | "redis" {
  if (service === "mongo") {
    return "mongo";
  }
  if (service === "redis") {
    return "redis";
  }
  return "neo4j";
}

function portFor(service: "mongo" | "neo4j" | "redis", ports: InfraPorts): number {
  if (service === "mongo") {
    return ports.mongo;
  }
  if (service === "redis") {
    return ports.redis;
  }
  return ports.neo4jBolt;
}

function handleDockerError(cause: unknown): void {
  if (cause instanceof DockerNotFoundError) {
    error(cause.message);
  } else if (cause instanceof DockerComposeError) {
    error(cause.message);
  } else if (cause instanceof DockerHealthTimeoutError) {
    error(cause.message);
  } else {
    error(cause instanceof Error ? cause.message : String(cause));
  }
  process.exitCode = 1;
}

function readString(key: Config): string {
  const value = getConfigValue(key);
  return typeof value === "string" ? value : "";
}

function generateNeo4jPassword(): string {
  return randomBytes(24).toString("base64url");
}
