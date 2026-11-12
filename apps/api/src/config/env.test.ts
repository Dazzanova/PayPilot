import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT, resolveRepoPath } from './env';

describe('resolveRepoPath', () => {
  it('resolves relative paths from the repository root', () => {
    assert.equal(
      resolveRepoPath('./.secrets/paypilot_metrics_token'),
      path.join(REPO_ROOT, '.secrets/paypilot_metrics_token')
    );
  });

  it('keeps absolute paths unchanged', () => {
    assert.equal(resolveRepoPath('/tmp/metrics-token'), '/tmp/metrics-token');
  });
});
