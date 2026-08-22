import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const DEFAULT_SOURCE = fileURLToPath(new URL('./linux-custody-helper.c', import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function failure(failureClass, detail = {}) {
  const error = new Error(`${failureClass} ${JSON.stringify(detail)}`);
  error.failureClass = failureClass;
  error.failureDetail = detail;
  return error;
}

function parseResponse(result, operation) {
  const output = String(result.stdout ?? '').trim();
  let response;
  try {
    response = JSON.parse(output);
  } catch (error) {
    throw failure('LINUX_CUSTODY_HELPER_MALFORMED', {
      OPERATION: operation,
      EXIT_CODE: result.status,
      MESSAGE: error.message,
    });
  }
  if (response?.protocol !== PROTOCOL_VERSION || typeof response.status !== 'string') {
    throw failure('LINUX_CUSTODY_HELPER_MALFORMED', { OPERATION: operation, RESPONSE: response });
  }
  return response;
}

export function prepareLinuxCustodyHelper({
  platform = process.platform,
  sourcePath = DEFAULT_SOURCE,
  compiler = process.env.CC ?? 'cc',
  suppliedBinary = process.env.CANA_LINUX_CUSTODY_HELPER ?? null,
  expectedSourceSha256 = process.env.CANA_LINUX_CUSTODY_SOURCE_SHA256 ?? null,
  expectedBinarySha256 = process.env.CANA_LINUX_CUSTODY_BINARY_SHA256 ?? null,
  tempRoot = os.tmpdir(),
  run = spawnSync,
} = {}) {
  if (platform !== 'linux') throw failure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', { PLATFORM: platform });
  const sourceBytes = readFileSync(sourcePath);
  const sourceDigest = sha256(sourceBytes);
  if (expectedSourceSha256 && expectedSourceSha256 !== sourceDigest) {
    throw failure('LINUX_CUSTODY_SOURCE_MISMATCH', { EXPECTED: expectedSourceSha256, ACTUAL: sourceDigest });
  }
  let runtimeDirectory = null;
  let binaryPath = suppliedBinary ? path.resolve(suppliedBinary) : null;
  let compilerVersion = null;
  const compileArgv = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror'];

  if (!binaryPath) {
    runtimeDirectory = mkdtempSync(path.join(tempRoot, 'cana-linux-custody-'));
    chmodSync(runtimeDirectory, 0o700);
    binaryPath = path.join(runtimeDirectory, 'linux-custody-helper');
    const version = run(compiler, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (version.status !== 0) {
      rmSync(runtimeDirectory, { recursive: true, force: true });
      throw failure('LINUX_CUSTODY_HELPER_BUILD_FAILED', { COMPILER: compiler });
    }
    compilerVersion = String(version.stdout).split('\n')[0];
    const compiled = run(compiler, [...compileArgv, '-o', binaryPath, sourcePath], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (compiled.status !== 0 || !existsSync(binaryPath)) {
      rmSync(runtimeDirectory, { recursive: true, force: true });
      throw failure('LINUX_CUSTODY_HELPER_BUILD_FAILED', {
        COMPILER: compiler,
        EXIT_CODE: compiled.status,
        STDERR: String(compiled.stderr ?? '').slice(-2_000),
      });
    }
    chmodSync(binaryPath, 0o700);
  }

  const binaryStat = statSync(binaryPath);
  if (
    !binaryStat.isFile()
    || binaryStat.nlink !== 1
    || (binaryStat.mode & 0o022) !== 0
    || (typeof process.geteuid === 'function' && binaryStat.uid !== process.geteuid())
  ) {
    if (runtimeDirectory) rmSync(runtimeDirectory, { recursive: true, force: true });
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', { BINARY: binaryPath });
  }
  const binaryDigest = sha256(readFileSync(binaryPath));
  if (expectedBinarySha256 && expectedBinarySha256 !== binaryDigest) {
    if (runtimeDirectory) rmSync(runtimeDirectory, { recursive: true, force: true });
    throw failure('LINUX_CUSTODY_BINARY_MISMATCH', { EXPECTED: expectedBinarySha256, ACTUAL: binaryDigest });
  }
  const probed = run(binaryPath, ['probe'], { encoding: 'utf8', timeout: 10_000 });
  const probe = parseResponse(probed, 'probe');
  if (probed.status !== 0 || probe.status !== 'READY') {
    if (runtimeDirectory) rmSync(runtimeDirectory, { recursive: true, force: true });
    throw failure('LINUX_CUSTODY_HELPER_UNAVAILABLE', { EXIT_CODE: probed.status, STATUS: probe.status });
  }

  let closed = false;
  function invoke(operation, argv, { input = null, timeout = 10_000 } = {}) {
    if (closed) throw failure('LINUX_CUSTODY_HELPER_CLOSED', { OPERATION: operation });
    const result = run(binaryPath, [operation, ...argv], {
      encoding: input === null ? 'utf8' : undefined,
      input,
      maxBuffer: 4 * 1024 * 1024,
      timeout,
    });
    const response = parseResponse(result, operation);
    return { ...response, exitCode: result.status };
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    binaryPath,
    sourcePath,
    sourceSha256: sourceDigest,
    binarySha256: binaryDigest,
    compiler,
    compilerVersion,
    compileArgv,
    write({ rootPath, device, inode, relativePath, bytes }) {
      const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      if (payload.byteLength > MAX_PAYLOAD_BYTES) {
        throw failure('OUTPUT_WRITE_REFUSED', { BYTES: payload.byteLength, LIMIT: MAX_PAYLOAD_BYTES });
      }
      const response = invoke('write', [rootPath, String(device), String(inode), relativePath], {
        input: payload,
        timeout: 30_000,
      });
      if (response.exitCode !== 0 || response.status !== 'WROTE' || response.bytes !== payload.byteLength) {
        throw failure('OUTPUT_WRITE_REFUSED', { STATUS: response.status, EXIT_CODE: response.exitCode });
      }
      return response;
    },
    createDirectory({ parentPath, device, inode, name }) {
      if (
        !path.isAbsolute(parentPath)
        || typeof name !== 'string'
        || name === ''
        || name === '.'
        || name === '..'
        || name.includes('/')
        || name.includes('\\')
      ) {
        throw failure('DIRECTORY_CREATE_REFUSED', { PARENT: parentPath, NAME: name });
      }
      const response = invoke('mkdir', [parentPath, String(device), String(inode), name]);
      if (response.exitCode !== 0 || response.status !== 'CREATED') {
        throw failure('DIRECTORY_CREATE_REFUSED', { STATUS: response.status, EXIT_CODE: response.exitCode });
      }
      return response;
    },
    launchSpec({ rootPath, device, inode, executable, argv }) {
      if (!path.isAbsolute(executable) || !Array.isArray(argv)) {
        throw failure('CHROMIUM_EXEC_FAILED', { EXECUTABLE: executable });
      }
      if (closed) throw failure('LINUX_CUSTODY_HELPER_CLOSED', { OPERATION: 'launch' });
      return {
        command: binaryPath,
        argv: ['launch', rootPath, String(device), String(inode), executable, ...argv],
      };
    },
    signal({ pid, startTime, signal }) {
      return invoke('signal', [String(pid), String(startTime), signal]);
    },
    status({ pid, startTime }) {
      return invoke('status', [String(pid), String(startTime)]);
    },
    close() {
      if (closed) return;
      closed = true;
      if (runtimeDirectory) rmSync(runtimeDirectory, { recursive: true, force: true });
    },
  };
}
