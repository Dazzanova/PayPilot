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
  setDbUp: (value: 0 | 1) => void;
  setDuration: (seconds: number) => void;
  setTimestamp: (seconds: number) => void;
  now: () => number;
  logWarn: (message: string, meta?: unknown) => void;
  logDebug: (message: string, meta?: unknown) => void;
  timeoutMs: number;
}

export interface DbProbe {
  run: () => Promise<void>;
  start: () => () => void;
}

const defaultDeps: DbProbeDeps = {
  query: async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = ${DB_PROBE_TIMEOUT_MS}`
      );
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

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?|amqps?):\/\/\S+/gi,
      '[redacted]'
    )
    .replace(/\b(password|pwd)=[^\s&;]+/gi, '$1=[redacted]');
}

function describeError(error: unknown, fallback: string): string {
  return sanitizeErrorMessage(error instanceof Error ? error.message : fallback);
}

export function createDbProbe(deps: DbProbeDeps = defaultDeps): DbProbe {
  let inFlight = false;

  async function run(): Promise<void> {
    if (inFlight) {
      deps.logDebug(
        'Skipping database probe because the previous probe is still running'
      );
      return;
    }

    const startedAt = deps.now();
    inFlight = true;
    let connected = false;

    // Release the overlap lock only when the underlying query settles, not when
    // the timeout wrapper rejects. Otherwise a stalled query would accumulate
    // one orphan per interval tick.
    const queryPromise = (async () => {
      try {
        return await deps.query();
      } finally {
        inFlight = false;
      }
    })();

    try {
      await withTimeout(queryPromise, deps.timeoutMs);
      connected = true;
    } catch (error) {
      deps.logWarn('Database probe failed', {
        message: describeError(error, 'Unknown database probe error'),
      });
    }

    try {
      const finishedAt = deps.now();
      deps.setDbUp(connected ? 1 : 0);
      deps.setDuration((finishedAt - startedAt) / 1000);
      deps.setTimestamp(finishedAt / 1000);
    } catch (error) {
      deps.logWarn('Database probe metric update failed', {
        message: describeError(error, 'Unknown database metric error'),
      });
    }
  }

  function start(): () => void {
    const runSafely = () => {
      void run().catch((error) => {
        deps.logWarn('Database probe crashed', {
          message: describeError(error, 'Unknown database probe error'),
        });
      });
    };

    runSafely();

    const interval = setInterval(runSafely, DB_PROBE_INTERVAL_MS);
    interval.unref?.();

    return () => clearInterval(interval);
  }

  return { run, start };
}

const probes = new WeakMap<DbProbeDeps, DbProbe>();

function probeFor(deps: DbProbeDeps): DbProbe {
  let probe = probes.get(deps);
  if (!probe) {
    probe = createDbProbe(deps);
    probes.set(deps, probe);
  }
  return probe;
}

export function runDbProbe(deps: DbProbeDeps = defaultDeps): Promise<void> {
  return probeFor(deps).run();
}

export function startDbProbe(deps: DbProbeDeps = defaultDeps): () => void {
  return probeFor(deps).start();
}
