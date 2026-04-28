import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { getLogsDir } from "./dirs.ts";
import { buildPrintf, callerFormat, sugarFormat } from "./formats.ts";

const FILE_MODE = 0o600;

function fileFormat(): winston.Logform.Format {
  return winston.format.combine(
    sugarFormat(),
    callerFormat(),
    winston.format.timestamp(),
    buildPrintf({ colors: false }),
  );
}

function consoleFormat(useColors: boolean): winston.Logform.Format {
  const layers: winston.Logform.Format[] = [
    sugarFormat(),
    callerFormat(),
    winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  ];
  if (useColors) {
    layers.push(winston.format.colorize());
  }
  layers.push(buildPrintf({ colors: useColors }));
  return winston.format.combine(...layers);
}

export function makeFileTransport(scope: string): DailyRotateFile {
  const retention = getConfigValue(Config.LogRetentionDays);
  return new DailyRotateFile({
    dirname: getLogsDir(),
    filename: `${scope}-%DATE%.log`,
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxFiles: `${retention}d`,
    options: { mode: FILE_MODE },
    format: fileFormat(),
  });
}

export function makeConsoleTransport(): winston.transports.ConsoleTransportInstance {
  const useColors = process.stdout.isTTY === true;
  return new winston.transports.Console({ format: consoleFormat(useColors) });
}

export function flushTransport(t: winston.transport): Promise<void> {
  return new Promise((resolve) => {
    const inner = t as { close?: () => void; on: (e: string, fn: () => void) => void };
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };
    inner.on("finish", finish);
    inner.on("close", finish);
    inner.close?.();
    setTimeout(finish, 1000).unref?.();
  });
}
