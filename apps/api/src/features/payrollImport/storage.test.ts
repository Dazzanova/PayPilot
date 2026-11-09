import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildStorageKey,
  deleteImportFile,
  hashBuffer,
  importStorageRoot,
  resolveImportPath,
  sanitizeFilename,
  saveImportFile,
} from './storage';

let root: string;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'payroll-import-'));
  process.env.PAYROLL_IMPORT_STORAGE_DIR = root;
});

after(async () => {
  delete process.env.PAYROLL_IMPORT_STORAGE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('payroll import storage', () => {
  it('hashes bytes deterministically', () => {
    assert.equal(hashBuffer(Buffer.from('x')), hashBuffer(Buffer.from('x')));
    assert.notEqual(hashBuffer(Buffer.from('x')), hashBuffer(Buffer.from('y')));
    assert.equal(hashBuffer(Buffer.from('x')).length, 64);
  });

  it('sanitizes client filenames', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFilename(''), 'payroll.csv');
    assert.equal(sanitizeFilename(undefined), 'payroll.csv');
    assert.equal(sanitizeFilename('a\u0000b.csv'), 'ab.csv');
    assert.ok(sanitizeFilename('a'.repeat(400)).length <= 255);
  });

  it('keeps generated paths inside the storage root', () => {
    assert.equal(importStorageRoot(), path.resolve(root));
    assert.throws(() => resolveImportPath('../escape.csv'));
    assert.throws(() => resolveImportPath('/etc/passwd'));
  });

  it('saves and deletes a private file under the generated key', async () => {
    const key = buildStorageKey('11111111-1111-4111-8111-111111111111', 'batch-1');
    assert.equal(key, '11111111-1111-4111-8111-111111111111/batch-1.csv');
    const saved = await saveImportFile({
      organizationId: '11111111-1111-4111-8111-111111111111',
      batchId: 'batch-1',
      buffer: Buffer.from('hello'),
    });
    assert.equal(await readFile(saved.absolutePath, 'utf8'), 'hello');
    assert.equal(resolveImportPath(key).startsWith(importStorageRoot()), true);

    const fileMode = (await stat(saved.absolutePath)).mode & 0o777;
    const directoryMode = (await stat(path.dirname(saved.absolutePath))).mode & 0o777;
    assert.equal(fileMode, 0o600);
    assert.equal(directoryMode, 0o700);

    await deleteImportFile(key);
    await assert.rejects(readFile(saved.absolutePath, 'utf8'));
  });
});
