/**
 * Batch Job Run Reporter
 *
 * Records batch job executions to MongoDB for monitoring.
 * Provides withLockAndReport() — acquires file lock + records run to DB.
 */

import * as os from 'os';
import logger from './logger';
import { ScriptLock } from './lock';
import { getStorage } from './storage';

export type BatchJobStatus = 'completed' | 'skipped' | 'error';

export interface BatchJobRunDocument {
  scriptName: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  status: BatchJobStatus;
  errorMessage?: string;
  metrics: Record<string, number | undefined>;
  hostname?: string;
  pid?: number;
}

async function recordJobRun(
  scriptName: string,
  status: BatchJobStatus,
  startedAt: Date,
  endedAt: Date,
  metrics: Record<string, number | undefined>,
  errorMessage?: string,
): Promise<void> {
  try {
    const storage = getStorage();
    const collection = storage.getDb().collection('hl_batch_job_runs');

    await collection.insertOne({
      scriptName,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      status,
      metrics,
      hostname: os.hostname(),
      pid: process.pid,
      ...(errorMessage && { errorMessage }),
    });
    logger.info(`[JobReporter] Recorded ${status} run for ${scriptName}`);
  } catch (error) {
    logger.error(`[JobReporter] Failed to record run: ${error}`);
  }
}

export async function withLockAndReport<T extends Record<string, number | undefined>>(
  scriptName: string,
  fn: () => Promise<T>,
): Promise<{ executed: boolean; metrics?: T }> {
  const lock = new ScriptLock(scriptName);
  const startedAt = new Date();

  if (!lock.acquire()) {
    const endedAt = new Date();
    await recordJobRun(scriptName, 'skipped', startedAt, endedAt, {});
    logger.info(`[${scriptName}] Another instance is already running. Skipping.`);
    return { executed: false };
  }

  let status: BatchJobStatus = 'completed';
  let metrics: T | undefined;
  let errorMessage: string | undefined;

  try {
    metrics = await fn();
    return { executed: true, metrics };
  } catch (error) {
    status = 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    lock.release();
    const endedAt = new Date();
    await recordJobRun(scriptName, status, startedAt, endedAt, metrics || {}, errorMessage);
  }
}
