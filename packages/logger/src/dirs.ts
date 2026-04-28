import fs from "node:fs";
import path from "node:path";
import { getBytebellHome } from "@bb/config";

const LOGS_DIR_NAME = "logs";
const DIR_MODE = 0o700;

export function getLogsDir(): string {
  return path.join(getBytebellHome(), LOGS_DIR_NAME);
}

export function ensureLogsDir(): void {
  fs.mkdirSync(getLogsDir(), { recursive: true, mode: DIR_MODE });
}
