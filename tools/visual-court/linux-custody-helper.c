#define _GNU_SOURCE

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#ifdef __linux__
#include <poll.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#endif

#if defined(__linux__) && defined(SYS_openat2) && defined(SYS_pidfd_open) && defined(SYS_pidfd_send_signal)

struct open_how {
  uint64_t flags;
  uint64_t mode;
  uint64_t resolve;
};

#define RESOLVE_NO_MAGICLINKS 0x02U
#define RESOLVE_NO_SYMLINKS 0x04U
#define RESOLVE_BENEATH 0x08U

#define PROTOCOL_VERSION 1
#define MAX_PAYLOAD_BYTES (64U * 1024U * 1024U)

static void json_status(const char *status) {
  printf("{\"protocol\":%d,\"status\":\"%s\"}\n", PROTOCOL_VERSION, status);
}

static int fail_status(const char *status, int code) {
  json_status(status);
  return code;
}

static int openat2_exact(int directory_fd, const char *path, int flags, mode_t mode) {
  struct open_how how = {
    .flags = (uint64_t)flags,
    .mode = (uint64_t)mode,
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS,
  };
  return (int)syscall(SYS_openat2, directory_fd, path, &how, sizeof(how));
}

static int pidfd_open_exact(pid_t pid) {
  return (int)syscall(SYS_pidfd_open, pid, 0);
}

static int pidfd_signal_exact(int pidfd, int signal_number) {
  return (int)syscall(SYS_pidfd_send_signal, pidfd, signal_number, NULL, 0);
}

static int parse_u64(const char *value, unsigned long long *result) {
  char *end = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return -1;
  *result = parsed;
  return 0;
}

static int read_process_identity(pid_t pid, pid_t *parent_pid,
                                 unsigned long long *start_time) {
  char path[64];
  if (snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid) >= (int)sizeof(path)) return -1;
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  char buffer[4096];
  ssize_t count = read(fd, buffer, sizeof(buffer) - 1);
  int saved_errno = errno;
  close(fd);
  errno = saved_errno;
  if (count <= 0) return -1;
  buffer[count] = '\0';
  char *after_comm = strrchr(buffer, ')');
  if (after_comm == NULL || after_comm[1] != ' ') {
    errno = EINVAL;
    return -1;
  }
  char *cursor = after_comm + 2;
  char *save = NULL;
  char *token = strtok_r(cursor, " ", &save);
  for (int index = 0; index <= 19; index += 1) {
    if (token == NULL) { errno = EINVAL; return -1; }
    if (index == 1 && parent_pid != NULL) {
      unsigned long long parsed_parent = 0;
      if (parse_u64(token, &parsed_parent) != 0 || parsed_parent > INT32_MAX) {
        errno = EINVAL;
        return -1;
      }
      *parent_pid = (pid_t)parsed_parent;
    }
    if (index == 19) {
      if (parse_u64(token, start_time) != 0) { errno = EINVAL; return -1; }
      return 0;
    }
    token = strtok_r(NULL, " ", &save);
  }
  errno = EINVAL;
  return -1;
}

static int read_start_time(pid_t pid, unsigned long long *start_time) {
  return read_process_identity(pid, NULL, start_time);
}

static int validate_relative_path(const char *relative) {
  if (relative == NULL || relative[0] == '\0' || relative[0] == '/') return -1;
  const char *component = relative;
  for (const char *cursor = relative;; cursor += 1) {
    if (*cursor == '\\') return -1;
    if (*cursor == '/' || *cursor == '\0') {
      size_t length = (size_t)(cursor - component);
      if (length == 0 || (length == 1 && component[0] == '.')
          || (length == 2 && component[0] == '.' && component[1] == '.')) return -1;
      if (*cursor == '\0') break;
      component = cursor + 1;
    }
  }
  return 0;
}

static int open_root(const char *absolute_root, unsigned long long expected_dev,
                     unsigned long long expected_ino, struct stat *root_stat) {
  if (absolute_root == NULL || absolute_root[0] != '/') {
    errno = EINVAL;
    return -1;
  }
  int slash_fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (slash_fd < 0) return -1;
  const char *relative = absolute_root;
  while (*relative == '/') relative += 1;
  int root_fd = relative[0] == '\0'
    ? dup(slash_fd)
    : openat2_exact(slash_fd, relative, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
  int saved_errno = errno;
  close(slash_fd);
  errno = saved_errno;
  if (root_fd < 0) return -1;
  if (fstat(root_fd, root_stat) != 0
      || (unsigned long long)root_stat->st_dev != expected_dev
      || (unsigned long long)root_stat->st_ino != expected_ino
      || root_stat->st_nlink == 0) {
    close(root_fd);
    errno = ESTALE;
    return -1;
  }
  return root_fd;
}

static int write_all(int fd, const unsigned char *buffer, size_t count) {
  size_t offset = 0;
  while (offset < count) {
    ssize_t written = write(fd, buffer + offset, count - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return -1;
    offset += (size_t)written;
  }
  return 0;
}

static int write_artifact(const char *absolute_root, const char *dev_value,
                          const char *ino_value, const char *relative) {
  unsigned long long expected_dev = 0;
  unsigned long long expected_ino = 0;
  if (parse_u64(dev_value, &expected_dev) != 0 || parse_u64(ino_value, &expected_ino) != 0
      || validate_relative_path(relative) != 0 || strlen(relative) >= 4096) {
    return fail_status("INVALID_REQUEST", 2);
  }
  struct stat root_stat;
  int directory_fd = open_root(absolute_root, expected_dev, expected_ino, &root_stat);
  if (directory_fd < 0) return fail_status("OUTPUT_BINDING_LOST", 4);

  char path_buffer[4096];
  memcpy(path_buffer, relative, strlen(relative) + 1);
  char *last_slash = strrchr(path_buffer, '/');
  char *leaf = path_buffer;
  if (last_slash != NULL) {
    *last_slash = '\0';
    leaf = last_slash + 1;
    char *save = NULL;
    char *component = strtok_r(path_buffer, "/", &save);
    while (component != NULL) {
      int next_fd = openat2_exact(directory_fd, component, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
      if (next_fd < 0 && errno == ENOENT) {
        if (mkdirat(directory_fd, component, 0700) != 0 && errno != EEXIST) {
          close(directory_fd);
          return fail_status("OUTPUT_WRITE_REFUSED", 4);
        }
        next_fd = openat2_exact(directory_fd, component, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
      }
      if (next_fd < 0) {
        close(directory_fd);
        return fail_status("OUTPUT_WRITE_REFUSED", 4);
      }
      close(directory_fd);
      directory_fd = next_fd;
      component = strtok_r(NULL, "/", &save);
    }
  }

  int file_fd = openat2_exact(directory_fd, leaf,
    O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (file_fd < 0) {
    close(directory_fd);
    return fail_status("OUTPUT_WRITE_REFUSED", 4);
  }
  struct stat file_stat;
  if (fstat(file_fd, &file_stat) != 0 || !S_ISREG(file_stat.st_mode) || file_stat.st_nlink != 1) {
    close(file_fd);
    unlinkat(directory_fd, leaf, 0);
    close(directory_fd);
    return fail_status("OUTPUT_WRITE_REFUSED", 4);
  }

  unsigned char buffer[65536];
  size_t total = 0;
  int failed = 0;
  for (;;) {
    ssize_t count = read(STDIN_FILENO, buffer, sizeof(buffer));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { failed = 1; break; }
    if (count == 0) break;
    if (total + (size_t)count > MAX_PAYLOAD_BYTES || write_all(file_fd, buffer, (size_t)count) != 0) {
      failed = 1;
      break;
    }
    total += (size_t)count;
  }
  if (!failed && fsync(file_fd) != 0) failed = 1;
  if (close(file_fd) != 0) failed = 1;
  if (failed) {
    unlinkat(directory_fd, leaf, 0);
    close(directory_fd);
    return fail_status("OUTPUT_WRITE_REFUSED", 4);
  }
  if (fsync(directory_fd) != 0 || close(directory_fd) != 0) {
    return fail_status("OUTPUT_WRITE_REFUSED", 4);
  }
  printf("{\"protocol\":%d,\"status\":\"WROTE\",\"bytes\":%zu}\n", PROTOCOL_VERSION, total);
  return 0;
}

static int create_directory(const char *absolute_parent, const char *dev_value,
                            const char *ino_value, const char *name) {
  unsigned long long expected_dev = 0;
  unsigned long long expected_ino = 0;
  if (parse_u64(dev_value, &expected_dev) != 0 || parse_u64(ino_value, &expected_ino) != 0
      || validate_relative_path(name) != 0 || strchr(name, '/') != NULL || strlen(name) >= 256) {
    return fail_status("INVALID_REQUEST", 2);
  }
  struct stat parent_stat;
  int parent_fd = open_root(absolute_parent, expected_dev, expected_ino, &parent_stat);
  if (parent_fd < 0) return fail_status("DIRECTORY_CREATE_REFUSED", 4);
  if (mkdirat(parent_fd, name, 0700) != 0) {
    close(parent_fd);
    return fail_status("DIRECTORY_CREATE_REFUSED", 4);
  }
  int directory_fd = openat2_exact(parent_fd, name,
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, 0);
  struct stat directory_stat;
  int valid = directory_fd >= 0
    && fstat(directory_fd, &directory_stat) == 0
    && S_ISDIR(directory_stat.st_mode)
    && directory_stat.st_nlink > 0
    && directory_stat.st_uid == geteuid()
    && fchmod(directory_fd, 0700) == 0
    && fsync(directory_fd) == 0
    && fsync(parent_fd) == 0;
  if (directory_fd >= 0) close(directory_fd);
  if (!valid) {
    unlinkat(parent_fd, name, AT_REMOVEDIR);
    close(parent_fd);
    return fail_status("DIRECTORY_CREATE_REFUSED", 4);
  }
  close(parent_fd);
  printf("{\"protocol\":%d,\"status\":\"CREATED\",\"device\":\"%llu\",\"inode\":\"%llu\"}\n",
    PROTOCOL_VERSION, (unsigned long long)directory_stat.st_dev,
    (unsigned long long)directory_stat.st_ino);
  return 0;
}

static volatile sig_atomic_t supervisor_shutdown_requested = 0;

static void request_supervisor_shutdown(int signal_number) {
  (void)signal_number;
  supervisor_shutdown_requested = 1;
}

static long long monotonic_milliseconds(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return -1;
  return (long long)value.tv_sec * 1000LL + (long long)value.tv_nsec / 1000000LL;
}

static void pause_supervisor(void) {
  struct timespec delay = { .tv_sec = 0, .tv_nsec = 20 * 1000 * 1000 };
  while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {
    if (supervisor_shutdown_requested) continue;
  }
}

static void signal_direct_children(pid_t supervisor_pid, int signal_number) {
  DIR *directory = opendir("/proc");
  if (directory == NULL) return;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    unsigned long long parsed_pid = 0;
    if (parse_u64(entry->d_name, &parsed_pid) != 0 || parsed_pid == 0
        || parsed_pid > INT32_MAX || (pid_t)parsed_pid == supervisor_pid) continue;
    pid_t parent_pid = 0;
    unsigned long long observed_start = 0;
    if (read_process_identity((pid_t)parsed_pid, &parent_pid, &observed_start) != 0
        || parent_pid != supervisor_pid) continue;
    int pidfd = pidfd_open_exact((pid_t)parsed_pid);
    if (pidfd < 0) continue;
    unsigned long long confirmed_start = 0;
    if (read_start_time((pid_t)parsed_pid, &confirmed_start) == 0
        && confirmed_start == observed_start) {
      (void)pidfd_signal_exact(pidfd, signal_number);
    }
    close(pidfd);
  }
  closedir(directory);
}

static int launch_process(const char *absolute_root, const char *dev_value,
                          const char *ino_value, char **command_argv) {
  unsigned long long expected_dev = 0;
  unsigned long long expected_ino = 0;
  if (parse_u64(dev_value, &expected_dev) != 0 || parse_u64(ino_value, &expected_ino) != 0
      || command_argv == NULL || command_argv[0] == NULL || command_argv[0][0] != '/') {
    return fail_status("INVALID_REQUEST", 2);
  }
  struct stat root_stat;
  int root_fd = open_root(absolute_root, expected_dev, expected_ino, &root_stat);
  if (root_fd < 0) return fail_status("BROWSER_WORKSPACE_BINDING_LOST", 4);
  if (fchdir(root_fd) != 0) {
    close(root_fd);
    return fail_status("BROWSER_WORKSPACE_BINDING_LOST", 4);
  }
  if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) {
    close(root_fd);
    return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  }
  struct sigaction shutdown_action;
  memset(&shutdown_action, 0, sizeof(shutdown_action));
  shutdown_action.sa_handler = request_supervisor_shutdown;
  sigemptyset(&shutdown_action.sa_mask);
  if (sigaction(SIGTERM, &shutdown_action, NULL) != 0
      || sigaction(SIGINT, &shutdown_action, NULL) != 0) {
    close(root_fd);
    return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  }
  pid_t browser_pid = fork();
  if (browser_pid < 0) {
    close(root_fd);
    return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  }
  if (browser_pid == 0) {
    (void)setpgid(0, 0);
    close(root_fd);
    execv(command_argv[0], command_argv);
    _exit(127);
  }
  if (setpgid(browser_pid, browser_pid) != 0 && errno != EACCES && errno != ESRCH) {
    kill(browser_pid, SIGKILL);
    close(root_fd);
    return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  }
  close(root_fd);

  int browser_status = 0;
  int browser_status_seen = 0;
  long long shutdown_started = -1;
  int kill_escalated = 0;
  for (;;) {
    if (supervisor_shutdown_requested) {
      long long now = monotonic_milliseconds();
      if (shutdown_started < 0) {
        shutdown_started = now < 0 ? 0 : now;
        (void)kill(-browser_pid, SIGTERM);
      } else if (!kill_escalated && (now < 0 || now - shutdown_started >= 1000)) {
        kill_escalated = 1;
        (void)kill(-browser_pid, SIGKILL);
      }
      signal_direct_children(getpid(), kill_escalated ? SIGKILL : SIGTERM);
    }
    int child_status = 0;
    pid_t waited = waitpid(-1, &child_status, supervisor_shutdown_requested ? WNOHANG : 0);
    if (waited == browser_pid) {
      browser_status = child_status;
      browser_status_seen = 1;
    }
    if (waited > 0) continue;
    if (waited == 0) {
      pause_supervisor();
      continue;
    }
    if (waited < 0 && errno == EINTR) continue;
    if (waited < 0 && errno == ECHILD) break;
    return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  }
  if (!browser_status_seen) return fail_status("CHROMIUM_SUPERVISOR_FAILED", 4);
  if (WIFEXITED(browser_status)) return WEXITSTATUS(browser_status);
  if (WIFSIGNALED(browser_status)) return 128 + WTERMSIG(browser_status);
  return 4;
}

static int exact_process_status(pid_t pid, unsigned long long expected_start, int signal_number) {
  int pidfd = pidfd_open_exact(pid);
  if (pidfd < 0) {
    if (errno == ESRCH) return fail_status("EXITED_EXACT", 0);
    return fail_status("PROOF_UNAVAILABLE", 4);
  }
  unsigned long long current_start = 0;
  if (read_start_time(pid, &current_start) != 0) {
    struct pollfd descriptor = { .fd = pidfd, .events = POLLIN };
    int ready = poll(&descriptor, 1, 0);
    close(pidfd);
    if (ready == 1 && (descriptor.revents & POLLIN)) return fail_status("EXITED_EXACT", 0);
    return fail_status("PROOF_UNAVAILABLE", 4);
  }
  if (current_start != expected_start) {
    close(pidfd);
    return fail_status("IDENTITY_REPLACED", 0);
  }
  if (signal_number != 0) {
    if (pidfd_signal_exact(pidfd, signal_number) != 0) {
      int signal_errno = errno;
      close(pidfd);
      if (signal_errno == ESRCH) return fail_status("EXITED_EXACT", 0);
      return fail_status("PROOF_UNAVAILABLE", 4);
    }
    close(pidfd);
    return fail_status("SIGNALLED_EXACT", 0);
  }
  struct pollfd descriptor = { .fd = pidfd, .events = POLLIN };
  int ready = poll(&descriptor, 1, 0);
  close(pidfd);
  if (ready < 0) return fail_status("PROOF_UNAVAILABLE", 4);
  return fail_status(ready == 1 && (descriptor.revents & POLLIN) ? "EXITED_EXACT" : "LIVE_EXACT", 0);
}

static int process_operation(const char *pid_value, const char *start_value, const char *signal_value) {
  unsigned long long parsed_pid = 0;
  unsigned long long start_time = 0;
  if (parse_u64(pid_value, &parsed_pid) != 0 || parsed_pid == 0 || parsed_pid > INT32_MAX
      || parse_u64(start_value, &start_time) != 0) return fail_status("INVALID_REQUEST", 2);
  int signal_number = 0;
  if (signal_value != NULL) {
    if (strcmp(signal_value, "SIGTERM") == 0) signal_number = SIGTERM;
    else if (strcmp(signal_value, "SIGKILL") == 0) signal_number = SIGKILL;
    else return fail_status("INVALID_REQUEST", 2);
  }
  return exact_process_status((pid_t)parsed_pid, start_time, signal_number);
}

static int probe(void) {
  int slash_fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (slash_fd < 0) return fail_status("UNSUPPORTED", 3);
  int opened = openat2_exact(slash_fd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
  close(slash_fd);
  if (opened < 0) return fail_status("UNSUPPORTED", 3);
  close(opened);
  int pidfd = pidfd_open_exact(getpid());
  if (pidfd < 0) return fail_status("UNSUPPORTED", 3);
  int signal_result = pidfd_signal_exact(pidfd, 0);
  close(pidfd);
  if (signal_result != 0) return fail_status("UNSUPPORTED", 3);
  return fail_status("READY", 0);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "probe") == 0) return probe();
  if (argc == 6 && strcmp(argv[1], "mkdir") == 0) {
    return create_directory(argv[2], argv[3], argv[4], argv[5]);
  }
  if (argc == 6 && strcmp(argv[1], "write") == 0) {
    return write_artifact(argv[2], argv[3], argv[4], argv[5]);
  }
  if (argc >= 6 && strcmp(argv[1], "launch") == 0) {
    return launch_process(argv[2], argv[3], argv[4], &argv[5]);
  }
  if (argc == 4 && strcmp(argv[1], "status") == 0) {
    return process_operation(argv[2], argv[3], NULL);
  }
  if (argc == 5 && strcmp(argv[1], "signal") == 0) {
    return process_operation(argv[2], argv[3], argv[4]);
  }
  return fail_status("INVALID_REQUEST", 2);
}

#else

int main(void) {
  printf("{\"protocol\":1,\"status\":\"UNSUPPORTED\"}\n");
  return 3;
}

#endif
