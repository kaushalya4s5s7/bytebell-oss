import { open, type Database, type Job, type JsonValue, type Queue } from "@russellthehippo/honker-node";
import { JobType, type JobMessage, type PayloadFor } from "@bb/types";
import { QueueConnectError, QueueNotConnectedError } from "@bb/errors";
import { logger } from "@bb/logger";
import { defaultConcurrencyFor, registerQueueProvider } from "@bb/queue";
import type {
  FailedJob,
  IQueueProvider,
  JobHandler,
  NormalizedEnqueueOptions,
  QueuePingResult,
  RemoveKnowledgeJobsResult,
  WorkerRegistrationOptions,
} from "@bb/queue-core";
import { mapHonkerPriority } from "./priority.ts";
import { resolveQueueDbPath } from "./paths.ts";

const VISIBILITY_S = 300;
const HEARTBEAT_EXTEND_S = 300;
const HEARTBEAT_MS = 60_000;
const RETRY_DELAY_S = 5;
const MAX_ATTEMPTS = 3;
const SWEEP_INTERVAL_MS = 30_000;

const ALL_JOB_TYPES: readonly JobType[] = [
  JobType.GithubIndex,
  JobType.GithubPull,
  JobType.LocalIngest,
  JobType.BusinessContextProcessing,
];

interface WorkerLoop {
  controller: AbortController;
  done: Promise<void>;
}

class HonkerQueueProvider implements IQueueProvider {
  private db: Database | null = null;
  private queues = new Map<JobType, Queue>();
  private workers: WorkerLoop[] = [];
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    try {
      const dbPath = resolveQueueDbPath();
      const db = open(dbPath);
      for (const type of ALL_JOB_TYPES) {
        this.queues.set(type, db.queue(type, { visibilityTimeoutS: VISIBILITY_S, maxAttempts: MAX_ATTEMPTS }));
      }
      this.db = db;
      this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.sweepTimer.unref();
    } catch (cause: unknown) {
      this.queues.clear();
      this.db = null;
      throw new QueueConnectError(cause);
    }
  }

  async close(): Promise<void> {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const loops = this.workers.splice(0);
    for (const w of loops) {
      w.controller.abort();
    }
    await Promise.allSettled(loops.map((w) => w.done));
    this.queues.clear();
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }

  async ping(): Promise<QueuePingResult> {
    const start = performance.now();
    try {
      this.requireDb().query("SELECT 1", null);
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: Math.round(performance.now() - start) };
    }
  }

  async enqueueRaw<T extends JobType>(
    type: T,
    message: JobMessage<PayloadFor<T>>,
    opts: NormalizedEnqueueOptions,
  ): Promise<string> {
    const db = this.requireDb();
    const queue = this.requireQueue(type);
    const existing = db.query(
      "SELECT id FROM _honker_live WHERE queue = ? AND json_extract(payload, '$.knowledgeId') = ? LIMIT 1",
      [type, message.knowledgeId],
    );
    const firstRow = existing[0];
    if (firstRow !== undefined) {
      return String(firstRow["id"]);
    }
    const id = queue.enqueue(message as unknown as JsonValue, {
      priority: mapHonkerPriority(opts.priority),
    });
    return String(id);
  }

  registerWorker<T extends JobType>(type: T, handler: JobHandler<T>, opts: WorkerRegistrationOptions = {}): void {
    const queue = this.requireQueue(type);
    const concurrency = opts.concurrency ?? defaultConcurrencyFor(type);
    for (let i = 0; i < concurrency; i++) {
      const workerId = `${type}-${i}-${process.pid}`;
      const controller = new AbortController();
      const done = this.runWorkerLoop(queue, workerId, handler, controller.signal);
      this.workers.push({ controller, done });
    }
  }

  private async runWorkerLoop<T extends JobType>(
    queue: Queue,
    workerId: string,
    handler: JobHandler<T>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const job of queue.claim(workerId, { signal })) {
        await this.processJob(job, workerId, handler);
      }
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      logger.error(`queue-honker: worker=${workerId} loop crashed: ${describeError(err)}`);
    }
  }

  private async processJob<T extends JobType>(job: Job, workerId: string, handler: JobHandler<T>): Promise<void> {
    let ownsLease = true;
    const hb = setInterval(() => {
      if (!ownsLease) {
        return;
      }
      const ok = job.heartbeat(HEARTBEAT_EXTEND_S);
      if (!ok) {
        ownsLease = false;
        logger.warn(`queue-honker: worker=${workerId} job=${job.id} lost lease mid-flight; stop-and-finish`);
      }
    }, HEARTBEAT_MS);
    try {
      await handler(job.payload as unknown as JobMessage<PayloadFor<T>>);
      if (ownsLease) {
        job.ack();
      }
    } catch (err: unknown) {
      const reason = describeError(err);
      logger.error(`queue-honker: job=${job.id} handler threw: ${reason}; scheduling retry`);
      if (ownsLease) {
        job.retry(RETRY_DELAY_S, reason);
      }
    } finally {
      clearInterval(hb);
    }
  }

  async removeKnowledgeJobs(knowledgeId: string): Promise<RemoveKnowledgeJobsResult> {
    const db = this.requireDb();
    const placeholders = ALL_JOB_TYPES.map(() => "?").join(",");
    const tx = db.transaction();
    try {
      const removed = tx.execute(
        `DELETE FROM _honker_live WHERE queue IN (${placeholders}) AND json_extract(payload, '$.knowledgeId') = ?`,
        [...ALL_JOB_TYPES, knowledgeId],
      );
      tx.commit();
      return { removed };
    } catch (err) {
      try {
        tx.rollback();
      } catch {
        // already rolled back / commit failed — swallow
      }
      throw err;
    }
  }

  async listFailedJobs(): Promise<FailedJob[]> {
    const db = this.requireDb();
    const rows = db.query("SELECT id, queue, payload, attempts, last_error, died_at FROM _honker_dead", null);
    return rows.map(normalizeFailed);
  }

  private sweep(): void {
    for (const queue of this.queues.values()) {
      try {
        queue.sweepExpired();
      } catch (err) {
        logger.warn(`queue-honker: sweepExpired threw: ${describeError(err)}`);
      }
    }
  }

  private requireDb(): Database {
    if (this.db === null) {
      throw new QueueNotConnectedError();
    }
    return this.db;
  }

  private requireQueue(type: JobType): Queue {
    const q = this.queues.get(type);
    if (q === undefined) {
      throw new QueueNotConnectedError();
    }
    return q;
  }
}

function normalizeFailed(row: Record<string, unknown>): FailedJob {
  const payloadRaw = row["payload"];
  const payload: unknown = typeof payloadRaw === "string" ? safeParseJson(payloadRaw) : payloadRaw;
  const knowledgeId = extractKnowledgeId(payload);
  const queue = typeof row["queue"] === "string" ? row["queue"] : "";
  const diedAt = typeof row["died_at"] === "number" ? row["died_at"] : Date.now() / 1000;
  return {
    id: String(row["id"] ?? ""),
    type: queue as JobType,
    knowledgeId,
    attempts: typeof row["attempts"] === "number" ? row["attempts"] : 0,
    failedAt: new Date(diedAt * 1000).toISOString(),
    reason: typeof row["last_error"] === "string" ? row["last_error"] : "",
    payload,
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractKnowledgeId(payload: unknown): string {
  if (payload !== null && typeof payload === "object" && "knowledgeId" in payload) {
    const v = (payload as { knowledgeId: unknown }).knowledgeId;
    return typeof v === "string" ? v : "";
  }
  return "";
}

registerQueueProvider("honker", () => new HonkerQueueProvider());
