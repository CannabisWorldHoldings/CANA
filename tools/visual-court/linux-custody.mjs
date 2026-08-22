import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_HELPER_ARG_BYTES = 120 * 1024;
const PYTHON_EXECUTABLE = '/usr/bin/python3';
const DEFAULT_COMPILER = '/usr/bin/cc';
const SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const PYTHON_ISOLATION_ARGV = ['-I', '-S', '-E', '-c'];
const DISABLE_DUMPABILITY = [
  'libc = ctypes.CDLL(None, use_errno=True)',
  'if libc.prctl(4, 0, 0, 0, 0) != 0: raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE)")',
];
const SEALED_COMPILE_SCRIPT = [
  'import ctypes, fcntl, os, subprocess, sys',
  ...DISABLE_DUMPABILITY,
  'fd = os.memfd_create("cana-linux-custody-build", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)',
  'os.fchmod(fd, 0o600)',
  'source = sys.stdin.buffer.read()',
  'argv = [sys.argv[1], *sys.argv[2:], "-x", "c", "-o", f"/proc/self/fd/{fd}", "-"]',
  'result = subprocess.run(argv, input=source, pass_fds=(fd,), stdout=sys.stderr.buffer, stderr=sys.stderr.buffer)',
  'if result.returncode != 0: raise SystemExit(result.returncode)',
  'os.fchmod(fd, 0o500)',
  'seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE',
  'fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)',
  'os.lseek(fd, 0, os.SEEK_SET)',
  'while True:',
  '    chunk = os.read(fd, 65536)',
  '    if not chunk: break',
  '    sys.stdout.buffer.write(chunk)',
].join('\n');
const SEALED_EXEC_SCRIPT = [
  'import base64, ctypes, fcntl, hashlib, os, sys',
  ...DISABLE_DUMPABILITY,
  'payload = base64.b64decode(sys.argv[2], validate=True)',
  'if hashlib.sha256(payload).hexdigest() != sys.argv[1]: raise SystemExit(126)',
  'fd = os.memfd_create("cana-linux-custody-helper", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)',
  'view = memoryview(payload)',
  'while view: view = view[os.write(fd, view):]',
  'os.fchmod(fd, 0o500)',
  'seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE',
  'fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)',
  'os.execve(f"/proc/self/fd/{fd}", ["cana-linux-custody-helper", *sys.argv[3:]], dict(os.environ))',
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

function trustedSystemExecutable(input, label) {
  const resolved = realpathSync(input);
  const fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error(`${label} is not a root-owned non-writable regular file`);
    }
  } finally {
    closeSync(fd);
  }
  return resolved;
}

function custodyEnvironment() {
  return {
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: SAFE_PATH,
    TMPDIR: '/tmp',
    TZ: 'UTC',
  };
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
  compiler = DEFAULT_COMPILER,
  suppliedBinary = process.env.CANA_LINUX_CUSTODY_HELPER ?? null,
  expectedSourceSha256 = process.env.CANA_LINUX_CUSTODY_SOURCE_SHA256 ?? null,
  expectedBinarySha256 = process.env.CANA_LINUX_CUSTODY_BINARY_SHA256 ?? null,
  run = spawnSync,
} = {}) {
  if (platform !== 'linux') throw failure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', { PLATFORM: platform });
  const sourceBytes = readFileSync(sourcePath);
  const sourceDigest = sha256(sourceBytes);
  if (expectedSourceSha256 && expectedSourceSha256 !== sourceDigest) {
    throw failure('LINUX_CUSTODY_SOURCE_MISMATCH', { EXPECTED: expectedSourceSha256, ACTUAL: sourceDigest });
  }
  let binaryPath = suppliedBinary ? path.resolve(suppliedBinary) : null;
  let compilerVersion = null;
  const compileArgv = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror'];
  const environment = custodyEnvironment();
  let sealedExecutor;
  let trustedCompiler;
  try {
    sealedExecutor = trustedSystemExecutable(PYTHON_EXECUTABLE, 'sealed executor');
    trustedCompiler = trustedSystemExecutable(compiler, 'compiler');
  } catch (error) {
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', {
      REASON: 'TRUSTED_TOOLCHAIN_UNAVAILABLE',
      MESSAGE: error.message,
    });
  }
  let sourceBinaryFd = null;
  const closeBinary = () => {
    if (sourceBinaryFd !== null) closeSync(sourceBinaryFd);
    sourceBinaryFd = null;
  };
  const cleanFailure = () => closeBinary();
  let binaryBytes;
  if (binaryPath) {
    if (!expectedBinarySha256) {
      throw failure('LINUX_CUSTODY_BINARY_DIGEST_REQUIRED', { BINARY: binaryPath });
    }
    try {
      sourceBinaryFd = openSync(binaryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', { BINARY: binaryPath, MESSAGE: error.message });
    }
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
    binaryBytes = readFileSync(sourceBinaryFd);
    closeBinary();
  } else {
    const version = run(trustedCompiler, ['--version'], {
      encoding: 'utf8',
      env: environment,
      timeout: 10_000,
    });
    if (version.status !== 0) {
      throw failure('LINUX_CUSTODY_HELPER_BUILD_FAILED', { COMPILER: trustedCompiler });
    }
    compilerVersion = String(version.stdout).split('\n')[0];
    const compiled = run(
      sealedExecutor,
      [...PYTHON_ISOLATION_ARGV, SEALED_COMPILE_SCRIPT, trustedCompiler, ...compileArgv],
      {
        encoding: undefined,
        env: environment,
        input: sourceBytes,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    if (compiled.status !== 0 || !Buffer.isBuffer(compiled.stdout) || compiled.stdout.byteLength === 0) {
      throw failure('LINUX_CUSTODY_HELPER_BUILD_FAILED', {
        COMPILER: trustedCompiler,
        EXIT_CODE: compiled.status,
        STDERR: String(compiled.stderr ?? '').slice(-2_000),
      });
    }
    binaryBytes = compiled.stdout;
  }
  const binaryDigest = sha256(binaryBytes);
  if (expectedBinarySha256 && expectedBinarySha256 !== binaryDigest) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_BINARY_MISMATCH', { EXPECTED: expectedBinarySha256, ACTUAL: binaryDigest });
  }
  const encodedBinary = binaryBytes.toString('base64');
  if (Buffer.byteLength(encodedBinary) > MAX_HELPER_ARG_BYTES) {
    cleanFailure();
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', {
      BINARY: binaryPath,
      REASON: 'CONTENT_STABLE_SNAPSHOT_TOO_LARGE',
    });
  }
  const sealedArgv = (operation, argv = []) => [
    ...PYTHON_ISOLATION_ARGV,
    SEALED_EXEC_SCRIPT,
    binaryDigest,
    encodedBinary,
    operation,
    ...argv,
  ];
  const helperStdio = (input) => [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'];
  const probed = run(sealedExecutor, sealedArgv('probe'), {
    encoding: 'utf8',
    env: environment,
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
      env: environment,
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
    compiler: trustedCompiler,
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
        env: environment,
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
    },
  };
}
