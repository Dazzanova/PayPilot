import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  DB_PROBE_INTERVAL_MS,
  DbProbeDeps,
  runDbProbe,
  startDbProbe,
} from './dbProbe';

interface ProbeCalls {
  up: number[];
  duration: number[];
  timestamp: number[];
  warnings: Array<{ message: string; meta?: unknown }>;
  debug: string[];
}

function makeDeps(
  overrides: Partial<DbProbeDeps> = {}
): DbProbeDeps & { calls: ProbeCalls } {
  const calls: ProbeCalls = {
    up: [],
    duration: [],
    timestamp: [],
    warnings: [],
    debug: [],
  };
  let now = 1_000;

  return {
    query: async () => undefined,
    setDbUp: (value) => calls.up.push(value),
    setDuration: (value) => calls.duration.push(value),
    setTimestamp: (value) => calls.timestamp.push(value),
    now: () => {
      now += 25;
      return now;
    },
    logWarn: (message, meta) => calls.warnings.push({ message, meta }),
    logDebug: (message) => calls.debug.push(message),
    timeoutMs: 1_000,
    calls,
    ...overrides,
  };
}

describe('runDbProbe', () => {
  it('sets db_up to 1 and records duration and timestamp on success', async () => {
    const deps = makeDeps();

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [1]);
    assert.deepEqual(deps.calls.duration, [0.025]);
    assert.deepEqual(deps.calls.timestamp, [1.05]);
    assert.equal(deps.calls.warnings.length, 0);
  });

  it('sets db_up to 0 and warns on failure without leaking the connection string', async () => {
    const deps = makeDeps({
      query: async () => {
        throw new Error(
          'connection refused for postgresql://user:secret@localhost:5433/paypilot'
        );
      },
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.deepEqual(deps.calls.duration, [0.025]);
    assert.deepEqual(deps.calls.timestamp, [1.05]);
    assert.equal(deps.calls.warnings.length, 1);
    assert.match(deps.calls.warnings[0].message, /probe failed/i);
    const serialized = JSON.stringify(deps.calls.warnings);
    assert.equal(serialized.includes('postgresql://'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.match(serialized, /\[redacted\]/);
  });

  it('redacts short postgres URLs and password parameters', async () => {
    const deps = makeDeps({
      query: async () => {
        throw new Error(
          'failed postgres://user:secret@localhost:5433/paypilot password=hunter2'
        );
      },
    });

    await runDbProbe(deps);

    const serialized = JSON.stringify(deps.calls.warnings);
    assert.equal(serialized.includes('postgres://'), false);
    assert.equal(serialized.includes('hunter2'), false);
    assert.match(serialized, /password=\[redacted\]/);
  });

  it('uses a generic message for non-Error rejections', async () => {
    const deps = makeDeps({
      query: async () => {
        throw 'connection failed';
      },
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.deepEqual(deps.calls.warnings[0].meta, {
      message: 'Unknown database probe error',
    });
  });

  it('sets db_up to 0 when the probe times out', async () => {
    const deps = makeDeps({
      query: () => new Promise(() => undefined),
      timeoutMs: 5,
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.deepEqual(deps.calls.duration, [0.025]);
    assert.deepEqual(deps.calls.timestamp, [1.05]);
    assert.match(
      JSON.stringify(deps.calls.warnings),
      /timed out after 5ms/
    );
  });

  it('skips a second probe while the first is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = makeDeps({ query: () => gate });

    try {
      const first = runDbProbe(deps);
      await Promise.resolve();
      await runDbProbe(deps);

      assert.equal(deps.calls.up.length, 0);
      assert.equal(deps.calls.debug.length, 1);
      assert.match(deps.calls.debug[0], /previous probe is still running/i);

      release();
      await first;
      assert.deepEqual(deps.calls.up, [1]);
    } finally {
      release();
    }
  });

  it('keeps the overlap lock after a timeout until the query settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queries = 0;
    const deps = makeDeps({
      query: () => {
        queries += 1;
        return gate;
      },
      timeoutMs: 5,
    });

    try {
      const first = runDbProbe(deps);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await first;

      assert.deepEqual(deps.calls.up, [0]);
      assert.equal(queries, 1);

      await runDbProbe(deps);
      assert.equal(queries, 1);
      assert.match(deps.calls.debug[0], /previous probe is still running/i);

      release();
      await new Promise((resolve) => setImmediate(resolve));

      await runDbProbe(deps);
      assert.equal(queries, 2);
      assert.deepEqual(deps.calls.up, [0, 1]);
    } finally {
      release();
    }
  });

  it('does not wedge the lock when a metric setter throws', async () => {
    const deps = makeDeps();
    const originalSetDbUp = deps.setDbUp;
    let shouldThrow = true;
    deps.setDbUp = (value) => {
      if (shouldThrow) throw new Error('gauge failure');
      originalSetDbUp(value);
    };

    await runDbProbe(deps);

    assert.equal(deps.calls.warnings.length, 1);
    assert.match(deps.calls.warnings[0].message, /metric update failed/i);

    shouldThrow = false;
    await runDbProbe(deps);
    assert.deepEqual(deps.calls.up, [1]);
  });

  it('isolates overlap state between different deps objects', async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let queries = 0;
    const depsA = makeDeps({
      query: () => {
        queries += 1;
        return gateA;
      },
    });
    const depsB = makeDeps({
      query: () => {
        queries += 1;
        return gateB;
      },
    });

    try {
      const firstA = runDbProbe(depsA);
      const firstB = runDbProbe(depsB);
      await Promise.resolve();

      assert.equal(queries, 2);

      await runDbProbe(depsA);
      assert.equal(queries, 2);
      assert.equal(depsA.calls.debug.length, 1);

      releaseA();
      releaseB();
      await Promise.all([firstA, firstB]);

      assert.deepEqual(depsA.calls.up, [1]);
      assert.deepEqual(depsB.calls.up, [1]);
    } finally {
      releaseA();
      releaseB();
    }
  });
});

describe('startDbProbe', () => {
  it('runs at startup, refreshes on the interval, and stops cleanly', async (t) => {
    const deps = makeDeps();
    mock.timers.enable({ apis: ['setInterval'] });
    t.after(() => mock.timers.reset());

    const stop = startDbProbe(deps);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deps.calls.up.length, 1);

    mock.timers.tick(DB_PROBE_INTERVAL_MS);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deps.calls.up.length, 2);

    stop();
    mock.timers.tick(DB_PROBE_INTERVAL_MS);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deps.calls.up.length, 2);
  });
});
