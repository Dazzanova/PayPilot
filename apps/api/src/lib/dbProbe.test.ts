import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DbProbeDeps, runDbProbe, startDbProbe } from './dbProbe';

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
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
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
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
    assert.equal(deps.calls.warnings.length, 1);
    assert.match(deps.calls.warnings[0].message, /probe failed/i);
    const serialized = JSON.stringify(deps.calls.warnings);
    assert.equal(serialized.includes('postgresql://'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.match(serialized, /\[redacted\]/);
  });

  it('sets db_up to 0 when the probe times out', async () => {
    const deps = makeDeps({
      query: () => new Promise(() => undefined),
      timeoutMs: 5,
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
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

    const first = runDbProbe(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runDbProbe(deps);

    assert.equal(deps.calls.up.length, 0);
    assert.equal(deps.calls.debug.length, 1);
    assert.match(deps.calls.debug[0], /previous probe is still running/i);

    release();
    await first;
    assert.deepEqual(deps.calls.up, [1]);
  });
});

describe('startDbProbe', () => {
  it('runs once at startup and stops the interval', async () => {
    const deps = makeDeps();
    const clearIntervalSpy = mock.method(global, 'clearInterval');

    const stop = startDbProbe(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();

    assert.equal(deps.calls.up.length, 1);
    assert.equal(clearIntervalSpy.mock.callCount(), 1);

    clearIntervalSpy.mock.restore();
  });
});
