import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);

function gitEnvironment() {
  const environment = {
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

async function git(directory, args, options = {}) {
  return exec('git', [
    '-c', `core.hooksPath=${os.devNull}`,
    '-c', 'core.fsmonitor=false',
    '-C', directory,
    ...args,
  ], {
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

export async function assertCanonicalRepository({ repoRoot, baseSha }) {
  const expectedRoot = await fs.realpath(repoRoot);
  const { stdout } = await git(expectedRoot, ['rev-parse', '--show-toplevel']);
  const actualRoot = await fs.realpath(stdout.trim());
  if (actualRoot !== expectedRoot) {
    const error = new Error('Armada source repository identity mismatch');
    error.code = 'ARMADA_REPOSITORY_IDENTITY_MISMATCH';
    throw error;
  }
  await git(expectedRoot, ['rev-parse', '--verify', `${baseSha}^{commit}`]);
  try {
    await git(expectedRoot, ['merge-base', '--is-ancestor', baseSha, 'HEAD']);
  } catch {
    const error = new Error('Armada base SHA must be reachable from the canonical source HEAD');
    error.code = 'ARMADA_BASE_SHA_NOT_CANONICAL';
    throw error;
  }
  return expectedRoot;
}

export async function createDisposableWorktree({ repoRoot, baseSha, label = 'armada' }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `cana-${label}-`));
  try {
    await git(repoRoot, ['worktree', 'add', '--detach', root, baseSha]);
    return root;
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function removeDisposableWorktree({ repoRoot, worktree }) {
  try {
    await git(repoRoot, ['worktree', 'remove', '--force', worktree]);
  } finally {
    await fs.rm(worktree, { recursive: true, force: true });
  }
}

export async function worktreeDiff({ worktree }) {
  const { stdout } = await git(worktree, ['status', '--porcelain=v1']);
  return stdout.trim();
}
