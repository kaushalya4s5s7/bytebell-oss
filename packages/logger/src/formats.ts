import util from "node:util";
import path from "node:path";
import winston from "winston";
import { getCallerInfo, toProjectRelative } from "./caller.ts";

const SPLAT = Symbol.for("splat");

interface InfoExtras {
  logpath?: string;
  file?: string;
  line?: number;
  function?: string;
  worker?: string;
}

type WinstonInfo = winston.Logform.TransformableInfo & InfoExtras & Record<symbol, unknown>;

function inspect(value: unknown, colors: boolean): string {
  return typeof value === "string" ? value : util.inspect(value, { depth: 4, breakLength: 120, colors });
}

export const sugarFormat = winston.format((info: winston.Logform.TransformableInfo) => {
  const ext = (info as WinstonInfo)[SPLAT] as unknown[] | undefined;
  if (ext === undefined || ext.length === 0) {
    return info;
  }
  const rendered = ext.map((x) => inspect(x, false)).join(" ");
  info.message = `${String(info.message)} ${rendered}`;
  return info;
});

export const callerFormat = winston.format((info: winston.Logform.TransformableInfo) => {
  const caller = getCallerInfo();
  const target = info as WinstonInfo;
  if (caller.file === "unknown") {
    target.logpath = "unknown:0";
    target.file = "unknown";
    target.line = 0;
    target.function = "anonymous";
    return info;
  }
  const rel = toProjectRelative(caller.file);
  target.logpath = `${rel}:${caller.line}`;
  target.file = path.basename(caller.file);
  target.line = caller.line;
  target.function = caller.function;
  return info;
});

function formatExtraMeta(info: WinstonInfo): string {
  const parts: string[] = [];
  if (typeof info.worker === "string" && info.worker.length > 0) {
    parts.push(`worker=${info.worker}`);
  }
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

export function buildPrintf(opts: { colors: boolean }): winston.Logform.Format {
  return winston.format.printf((rawInfo) => {
    const info = rawInfo as WinstonInfo;
    const ts = info["timestamp"] ?? new Date().toISOString();
    const levelText = opts.colors ? info.level : info.level.toUpperCase();
    const logpath = info.logpath ?? "unknown:0";
    return `${String(ts)} [${logpath}]${formatExtraMeta(info)} ${levelText}: ${String(info.message)}`;
  });
}
