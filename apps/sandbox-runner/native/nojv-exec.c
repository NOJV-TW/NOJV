#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

#define MAX_PROCESSES 4096

static int wake[2];
static long long cpu_us;
static long max_rss_kb;
static long peak_group_kb;

static void on_signal(int sig) {
  int saved = errno;
  unsigned char byte = (unsigned char)sig;
  (void)!write(wake[1], &byte, 1);
  errno = saved;
}

static long long now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void account(const struct rusage *usage) {
  cpu_us += (long long)usage->ru_utime.tv_sec * 1000000 + usage->ru_utime.tv_usec +
            (long long)usage->ru_stime.tv_sec * 1000000 + usage->ru_stime.tv_usec;
  long rss = usage->ru_maxrss;
#ifdef __APPLE__
  rss /= 1024;
#endif
  if (rss > max_rss_kb) max_rss_kb = rss;
}

static int list_processes(pid_t *pids, pid_t *parents) {
  int count = 0;
#ifdef __linux__
  DIR *proc = opendir("/proc");
  if (!proc) return 0;
  struct dirent *entry;
  while (count < MAX_PROCESSES && (entry = readdir(proc))) {
    char *end;
    long pid = strtol(entry->d_name, &end, 10);
    if (*end || pid <= 0) continue;
    char path[64], stat[512];
    snprintf(path, sizeof path, "/proc/%ld/stat", pid);
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) continue;
    ssize_t n = read(fd, stat, sizeof stat - 1);
    close(fd);
    if (n <= 0) continue;
    stat[n] = 0;
    char *tail = strrchr(stat, ')');
    char state;
    long ppid;
    if (!tail || sscanf(tail + 2, "%c %ld", &state, &ppid) != 2) continue;
    pids[count] = (pid_t)pid;
    parents[count] = (pid_t)ppid;
    count++;
  }
  closedir(proc);
#else
  (void)pids;
  (void)parents;
#endif
  return count;
}

static void kill_adopted_children(void) {
  static pid_t pids[MAX_PROCESSES], parents[MAX_PROCESSES];
  int count = list_processes(pids, parents);
  pid_t self = getpid();
  for (int i = 0; i < count; i++)
    if (parents[i] == self) kill(pids[i], SIGKILL);
}

static long resident_kb(pid_t pid) {
  char path[64], statm[128];
  snprintf(path, sizeof path, "/proc/%ld/statm", (long)pid);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  ssize_t n = read(fd, statm, sizeof statm - 1);
  close(fd);
  if (n <= 0) return 0;
  statm[n] = 0;
  long size, resident;
  if (sscanf(statm, "%ld %ld", &size, &resident) != 2) return 0;
  return resident * (sysconf(_SC_PAGESIZE) / 1024);
}

static long descendants_rss_kb(void) {
  static pid_t pids[MAX_PROCESSES], parents[MAX_PROCESSES], queue[MAX_PROCESSES];
  int count = list_processes(pids, parents);
  int head = 0, tail = 0;
  long total = 0;
  queue[tail++] = getpid();
  while (head < tail) {
    pid_t parent = queue[head++];
    for (int i = 0; i < count && tail < MAX_PROCESSES; i++) {
      if (parents[i] != parent) continue;
      queue[tail++] = pids[i];
      total += resident_kb(pids[i]);
    }
  }
  return total;
}

int main(int argc, char **argv) {
  if (argc < 6 || strcmp(argv[4], "--") != 0) {
    fputs("usage: nojv-exec CPU_SECONDS WALL_MS MEMORY_KB -- COMMAND [ARG...]\n", stderr);
    return 125;
  }
  long cpu_seconds = strtol(argv[1], NULL, 10);
  long long wall_ms = strtoll(argv[2], NULL, 10);
  long memory_kb = strtol(argv[3], NULL, 10);
  int exec_error[2];
  FILE *report = fdopen(3, "w");
  if (!report || fcntl(3, F_SETFD, FD_CLOEXEC) < 0 || pipe(wake) < 0 || pipe(exec_error) < 0)
    return 125;
  for (int i = 0; i < 2; i++) {
    fcntl(wake[i], F_SETFD, FD_CLOEXEC);
    fcntl(exec_error[i], F_SETFD, FD_CLOEXEC);
  }
  fcntl(wake[1], F_SETFL, O_NONBLOCK);
#ifdef __linux__
  prctl(PR_SET_CHILD_SUBREAPER, 1);
  prctl(PR_SET_DUMPABLE, 0);
#endif
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = on_signal;
  sigaction(SIGCHLD, &action, NULL);
  sigaction(SIGTERM, &action, NULL);

  long long started = now_ms();
  pid_t child = fork();
  if (child < 0) return 125;
  if (child == 0) {
    signal(SIGCHLD, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    setsid();
    struct rlimit no_core = {0, 0};
    setrlimit(RLIMIT_CORE, &no_core);
    if (cpu_seconds > 0) {
      struct rlimit cpu = {(rlim_t)cpu_seconds, (rlim_t)cpu_seconds + 1};
      setrlimit(RLIMIT_CPU, &cpu);
    }
    execvp(argv[5], argv + 5);
    int error = errno;
    (void)!write(exec_error[1], &error, sizeof error);
    _exit(127);
  }
  close(exec_error[1]);

  const char *killed = "none";
  int status = 0, main_done = 0, reaped_status;
  struct rusage usage;
  pid_t pid;
  while (!main_done) {
    long long left = started + wall_ms - now_ms();
    if (left <= 0) {
      killed = "wall";
      break;
    }
    long long timeout = memory_kb > 0 ? 10 : 60000;
    struct pollfd wake_fd = {wake[0], POLLIN, 0};
    if (poll(&wake_fd, 1, (int)(left < timeout ? left : timeout)) > 0) {
      unsigned char signals[64];
      ssize_t n = read(wake[0], signals, sizeof signals);
      for (ssize_t i = 0; i < n; i++)
        if (signals[i] == SIGTERM) killed = "term";
    }
    while ((pid = wait4(-1, &reaped_status, WNOHANG, &usage)) > 0) {
      account(&usage);
      if (pid == child) {
        status = reaped_status;
        main_done = 1;
      }
    }
    if (strcmp(killed, "term") == 0) break;
    if (memory_kb > 0 && !main_done) {
      long group_kb = descendants_rss_kb();
      if (group_kb > peak_group_kb) peak_group_kb = group_kb;
      if (group_kb > memory_kb) {
        killed = "memory";
        break;
      }
    }
  }

  kill(-child, SIGKILL);
  for (;;) {
    kill_adopted_children();
    pid = wait4(-1, &reaped_status, 0, &usage);
    if (pid < 0) {
      if (errno == EINTR) continue;
      break;
    }
    account(&usage);
    if (pid == child) {
      status = reaped_status;
      main_done = 1;
    }
  }

  int exec_errno = 0;
  if (read(exec_error[0], &exec_errno, sizeof exec_errno) != sizeof exec_errno) exec_errno = 0;
  fprintf(report,
          "{\"cpuUs\":%lld,\"maxRssKb\":%ld,\"peakGroupKb\":%ld,\"wallMs\":%lld,\"killed\":\"%s\"",
          cpu_us, max_rss_kb, peak_group_kb, now_ms() - started, killed);
  if (exec_errno)
    fprintf(report, ",\"execErrno\":%d", exec_errno);
  else if (WIFEXITED(status))
    fprintf(report, ",\"exitCode\":%d", WEXITSTATUS(status));
  else if (WIFSIGNALED(status))
    fprintf(report, ",\"signal\":%d", WTERMSIG(status));
  fputs("}\n", report);
  return fclose(report) == 0 ? 0 : 125;
}
