import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_HELPER_ARG_BYTES = 120 * 1024;
const PYTHON_EXECUTABLE = '/usr/bin/python3';
const SEALED_EXEC_SCRIPT = [
  'import base64, fcntl, hashlib, os, sys',
  'payload = base64.b64decode(sys.argv[2], validate=True)',
  'if hashlib.sha256(payload).hexdigest() != sys.argv[1]: raise SystemExit(126)',
  'fd = os.memfd_create("cana-linux-custody-helper", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)',
  'view = memoryview(payload)',
  'while view: view = view[os.write(fd, view):]',
  'os.fchmod(fd, 0o500)',
  'seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE',
  'fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)',
  'os.execve(f"/proc/self/fd/{fd}", ["cana-linux-custody-helper", *sys.argv[3:]], os.environ)',
].join('\n');
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
  const runtimeDirectory = mkdtempSync(path.join(tempRoot, 'cana-linux-custody-'));
  chmodSync(runtimeDirectory, 0o700);
  let binaryPath = suppliedBinary ? path.resolve(suppliedBinary) : null;
  let compilerVersion = null;
  const compileArgv = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror'];

  if (!binaryPath) {
    binaryPath = path.join(runtimeDirectory, 'linux-custody-helper');
    const version = run(compiler, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (version.status !== 0) {
      rmSync(runtimeDirectory, { recursive: true, force: true });
      throw failure('LINUX_CUSTODY_HELPER_BUILD_FAILED', { COMPILER: compiler });
    }
    compilerVersion = String(version.stdout).split('\n')[0];
    const compiled = run(compiler, [...compileArgv, '-x', 'c', '-o', binaryPath, '-'], {
      encoding: 'utf8',
      input: sourceBytes,
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

  let sourceBinaryFd = null;
  try {
    sourceBinaryFd = openSync(binaryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    rmSync(runtimeDirectory, { recursive: true, force: true });
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', { BINARY: binaryPath, MESSAGE: error.message });
  }
  const closeBinary = () => {
    if (sourceBinaryFd !== null) closeSync(sourceBinaryFd);
    sourceBinaryFd = null;
  };
  const cleanFailure = () => {
    closeBinary();
    rmSync(runtimeDirectory, { recursive: true, force: true });
  };
  const binaryStat = fstatSync(sourceBinaryFd);
  if (
    !binaryStat.isFile()
    || binaryStat.nlink !== 1
    || (binaryStat.mode & 0o022) !== 0
    || (typeof process.geteuid === 'function' && binaryStat.uid !== process.geteuid())
  ) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', { BINARY: binaryPath });
  }
  const binaryBytes = readFileSync(sourceBinaryFd);
  const binaryDigest = sha256(binaryBytes);
  if (expectedBinarySha256 && expectedBinarySha256 !== binaryDigest) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_BINARY_MISMATCH', { EXPECTED: expectedBinarySha256, ACTUAL: binaryDigest });
  }
  closeBinary();
  const encodedBinary = binaryBytes.toString('base64');
  if (Buffer.byteLength(encodedBinary) > MAX_HELPER_ARG_BYTES) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', {
      BINARY: binaryPath,
      REASON: 'CONTENT_STABLE_SNAPSHOT_TOO_LARGE',
    });
  }
  let sealedExecutor;
  try {
    sealedExecutor = realpathSync(PYTHON_EXECUTABLE);
    const executorFd = openSync(sealedExecutor, constants.O_RDONLY | constants.O_NOFOLLOW);
    const executorStat = fstatSync(executorFd);
    closeSync(executorFd);
    if (!executorStat.isFile() || executorStat.uid !== 0 || (executorStat.mode & 0o022) !== 0) {
      throw new Error('sealed executor is not a root-owned non-writable regular file');
    }
  } catch (error) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', {
      BINARY: binaryPath,
      REASON: 'SEALED_EXECUTOR_UNAVAILABLE',
      MESSAGE: error.message,
    });
  }
  const sealedArgv = (operation, argv = []) => [
    '-I',
    '-S',
    '-E',
    '-c',
    SEALED_EXEC_SCRIPT,
    binaryDigest,
    encodedBinary,
    operation,
    ...argv,
  ];
  const helperStdio = (input) => [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'];
  const probed = run(sealedExecutor, sealedArgv('probe'), {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: helperStdio(null),
  });
  let probe;
  try {
    probe = parseResponse(probed, 'probe');
  } catch (error) {
    cleanFailure();
    throw error;
  }
  if (probed.status !== 0 || probe.status !== 'READY') {
    cleanFailure();
    throw failure('LINUX_CUSTODY_HELPER_UNAVAILABLE', { EXIT_CODE: probed.status, STATUS: probe.status });
  }

  let closed = false;
  function invoke(operation, argv, { input = null, timeout = 10_000 } = {}) {
    if (closed) throw failure('LINUX_CUSTODY_HELPER_CLOSED', { OPERATION: operation });
    const result = run(sealedExecutor, sealedArgv(operation, argv), {
      encoding: input === null ? 'utf8' : undefined,
      input,
      maxBuffer: 4 * 1024 * 1024,
      stdio: helperStdio(input),
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
        command: sealedExecutor,
        argv: sealedArgv('launch', [rootPath, String(device), String(inode), executable, ...argv]),
        stdio: ['ignore', 'pipe', 'pipe'],
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
      closeBinary();
      rmSync(runtimeDirectory, { recursive: true, force: true });
    },
  };
}
