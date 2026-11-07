import { createHash } from 'node:crypto';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_RELATIVE = path.join('var', 'payroll-imports');

/**
 * Resolve the private raw-file directory. When no explicit configuration is
 * present, use the repository-level `var/payroll-imports` directory rather than
 * a directory relative to the process working directory.
 */
export function importStorageRoot(): string {
  const configured = process.env.PAYROLL_IMPORT_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  const repoRoot = fs.existsSync(path.join(cwd, '..', '..', 'package.json'))
    ? path.resolve(cwd, '..', '..')
    : cwd;
  return path.join(repoRoot, DEFAULT_RELATIVE);
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sanitizeFilename(value: string | undefined): string {
  const base = path.basename((value ?? '').trim() || 'payroll.csv');
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  return (cleaned || 'payroll.csv').slice(0, 255);
}

export function buildStorageKey(organizationId: string, batchId: string): string {
  return `${organizationId}/${batchId}.csv`;
}

export function resolveImportPath(storageKey: string): string {
  const root = importStorageRoot();
  const full = path.resolve(root, storageKey);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid storage key');
  }
  return full;
}

export async function saveImportFile(input: {
  organizationId: string;
  batchId: string;
  buffer: Buffer;
}): Promise<{ storageKey: string; absolutePath: string }> {
  const storageKey = buildStorageKey(input.organizationId, input.batchId);
  const absolutePath = resolveImportPath(storageKey);
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, input.buffer, { mode: 0o600 });
  await chmod(absolutePath, 0o600);
  return { storageKey, absolutePath };
}

export async function deleteImportFile(storageKey: string): Promise<void> {
  await unlink(resolveImportPath(storageKey));
}

export async function deleteImportFileQuietly(storageKey: string): Promise<void> {
  try {
    await deleteImportFile(storageKey);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
