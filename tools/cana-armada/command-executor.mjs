import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../../apps/web/src/lib/cana-intelligence/core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_GRANT = Symbol('CANA_ARMADA_ADAPTER_GRANT');
const SAFE_ENV_KEYS = Object.freeze(['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']);
const ADAPTERS = Object.freeze({
  'fixture-agent-a': Object.freeze({
    role: 'candidate',
    command: process.execPath,
    args: Object.freeze([path.join(HERE, 'fixtures/fake-agent.mjs'), 'a']),
  }),
  'fixture-agent-b': Object.freeze({
    role: 'candidate',
    command: process.execPath,
    args: Object.freeze([path.join(HERE, 'fixtures/fake-agent.mjs'), 'b']),
  }),
  'fixture-verifier': Object.freeze({
    role: 'verifier',
    command: process.execPath,
    args: Object.freeze([path.join(HERE, 'fixtures/fake-verifier.mjs')]),
  }),
});

export function resolveArmadaAdapter(adapterId, role) {
  const registered = ADAPTERS[adapterId];
  if (!registered || registered.role !== role) {
    const error = new Error(`Armada ${role} adapter is not source-registered: ${String(adapterId)}`);
    error.code = 'ARMADA_ADAPTER_NOT_AUTHORIZED';
    throw error;
  }
  return Object.freeze({
    [ADAPTER_GRANT]: true,
    adapterId,
    role,
    command: registered.command,
    args: registered.args,
  });
}

export async function runCommandAgent({
  adapter,
  input,
  cwd,
  timeoutMs = 120_000,
  maxOutputBytes = 2_000_000,
}) {
  if (adapter?.[ADAPTER_GRANT] !== true || !ADAPTERS[adapter.adapterId]) {
    const error = new Error('source-registered Armada adapter grant required');
    error.code = 'ARMADA_ADAPTER_NOT_AUTHORIZED';
    throw error;
  }
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    const error = new Error('absolute isolated Armada cwd required');
    error.code = 'ARMADA_ISOLATED_CWD_REQUIRED';
    throw error;
  }
  const registered = ADAPTERS[adapter.adapterId];
  if (
    adapter.command !== registered.command
    || JSON.stringify(adapter.args) !== JSON.stringify(registered.args)
    || adapter.role !== registered.role
  ) {
    const error = new Error('Armada adapter grant does not match its source registration');
    error.code = 'ARMADA_ADAPTER_NOT_AUTHORIZED';
    throw error;
  }
  const safeEnv = { CANA_ARMADA_EFFECT_AUTHORITY: 'NONE' };
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) safeEnv[key] = process.env[key];
  }
  const startedAt = new Date();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(adapter.command, adapter.args, {
      cwd,
      env: safeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error(`agent command timed out after ${timeoutMs}ms`), { code: 'ARMADA_TIMEOUT' }));
    }, timeoutMs);
    const append = (kind, data) => {
      bytes += Buffer.byteLength(data);
      if (bytes > maxOutputBytes) {
        child.kill('SIGKILL');
        clearTimeout(timer);
        reject(Object.assign(new Error('agent output exceeded limit'), { code: 'ARMADA_OUTPUT_LIMIT' }));
        return;
      }
      if (kind === 'out') stdout += data;
      else stderr += data;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => append('out', data));
    child.stderr.on('data', (data) => append('err', data));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
  const completedAt = new Date();
  return Object.freeze({
    ...result,
    adapterId: adapter.adapterId,
    effectAuthority: 'NONE',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt - startedAt,
    stdoutDigest: digest(result.stdout, 'stdout'),
    stderrDigest: digest(result.stderr, 'stderr'),
    inheritedEnvKeys: [...SAFE_ENV_KEYS],
    explicitEnvKeys: ['CANA_ARMADA_EFFECT_AUTHORITY'],
  });
}
export function parseJsonFromAgent(run){if(run.code!==0){const error=new Error(`agent exited ${run.code}: ${run.stderr.slice(0,1000)}`);error.code='ARMADA_AGENT_FAILED';throw error;}const text=run.stdout.trim();try{return JSON.parse(text);}catch{const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start>=0&&end>start)return JSON.parse(text.slice(start,end+1));throw new Error('agent did not return JSON');}}
