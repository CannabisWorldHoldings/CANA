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

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const PYTHON_EXECUTABLE = '/usr/bin/python3';
const SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const PYTHON_ISOLATION_ARGV = ['-I', '-S', '-E', '-c'];
const PYTHON_CUSTODY_SCRIPT = String.raw`
import ctypes
import errno
import json
import os
import select
import signal
import stat
import sys
import time

PROTOCOL = 1
MAX_PAYLOAD_BYTES = 64 * 1024 * 1024
SYS_OPENAT2 = 437
RESOLVE_NO_MAGICLINKS = 0x02
RESOLVE_NO_SYMLINKS = 0x04
RESOLVE_BENEATH = 0x08
PR_SET_CHILD_SUBREAPER = 36

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long

class OpenHow(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint64), ("mode", ctypes.c_uint64), ("resolve", ctypes.c_uint64)]

def finish(status_name, code=0, **detail):
    sys.stdout.write(json.dumps({"protocol": PROTOCOL, "status": status_name, **detail}, separators=(",", ":")) + "\n")
    raise SystemExit(code)

def parse_uint(value):
    if not value or not value.isascii() or not value.isdigit():
        raise ValueError("not an unsigned integer")
    return int(value)

def valid_relative(value):
    if not value or value.startswith("/") or "\\" in value:
        return False
    return all(component not in ("", ".", "..") for component in value.split("/"))

def openat2(directory_fd, relative, flags, mode=0):
    how = OpenHow(flags, mode, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS)
    result = libc.syscall(
        SYS_OPENAT2,
        directory_fd,
        ctypes.c_char_p(os.fsencode(relative)),
        ctypes.byref(how),
        ctypes.sizeof(how),
    )
    if result < 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), relative)
    return int(result)

def open_root(absolute_root, expected_device, expected_inode):
    if not absolute_root.startswith("/"):
        raise ValueError("root must be absolute")
    slash_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        relative = absolute_root.lstrip("/")
        root_fd = os.dup(slash_fd) if not relative else openat2(
            slash_fd, relative, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        )
    finally:
        os.close(slash_fd)
    root_stat = os.fstat(root_fd)
    if root_stat.st_dev != expected_device or root_stat.st_ino != expected_inode or root_stat.st_nlink == 0:
        os.close(root_fd)
        raise OSError(errno.ESTALE, "root identity changed")
    return root_fd

def write_artifact(arguments):
    if len(arguments) != 4:
        finish("INVALID_REQUEST", 2)
    absolute_root, device_value, inode_value, relative = arguments
    try:
        device = parse_uint(device_value)
        inode = parse_uint(inode_value)
        if not valid_relative(relative) or len(relative) >= 4096:
            raise ValueError("invalid relative path")
        directory_fd = open_root(absolute_root, device, inode)
    except (OSError, ValueError):
        finish("OUTPUT_BINDING_LOST", 4)
    components = relative.split("/")
    leaf = components.pop()
    file_fd = None
    created = False
    try:
        for component in components:
            try:
                next_fd = openat2(directory_fd, component, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            except FileNotFoundError:
                os.mkdir(component, 0o700, dir_fd=directory_fd)
                next_fd = openat2(directory_fd, component, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = openat2(
            directory_fd,
            leaf,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            0o600,
        )
        created = True
        file_stat = os.fstat(file_fd)
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_nlink != 1:
            raise OSError(errno.EPERM, "created output is not an exclusive regular file")
        total = 0
        while True:
            chunk = sys.stdin.buffer.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_PAYLOAD_BYTES:
                raise OSError(errno.EFBIG, "payload too large")
            view = memoryview(chunk)
            while view:
                view = view[os.write(file_fd, view):]
        os.fsync(file_fd)
        os.close(file_fd)
        file_fd = None
        os.fsync(directory_fd)
        os.close(directory_fd)
        finish("WROTE", bytes=total)
    except OSError:
        if file_fd is not None:
            try: os.close(file_fd)
            except OSError: pass
        if created:
            try: os.unlink(leaf, dir_fd=directory_fd)
            except OSError: pass
        try: os.close(directory_fd)
        except OSError: pass
        finish("OUTPUT_WRITE_REFUSED", 4)

def create_directory(arguments):
    if len(arguments) != 4:
        finish("INVALID_REQUEST", 2)
    absolute_parent, device_value, inode_value, name = arguments
    created = False
    try:
        device = parse_uint(device_value)
        inode = parse_uint(inode_value)
        if not valid_relative(name) or "/" in name or len(name) >= 256:
            raise ValueError("invalid name")
        parent_fd = open_root(absolute_parent, device, inode)
        os.mkdir(name, 0o700, dir_fd=parent_fd)
        created = True
        directory_fd = openat2(
            parent_fd, name, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
        )
        directory_stat = os.fstat(directory_fd)
        if not stat.S_ISDIR(directory_stat.st_mode) or directory_stat.st_nlink == 0 or directory_stat.st_uid != os.geteuid():
            raise OSError(errno.EPERM, "created directory identity invalid")
        os.fchmod(directory_fd, 0o700)
        os.fsync(directory_fd)
        os.fsync(parent_fd)
        os.close(directory_fd)
        os.close(parent_fd)
        finish("CREATED", device=str(directory_stat.st_dev), inode=str(directory_stat.st_ino))
    except (OSError, ValueError):
        if created:
            try: os.rmdir(name, dir_fd=parent_fd)
            except (NameError, OSError): pass
        try: os.close(parent_fd)
        except (NameError, OSError): pass
        finish("DIRECTORY_CREATE_REFUSED", 4)

def read_identity(pid):
    descriptor = os.open(f"/proc/{pid}/stat", os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        raw = os.read(descriptor, 4095).decode("utf-8", "strict")
    finally:
        os.close(descriptor)
    after = raw.rsplit(") ", 1)[1].split()
    return int(after[1]), int(after[19])

def exact_process(pid, expected_start, signal_number=None):
    try:
        pidfd = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        finish("EXITED_EXACT")
    except OSError:
        finish("PROOF_UNAVAILABLE", 4)
    try:
        try:
            _, current_start = read_identity(pid)
        except OSError:
            poller = select.poll()
            poller.register(pidfd, select.POLLIN)
            ready = bool(poller.poll(0))
            finish("EXITED_EXACT" if ready else "PROOF_UNAVAILABLE", 0 if ready else 4)
        if current_start != expected_start:
            finish("IDENTITY_REPLACED")
        if signal_number is not None:
            try:
                signal.pidfd_send_signal(pidfd, signal_number, None, 0)
            except ProcessLookupError:
                finish("EXITED_EXACT")
            except OSError:
                finish("PROOF_UNAVAILABLE", 4)
            finish("SIGNALLED_EXACT")
        poller = select.poll()
        poller.register(pidfd, select.POLLIN)
        finish("EXITED_EXACT" if poller.poll(0) else "LIVE_EXACT")
    finally:
        os.close(pidfd)

shutdown_requested = False

def request_shutdown(_signal_number, _frame):
    global shutdown_requested
    shutdown_requested = True

def signal_direct_children(supervisor_pid, signal_number):
    try:
        entries = os.listdir("/proc")
    except OSError:
        return
    for entry in entries:
        if not entry.isdigit():
            continue
        pid = int(entry)
        if pid == supervisor_pid:
            continue
        try:
            parent_pid, observed_start = read_identity(pid)
            if parent_pid != supervisor_pid:
                continue
            pidfd = os.pidfd_open(pid, 0)
            try:
                _, confirmed_start = read_identity(pid)
                if confirmed_start == observed_start:
                    signal.pidfd_send_signal(pidfd, signal_number, None, 0)
            finally:
                os.close(pidfd)
        except OSError:
            continue

def launch_process(arguments):
    if len(arguments) < 4:
        finish("INVALID_REQUEST", 2)
    absolute_root, device_value, inode_value, executable, *command_arguments = arguments
    try:
        device = parse_uint(device_value)
        inode = parse_uint(inode_value)
        if not executable.startswith("/"):
            raise ValueError("executable must be absolute")
        root_fd = open_root(absolute_root, device, inode)
        os.fchdir(root_fd)
        if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")
        signal.signal(signal.SIGTERM, request_shutdown)
        signal.signal(signal.SIGINT, request_shutdown)
        browser_pid = os.fork()
        if browser_pid == 0:
            os.setpgid(0, 0)
            os.close(root_fd)
            os.execv(executable, [executable, *command_arguments])
        try:
            os.setpgid(browser_pid, browser_pid)
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.ESRCH):
                try: os.kill(browser_pid, signal.SIGKILL)
                except ProcessLookupError: pass
                os.close(root_fd)
                finish("CHROMIUM_SUPERVISOR_FAILED", 4)
        os.close(root_fd)
    except (OSError, ValueError):
        finish("BROWSER_WORKSPACE_BINDING_LOST", 4)
    browser_status = None
    shutdown_started = None
    kill_escalated = False
    while True:
        if shutdown_requested:
            now = time.monotonic()
            if shutdown_started is None:
                shutdown_started = now
                try: os.killpg(browser_pid, signal.SIGTERM)
                except ProcessLookupError: pass
            elif not kill_escalated and now - shutdown_started >= 1:
                kill_escalated = True
                try: os.killpg(browser_pid, signal.SIGKILL)
                except ProcessLookupError: pass
            signal_direct_children(os.getpid(), signal.SIGKILL if kill_escalated else signal.SIGTERM)
        try:
            waited, child_status = os.waitpid(-1, os.WNOHANG)
        except InterruptedError:
            continue
        except ChildProcessError:
            break
        if waited == 0:
            time.sleep(0.02)
            continue
        if waited == browser_pid:
            browser_status = child_status
    if browser_status is None:
        finish("CHROMIUM_SUPERVISOR_FAILED", 4)
    if os.WIFEXITED(browser_status):
        raise SystemExit(os.WEXITSTATUS(browser_status))
    if os.WIFSIGNALED(browser_status):
        raise SystemExit(128 + os.WTERMSIG(browser_status))
    raise SystemExit(4)

def probe():
    try:
        slash_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        opened = openat2(slash_fd, ".", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        os.close(opened)
        os.close(slash_fd)
        pidfd = os.pidfd_open(os.getpid(), 0)
        signal.pidfd_send_signal(pidfd, 0, None, 0)
        os.close(pidfd)
        read_identity(os.getpid())
        os.listdir("/proc")
    except OSError:
        finish("UNSUPPORTED", 3)
    finish("READY")

operation, *arguments = sys.argv[1:]
if operation == "probe" and not arguments:
    probe()
if operation == "write":
    write_artifact(arguments)
if operation == "mkdir":
    create_directory(arguments)
if operation == "launch":
    launch_process(arguments)
if operation in ("status", "signal"):
    try:
        pid = parse_uint(arguments[0])
        start_time = parse_uint(arguments[1])
        requested_signal = None
        if operation == "signal":
            requested_signal = {"SIGTERM": signal.SIGTERM, "SIGKILL": signal.SIGKILL}[arguments[2]]
        exact_process(pid, start_time, requested_signal)
    except (IndexError, KeyError, ValueError):
        finish("INVALID_REQUEST", 2)
finish("INVALID_REQUEST", 2)
`;

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
  return Object.freeze({
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: SAFE_PATH,
    TMPDIR: '/tmp',
    TZ: 'UTC',
  });
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
  run = spawnSync,
} = {}) {
  if (platform !== 'linux') throw failure('CHROMIUM_CLEANUP_PROOF_UNAVAILABLE', { PLATFORM: platform });
  const environment = custodyEnvironment();
  let trustedExecutor;
  try {
    trustedExecutor = trustedSystemExecutable(PYTHON_EXECUTABLE, 'custody interpreter');
  } catch (error) {
    throw failure('LINUX_CUSTODY_HELPER_UNTRUSTED', {
      REASON: 'TRUSTED_INTERPRETER_UNAVAILABLE',
      MESSAGE: error.message,
    });
  }
  const runtimeDigest = sha256(Buffer.from(PYTHON_CUSTODY_SCRIPT));
  const interpreterDigest = sha256(readFileSync(trustedExecutor));
  const custodyArgv = (operation, argv = []) => [
    ...PYTHON_ISOLATION_ARGV,
    PYTHON_CUSTODY_SCRIPT,
    operation,
    ...argv,
  ];
  const helperStdio = (input) => [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'];
  const probed = run(trustedExecutor, custodyArgv('probe'), {
    encoding: 'utf8',
    env: environment,
    timeout: 10_000,
    stdio: helperStdio(null),
  });
  let probe;
  try {
    probe = parseResponse(probed, 'probe');
  } catch (error) {
    throw error;
  }
  if (probed.status !== 0 || probe.status !== 'READY') {
    throw failure('LINUX_CUSTODY_HELPER_UNAVAILABLE', { EXIT_CODE: probed.status, STATUS: probe.status });
  }

  let closed = false;
  function invoke(operation, argv, { input = null, timeout = 10_000 } = {}) {
    if (closed) throw failure('LINUX_CUSTODY_HELPER_CLOSED', { OPERATION: operation });
    const result = run(trustedExecutor, custodyArgv(operation, argv), {
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
    binaryPath: trustedExecutor,
    sourcePath: 'inline:linux-custody-python',
    sourceSha256: runtimeDigest,
    binarySha256: interpreterDigest,
    compiler: null,
    compilerVersion: null,
    compileArgv: [],
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
        command: trustedExecutor,
        argv: custodyArgv('launch', [rootPath, String(device), String(inode), executable, ...argv]),
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
    },
  };
}
