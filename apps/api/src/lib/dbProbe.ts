import { logger } from './logger';
import {
  dbLastProbeTimestamp,
  dbProbeDuration,
  dbUp,
} from './metrics';
import { prisma } from './prisma';

export const DB_PROBE_INTERVAL_MS = 15_000;
export const DB_PROBE_TIMEOUT_MS = 2_000;

export interface DbProbeDeps {
  query: () => Promise<unknown>;
  setDbUp: (value: number) => void;
  setDuration: (seconds: number) => void;
  setTimestamp: (seconds: number) => void;
  now: () => number;
  logWarn: (message: string, meta?: unknown) => void;
  logDebug: (message: string, meta?: unknown) => void;
  timeoutMs: number;
}

const defaultDeps: DbProbeDeps = {
  query: async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 2000');
      await tx.$queryRawUnsafe('SELECT 1');
    });
  },
  setDbUp: (value) => dbUp.set(value),
  setDuration: (seconds) => dbProbeDuration.set(seconds),
  setTimestamp: (seconds) => dbLastProbeTimestamp.set(seconds),
  now: () => Date.now(),
  logWarn: (message, meta) => logger.warn(message, meta),
  logDebug: (message, meta) => logger.debug(message, meta),
  timeoutMs: DB_PROBE_TIMEOUT_MS,
};

let inFlight = false;

function sanitizeErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Database probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function runDbProbe(
  deps: DbProbeDeps = defaultDeps
): Promise<void> {
  if (inFlight) {
    deps.logDebug('Skipping database probe because the previous probe is still running');
    return;
  }

  inFlight = true;
  const startedAt = deps.now();
  let connected = false;

  try {
    await withTimeout(deps.query(), deps.timeoutMs);
    connected = true;
  } catch (error) {
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : 'Unknown database probe error'
    );
    deps.logWarn('Database probe failed', { message });
  } finally {
    const finishedAt = deps.now();
    deps.setDbUp(connected ? 1 : 0);
    deps.setDuration((finishedAt - startedAt) / 1000);
    deps.setTimestamp(finishedAt / 1000);
    inFlight = false;
  }
}

export function startDbProbe(deps: DbProbeDeps = defaultDeps): () => void {
  void runDbProbe(deps);

  const interval = setInterval(() => {
    void runDbProbe(deps);
  }, DB_PROBE_INTERVAL_MS);
  interval.unref();

  return () => clearInterval(interval);
}
